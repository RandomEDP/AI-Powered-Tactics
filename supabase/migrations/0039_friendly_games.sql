-- Friendly games, outside any team (Ethan: rework "Just me" into a general game that only counts as a friendly for
-- personal stats, never a team's; with people from your teams, other people on Gaffer and guests who aren't on it yet,
-- who are each sent a personal link afterwards).
-- Each account has one hidden team of its own for its friendlies (teams.personal), made the first time it's needed. Every
-- game, clip, reel and highlight works there exactly as in any team, and nothing in it touches a real team's record.
-- The people in a friendly are players of that hidden team: someone on Gaffer is linked to their account straight away (so
-- the game is in their profile's stats), and a guest is a name until they open their personal link and sign in
-- (friendly_claim), which links that player to their new account, goals, games and highlights included.
-- A personal team is never listed or searchable, isn't shown on anyone's profile, and its players don't follow each other.
-- No deletes or drops, so it can all go in through the Supabase MCP.

alter table public.teams add column if not exists personal boolean not null default false;
create unique index if not exists teams_one_personal on public.teams (created_by) where personal;

create table if not exists public.friendly_invites (
  token uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  pid integer not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz
);
create index if not exists friendly_invites_team_idx on public.friendly_invites (team_id, pid);
alter table public.friendly_invites enable row level security; -- no policies: only the functions below touch it

-- The signed-in person's own friendlies team, made the first time.
create or replace function private.friendly_team(p_user uuid) returns public.teams
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; pr public.profiles; tries integer := 0; first text;
begin
  select * into t from public.teams where personal and created_by = p_user;
  if found then return t; end if;
  select * into pr from public.profiles where user_id = p_user;
  first := nullif(split_part(regexp_replace(trim(coalesce(pr.name, '')), '\s+', ' ', 'g'), ' ', 1), '');
  loop
    begin
      insert into public.teams (code, organiser_code, name, short, color, settings, created_by, listed, personal)
      values (private.random_code(6), private.random_code(10), left(coalesce(first, pr.username, 'My') || '''s friendlies', 60), 'Friendlies', '#1f6b4a', '{}'::jsonb, p_user, false, true)
      returning * into t;
      exit;
    exception when unique_violation then
      select * into t from public.teams where personal and created_by = p_user; -- (made at the same moment on another phone)
      if found then return t; end if;
      tries := tries + 1; if tries > 8 then raise; end if;
    end;
  end loop;
  insert into public.team_members (team_id, user_id) values (t.id, p_user) on conflict do nothing;
  return t;
end $$;
revoke all on function private.friendly_team(uuid) from public, anon, authenticated;

-- Everyone playing in a friendly, as players of your friendlies team. p_people is a list of
--   {k, self: true}  you;   {k, u: username, n?}  someone on Gaffer (n: the name the app knows them by, if their profile has none);   {k, n: name}  a guest
-- (k is the app's own key, handed back). Someone on Gaffer is the same player in every friendly; so is a guest with the
-- same name who hasn't signed up yet. Returns {code, name, players: [{k, pid, name, linked}]}; pid is null for a username
-- that doesn't exist or belongs to someone either of you has blocked.
create or replace function public.friendly_people(p_people jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; mine public.profiles; pr public.profiles; x jsonb; who uuid; nm text; p integer; out jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_people, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_people, '[]'::jsonb)) > 40 then raise exception 'Up to 40 people in a friendly' using errcode = '22023'; end if;
  t := private.friendly_team(uid);
  select * into mine from public.profiles where user_id = uid;
  for x in select v from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) v loop
    who := null; nm := null; p := null;
    if jsonb_typeof(x) <> 'object' then continue; end if;
    if x->>'self' = 'true' then
      who := uid; nm := coalesce(nullif(trim(mine.name), ''), mine.username, 'Me');
    elsif x ? 'u' then
      select * into pr from public.profiles where lower(username) = lower(trim(x->>'u'));
      if found and not private.blocked(uid, pr.user_id) then who := pr.user_id; nm := coalesce(nullif(trim(pr.name), ''), nullif(left(regexp_replace(trim(coalesce(x->>'n', '')), '\s+', ' ', 'g'), 40), ''), pr.username); end if;
    else
      nm := nullif(left(regexp_replace(trim(coalesce(x->>'n', '')), '\s+', ' ', 'g'), 40), '');
    end if;
    if who is not null then
      select pl.pid into p from public.players pl where pl.team_id = t.id and pl.user_id = who;
      if p is null then
        select coalesce(max(pl.pid), 0) + 1 into p from public.players pl where pl.team_id = t.id;
        insert into public.players (team_id, pid, name, user_id) values (t.id, p, left(nm, 40), who);
      end if;
    elsif nm is not null then
      select pl.pid into p from public.players pl where pl.team_id = t.id and pl.user_id is null and lower(pl.name) = lower(nm) order by pl.pid limit 1;
      if p is null then
        select coalesce(max(pl.pid), 0) + 1 into p from public.players pl where pl.team_id = t.id;
        insert into public.players (team_id, pid, name) values (t.id, p, nm);
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('k', x->'k', 'pid', p,
      'name', (select pl.name from public.players pl where pl.team_id = t.id and pl.pid = p),
      'linked', p is not null and exists (select 1 from public.players pl where pl.team_id = t.id and pl.pid = p and pl.user_id is not null)));
  end loop;
  return jsonb_build_object('code', t.code, 'name', t.name, 'players', out);
end $$;

-- A personal link for one player of your friendlies team: the same one until it's been used.
create or replace function public.friendly_invite(p_code text, p_pid integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; tok uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code)) and personal;
  if not found or not private.is_organiser(t.id) then raise exception 'Only for your own friendlies' using errcode = '42501'; end if;
  if not exists (select 1 from public.players where team_id = t.id and pid = p_pid) then return null; end if;
  select i.token into tok from public.friendly_invites i where i.team_id = t.id and i.pid = p_pid and i.claimed_by is null order by i.created_at limit 1;
  if tok is null then insert into public.friendly_invites (team_id, pid) values (t.id, p_pid) returning token into tok; end if;
  return tok;
end $$;

-- Someone who was sent a personal link, signed in: that player becomes theirs (their goals, games and clips from the
-- friendlies go on their profile). Returns {status, code, name, player}; status is ok, missing, taken (someone else has
-- it) or already (they're in those friendlies under another name).
create or replace function public.friendly_claim(p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); i public.friendly_invites; t public.teams; holder uuid; pname text; st text;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into i from public.friendly_invites where token = p_token;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  select * into t from public.teams where id = i.team_id;
  select pl.user_id, pl.name into holder, pname from public.players pl where pl.team_id = t.id and pl.pid = i.pid for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if holder = uid then st := 'ok';
  elsif holder is not null then st := 'taken';
  elsif exists (select 1 from public.players pl where pl.team_id = t.id and pl.user_id = uid) then st := 'already';
  else
    update public.players set user_id = uid where team_id = t.id and pid = i.pid;
    st := 'ok';
  end if;
  if st = 'ok' and i.claimed_by is null then update public.friendly_invites set claimed_by = uid, claimed_at = now() where token = i.token; end if;
  return jsonb_build_object('status', st, 'code', t.code, 'name', t.name, 'player', pname);
end $$;

revoke all on function public.friendly_people(jsonb), public.friendly_invite(text, integer), public.friendly_claim(uuid) from public, anon, authenticated;
grant execute on function public.friendly_people(jsonb), public.friendly_invite(text, integer), public.friendly_claim(uuid) to authenticated;

-- People in a friendly don't start following each other (they're not teammates).
create or replace function private.on_teammate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.user_id is not distinct from old.user_id then return new; end if;
  end if;
  if exists (select 1 from public.teams t where t.id = new.team_id and t.personal) then return new; end if;
  perform private.follow_teammates(new.team_id, new.user_id);
  return new;
end $$;
revoke all on function private.on_teammate() from public, anon, authenticated;

-- my_teams says which are friendlies (yours, or someone else's you played in), so the app keeps them apart from teams.
create or replace function public.my_teams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name,
      'org', exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = auth.uid()),
      'pid', (select p.pid from public.players p where p.team_id = t.id and p.user_id = auth.uid()),
      'personal', t.personal) order by t.name), '[]'::jsonb)
  from public.teams t
  where auth.uid() is not null and (
    exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = auth.uid())
    or exists (select 1 from public.players p where p.team_id = t.id and p.user_id = auth.uid()));
$$;
revoke all on function public.my_teams() from public, anon, authenticated;
grant execute on function public.my_teams() to authenticated;

-- get_profile: as 0024, but friendlies teams aren't listed among someone's teams (their games still count in the stats).
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
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', case when t.listed then t.id end, 'name', t.name, 'short', t.short, 'color', t.color, 'crest', t.crest) order by t.name)
      from public.players pl join public.teams t on t.id = pl.team_id where pl.user_id = p.user_id and not t.personal), '[]'::jsonb),
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
revoke all on function public.get_profile(text) from public, anon, authenticated;
grant execute on function public.get_profile(text) to authenticated;
