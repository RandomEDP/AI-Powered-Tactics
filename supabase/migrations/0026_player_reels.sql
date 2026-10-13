-- A player's reel (made on a phone from their clips in Highlights, By player) is kept and plays on their card, with their
-- moments underneath to skip to. One per player: a new one replaces it. Only the player themselves (the squad member linked
-- to their account) or a gaffer can put one there; its file is in the player's own folder in the clip storage
-- ("<team id>/players/<pid>/"), where clip-store lets that player upload. marks: [{t: seconds into the reel, label}].

create table if not exists public.player_reels (
  team_id uuid not null references public.teams (id) on delete cascade,
  pid integer not null,
  path text check (path is null or char_length(path) <= 300),
  store text check (store is null or store in ('r2')),
  marks jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array' and jsonb_array_length(marks) <= 200),
  made_by uuid references auth.users (id) on delete set null,
  made_at timestamptz not null default now(),
  primary key (team_id, pid)
);
alter table public.player_reels enable row level security; -- no policies: only the functions below touch it

-- Keep a player's new reel (p_path), or take theirs off their card (p_path null). Returns {ok, old} with the file it
-- replaced (for the app to remove), or {error}: 'not_allowed' (not that player or a gaffer), 'bad_path', 'missing'.
create or replace function public.save_player_reel(p_code text, p_pid integer, p_path text, p_store text default null, p_marks jsonb default '[]'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; old_path text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not exists (select 1 from public.players p where p.team_id = t.id and p.pid = p_pid) then return jsonb_build_object('error', 'missing'); end if;
  if not (private.is_organiser(t.id) or exists (select 1 from public.players p where p.team_id = t.id and p.pid = p_pid and p.user_id = auth.uid())) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  if p_path is not null and (left(p_path, char_length(t.id::text || '/players/' || p_pid || '/')) <> t.id::text || '/players/' || p_pid || '/' or p_path like '%..%') then
    return jsonb_build_object('error', 'bad_path');
  end if;
  select r.path into old_path from public.player_reels r where r.team_id = t.id and r.pid = p_pid;
  insert into public.player_reels (team_id, pid, path, store, marks, made_by, made_at)
  values (t.id, p_pid, p_path, case when p_store = 'r2' then 'r2' end, case when p_path is null then '[]'::jsonb else coalesce(p_marks, '[]'::jsonb) end, auth.uid(), now())
  on conflict (team_id, pid) do update set path = excluded.path, store = excluded.store, marks = excluded.marks, made_by = excluded.made_by, made_at = excluded.made_at;
  return jsonb_build_object('ok', true, 'old', case when old_path is distinct from p_path then old_path end);
end $$;
revoke all on function public.save_player_reel(text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_player_reel(text, integer, text, text, jsonb) to authenticated;

-- get_team: each player's reel ('reels').
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
        'periods', g.periods, 'side', g.side, 'tournament_id', g.tournament_id, 'tournament', g.tournament, 'house', g.house, 'reel', g.reel,
        'players', coalesce((select jsonb_agg(jsonb_build_object('pid', gp.pid, 'mins', gp.mins, 'goals', gp.goals, 'assists', gp.assists, 'scored_on', gp.scored_on, 'conceded', gp.conceded)) from public.game_players gp where gp.game_id = g.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'pid', e.pid, 'assist', e.assist, 'min', e.min, 'x', e.x, 'at', e.at, 'watch', e.watch, 'by_team', e.by_team, 'on_pitch', e.on_pitch) order by e.seq) from public.game_events e where e.game_id = g.id), '[]'::jsonb)
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
