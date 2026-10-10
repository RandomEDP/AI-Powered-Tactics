-- Playing other teams: a home ground so nearby teams can find each other, challenges with terms both gaffers
-- agree (which then become a poll for each team), and an Elo rating moved by "Elo matches" both teams report the same way.

create table if not exists public.team_rivalry (
  team_id uuid primary key references public.teams (id) on delete cascade,
  home_name text not null default '' check (char_length(home_name) <= 80),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  elo integer not null default 1000,
  elo_games integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.team_rivalry enable row level security; -- no policies: only the functions below touch it

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_team uuid not null references public.teams (id) on delete cascade,
  to_team uuid not null references public.teams (id) on delete cascade,
  kind text not null default 'friendly' check (kind in ('friendly', 'elo')),
  terms jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'cancelled', 'played', 'disputed')),
  turn uuid not null,                 -- the team whose answer is awaited
  rounds integer not null default 0,  -- how many times the terms have been sent back
  from_fixture uuid,
  to_fixture uuid,
  from_score jsonb,                   -- { us, them } as each team reported it
  to_score jsonb,
  elo_change jsonb,                   -- { from, to } once an Elo match is settled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_team <> to_team)
);
create index if not exists challenges_from_idx on public.challenges (from_team, updated_at desc);
create index if not exists challenges_to_idx on public.challenges (to_team, updated_at desc);
alter table public.challenges enable row level security;

