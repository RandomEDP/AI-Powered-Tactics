-- Profiles and following. Every account picks a username. A profile shows the player's teams, results (never upcoming
-- games), stats, and up to three clips they choose. Each person picks whether their profile is public or private:
-- anyone signed in can follow a public profile straight away; following a private one is a request they accept.
-- The feed shows games played by the people you follow, leaving out your own teams' games (you've seen those already).
-- Anyone can be blocked (each disappears for the other, and any following between them ends) or reported.
-- Everything is reached through the functions below; the tables have RLS on and no policies.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  name text not null default '' check (char_length(name) <= 40),
  private boolean not null default false,
  pins jsonb not null default '[]'::jsonb check (jsonb_typeof(pins) = 'array' and jsonb_array_length(pins) <= 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_idx on public.profiles (lower(username));
alter table public.profiles enable row level security;

-- Usernames nobody can take, or only one account can (user_id: set in the live database, never written here).
create table if not exists public.reserved_usernames (
  handle text primary key check (handle = lower(handle)),
  user_id uuid references auth.users (id) on delete set null
);
alter table public.reserved_usernames enable row level security;
insert into public.reserved_usernames (handle) values ('edp'), ('ethan'), ('ethandp'), ('e_d_p_1'), ('gaffer'), ('admin'), ('support'), ('official')
  on conflict do nothing;

create table if not exists public.follows (
  follower uuid not null references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee, status);
alter table public.follows enable row level security;

create table if not exists public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked);
alter table public.blocks enable row level security;

create table if not exists public.profile_reports (
  reporter uuid not null references auth.users (id) on delete cascade,
  reported uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (reporter, reported)
);
alter table public.profile_reports enable row level security;

-- ---------- helpers
-- 'ok', 'invalid' (3 to 20 letters, numbers or _), 'taken' or 'reserved', for that person (null: someone not signed in yet).
create or replace function private.username_status(p_name text, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_name, '') !~ '^[A-Za-z0-9_]{3,20}$' then 'invalid'
    when exists (select 1 from public.reserved_usernames r where r.handle = lower(p_name) and (r.user_id is null or r.user_id is distinct from p_user)) then 'reserved'
    when exists (select 1 from public.profiles p where lower(p.username) = lower(p_name) and p.user_id is distinct from p_user) then 'taken'
    else 'ok' end;
$$;
-- Has either blocked the other?
create or replace function private.blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks x where (x.blocker = a and x.blocked = b) or (x.blocker = b and x.blocked = a));
$$;
-- Can the signed-in person see this profile's teams, results and clips?
create or replace function private.can_see(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not private.blocked(auth.uid(), p_user) and (
    p_user = auth.uid()
    or exists (select 1 from public.profiles p where p.user_id = p_user and not p.private)
    or exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p_user and f.status = 'accepted'));
$$;
revoke all on function private.username_status(text, uuid), private.blocked(uuid, uuid), private.can_see(uuid) from public, anon;
grant execute on function private.username_status(text, uuid), private.blocked(uuid, uuid), private.can_see(uuid) to authenticated;

-- A person's clips (from teams where they're a claimed player, not taken out from under their name), each with its game.
create or replace function private.clips_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('game_id', c.game_id, 'at', c.at, 'seq', c.seq, 'path', c.path, 'vpath', c.vpath, 'store', c.store,
      'label', c.label, 'dur', c.dur, 'team', t.short, 'team_name', t.name, 'color', t.color, 'opp', g.opp, 'us', g.us, 'them', g.them,
      'house', case when g.house is not null then jsonb_build_object('a', g.house->'a', 'b', g.house->'b', 'side', g.house->'side'->(p.pid::text)) end,
      'when', coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint)) order by c.at desc), '[]'::jsonb)
  from public.players p
  join public.teams t on t.id = p.team_id
  join public.clips c on c.team_id = p.team_id and p.pid = any (c.pids) and c.at is not null
  join public.games g on g.id = c.game_id
  where p.user_id = p_user
    and not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = p.pid);
$$;
revoke all on function private.clips_of(uuid) from public, anon, authenticated;

-- ---------- usernames
-- Is this username free? Anyone can ask (the sign-up form checks before the account exists).
create or replace function public.username_status(p_username text) returns text
language sql stable security definer set search_path = '' as $$ select private.username_status(trim(p_username), auth.uid()); $$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;

