-- Scorers for both sides in a friendly (Ethan, October 2026: "When playing a friendly game you should be able to select
-- who scored for both teams"). When the other side has nobody from Gaffer on it (a friendly against a team that isn't on
-- Gaffer), their scorers are typed in by name. In a game among the squad (and a friendly outside any team) the names go
-- with the house's guests, as before; in any other game they're kept here, as [{id, name}], and the game's events point
-- at those ids. They never count in anyone's stats (game_players only ever has the squad).

alter table public.games add column if not exists guests jsonb
  check (guests is null or (jsonb_typeof(guests) = 'array' and jsonb_array_length(guests) <= 99));

-- get_team gives the game's guests too (otherwise as in 0031).
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
        'periods', g.periods, 'side', g.side, 'tournament_id', g.tournament_id, 'tournament', g.tournament, 'house', g.house, 'reel', g.reel, 'link', g.link, 'guests', g.guests,
        'players', coalesce((select jsonb_agg(jsonb_build_object('pid', gp.pid, 'mins', gp.mins, 'goals', gp.goals, 'assists', gp.assists, 'scored_on', gp.scored_on, 'conceded', gp.conceded)) from public.game_players gp where gp.game_id = g.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'pid', e.pid, 'assist', e.assist, 'min', e.min, 'x', e.x, 'at', e.at, 'watch', e.watch, 'by_team', e.by_team, 'on_pitch', e.on_pitch, 'from_link', e.from_link) order by e.seq) from public.game_events e where e.game_id = g.id), '[]'::jsonb)
      ) order by g.seq, g.finished_at) from public.games g where g.team_id = t.id), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'opp', f.opp, 'ko_at', f.ko_at, 'location', f.location, 'cost', f.cost,
        'max_outfield', f.max_outfield, 'lineup', f.lineup, 'side', f.side, 'kind', f.kind, 'fmt', f.fmt,
        'votes', coalesce((select jsonb_agg(jsonb_build_object('pid', v.pid, 'choice', v.choice) order by v.voted_at) from public.fixture_votes v where v.fixture_id = f.id), '[]'::jsonb)
      ) order by f.ko_at) from public.fixtures f where f.team_id = t.id and f.status = 'open'), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(jsonb_build_object('game_id', c.game_id, 'seq', c.seq, 'path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'at', c.at, 'dur', c.dur, 'reel_at', c.reel_at, 'pids', coalesce((select jsonb_agg(x order by i) from unnest(c.pids) with ordinality u(x, i)
          where not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = x)), '[]'::jsonb),
        'off', coalesce((select jsonb_agg(h.pid order by h.pid) from public.clip_hides h where h.game_id = c.game_id and h.at = c.at), '[]'::jsonb))
      order by c.at, c.seq) from public.clips c where c.team_id = t.id), '[]'::jsonb),
    'reels', coalesce((select jsonb_agg(jsonb_build_object('pid', pr.pid, 'path', pr.path, 'store', pr.store, 'marks', pr.marks,
        'made_at', (extract(epoch from pr.made_at) * 1000)::bigint) order by pr.pid) from public.player_reels pr where pr.team_id = t.id and pr.path is not null), '[]'::jsonb),
    'live', (select l.state from public.live_matches l where l.team_id = t.id)
  );
end $function$;

-- A teammate logging a goal can type the other side's scorer, and who set it up, by name (`pn`, `an`): the gaffer's phone
-- adds them to the game. Otherwise as in 0001.
create or replace function public.queue_goal(p_code text, p_payload jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; clean jsonb;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not t.followers_can_score then return false; end if;
  if (select count(*) from public.goal_queue q where q.team_id = t.id) >= 50 then return false; end if;
  clean := jsonb_strip_nulls(jsonb_build_object(
    'us', case when jsonb_typeof(p_payload->'us') = 'boolean' then p_payload->'us' end,
    'p', case when jsonb_typeof(p_payload->'p') = 'number' then p_payload->'p' end,
    'a', case when jsonb_typeof(p_payload->'a') = 'number' then p_payload->'a' end,
    'pn', case when jsonb_typeof(p_payload->'pn') = 'string' then to_jsonb(left(trim(p_payload->>'pn'), 30)) end,
    'an', case when jsonb_typeof(p_payload->'an') = 'string' then to_jsonb(left(trim(p_payload->>'an'), 30)) end,
    'min', case when jsonb_typeof(p_payload->'min') = 'number' then p_payload->'min' end,
    'x', case when jsonb_typeof(p_payload->'x') = 'number' then p_payload->'x' end,
    'ts', case when jsonb_typeof(p_payload->'ts') = 'number' then p_payload->'ts' end));
  if clean->'us' is null then return false; end if;
  insert into public.goal_queue (team_id, payload) values (t.id, clean);
  return true;
end $$;
