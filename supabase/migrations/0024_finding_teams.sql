-- Finding teams. Teams can be searched for by name, and a team on someone's profile can be tapped, to look at its squad,
-- results, stats and highlights. A gaffer can take their team out of search in Options ("Let people find this team";
-- every team starts listed). The team's code is never shown this way: to follow or join a team you still need the code
-- from its gaffer. Upcoming games, chat, the live game and guests' names aren't shown either.

alter table public.teams add column if not exists listed boolean not null default true;

-- Teams whose name (or short name) has these letters in, for anyone signed in. No codes.
create or replace function public.search_teams(p_query text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.o order by x.rank, x.n), '[]'::jsonb) from (
    select jsonb_build_object('id', t.id, 'name', t.name, 'short', t.short, 'color', t.color, 'crest', t.crest,
        'players', (select count(*) from public.players p where p.team_id = t.id),
        'games', (select count(*) from public.games g where g.team_id = t.id)) as o,
      case when lower(t.name) like lower(trim(p_query)) || '%' then 0 else 1 end as rank, lower(t.name) as n
    from public.teams t
    where auth.uid() is not null and t.listed and char_length(trim(coalesce(p_query, ''))) >= 2
      and (position(lower(trim(p_query)) in lower(t.name)) > 0 or position(lower(trim(p_query)) in lower(coalesce(t.short, ''))) > 0)
    order by rank, n limit 20) x;
$$;

-- One team to look at, by its id: its squad (with the username of anyone who has a profile), each player's totals, the
-- last 20 results and the latest highlights. Null if the team isn't listed (unless you're in it). Never the team's code.
create or replace function public.view_team(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where id = p_team;
  if not found or not (t.listed or private.in_team(t.id)) then return null; end if;
  return jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'short', t.short, 'color', t.color, 'crest', t.crest),
    'mine', private.in_team(t.id),
    'players', coalesce((select jsonb_agg(jsonb_build_object('pid', p.pid, 'name', p.name, 'number', p.shirt_number, 'position', p.position,
        'username', (select pr.username from public.profiles pr where pr.user_id = p.user_id and not private.blocked(auth.uid(), p.user_id)),
        'games', (select count(*) from public.game_players gp join public.games g on g.id = gp.game_id where g.team_id = t.id and gp.pid = p.pid),
        'goals', (select coalesce(sum(gp.goals), 0) from public.game_players gp join public.games g on g.id = gp.game_id where g.team_id = t.id and gp.pid = p.pid),
        'assists', (select coalesce(sum(gp.assists), 0) from public.game_players gp join public.games g on g.id = gp.game_id where g.team_id = t.id and gp.pid = p.pid)
      ) order by p.pid) from public.players p where p.team_id = t.id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(r.o order by r.w desc) from (
        select jsonb_build_object('id', g.id, 'opp', g.opp, 'us', g.us, 'them', g.them, 'friendly', g.friendly, 'tournament', g.tournament,
          'house', case when g.house is not null then jsonb_build_object('a', g.house->'a', 'b', g.house->'b') end,
          'when', coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint),
          'scorers', coalesce((select jsonb_agg(jsonb_build_object('pid', gp.pid, 'goals', gp.goals) order by gp.goals desc, gp.pid) from public.game_players gp where gp.game_id = g.id and gp.goals > 0), '[]'::jsonb)) as o,
          coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint) as w
        from public.games g where g.team_id = t.id order by w desc limit 20) r), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(c.o order by c.at desc) from (
        select jsonb_build_object('game_id', c.game_id, 'at', c.at, 'path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) as o, c.at
        from public.clips c where c.team_id = t.id and c.at is not null order by c.at desc limit 12) c), '[]'::jsonb));
end $$;

revoke all on function public.search_teams(text), public.view_team(uuid) from public, anon, authenticated;
grant execute on function public.search_teams(text), public.view_team(uuid) to authenticated;

-- A team on someone's profile carries its id (to look at it) only while it's listed.
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

-- get_team: the team says whether it's listed (for the switch in Options).
create or replace function public.get_team(p_code text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare t public.teams; org boolean;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  org := private.is_organiser(t.id);
  return jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'short', t.short, 'color', t.color, 'crest', t.crest,
      'settings', t.settings, 'followers_can_score', t.followers_can_score, 'listed', t.listed, 'organiser_code', case when org then t.organiser_code end,
      'updated_at', t.updated_at),
    'is_organiser', org,
    'my_pid', (select p.pid from public.players p where p.team_id = t.id and p.user_id = auth.uid()),
    'players', coalesce((select jsonb_agg(jsonb_build_object('pid', p.pid, 'name', p.name,
        'position', p.position, 'number', p.shirt_number,
        'claimed', p.user_id is not null,
        'me', p.user_id is not null and p.user_id = auth.uid(),
        'gaffer', p.user_id is not null and exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = p.user_id),
        'last_name', case when org or p.user_id = auth.uid() then p.last_name end
      ) order by p.pid) from public.players p where p.team_id = t.id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'seq', g.seq, 'opp', g.opp, 'friendly', g.friendly, 'us', g.us, 'them', g.them, 'half', g.half,
        'ko_at', g.ko_at, 'ht_at', g.ht_at, 'h2_at', g.h2_at, 'ft_at', g.ft_at, 'finished_at', g.finished_at,
        'sync', g.sync, 'pre', g.pre, 'post', g.post, 'cap', g.cap, 'lineups', g.lineups,
        'periods', g.periods, 'side', g.side, 'tournament_id', g.tournament_id, 'tournament', g.tournament, 'house', g.house,
        'players', coalesce((select jsonb_agg(jsonb_build_object('pid', gp.pid, 'mins', gp.mins, 'goals', gp.goals, 'assists', gp.assists, 'scored_on', gp.scored_on, 'conceded', gp.conceded)) from public.game_players gp where gp.game_id = g.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'pid', e.pid, 'assist', e.assist, 'min', e.min, 'x', e.x, 'at', e.at, 'watch', e.watch, 'by_team', e.by_team, 'on_pitch', e.on_pitch) order by e.seq) from public.game_events e where e.game_id = g.id), '[]'::jsonb)
      ) order by g.seq, g.finished_at) from public.games g where g.team_id = t.id), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'opp', f.opp, 'ko_at', f.ko_at, 'location', f.location, 'cost', f.cost,
        'max_outfield', f.max_outfield, 'lineup', f.lineup, 'side', f.side, 'kind', f.kind, 'fmt', f.fmt,
        'votes', coalesce((select jsonb_agg(jsonb_build_object('pid', v.pid, 'choice', v.choice) order by v.voted_at) from public.fixture_votes v where v.fixture_id = f.id), '[]'::jsonb)
      ) order by f.ko_at) from public.fixtures f where f.team_id = t.id and f.status = 'open'), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(jsonb_build_object('game_id', c.game_id, 'seq', c.seq, 'path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'at', c.at, 'dur', c.dur, 'pids', coalesce((select jsonb_agg(x order by i) from unnest(c.pids) with ordinality u(x, i)
          where not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = x)), '[]'::jsonb),
        'off', coalesce((select jsonb_agg(h.pid order by h.pid) from public.clip_hides h where h.game_id = c.game_id and h.at = c.at), '[]'::jsonb))
      order by c.at, c.seq) from public.clips c where c.team_id = t.id), '[]'::jsonb),
    'live', (select l.state from public.live_matches l where l.team_id = t.id)
  );
end $function$;