-- Pick or change your username, name and whether your profile is private. Returns 'ok' or why not ('invalid', 'taken',
-- 'reserved', 'name'). Going public accepts every request waiting.
create or replace function public.set_profile(p_username text, p_name text, p_private boolean default false) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_user text := trim(coalesce(p_username, '')); v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  st text;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  st := private.username_status(v_user, uid);
  if st <> 'ok' then return st; end if;
  insert into public.profiles (user_id, username, name, private) values (uid, v_user, v_name, coalesce(p_private, false))
  on conflict (user_id) do update set username = excluded.username, name = excluded.name, private = excluded.private, updated_at = now();
  if not coalesce(p_private, false) then update public.follows set status = 'accepted' where followee = uid and status = 'pending'; end if;
  return 'ok';
exception when unique_violation then return 'taken';
end $$;

-- Yours: username, name, private, pins, counts, and how many follow requests are waiting. Null until you've picked a username.
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', p.username, 'name', p.name, 'private', p.private, 'pins', p.pins,
    'followers', (select count(*) from public.follows f where f.followee = p.user_id and f.status = 'accepted'),
    'following', (select count(*) from public.follows f where f.follower = p.user_id and f.status = 'accepted'),
    'requests', (select count(*) from public.follows f where f.followee = p.user_id and f.status = 'pending'))
  from public.profiles p where p.user_id = auth.uid();
$$;

-- ---------- finding and seeing people
create or replace function public.find_people(p_query text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.o order by x.rank, x.u), '[]'::jsonb) from (
    select jsonb_build_object('username', p.username, 'name', p.name, 'private', p.private, 'me', p.user_id = auth.uid(),
        'follow', (select f.status from public.follows f where f.follower = auth.uid() and f.followee = p.user_id)) as o,
      case when lower(p.username) = lower(trim(p_query)) then 0 when lower(p.username) like lower(trim(p_query)) || '%' then 1 else 2 end as rank, lower(p.username) as u
    from public.profiles p
    where auth.uid() is not null and char_length(trim(coalesce(p_query, ''))) >= 2
      and (position(lower(trim(p_query)) in lower(p.username)) > 0 or position(lower(trim(p_query)) in lower(p.name)) > 0)
      and not private.blocked(auth.uid(), p.user_id)
    order by rank, u limit 20) x;
$$;

-- A profile by username. Null if there's no such person, or either has blocked the other. Someone private shows only their
-- name, username and counts until you follow them.
create or replace function public.get_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles; see boolean; out jsonb;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into p from public.profiles x where lower(x.username) = lower(trim(p_username));
  if not found or private.blocked(uid, p.user_id) then return null; end if;
  see := private.can_see(p.user_id);
  out := jsonb_build_object('username', p.username, 'name', p.name, 'private', p.private, 'me', p.user_id = uid, 'can_see', see,
    'follow', (select f.status from public.follows f where f.follower = uid and f.followee = p.user_id),
    'follows_me', (select f.status from public.follows f where f.follower = p.user_id and f.followee = uid),
    'followers', (select count(*) from public.follows f where f.followee = p.user_id and f.status = 'accepted'),
    'following', (select count(*) from public.follows f where f.follower = p.user_id and f.status = 'accepted'));
  if not see then return out; end if;
  return out || jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'short', t.short, 'color', t.color, 'crest', t.crest) order by t.name)
      from public.players pl join public.teams t on t.id = pl.team_id where pl.user_id = p.user_id), '[]'::jsonb),
    'stats', (select jsonb_build_object('games', count(*), 'goals', coalesce(sum(gp.goals), 0), 'assists', coalesce(sum(gp.assists), 0),
        'wins', count(*) filter (where case when g.house is null then g.us > g.them when g.house->'side'->>(gp.pid::text) = 'b' then g.them > g.us else g.us > g.them end))
      from public.players pl join public.game_players gp on gp.pid = pl.pid join public.games g on g.id = gp.game_id and g.team_id = pl.team_id
      where pl.user_id = p.user_id),
    'results', coalesce((select jsonb_agg(r.o order by r.w desc) from (
        select jsonb_build_object('team', t.short, 'team_name', t.name, 'opp', g.opp, 'us', g.us, 'them', g.them, 'friendly', g.friendly,
          'house', case when g.house is not null then jsonb_build_object('a', g.house->'a', 'b', g.house->'b', 'side', g.house->'side'->(gp.pid::text)) end,
          'goals', gp.goals, 'assists', gp.assists, 'when', coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint)) as o, coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint) as w
        from public.players pl join public.teams t on t.id = pl.team_id join public.game_players gp on gp.pid = pl.pid join public.games g on g.id = gp.game_id and g.team_id = pl.team_id
        where pl.user_id = p.user_id order by w desc limit 10) r), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(c order by (select i from jsonb_array_elements(p.pins) with ordinality e(v, i) where v->>'g' = c->>'game_id' and (v->>'at')::bigint = (c->>'at')::bigint))
      from jsonb_array_elements(private.clips_of(p.user_id)) c
      where exists (select 1 from jsonb_array_elements(p.pins) v where v->>'g' = c->>'game_id' and (v->>'at')::bigint = (c->>'at')::bigint)), '[]'::jsonb));
