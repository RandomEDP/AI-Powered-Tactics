-- Posts, like Instagram: people share their own moments (one of their clips, or their player reel) with a caption, from
-- the + on the Home feed. Home shows posts from people you follow, and your own; each profile has a grid of its posts.
-- Who can see a post is who can see its author's profile (public: anyone signed in; private: followers they've accepted;
-- never someone either has blocked). A post can be liked, removed by its author, or reported. No comments (yet).

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null check (kind in ('clip', 'reel')),
  game_id uuid,                 -- a clip: its game and moment (the clip is found by these, so a re-cut keeps the post)
  at bigint,
  path text check (path is null or char_length(path) <= 300), -- a reel: its file, kept while the post is up
  store text check (store is null or store in ('r2')),
  caption text not null default '' check (char_length(caption) <= 300),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);
alter table public.posts enable row level security; -- no policies: only the functions below touch it

create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  liked boolean not null default true,
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;

create table if not exists public.post_reports (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_reports enable row level security;

-- One post as the app shows it: who, which team, the video (a clip found by its game and moment; null if it's gone), likes.
create or replace function private.post_json(p public.posts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'caption', p.caption, 'at', (extract(epoch from p.created_at) * 1000)::bigint,
    'username', pr.username, 'name', pr.name, 'mine', p.user_id = auth.uid(),
    'team', t.name, 'short', t.short, 'color', t.color,
    'video', case when p.kind = 'reel' then jsonb_build_object('path', p.path, 'store', p.store, 'label', 'Player reel')
      else (select jsonb_build_object('path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) from public.clips c where c.game_id = p.game_id and c.at = p.at order by c.seq limit 1) end,
    'likes', (select count(*) from public.post_likes l where l.post_id = p.id and l.liked),
    'liked', exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid() and l.liked))
  from public.profiles pr, public.teams t where pr.user_id = p.user_id and t.id = p.team_id;
$$;
revoke all on function private.post_json(public.posts) from public, anon, authenticated;

-- Post one of your own clips (p_kind 'clip', p_game, p_at) or your player reel in a team (p_kind 'reel', p_team).
-- Returns {id} or {error}: 'no_profile' (pick a username first), 'not_yours', 'caption', 'too_many' (30 a day).
create or replace function public.create_post(p_kind text, p_team uuid default null, p_game uuid default null, p_at bigint default null, p_caption text default '') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_team uuid; v_path text; v_store text; v_cap text := left(trim(regexp_replace(coalesce(p_caption, ''), '\s+', ' ', 'g')), 300); new_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then return jsonb_build_object('error', 'no_profile'); end if;
  if (select count(*) from public.posts where user_id = uid and created_at > now() - interval '1 day') >= 30 then return jsonb_build_object('error', 'too_many'); end if;
  if p_kind = 'clip' then
    select c.team_id into v_team from public.players pl join public.clips c on c.team_id = pl.team_id and pl.pid = any (c.pids)
    where pl.user_id = uid and c.game_id = p_game and c.at = p_at
      and not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = pl.pid) limit 1;
  elsif p_kind = 'reel' then
    select pr.team_id, pr.path, pr.store into v_team, v_path, v_store from public.player_reels pr join public.players pl on pl.team_id = pr.team_id and pl.pid = pr.pid
    where pl.user_id = uid and pr.team_id = p_team and pr.path is not null;
  end if;
  if v_team is null then return jsonb_build_object('error', 'not_yours'); end if;
  insert into public.posts (user_id, team_id, kind, game_id, at, path, store, caption)
  values (uid, v_team, p_kind, case when p_kind = 'clip' then p_game end, case when p_kind = 'clip' then p_at end, v_path, v_store, v_cap)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

-- Take your own post down.
create or replace function public.remove_post(p_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  with gone as (update public.posts set removed_at = now() where id = p_id and user_id = auth.uid() and removed_at is null returning 1)
  select exists (select 1 from gone);
$$;

-- Like (true) or unlike (false) a post you can see.
create or replace function public.like_post(p_id uuid, p_like boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p public.posts;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into p from public.posts where id = p_id and removed_at is null;
  if not found or not private.can_see(p.user_id) then return null; end if;
  insert into public.post_likes (post_id, user_id, liked) values (p_id, auth.uid(), coalesce(p_like, true))
  on conflict (post_id, user_id) do update set liked = excluded.liked;
  return jsonb_build_object('likes', (select count(*) from public.post_likes l where l.post_id = p_id and l.liked), 'liked', coalesce(p_like, true));
end $$;

-- Report a post to Gaffer (read in the dashboard). Once per person; again updates the reason.
create or replace function public.report_post(p_id uuid, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts where id = p_id) then return false; end if;
  insert into public.post_reports (post_id, user_id, reason) values (p_id, auth.uid(), left(coalesce(p_reason, ''), 200))
  on conflict (post_id, user_id) do update set reason = excluded.reason, created_at = now();
  return true;
end $$;

-- Home: posts from the people you follow, and your own, newest first, 20 at a time (p_before: the oldest one's time, for more).
create or replace function public.get_feed(p_before bigint default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.c desc), '[]'::jsonb) from (
    select private.post_json(p) as j, p.created_at as c from public.posts p
    where auth.uid() is not null and p.removed_at is null
      and (p.user_id = auth.uid() or exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.user_id and f.status = 'accepted'))
      and not private.blocked(auth.uid(), p.user_id)
      and (p_before is null or p.created_at < to_timestamp(p_before / 1000.0))
    order by p.created_at desc limit 20) x where x.j is not null;
$$;

-- Someone's posts, for the grid on their profile (only if you can see their profile).
create or replace function public.user_posts(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select user_id into who from public.profiles where lower(username) = lower(trim(p_username));
  if who is null or not private.can_see(who) then return null; end if;
  return coalesce((select jsonb_agg(x.j order by x.c desc) from (
    select private.post_json(p) as j, p.created_at as c from public.posts p where p.user_id = who and p.removed_at is null order by p.created_at desc limit 60) x where x.j is not null), '[]'::jsonb);
end $$;

-- Your player reels, in every team you're in, to post one.
create or replace function public.my_reels() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'team', t.name, 'short', t.short, 'path', pr.path, 'store', pr.store,
      'moments', jsonb_array_length(pr.marks), 'made_at', (extract(epoch from pr.made_at) * 1000)::bigint) order by pr.made_at desc), '[]'::jsonb)
  from public.player_reels pr join public.players pl on pl.team_id = pr.team_id and pl.pid = pr.pid join public.teams t on t.id = pr.team_id
  where pl.user_id = auth.uid() and pr.path is not null;
$$;

revoke all on function public.create_post(text, uuid, uuid, bigint, text), public.remove_post(uuid), public.like_post(uuid, boolean), public.report_post(uuid, text),
  public.get_feed(bigint), public.user_posts(text), public.my_reels() from public, anon, authenticated;
grant execute on function public.create_post(text, uuid, uuid, bigint, text), public.remove_post(uuid), public.like_post(uuid, boolean), public.report_post(uuid, text),
  public.get_feed(bigint), public.user_posts(text), public.my_reels() to authenticated;

-- A player's reel that's been posted keeps its file when a new reel replaces it.
create or replace function public.save_player_reel(p_code text, p_pid integer, p_path text, p_store text default null, p_marks jsonb default '[]'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; old_path text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not exists (select 1 from public.players p where p.team_id = t.id and p.pid = p_pid) then return jsonb_build_object('error', 'missing'); end if;
  if not (private.is_organiser(t.id) or exists (select 1 from public.players p where p.team_id = t.id and p.pid = p_pid and p.user_id = auth.uid())) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  if p_path is not null and (left(p_path, char_length(t.id::text || '/players/' || p_pid || '/')) <> t.id::text || '/players/' || p_pid || '/' or p_path like '%..%') then
    return jsonb_build_object('error', 'bad_path');
  end if;
  select r.path into old_path from public.player_reels r where r.team_id = t.id and r.pid = p_pid;
  insert into public.player_reels (team_id, pid, path, store, marks, made_by, made_at)
  values (t.id, p_pid, p_path, case when p_store = 'r2' then 'r2' end, case when p_path is null then '[]'::jsonb else coalesce(p_marks, '[]'::jsonb) end, auth.uid(), now())
  on conflict (team_id, pid) do update set path = excluded.path, store = excluded.store, marks = excluded.marks, made_by = excluded.made_by, made_at = excluded.made_at;
  -- (the file it replaced goes, unless it's been posted: the post still plays it)
  return jsonb_build_object('ok', true, 'old', case when old_path is distinct from p_path and not exists (select 1 from public.posts x where x.path = old_path and x.removed_at is null) then old_path end);
end $$;
