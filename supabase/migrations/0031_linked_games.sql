-- Playing another team on Gaffer (Ethan: "type in another team's name when starting a new game and select them, so it
-- loads all of their players, and either team can upload footage and they can both mark the score").
-- 1. game_links: a gaffer picks a team on Gaffer as the opponent (search_teams) and kicks off; link_game asks that
--    team, and team-notify kind "link" tells its gaffers. Nothing of either team is shared until they accept.
-- 2. Once accepted, each team logs its own goals in its own game (games.link, and "link" in the live game), and
--    team_links gives each side the other's goals, squad names and clips for that game. Both apps add them up the same
--    way, so they show one score; a goal logged by both sides counts once.
-- 3. At full time each side keeps the other's goals in its own game (game_events.from_link), so its record, stats and
--    cut include them, and puts them right if the other side fixes theirs later.
-- No deletes or drops anywhere, so it can all go in through the Supabase MCP.

create table if not exists public.game_links (
  id uuid primary key default gen_random_uuid(),
  from_team uuid not null references public.teams (id) on delete cascade,
  to_team uuid not null references public.teams (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_team <> to_team)
);
create index if not exists game_links_from_idx on public.game_links (from_team, created_at desc);
create index if not exists game_links_to_idx on public.game_links (to_team, created_at desc);
alter table public.game_links enable row level security; -- no policies: only the functions below touch it

-- (no foreign key: a game keeps its link even if the other team is deleted, so a gaffer's phone can always save it; the
-- other side's game is only ever looked up by both its link and its own team, so pointing a game at a link does nothing)
alter table public.games add column if not exists link uuid;
create index if not exists games_link_idx on public.games (link) where link is not null;
alter table public.game_events add column if not exists from_link boolean not null default false;

-- A number from a JSON value, or null if it isn't one (the live game is the app's own JSON).
create or replace function private.jnum(j jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric end;
$$;
revoke all on function private.jnum(jsonb) from public, anon;
grant execute on function private.jnum(jsonb) to authenticated;

-- Gaffers: ask another team on Gaffer to link today's game. Returns the link's id.
create or replace function public.link_game(p_code text, p_to uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; o public.teams; new_id uuid;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then raise exception 'Only a gaffer can link a game' using errcode = '42501'; end if;
  select * into o from public.teams where id = p_to;
  if not found or o.id = t.id or not o.listed then raise exception 'That team can''t be found on Gaffer' using errcode = '22023'; end if;
  if (select count(*) from public.game_links l where l.from_team = t.id and l.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve asked ten teams today already' using errcode = '42501';
  end if;
  insert into public.game_links (from_team, to_team) values (t.id, o.id) returning id into new_id;
  return new_id;
end $$;

-- Gaffers: the team asked accepts or turns it down; either side can unlink it later ('cancel').
create or replace function public.link_answer(p_code text, p_id uuid, p_action text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; l public.game_links;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return 'not_gaffer'; end if;
  select * into l from public.game_links where id = p_id for update;
  if not found or (l.from_team <> t.id and l.to_team <> t.id) then return 'missing'; end if;
  if p_action = 'cancel' then
    if l.status not in ('proposed', 'accepted') then return 'closed'; end if;
    update public.game_links set status = 'cancelled', updated_at = now() where id = p_id;
    return 'ok';
  end if;
  if p_action not in ('accept', 'decline') then return 'unknown'; end if;
  if l.to_team <> t.id then return 'not_yours'; end if;
  if l.status <> 'proposed' then return 'closed'; end if;
  update public.game_links set status = case when p_action = 'accept' then 'accepted' else 'declined' end, updated_at = now() where id = p_id;
  return 'ok';
end $$;

-- One side's own goals in a linked game, as the other side sees them: from its live game while it's on, else from the
-- finished game. Its scorers by name; goals it only took from the other side (from_link / "lk") are left out, so
-- nothing goes round in a circle.
create or replace function private.link_side(p_team uuid, p_link uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st jsonb; g public.games; squad jsonb;
begin
  select l.state into st from public.live_matches l where l.team_id = p_team and l.state->>'link' = p_link::text;
  if st is not null then
    squad := (select coalesce(jsonb_agg(p.name order by p.pid), '[]'::jsonb) from public.players p
      where p.team_id = p_team and p.pid in (select private.jnum(x)::integer from jsonb_array_elements(case when jsonb_typeof(st->'squad') = 'array' then st->'squad' else '[]'::jsonb end) x));
    return jsonb_build_object('phase', coalesce(st->>'phase', 'pre'), 'squad', squad,
      'ko_at', round(private.jnum(st->'koAt'))::bigint, 'ft_at', round(private.jnum(st->'ftAt'))::bigint,
      'goals', coalesce((select jsonb_agg(jsonb_build_object('at', round(private.jnum(e->'at'))::bigint, 'min', round(private.jnum(e->'min'))::integer, 'x', round(private.jnum(e->'x'))::integer,
          'p', (select p.name from public.players p where p.team_id = p_team and p.pid = round(private.jnum(e->'p'))::integer),
          'a', (select p.name from public.players p where p.team_id = p_team and p.pid = round(private.jnum(e->'a'))::integer)) order by private.jnum(e->'at'))
        from jsonb_array_elements(case when jsonb_typeof(st->'events') = 'array' then st->'events' else '[]'::jsonb end) e
        where coalesce(e->>'hl', '') <> 'true' and coalesce(e->>'lk', '') <> 'true' and e->>'us' = 'true' and private.jnum(e->'at') is not null), '[]'::jsonb),
      'against', coalesce((select jsonb_agg(jsonb_build_object('at', round(private.jnum(e->'at'))::bigint, 'min', round(private.jnum(e->'min'))::integer, 'x', round(private.jnum(e->'x'))::integer) order by private.jnum(e->'at'))
        from jsonb_array_elements(case when jsonb_typeof(st->'events') = 'array' then st->'events' else '[]'::jsonb end) e
        where coalesce(e->>'hl', '') <> 'true' and coalesce(e->>'lk', '') <> 'true' and e->>'us' = 'false' and private.jnum(e->'at') is not null), '[]'::jsonb),
      'clips', '[]'::jsonb);
  end if;
  select * into g from public.games x where x.team_id = p_team and x.link = p_link order by x.created_at desc limit 1;
  if not found then return jsonb_build_object('phase', 'none', 'squad', '[]'::jsonb, 'goals', '[]'::jsonb, 'against', '[]'::jsonb, 'clips', '[]'::jsonb); end if;
  return jsonb_build_object('phase', 'ft', 'friendly', g.friendly, 'ko_at', g.ko_at, 'ht_at', g.ht_at, 'h2_at', g.h2_at, 'ft_at', g.ft_at, 'half', g.half, 'periods', g.periods,
    'squad', coalesce((select jsonb_agg(p.name order by p.pid) from public.game_players gp join public.players p on p.team_id = p_team and p.pid = gp.pid where gp.game_id = g.id), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'min', e.min, 'x', e.x,
        'p', (select p.name from public.players p where p.team_id = p_team and p.pid = e.pid),
        'a', (select p.name from public.players p where p.team_id = p_team and p.pid = e.assist)) order by e.at)
      from public.game_events e where e.game_id = g.id and e.kind = 'goal' and not e.from_link and e.at is not null), '[]'::jsonb),
    'against', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'min', e.min, 'x', e.x) order by e.at)
      from public.game_events e where e.game_id = g.id and e.kind = 'against' and not e.from_link and e.at is not null), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(jsonb_build_object('seq', c.seq, 'at', c.at, 'path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) order by c.at, c.seq)
      from public.clips c where c.team_id = p_team and c.game_id = g.id), '[]'::jsonb));