-- Kilometres between two points.
create or replace function private.km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable set search_path = '' as $$
  select 6371 * 2 * asin(least(1, sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- Only what a challenge should hold, within sensible limits.
create or replace function private.clean_terms(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare side integer := case when (p->>'side') = '7' then 7 else 5 end;
  half integer := greatest(1, least(60, coalesce(nullif(p->>'half', '')::numeric, 15)::integer));
  subs integer := greatest(0, least(7, coalesce(nullif(p->>'subs', '')::numeric, 3)::integer));
  ko bigint := coalesce(nullif(p->>'ko_at', '')::numeric, 0)::bigint;
begin
  if ko < (extract(epoch from now()) * 1000)::bigint - 3600000 then raise exception 'Pick a date and time that hasn''t passed' using errcode = '22023'; end if;
  return jsonb_build_object('side', side, 'half', half, 'periods', case when (p->>'periods') = '1' then 1 else 2 end, 'subs', subs, 'ko_at', ko,
    'location', left(trim(coalesce(p->>'location', '')), 120), 'note', left(trim(coalesce(p->>'note', '')), 200));
end $$;

-- A team's home ground and rating, for anyone who has its code.
create or replace function public.rival_home(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; r public.team_rivalry;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  select * into r from public.team_rivalry where team_id = t.id;
  return jsonb_build_object('home', coalesce(r.home_name, ''), 'set', r.lat is not null, 'elo', coalesce(r.elo, 1000), 'games', coalesce(r.elo_games, 0));
end $$;

-- Gaffers: set where the team plays. Passing no position takes the team off the map.
create or replace function public.set_home(p_code text, p_name text, p_lat double precision, p_lng double precision) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return false; end if;
  insert into public.team_rivalry (team_id, home_name, lat, lng) values (t.id, left(trim(coalesce(p_name, '')), 80), round(p_lat::numeric, 3), round(p_lng::numeric, 3))
    on conflict (team_id) do update set home_name = excluded.home_name, lat = excluded.lat, lng = excluded.lng, updated_at = now();
  return true;
end $$;

-- Other teams that have set a home ground: the nearest ones, or those whose name matches.
create or replace function public.find_teams(p_code text, p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; me public.team_rivalry; q text := trim(coalesce(p_query, ''));
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.in_team(t.id) then return null; end if;
  select * into me from public.team_rivalry where team_id = t.id;
  return coalesce((select jsonb_agg(j order by ord) from (
    select jsonb_build_object('id', o.id, 'name', o.name, 'short', o.short, 'color', o.color, 'home', r.home_name, 'elo', r.elo, 'games', r.elo_games,
        'km', case when me.lat is null then null else round(private.km(me.lat, me.lng, r.lat, r.lng)::numeric, 1) end) as j,
      case when me.lat is null then 0 else private.km(me.lat, me.lng, r.lat, r.lng) end as ord
    from public.team_rivalry r join public.teams o on o.id = r.team_id
    where r.lat is not null and o.id <> t.id
      and case when q <> '' then o.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               else me.lat is not null and private.km(me.lat, me.lng, r.lat, r.lng) <= 40 end
    order by ord limit 30) x), '[]'::jsonb);
end $$;

-- Gaffers: challenge another team. Returns the challenge's id.
create or replace function public.challenge_send(p_code text, p_to uuid, p_kind text, p_terms jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; new_id uuid; open_ones integer;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then raise exception 'Only a gaffer can challenge a team' using errcode = '42501'; end if;
  if p_to = t.id or not exists (select 1 from public.team_rivalry r where r.team_id = p_to and r.lat is not null) then raise exception 'That team can''t be challenged' using errcode = '22023'; end if;
  select count(*) into open_ones from public.challenges c where c.from_team = t.id and c.status = 'proposed';
  if open_ones >= 10 then raise exception 'You have ten challenges waiting already' using errcode = '42501'; end if;
  insert into public.challenges (from_team, to_team, kind, terms, turn)
    values (t.id, p_to, case when p_kind = 'elo' then 'elo' else 'friendly' end, private.clean_terms(p_terms), p_to) returning id into new_id;
  return new_id;
end $$;

-- Gaffers: accept, send back different terms, or turn down. Accepting puts a poll in both teams' Games.
create or replace function public.challenge_reply(p_code text, p_id uuid, p_action text, p_terms jsonb default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; c public.challenges; other public.teams; a public.teams; b public.teams; fa uuid; fb uuid; fmt jsonb; outfield integer;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return 'not_gaffer'; end if;
  select * into c from public.challenges where id = p_id for update;
  if not found or (c.from_team <> t.id and c.to_team <> t.id) then return 'missing'; end if;
  if c.status <> 'proposed' then return 'closed'; end if;
  select * into other from public.teams where id = case when c.from_team = t.id then c.to_team else c.from_team end;
  if p_action = 'decline' then
    update public.challenges set status = case when c.from_team = t.id then 'cancelled' else 'declined' end, updated_at = now() where id = p_id;
    return 'ok';
  end if;
  if c.turn <> t.id then return 'not_your_turn'; end if;
  if p_action = 'counter' then
    update public.challenges set terms = private.clean_terms(p_terms), turn = other.id, rounds = c.rounds + 1, updated_at = now() where id = p_id;
    return 'ok';
  end if;
  if p_action <> 'accept' then return 'unknown'; end if;
  select * into a from public.teams where id = c.from_team;
  select * into b from public.teams where id = c.to_team;
  fmt := jsonb_build_object('side', (c.terms->>'side')::integer, 'half', (c.terms->>'half')::integer, 'sub', least(5, (c.terms->>'half')::integer), 'periods', (c.terms->>'periods')::integer);
  outfield := greatest(1, least(14, (c.terms->>'side')::integer - 1 + (c.terms->>'subs')::integer));
  insert into public.fixtures (team_id, opp, ko_at, location, max_outfield, side, kind, fmt)
    values (a.id, left(b.name, 60), (c.terms->>'ko_at')::bigint, c.terms->>'location', outfield, (c.terms->>'side')::integer, 'game', fmt) returning id into fa;
  insert into public.fixtures (team_id, opp, ko_at, location, max_outfield, side, kind, fmt)
    values (b.id, left(a.name, 60), (c.terms->>'ko_at')::bigint, c.terms->>'location', outfield, (c.terms->>'side')::integer, 'game', fmt) returning id into fb;
  update public.challenges set status = 'accepted', from_fixture = fa, to_fixture = fb, updated_at = now() where id = p_id;
  return 'ok';
end $$;

-- The team's challenges: anything still open, and the last few weeks of the rest.
create or replace function public.my_challenges(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.in_team(t.id) then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'status', c.status, 'terms', c.terms, 'rounds', c.rounds,
      'sent', c.from_team = t.id, 'my_turn', c.status = 'proposed' and c.turn = t.id,
      'fixture', case when c.from_team = t.id then c.from_fixture else c.to_fixture end,
      'my_score', case when c.from_team = t.id then c.from_score else c.to_score end,
      'elo_change', case when c.elo_change is null then null when c.from_team = t.id then c.elo_change->'from' else c.elo_change->'to' end,
      'other', jsonb_build_object('id', o.id, 'name', o.name, 'short', o.short, 'color', o.color, 'elo', coalesce(r.elo, 1000)),
      'at', (extract(epoch from c.updated_at) * 1000)::bigint) order by c.updated_at desc)
    from public.challenges c
      join public.teams o on o.id = case when c.from_team = t.id then c.to_team else c.from_team end
      left join public.team_rivalry r on r.team_id = o.id
    where (c.from_team = t.id or c.to_team = t.id) and (c.status in ('proposed', 'accepted', 'disputed') or c.updated_at > now() - interval '21 days')), '[]'::jsonb);
end $$;

-- Gaffers: report the final score of a game that came from a challenge. When both teams have reported the same score
-- the game is settled, and an Elo match moves both ratings.
create or replace function public.challenge_result(p_code text, p_id uuid, p_us integer, p_them integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; c public.challenges; mine jsonb; fs jsonb; ts jsonb; ra public.team_rivalry; rb public.team_rivalry;
  ea double precision; sa double precision; gd integer; g double precision; da integer; db integer;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return 'not_gaffer'; end if;
  select * into c from public.challenges where id = p_id for update;
  if not found or (c.from_team <> t.id and c.to_team <> t.id) then return 'missing'; end if;
  if c.status not in ('accepted', 'disputed') then return 'closed'; end if;
  mine := jsonb_build_object('us', greatest(0, least(99, p_us)), 'them', greatest(0, least(99, p_them)));
  fs := case when c.from_team = t.id then mine else c.from_score end;
  ts := case when c.to_team = t.id then mine else c.to_score end;
  update public.challenges set from_score = fs, to_score = ts, updated_at = now() where id = p_id;
  if fs is null or ts is null then return 'waiting'; end if;
  if (fs->>'us') <> (ts->>'them') or (fs->>'them') <> (ts->>'us') then
    update public.challenges set status = 'disputed' where id = p_id;
    return 'disputed';
  end if;
  if c.kind = 'elo' then
    insert into public.team_rivalry (team_id) values (c.from_team), (c.to_team) on conflict (team_id) do nothing;
    select * into ra from public.team_rivalry where team_id = c.from_team for update;
    select * into rb from public.team_rivalry where team_id = c.to_team for update;
    gd := abs((fs->>'us')::integer - (fs->>'them')::integer);
    sa := case when (fs->>'us')::integer > (fs->>'them')::integer then 1 when gd = 0 then 0.5 else 0 end;
    ea := 1 / (1 + power(10, (rb.elo - ra.elo) / 400.0));
    g := case when gd <= 1 then 1 when gd = 2 then 1.5 else (11 + gd) / 8.0 end; -- a bigger win moves the ratings more
    da := round((case when ra.elo_games < 10 then 40 else 32 end) * g * (sa - ea));
    db := round((case when rb.elo_games < 10 then 40 else 32 end) * g * (ea - sa));
    update public.team_rivalry set elo = greatest(100, elo + da), elo_games = elo_games + 1, updated_at = now() where team_id = c.from_team;
    update public.team_rivalry set elo = greatest(100, elo + db), elo_games = elo_games + 1, updated_at = now() where team_id = c.to_team;
    update public.challenges set status = 'played', elo_change = jsonb_build_object('from', da, 'to', db) where id = p_id;
  else
    update public.challenges set status = 'played' where id = p_id;
  end if;
  return 'played';
end $$;

revoke all on function private.km(double precision, double precision, double precision, double precision), private.clean_terms(jsonb) from public, anon;
grant execute on function private.km(double precision, double precision, double precision, double precision), private.clean_terms(jsonb) to authenticated;
revoke all on function public.rival_home(text), public.set_home(text, text, double precision, double precision), public.find_teams(text, text), public.challenge_send(text, uuid, text, jsonb),
  public.challenge_reply(text, uuid, text, jsonb), public.my_challenges(text), public.challenge_result(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.rival_home(text), public.set_home(text, text, double precision, double precision), public.find_teams(text, text), public.challenge_send(text, uuid, text, jsonb),
  public.challenge_reply(text, uuid, text, jsonb), public.my_challenges(text), public.challenge_result(text, uuid, integer, integer) to authenticated;
