-- Keep internal helpers out of the public API: move them to a private schema the API does not expose.
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_organiser(uuid) set schema private;
alter function public.game_team(uuid) set schema private;
alter function public.random_code(integer) set schema private;
alter function public.touch_updated_at() set schema private;

-- ---------- functions the app calls
-- Everything about one team, by its follow code. Only organisers get the organiser invite code back.
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
    'players', coalesce((select jsonb_agg(jsonb_build_object('pid', p.pid, 'name', p.name) order by p.pid) from public.players p where p.team_id = t.id), '[]'::jsonb),
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

-- A signed-in user creates a team; they become its first organiser.
create or replace function public.create_team(p_name text, p_short text, p_color text, p_crest text, p_settings jsonb, p_players jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; tries integer := 0;
begin
  if uid is null then raise exception 'Sign in to create a team' using errcode = '42501'; end if;
  if (select count(*) from public.team_members where user_id = uid) >= 20 then raise exception 'Team limit reached' using errcode = '54000'; end if;
  loop
    begin
      insert into public.teams (code, organiser_code, name, short, color, crest, settings, created_by)
      values (private.random_code(6), private.random_code(10), trim(p_name), coalesce(trim(p_short), ''), coalesce(p_color, '#1f6b4a'), p_crest, coalesce(p_settings, '{}'::jsonb), uid)
      returning * into t;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 8 then raise; end if;
    end;
  end loop;
  insert into public.team_members (team_id, user_id) values (t.id, uid);
  insert into public.players (team_id, pid, name)
    select t.id, (x->>'pid')::integer, left(coalesce(x->>'name', ''), 40)
    from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) x where (x->>'pid') ~ '^[0-9]+$';
  return jsonb_build_object('id', t.id, 'code', t.code, 'organiser_code', t.organiser_code);
end $$;

-- An organiser replaces the invite code (for example after sharing it by mistake).
create or replace function public.new_organiser_code(p_team uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text;
begin
  if not private.is_organiser(p_team) then raise exception 'Not an organiser of this team' using errcode = '42501'; end if;
  c := private.random_code(10);
  update public.teams set organiser_code = c where id = p_team;
  return c;
end $$;

revoke all on function private.random_code(integer), private.touch_updated_at() from public, anon, authenticated;
grant execute on function private.is_organiser(uuid), private.game_team(uuid) to authenticated;
