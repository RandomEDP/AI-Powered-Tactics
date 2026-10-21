-- Any number a side, from 2 to 99, and at most 99 from one team in a game (Ethan, October 2026: "scale up any game for
-- any amount of players, cap at 99 per team"). Until now polls, results and challenges only took 5- or 7-a-side, a poll
-- at most 14 outfield, and a friendly at most 40 people.

alter table public.fixtures drop constraint if exists fixtures_side_check;
alter table public.fixtures add constraint fixtures_side_check check (side between 2 and 99);
alter table public.fixtures drop constraint if exists fixtures_max_outfield_check;
alter table public.fixtures add constraint fixtures_max_outfield_check check (max_outfield between 1 and 98);
alter table public.games drop constraint if exists games_side_check;
alter table public.games add constraint games_side_check check (side is null or side between 2 and 99);

-- A challenge's terms: any side from 2 to 99, and subs so the side and its subs are never more than 99.
create or replace function private.clean_terms(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare side integer := greatest(2, least(99, coalesce(nullif(p->>'side', '')::numeric, 5)::integer));
  half integer := greatest(1, least(60, coalesce(nullif(p->>'half', '')::numeric, 15)::integer));
  subs integer := greatest(0, least(99 - side, coalesce(nullif(p->>'subs', '')::numeric, 3)::integer));
  ko bigint := coalesce(nullif(p->>'ko_at', '')::numeric, 0)::bigint;
begin
  if ko < (extract(epoch from now()) * 1000)::bigint - 3600000 then raise exception 'Pick a date and time that hasn''t passed' using errcode = '22023'; end if;
  return jsonb_build_object('side', side, 'half', half, 'periods', case when (p->>'periods') = '1' then 1 else 2 end, 'subs', subs, 'ko_at', ko,
    'location', left(trim(coalesce(p->>'location', '')), 120), 'note', left(trim(coalesce(p->>'note', '')), 200));
end $$;

-- Accepting a challenge makes both polls: up to 98 outfield (with the keeper, 99).
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
  outfield := greatest(1, least(98, (c.terms->>'side')::integer - 1 + (c.terms->>'subs')::integer));
  insert into public.fixtures (team_id, opp, ko_at, location, max_outfield, side, kind, fmt)
    values (a.id, left(b.name, 60), (c.terms->>'ko_at')::bigint, c.terms->>'location', outfield, (c.terms->>'side')::integer, 'game', fmt) returning id into fa;
  insert into public.fixtures (team_id, opp, ko_at, location, max_outfield, side, kind, fmt)
    values (b.id, left(a.name, 60), (c.terms->>'ko_at')::bigint, c.terms->>'location', outfield, (c.terms->>'side')::integer, 'game', fmt) returning id into fb;
  update public.challenges set status = 'accepted', from_fixture = fa, to_fixture = fb, updated_at = now() where id = p_id;
  return 'ok';
end $$;

-- A friendly: up to 99 a side, so up to 198 people.
create or replace function public.friendly_people(p_people jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; mine public.profiles; pr public.profiles; x jsonb; who uuid; nm text; p integer; out jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_people, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_people, '[]'::jsonb)) > 198 then raise exception 'Up to 99 a side in a friendly' using errcode = '22023'; end if;
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
