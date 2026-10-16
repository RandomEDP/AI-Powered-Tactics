-- Comments on posts (Ethan, for 1.1: "Can we add commenting on other peoples posts"). Anyone who can see a post can
-- comment on it (300 characters). A comment can be taken down by whoever wrote it or by the post's author, and reported
-- to Gaffer like a post (comment_reports, read in the dashboard; team-notify kind 'report' tells the moderators).
-- People blocked with you never see your comments, nor you theirs; and blocked from the post's author, you can't comment.
-- Taking one down sets removed_at (no deletes, so this applies through the MCP).

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_user_idx on public.post_comments (user_id, created_at desc);
alter table public.post_comments enable row level security; -- no policies: only the functions below touch it

create table if not exists public.comment_reports (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_reports enable row level security;

-- One comment as the app shows it.
create or replace function private.comment_json(c public.post_comments, p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'body', c.body, 'at', (extract(epoch from c.created_at) * 1000)::bigint,
    'username', pr.username, 'name', pr.name, 'mine', c.user_id = auth.uid(),
    'can_remove', c.user_id = auth.uid() or p_owner = auth.uid())
  from public.profiles pr where pr.user_id = c.user_id;
$$;
revoke all on function private.comment_json(public.post_comments, uuid) from public, anon, authenticated;

-- A post's comments, oldest first (the latest 200). Null if you can't see the post.
create or replace function public.post_comments(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.posts;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into p from public.posts where id = p_id and removed_at is null;
  if not found or not private.can_see(p.user_id) then return null; end if;
  return coalesce((select jsonb_agg(x.j order by x.t) from (
    select private.comment_json(c, p.user_id) as j, c.created_at as t from public.post_comments c
    where c.post_id = p_id and c.removed_at is null and not private.blocked(auth.uid(), c.user_id)
    order by c.created_at desc limit 200) x where x.j is not null), '[]'::jsonb);
end $$;

-- Comment on a post you can see. Returns {comment} or {error}: 'no_profile' (pick a username first), 'missing' (the
-- post's gone, or you can't see it), 'empty', 'too_many' (200 a day).
create or replace function public.add_comment(p_id uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.posts; v_body text := left(trim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')), 300); c public.post_comments;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then return jsonb_build_object('error', 'no_profile'); end if;
  select * into p from public.posts where id = p_id and removed_at is null;
  if not found or not private.can_see(p.user_id) then return jsonb_build_object('error', 'missing'); end if;
  if v_body = '' then return jsonb_build_object('error', 'empty'); end if;
  if (select count(*) from public.post_comments where user_id = uid and created_at > now() - interval '1 day') >= 200 then return jsonb_build_object('error', 'too_many'); end if;
  insert into public.post_comments (post_id, user_id, body) values (p_id, uid, v_body) returning * into c;
  return jsonb_build_object('comment', private.comment_json(c, p.user_id));
end $$;

-- Take a comment down: your own, or anyone's on your own post.
create or replace function public.remove_comment(p_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  with gone as (update public.post_comments c set removed_at = now(), removed_by = auth.uid()
    where c.id = p_id and c.removed_at is null
      and (c.user_id = auth.uid() or exists (select 1 from public.posts p where p.id = c.post_id and p.user_id = auth.uid()))
    returning 1)
  select exists (select 1 from gone);
$$;

-- Report a comment to Gaffer (read in the dashboard). Once per person; again updates the reason.
create or replace function public.report_comment(p_id uuid, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.post_comments where id = p_id) then return false; end if;
  insert into public.comment_reports (comment_id, user_id, reason) values (p_id, auth.uid(), left(coalesce(p_reason, ''), 200))
  on conflict (comment_id, user_id) do update set reason = excluded.reason, created_at = now();
  return true;
end $$;

revoke all on function public.post_comments(uuid), public.add_comment(uuid, text), public.remove_comment(uuid), public.report_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.post_comments(uuid), public.add_comment(uuid, text), public.remove_comment(uuid), public.report_comment(uuid, text) to authenticated;

-- Posts now say how many comments they have (as the reader sees them: not taken down, nobody blocked with you).
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
    'tagged_me', exists (select 1 from public.post_tags g where g.post_id = p.id and g.user_id = auth.uid() and not g.removed),
    'comments', (select count(*) from public.post_comments m where m.post_id = p.id and m.removed_at is null
      and (auth.uid() is null or not private.blocked(auth.uid(), m.user_id))))
  from public.profiles pr, public.teams t where pr.user_id = p.user_id and t.id = p.team_id;
$$;
revoke all on function private.post_json(public.posts) from public, anon, authenticated;