end $$;
revoke all on function private.link_side(uuid, uuid) from public, anon;
grant execute on function private.link_side(uuid, uuid) to authenticated;

-- A team's linked games, for anyone who has its code (as get_team): the requests it has sent, the ones waiting for its
-- gaffers (only gaffers see those), and the accepted ones with the other side's goals, squad and clips. Nothing of the
-- other team but its name, colours and crest until it has accepted.
create or replace function public.team_links(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; org boolean;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  org := private.is_organiser(t.id);
  return coalesce((select jsonb_agg(x.o order by x.w desc) from (
    select jsonb_build_object('id', l.id, 'status', l.status, 'sent', l.from_team = t.id,
        'at', (extract(epoch from l.created_at) * 1000)::bigint,
        'other', jsonb_build_object('id', o.id, 'name', o.name, 'short', o.short, 'color', o.color, 'crest', o.crest),
        'their', case when l.status = 'accepted' then private.link_side(o.id, l.id) end) as o, l.created_at as w
    from public.game_links l join public.teams o on o.id = case when l.from_team = t.id then l.to_team else l.from_team end
    where (l.from_team = t.id or l.to_team = t.id)
      and (l.status = 'accepted' or (l.status = 'proposed' and l.created_at > now() - interval '2 days' and (l.from_team = t.id or org))
        or (l.status in ('declined', 'cancelled') and l.from_team = t.id and l.updated_at > now() - interval '1 day'))
    order by l.created_at desc limit 30) x), '[]'::jsonb);
end $$;

revoke all on function public.link_game(text, uuid), public.link_answer(text, uuid, text), public.team_links(text) from public, anon, authenticated;
grant execute on function public.link_game(text, uuid), public.link_answer(text, uuid, text) to authenticated;
grant execute on function public.team_links(text) to anon, authenticated;

-- get_team: each game's link, and which goals were taken from the other side ('from_link').
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
        'periods', g.periods, 'side', g.side, 'tournament_id', g.tournament_id, 'tournament', g.tournament, 'house', g.house, 'reel', g.reel, 'link', g.link,
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
