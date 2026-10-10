-- Player accounts. A signed-in person joins a team by claiming one of its players: that links their account to the
-- player's stats. Each player can be claimed once, and each account holds one player per team.
alter table public.players
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists last_name text check (last_name is null or char_length(last_name) <= 40);
create unique index if not exists players_one_per_user on public.players (team_id, user_id) where user_id is not null;
create index if not exists players_user_idx on public.players (user_id) where user_id is not null;

-- Claim a player on a team, by the team's code. Returns 'ok', 'taken' (someone else has it) or 'missing'.
create or replace function public.claim_player(p_code text, p_pid integer, p_last_name text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; holder uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'missing'; end if;
  select user_id into holder from public.players where team_id = t.id and pid = p_pid for update;
  if not found then return 'missing'; end if;
  if holder is not null and holder <> uid then return 'taken'; end if;
  update public.players set user_id = null where team_id = t.id and user_id = uid and pid <> p_pid;
  update public.players set user_id = uid, last_name = nullif(left(trim(coalesce(p_last_name, '')), 40), '') where team_id = t.id and pid = p_pid;
  return 'ok';
end $$;

-- Give up your player on a team (your stats stay with the player).
create or replace function public.release_player(p_code text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.players p set user_id = null from public.teams t where t.id = p.team_id and t.code = upper(trim(p_code)) and p.user_id = uid;
  return found;
end $$;

-- Every team the signed-in person belongs to, as a player or as a gaffer.
create or replace function public.my_teams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name,
      'org', exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = auth.uid()),
      'pid', (select p.pid from public.players p where p.team_id = t.id and p.user_id = auth.uid())) order by t.name), '[]'::jsonb)
  from public.teams t
  where auth.uid() is not null and (
    exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = auth.uid())
    or exists (select 1 from public.players p where p.team_id = t.id and p.user_id = auth.uid()));
$$;

-- get_team now also says which players are claimed, which one is you, and who the gaffers are.
create or replace function public.get_team(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
        'claimed', p.user_id is not null,
        'me', p.user_id is not null and p.user_id = auth.uid(),
        'gaffer', p.user_id is not null and exists (select 1 from public.team_members m where m.team_id = t.id and m.user_id = p.user_id),
        'last_name', case when org or p.user_id = auth.uid() then p.last_name end
      ) order by p.pid) from public.players p where p.team_id = t.id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'seq', g.seq, 'opp', g.opp, 'friendly', g.friendly, 'us', g.us, 'them', g.them, 'half', g.half,
        'ko_at', g.ko_at, 'ht_at', g.ht_at, 'h2_at', g.h2_at, 'ft_at', g.ft_at, 'finished_at', g.finished_at,
        'sync', g.sync, 'pre', g.pre, 'post', g.post, 'cap', g.cap,
        'players', coalesce((select jsonb_agg(jsonb_build_object('pid', gp.pid, 'mins', gp.mins, 'goals', gp.goals, 'assists', gp.assists)) from public.game_players gp where gp.game_id = g.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'pid', e.pid, 'assist', e.assist, 'min', e.min, 'x', e.x, 'at', e.at, 'watch', e.watch, 'by_team', e.by_team) order by e.seq) from public.game_events e where e.game_id = g.id), '[]'::jsonb)
      ) order by g.seq, g.finished_at) from public.games g where g.team_id = t.id), '[]'::jsonb),
    'live', (select l.state from public.live_matches l where l.team_id = t.id)
  );
end $$;

revoke all on function public.claim_player(text, integer, text), public.release_player(text), public.my_teams() from public, anon, authenticated;
grant execute on function public.claim_player(text, integer, text), public.release_player(text), public.my_teams() to authenticated;