end $$;

-- Every clip of yours, across all your teams, to pick up to three from for your profile.
create or replace function public.my_clips() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return private.clips_of(auth.uid());
end $$;

-- The clips shown on your profile: up to three [{g: game id, at}] of your own. Returns 'ok', 'too_many', 'not_yours' or 'no_profile'.
create or replace function public.set_pins(p_pins jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); mine jsonb; v jsonb; clean jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then return 'no_profile'; end if;
  if jsonb_typeof(coalesce(p_pins, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_pins, '[]'::jsonb)) > 3 then return 'too_many'; end if;
  mine := private.clips_of(uid);
  for v in select * from jsonb_array_elements(coalesce(p_pins, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(mine) c where c->>'game_id' = v->>'g' and (c->>'at')::bigint = (v->>'at')::bigint) then return 'not_yours'; end if;
    clean := clean || jsonb_build_array(jsonb_build_object('g', v->>'g', 'at', (v->>'at')::bigint));
  end loop;
  update public.profiles set pins = clean, updated_at = now() where user_id = uid;
  return 'ok';
end $$;

-- ---------- following
-- Returns 'accepted' (following), 'pending' (they're private: asked), 'no_profile' (pick a username first), 'missing', 'self'.
create or replace function public.follow(p_username text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.profiles; st text;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then return 'no_profile'; end if;
  select * into p from public.profiles x where lower(x.username) = lower(trim(p_username));
  if not found or private.blocked(uid, p.user_id) then return 'missing'; end if;
  if p.user_id = uid then return 'self'; end if;
  st := case when p.private then 'pending' else 'accepted' end;
  insert into public.follows (follower, followee, status) values (uid, p.user_id, st)
  on conflict (follower, followee) do update set status = case when public.follows.status = 'accepted' then 'accepted' else excluded.status end
  returning status into st;
  return st;
end $$;

-- Stop following (or take back a request).
create or replace function public.unfollow(p_username text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with gone as (delete from public.follows f using public.profiles p
    where f.follower = auth.uid() and f.followee = p.user_id and lower(p.username) = lower(trim(p_username)) returning 1)
  select exists (select 1 from gone);
$$;

-- Accept a request (p_accept true), or turn it down / remove a follower (false).
create or replace function public.answer_follow(p_username text, p_accept boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); who uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select user_id into who from public.profiles where lower(username) = lower(trim(p_username));
  if who is null then return false; end if;
  if p_accept then update public.follows set status = 'accepted' where follower = who and followee = uid;
  else delete from public.follows where follower = who and followee = uid; end if;
  return found;
end $$;

-- Your requests waiting, who follows you and who you follow (each {username, name}).
create or replace function public.my_follows() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'name', p.name) order by f.created_at) from public.follows f join public.profiles p on p.user_id = f.follower where f.followee = auth.uid() and f.status = 'pending'), '[]'::jsonb),
    'followers', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'name', p.name) order by lower(p.username)) from public.follows f join public.profiles p on p.user_id = f.follower where f.followee = auth.uid() and f.status = 'accepted'), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'name', p.name, 'status', f.status) order by lower(p.username)) from public.follows f join public.profiles p on p.user_id = f.followee where f.follower = auth.uid()), '[]'::jsonb))
  where auth.uid() is not null;
$$;

