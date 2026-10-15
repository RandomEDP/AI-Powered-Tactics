-- Goal of the Week, across every team on Gaffer (Ethan asked). Each week runs Monday to Sunday, UK time.
-- 1. A gaffer nominates one of their team's goals (a clip from the last 14 days) for this week: one a team a week. Choosing
--    another replaces it; withdrawing takes it down. Only nominated clips are ever shown outside their team.
-- 2. Anyone signed in watches the week's goals and votes for one (one vote a person a week, changeable until Sunday ends),
--    never for a team they play for or run. Nobody sees how many votes each has until the week is over.
-- 3. The first time anyone looks after the week ends, the goal with the most votes wins (a tie goes to the one nominated
--    first; it needs at least one vote). team-notify kind "gotw" then tells everyone in the nominated teams and everyone
--    who voted, once. The winning team's gaffer makes the winner's reel on their iPhone, with the team's name on its end
--    card, and it's kept here for everyone to watch.
-- 4. A sponsor's name ("presented by …") for a week goes in gotw_sponsors, in the dashboard; empty for now.
-- 5. Anyone can report a nominated goal (gotw_report); a moderator takes it down by setting pulled and removed_at.
-- No deletes or drops anywhere, so it can all go in through the Supabase MCP.

-- The Monday a moment falls in, by the UK's clock.
create or replace function private.gotw_week(p_at timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', p_at at time zone 'Europe/London')::date;
$$;
revoke all on function private.gotw_week(timestamptz) from public, anon, authenticated;

create table if not exists public.gotw_noms (
  id uuid primary key default gen_random_uuid(),
  week date not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  at bigint not null,            -- the clip is found by its game and moment, so a re-cut keeps the nomination
  nominated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,        -- withdrawn or replaced by the gaffer, or taken down by a moderator
  pulled boolean not null default false -- taken down by a moderator: it can't go up again
);
create unique index if not exists gotw_noms_one_a_week on public.gotw_noms (week, team_id) where removed_at is null;
create unique index if not exists gotw_noms_once on public.gotw_noms (game_id, at) where removed_at is null;
alter table public.gotw_noms enable row level security; -- no policies: only the functions below touch it

create table if not exists public.gotw_votes (
  week date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  nom_id uuid not null references public.gotw_noms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (week, user_id)
);
create index if not exists gotw_votes_nom_idx on public.gotw_votes (nom_id);
alter table public.gotw_votes enable row level security;

create table if not exists public.gotw_sponsors (
  week date primary key,
  name text not null check (char_length(name) between 1 and 60)
);
alter table public.gotw_sponsors enable row level security; -- filled in the dashboard

create table if not exists public.gotw_winners (
  week date primary key,
  nom_id uuid references public.gotw_noms (id) on delete set null, -- null: nobody voted that week
  team_id uuid references public.teams (id) on delete set null,
  votes integer not null default 0,
  sponsor text,
  reel jsonb check (reel is null or (jsonb_typeof(reel) = 'object' and char_length(reel::text) <= 1000)),
  decided_at timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.gotw_winners enable row level security;

create table if not exists public.gotw_reports (
  nom_id uuid not null references public.gotw_noms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (nom_id, user_id)
);
alter table public.gotw_reports enable row level security; -- read in the dashboard

-- Weeks that have ended get their winner, once.
create or replace function private.gotw_settle() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare w date; b_id uuid; b_team uuid; b_votes integer;
begin
  for w in select distinct n.week from public.gotw_noms n
    where n.week < private.gotw_week() and not exists (select 1 from public.gotw_winners x where x.week = n.week) order by 1 loop
    b_id := null; b_team := null; b_votes := 0;
    select n.id, n.team_id, count(v.user_id)::integer into b_id, b_team, b_votes
      from public.gotw_noms n left join public.gotw_votes v on v.nom_id = n.id and v.week = w
      where n.week = w and n.removed_at is null
      group by n.id, n.team_id, n.created_at order by count(v.user_id) desc, n.created_at limit 1;
    insert into public.gotw_winners (week, nom_id, team_id, votes, sponsor)
    values (w, case when coalesce(b_votes, 0) > 0 then b_id end, case when coalesce(b_votes, 0) > 0 then b_team end, coalesce(b_votes, 0),
      (select s.name from public.gotw_sponsors s where s.week = w))
    on conflict (week) do nothing;
  end loop;
end $$;
revoke all on function private.gotw_settle() from public, anon, authenticated;

-- One nominated goal as the app shows it: the team, the game, the clip (null if it's gone). Never the team's code, its
-- squad or its guests' names (beyond whoever the clip's caption names).
create or replace function private.gotw_entry(n public.gotw_noms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'team_id', t.id, 'team', t.name, 'short', t.short, 'color', t.color,
    'opp', g.opp, 'house', case when g.house is not null then jsonb_build_object('a', g.house -> 'a', 'b', g.house -> 'b') end,
    'played', coalesce(g.ko_at, g.finished_at), 'game_id', n.game_id, 'at', n.at,
    'mine', private.in_team(t.id), 'gaffer', private.is_organiser(t.id),
    'video', (select jsonb_build_object('path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur)
      from public.clips c where c.game_id = n.game_id and c.at = n.at order by c.seq limit 1))
  from public.teams t, public.games g where t.id = n.team_id and g.id = n.game_id;
$$;
revoke all on function private.gotw_entry(public.gotw_noms) from public, anon, authenticated;

-- This week's goals (in an order of their own for each person, so nobody's goal is always first), whether you've voted,
-- and the latest winner. Settles any week that has ended first.
create or replace function public.gotw_board() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); w date := private.gotw_week(); last public.gotw_winners;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform private.gotw_settle();
  select * into last from public.gotw_winners x where x.week < w and x.nom_id is not null order by x.week desc limit 1;
  return jsonb_build_object(
    'week', w,
    'ends', (extract(epoch from ((w + 7)::timestamp at time zone 'Europe/London')) * 1000)::bigint,
    'sponsor', (select s.name from public.gotw_sponsors s where s.week = w),
    'voted', (select v.nom_id from public.gotw_votes v join public.gotw_noms n on n.id = v.nom_id and n.removed_at is null where v.week = w and v.user_id = uid),
    'votes', (select count(*) from public.gotw_votes v join public.gotw_noms n on n.id = v.nom_id and n.removed_at is null where v.week = w),
    'entries', coalesce((select jsonb_agg(private.gotw_entry(n) order by md5(n.id::text || uid::text)) from public.gotw_noms n where n.week = w and n.removed_at is null), '[]'::jsonb),
    'last', case when last.week is null then null else jsonb_build_object('week', last.week, 'votes', last.votes, 'sponsor', last.sponsor, 'reel', last.reel,
      'notified', last.notified_at is not null, 'entry', (select private.gotw_entry(n) from public.gotw_noms n where n.id = last.nom_id and not n.pulled)) end);
end $$;

-- A gaffer puts one of their team's goals up for this week (replacing the one they chose before, if any).
-- Returns {ok, week} or {error}: 'not_gaffer', 'no_clip', 'too_old' (more than 14 days ago), 'not_a_goal', 'used' (it's
-- been up in an earlier week, or was taken down).
create or replace function public.gotw_nominate(p_code text, p_game uuid, p_at bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; c public.clips; w date := private.gotw_week();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return jsonb_build_object('error', 'not_gaffer'); end if;
  select * into c from public.clips where team_id = t.id and game_id = p_game and at = p_at order by seq limit 1;
  if not found then return jsonb_build_object('error', 'no_clip'); end if;
  if c.at < (extract(epoch from now() - interval '14 days') * 1000)::bigint then return jsonb_build_object('error', 'too_old'); end if;
  if not exists (select 1 from public.game_events e join public.games g on g.id = e.game_id
    where e.game_id = c.game_id and not e.from_link and e.at between c.at - 1000 and c.at + (coalesce(c.dur, 14) * 1000)::bigint
      and (e.kind = 'goal' or (e.kind = 'against' and e.pid is not null and g.house is not null))) then
    return jsonb_build_object('error', 'not_a_goal');
  end if;
  if exists (select 1 from public.gotw_noms n where n.game_id = c.game_id and n.at = c.at and (n.pulled or (n.removed_at is null and n.week <> w))) then
    return jsonb_build_object('error', 'used');
  end if;
  if exists (select 1 from public.gotw_noms n where n.week = w and n.team_id = t.id and n.removed_at is null and n.game_id = c.game_id and n.at = c.at) then
    return jsonb_build_object('ok', true, 'week', w); -- (it's already the one)
  end if;
  update public.gotw_noms set removed_at = now() where week = w and team_id = t.id and removed_at is null;
  insert into public.gotw_noms (week, team_id, game_id, at, nominated_by) values (w, t.id, c.game_id, c.at, uid);
  return jsonb_build_object('ok', true, 'week', w);
end $$;

-- A gaffer takes their team's goal back down this week.
create or replace function public.gotw_withdraw(p_code text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return false; end if;
  update public.gotw_noms set removed_at = now() where week = private.gotw_week() and team_id = t.id and removed_at is null;
  return found;
end $$;

-- A vote for one of this week's goals (again moves it). Returns {ok} or {error}: 'missing', 'closed', 'own_team'.
create or replace function public.gotw_vote(p_nom uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n public.gotw_noms; w date := private.gotw_week();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into n from public.gotw_noms where id = p_nom and removed_at is null;
  if not found then return jsonb_build_object('error', 'missing'); end if;
  if n.week <> w then return jsonb_build_object('error', 'closed'); end if;
  if private.in_team(n.team_id) then return jsonb_build_object('error', 'own_team'); end if;
  insert into public.gotw_votes (week, user_id, nom_id) values (w, uid, n.id)
  on conflict (week, user_id) do update set nom_id = excluded.nom_id, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Report a nominated goal to Gaffer (read in the dashboard). Once per person; again updates the reason.
create or replace function public.gotw_report(p_nom uuid, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.gotw_noms where id = p_nom) then return false; end if;
  insert into public.gotw_reports (nom_id, user_id, reason) values (p_nom, auth.uid(), left(coalesce(p_reason, ''), 200))
  on conflict (nom_id, user_id) do update set reason = excluded.reason, created_at = now();
  return true;
end $$;

-- The winning team's gaffer keeps the winner's reel (made on their iPhone, in the team's folder: <team id>/gotw/...).
-- Returns {ok, old} (old: the file it replaced, to remove) or {error}: 'not_yours', 'bad_path'.
create or replace function public.gotw_save_reel(p_week date, p_path text, p_store text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare wn public.gotw_winners;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into wn from public.gotw_winners where week = p_week;
  if not found or wn.team_id is null or not private.is_organiser(wn.team_id) then return jsonb_build_object('error', 'not_yours'); end if;
  if p_path is null or left(p_path, char_length(wn.team_id::text || '/gotw/')) <> wn.team_id::text || '/gotw/' or p_path like '%..%' or char_length(p_path) > 300 then
    return jsonb_build_object('error', 'bad_path');
  end if;
  update public.gotw_winners set reel = jsonb_build_object('path', p_path, 'store', case when p_store = 'r2' then 'r2' end,
    'made_at', (extract(epoch from now()) * 1000)::bigint) where week = p_week;
  return jsonb_build_object('ok', true, 'old', case when wn.reel ->> 'path' is distinct from p_path then wn.reel ->> 'path' end);
end $$;

revoke all on function public.gotw_board(), public.gotw_nominate(text, uuid, bigint), public.gotw_withdraw(text), public.gotw_vote(uuid),
  public.gotw_report(uuid, text), public.gotw_save_reel(date, text, text) from public, anon, authenticated;
grant execute on function public.gotw_board(), public.gotw_nominate(text, uuid, bigint), public.gotw_withdraw(text), public.gotw_vote(uuid),
  public.gotw_report(uuid, text), public.gotw_save_reel(date, text, text) to authenticated;
