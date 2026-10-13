-- "Remove from my highlights": a player can take a clip out from under their own name. It stays in the game's highlights
-- (and in everyone else's); it just isn't listed under them, or put in their reels. A clip is known by its game and the
-- moment it was cut around (clips.at), so this lasts when the gaffer cuts the game again (which makes new clip rows).
-- Only the player themselves (the squad member linked to their account) can do it, and undo it.

create table if not exists public.clip_hides (
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  at bigint not null,
  pid integer not null,
  created_at timestamptz not null default now(),
  primary key (game_id, at, pid)
);
create index if not exists clip_hides_team_idx on public.clip_hides (team_id);
alter table public.clip_hides enable row level security; -- no policies: only the functions below touch it

-- p_hide true takes the clip out from under the caller's name, false puts it back. Returns 'ok', or 'not_in_squad' (not a
-- player in this team), 'no_clip' (no clip of that game at that moment).
create or replace function public.hide_clip(p_code text, p_game uuid, p_at bigint, p_hide boolean default true) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_pid integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'no_clip'; end if;
  select p.pid into v_pid from public.players p where p.team_id = t.id and p.user_id = auth.uid();
  if v_pid is null then return 'not_in_squad'; end if;
  if p_hide then
    if not exists (select 1 from public.clips c where c.team_id = t.id and c.game_id = p_game and c.at = p_at) then return 'no_clip'; end if;
    insert into public.clip_hides (team_id, game_id, at, pid) values (t.id, p_game, p_at, v_pid) on conflict do nothing;
  else
    delete from public.clip_hides h where h.team_id = t.id and h.game_id = p_game and h.at = p_at and h.pid = v_pid;
  end if;
  return 'ok';
end $$;
revoke all on function public.hide_clip(text, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.hide_clip(text, uuid, bigint, boolean) to authenticated;

-- get_team: a clip's players leave out anyone who has taken it out from under their name; 'off' lists who has.
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
      'settings', t.settings, 'followers_can_score', t.followers_can_score, 'organiser_code', case when org then t.organiser_code end,
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