-- ---------- the feed: games played in the last 60 days by people you follow, newest first, one card a game, with each
-- of their goals, assists and clips in it. Your own teams' games are left out: you've seen those already.
create or replace function public.my_feed() returns jsonb
language sql stable security definer set search_path = '' as $$
  with people as (
    select f.followee as uid, p.username, p.name from public.follows f join public.profiles p on p.user_id = f.followee
    where f.follower = auth.uid() and f.status = 'accepted' and not private.blocked(auth.uid(), f.followee)
  ), played as (
    select g.id, g.team_id, pl.pid, pe.username, pe.name, gp.goals, gp.assists from people pe
    join public.players pl on pl.user_id = pe.uid
    join public.game_players gp on gp.pid = pl.pid
    join public.games g on g.id = gp.game_id and g.team_id = pl.team_id
    where coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint) > (extract(epoch from now() - interval '60 days') * 1000)::bigint and not private.in_team(g.team_id)
  ), games as (
    select g.*, t.code, t.name as team_name, t.short as team_short, t.color from public.games g join public.teams t on t.id = g.team_id where g.id in (select id from played)
    order by coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint) desc limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.id, 'code', g.code, 'team', g.team_short, 'team_name', g.team_name, 'color', g.color,
      'opp', g.opp, 'us', g.us, 'them', g.them, 'friendly', g.friendly, 'house', case when g.house is not null then jsonb_build_object('a', g.house->'a', 'b', g.house->'b') end,
      'when', coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint),
      'people', (select jsonb_agg(jsonb_build_object('username', x.username, 'name', x.name, 'goals', x.goals, 'assists', x.assists,
          'side', case when g.house is not null then g.house->'side'->(x.pid::text) end) order by x.goals desc, x.username) from played x where x.id = g.id),
      'clips', coalesce((select jsonb_agg(jsonb_build_object('game_id', c.game_id, 'at', c.at, 'path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) order by c.at)
          from public.clips c where c.game_id = g.id and c.at is not null and exists (select 1 from played x where x.id = g.id and x.pid = any (c.pids)
            and not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = x.pid))), '[]'::jsonb)
    ) order by coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint) desc), '[]'::jsonb)
  from games g where auth.uid() is not null;
$$;

-- ---------- blocking and reporting
-- Block (true) or unblock (false). Blocking ends any following between you, either way.
create or replace function public.block_user(p_username text, p_block boolean default true) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); who uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select user_id into who from public.profiles where lower(username) = lower(trim(p_username));
  if who is null or who = uid then return false; end if;
  if p_block then
    insert into public.blocks (blocker, blocked) values (uid, who) on conflict do nothing;
    delete from public.follows where (follower = uid and followee = who) or (follower = who and followee = uid);
  else delete from public.blocks where blocker = uid and blocked = who; end if;
  return true;
end $$;

-- People you've blocked, so you can unblock them.
create or replace function public.my_blocks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'name', p.name) order by lower(p.username)), '[]'::jsonb)
  from public.blocks b join public.profiles p on p.user_id = b.blocked where b.blocker = auth.uid();
$$;

-- Report someone's profile to Gaffer (read in the dashboard). Once per person; reporting again updates the reason.
create or replace function public.report_user(p_username text, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); who uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select user_id into who from public.profiles where lower(username) = lower(trim(p_username));
  if who is null or who = uid then return false; end if;
  insert into public.profile_reports (reporter, reported, reason) values (uid, who, left(coalesce(p_reason, ''), 200))
  on conflict (reporter, reported) do update set reason = excluded.reason, created_at = now();
  return true;
end $$;

revoke all on function public.set_profile(text, text, boolean), public.my_profile(), public.find_people(text), public.get_profile(text), public.my_clips(),
  public.set_pins(jsonb), public.follow(text), public.unfollow(text), public.answer_follow(text, boolean), public.my_follows(), public.my_feed(),
  public.block_user(text, boolean), public.my_blocks(), public.report_user(text, text) from public, anon, authenticated;
grant execute on function public.set_profile(text, text, boolean), public.my_profile(), public.find_people(text), public.get_profile(text), public.my_clips(),
  public.set_pins(jsonb), public.follow(text), public.unfollow(text), public.answer_follow(text, boolean), public.my_follows(), public.my_feed(),
  public.block_user(text, boolean), public.my_blocks(), public.report_user(text, text) to authenticated;
