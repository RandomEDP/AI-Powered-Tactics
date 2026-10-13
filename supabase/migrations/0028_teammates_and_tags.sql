-- Teammates follow each other, names link to profiles, and people can be tagged in posts (Ethan asked).
-- 1. Everyone on a team (players with an account, and gaffers) follows everyone else on it, both ways, accepted straight
--    away even for a private profile: they're teammates. It happens when someone joins or claims their player, and once
--    here for everyone already on a team. Unfollowing a teammate afterwards sticks. People who've blocked each other are
--    left alone.
-- 2. team_people(code): which of the squad have a profile, so the app can link their names to it.
-- 3. post_tags: the people tagged in a post (up to 10, tag_post). A tagged person can take their tag off (untag_post); their
--    profile's Tagged tab lists the posts they're tagged in (user_tagged).
-- No deletes or drops anywhere (removing a tag sets `removed`), so it can all go in through the Supabase MCP.

-- ---------- 1. teammates follow each other
create or replace function private.team_users(p_team uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id from public.players p where p.team_id = p_team and p.user_id is not null
  union select m.user_id from public.team_members m where m.team_id = p_team;
$$;

create or replace function private.follow_teammates(p_team uuid, p_user uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.follows (follower, followee, status)
  select x.a, x.b, 'accepted' from (
    select p_user as a, u as b from private.team_users(p_team) u
    union select u, p_user from private.team_users(p_team) u) x
  where x.a <> x.b and not private.blocked(x.a, x.b)
  on conflict (follower, followee) do update set status = 'accepted';
$$;
revoke all on function private.team_users(uuid), private.follow_teammates(uuid, uuid) from public, anon, authenticated;

create or replace function private.on_teammate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.user_id is not distinct from old.user_id then return new; end if;
  end if;
  perform private.follow_teammates(new.team_id, new.user_id);
  return new;
end $$;
revoke all on function private.on_teammate() from public, anon, authenticated;

create or replace trigger players_follow_teammates after insert or update of user_id on public.players
  for each row execute function private.on_teammate();
create or replace trigger members_follow_teammates after insert on public.team_members
  for each row execute function private.on_teammate();

-- everyone already on a team
select private.follow_teammates(x.team_id, x.user_id) from (
  select team_id, user_id from public.players where user_id is not null
  union select team_id, user_id from public.team_members) x;

-- ---------- 2. which of the squad have a profile (signed in only; never anyone either of you has blocked)
create or replace function public.team_people(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('pid', p.pid, 'username', pr.username) order by p.pid), '[]'::jsonb)
  from public.teams t join public.players p on p.team_id = t.id join public.profiles pr on pr.user_id = p.user_id
  where auth.uid() is not null and t.code = upper(trim(p_code)) and not private.blocked(auth.uid(), p.user_id);
$$;
revoke all on function public.team_people(text) from public, anon, authenticated;
grant execute on function public.team_people(text) to authenticated;

-- ---------- 3. tags
create table if not exists public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  removed boolean not null default false,
  primary key (post_id, user_id)
);
create index if not exists post_tags_user_idx on public.post_tags (user_id) where not removed;
alter table public.post_tags enable row level security;

-- A post as the app shows it now also has who's tagged in it (not anyone blocked with you) and whether you are.
create or replace function private.post_json(p public.posts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'caption', p.caption, 'at', (extract(epoch from p.created_at) * 1000)::bigint,
    'username', pr.username, 'name', pr.name, 'mine', p.user_id = auth.uid(),
    'team', t.name, 'short', t.short, 'color', t.color,
    'video', case when p.kind = 'reel' then jsonb_build_object('path', p.path, 'store', p.store, 'label', 'Player reel')
      else (select jsonb_build_object('path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) from public.clips c where c.game_id = p.game_id and c.at = p.at order by c.seq limit 1) end,
    'likes', (select count(*) from public.post_likes l where l.post_id = p.id and l.liked),
    'liked', exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid() and l.liked),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('username', tp.username, 'name', tp.name) order by tp.username)
      from public.post_tags g join public.profiles tp on tp.user_id = g.user_id
      where g.post_id = p.id and not g.removed and (auth.uid() is null or not private.blocked(auth.uid(), g.user_id))), '[]'::jsonb),
    'tagged_me', exists (select 1 from public.post_tags g where g.post_id = p.id and g.user_id = auth.uid() and not g.removed))
  from public.profiles pr, public.teams t where pr.user_id = p.user_id and t.id = p.team_id;
$$;
revoke all on function private.post_json(public.posts) from public, anon, authenticated;

-- Tag people in your own post: usernames (up to 10 a post), anyone with one except yourself and anyone either of you has
-- blocked; unknown names are skipped. Called straight after create_post. Returns how many are tagged, or null.
create or replace function public.tag_post(p_id uuid, p_tags jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts where id = p_id and user_id = uid and removed_at is null) then return null; end if;
  insert into public.post_tags (post_id, user_id)
  select distinct p_id, pr.user_id from jsonb_array_elements_text(case when jsonb_typeof(p_tags) = 'array' then p_tags else '[]'::jsonb end) n
    join public.profiles pr on lower(pr.username) = lower(trim(n))
  where pr.user_id <> uid and not private.blocked(uid, pr.user_id)
  on conflict do nothing;
  if (select count(*) from public.post_tags where post_id = p_id) > 10 then raise exception 'Up to 10 people a post' using errcode = '22023'; end if;
  return (select count(*)::int from public.post_tags where post_id = p_id and not removed);
end $$;

-- Take your tag off someone's post. The post stays; you're no longer on it and it leaves your Tagged tab.
create or replace function public.untag_post(p_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  with off as (update public.post_tags set removed = true where post_id = p_id and user_id = auth.uid() and not removed returning 1)
  select exists (select 1 from off);
$$;

-- The posts someone is tagged in, for their profile's Tagged tab (if you can see their profile, and each post's author's).
create or replace function public.user_tagged(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select user_id into who from public.profiles where lower(username) = lower(trim(p_username));
  if who is null or not private.can_see(who) then return null; end if;
  return coalesce((select jsonb_agg(x.j order by x.c desc) from (
    select private.post_json(p) as j, p.created_at as c from public.posts p join public.post_tags g on g.post_id = p.id
    where g.user_id = who and not g.removed and p.removed_at is null and private.can_see(p.user_id)
    order by p.created_at desc limit 60) x where x.j is not null), '[]'::jsonb);
end $$;

revoke all on function public.tag_post(uuid, jsonb), public.untag_post(uuid), public.user_tagged(text) from public, anon, authenticated;
grant execute on function public.tag_post(uuid, jsonb), public.untag_post(uuid), public.user_tagged(text) to authenticated;
