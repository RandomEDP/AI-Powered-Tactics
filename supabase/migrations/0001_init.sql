-- AI Powered Tactics: schema, security rules and functions.
-- Organisers sign in and manage their teams. Followers need no account: they open a team by its 6-character code
-- through get_team(), which never exposes the organiser invite code or lets anyone list teams.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  organiser_code text not null unique check (organiser_code ~ '^[A-Z0-9]{10}$'),
  name text not null check (char_length(name) between 1 and 60),
  short text not null default '' check (char_length(short) <= 12),
  color text not null default '#1f6b4a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  crest text check (crest is null or (char_length(crest) <= 300000 and crest like 'data:image/%')),
  settings jsonb not null default '{}'::jsonb,
  followers_can_score boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'organiser' check (role in ('organiser')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

create table public.players (
  team_id uuid not null references public.teams (id) on delete cascade,
  pid integer not null check (pid > 0),
  name text not null default '' check (char_length(name) <= 40),
  primary key (team_id, pid)
);

create table public.games (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  seq integer not null default 0,
  opp text not null default '' check (char_length(opp) <= 60),
  friendly boolean not null default false,
  us integer not null default 0,
  them integer not null default 0,
  half integer,
  ko_at bigint, ht_at bigint, h2_at bigint, ft_at bigint, finished_at bigint,
  sync real, pre integer, post integer, cap boolean,
  created_at timestamptz not null default now()
);
create index games_team_idx on public.games (team_id);

create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  pid integer not null,
  mins integer not null default 0,
  goals integer not null default 0,
  assists integer not null default 0,
  primary key (game_id, pid)
);

create table public.game_events (
  game_id uuid not null references public.games (id) on delete cascade,
  seq integer not null,
  kind text not null check (kind in ('goal', 'against', 'highlight', 'save')),
  pid integer, assist integer, min integer, x integer, at bigint,
  watch boolean not null default false,
  by_team boolean not null default false,
  primary key (game_id, seq)
);

create table public.live_matches (
  team_id uuid primary key references public.teams (id) on delete cascade,
  state jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table public.goal_queue (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index goal_queue_team_idx on public.goal_queue (team_id);

-- ---------- helpers
create or replace function public.is_organiser(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.team_id = p_team and m.user_id = (select auth.uid()));
$$;

create or replace function public.game_team(p_game uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select g.team_id from public.games g where g.id = p_game;
$$;

create or replace function public.random_code(p_len integer) returns text
language plpgsql volatile set search_path = '' as $$
declare abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; out text := ''; i integer;
begin
  for i in 1..p_len loop
    out := out || substr(abc, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(abc)), 1);
  end loop;
  return out;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger teams_touch before update on public.teams for each row execute function public.touch_updated_at();
create trigger live_touch before update on public.live_matches for each row execute function public.touch_updated_at();

-- ---------- row level security: organisers manage their own teams; nobody else reads tables directly
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_events enable row level security;
alter table public.live_matches enable row level security;
alter table public.goal_queue enable row level security;

create policy "organisers read their teams" on public.teams for select to authenticated using ((select public.is_organiser(id)));
create policy "organisers update their teams" on public.teams for update to authenticated using ((select public.is_organiser(id))) with check ((select public.is_organiser(id)));
create policy "organisers delete their teams" on public.teams for delete to authenticated using ((select public.is_organiser(id)));

create policy "organisers see co-organisers" on public.team_members for select to authenticated using ((select public.is_organiser(team_id)));
create policy "organisers can step down" on public.team_members for delete to authenticated using (user_id = (select auth.uid()));

create policy "organisers manage players" on public.players for all to authenticated
  using ((select public.is_organiser(team_id))) with check ((select public.is_organiser(team_id)));
create policy "organisers manage games" on public.games for all to authenticated
  using ((select public.is_organiser(team_id))) with check ((select public.is_organiser(team_id)));
create policy "organisers manage game players" on public.game_players for all to authenticated
  using ((select public.is_organiser(public.game_team(game_id)))) with check ((select public.is_organiser(public.game_team(game_id))));
create policy "organisers manage game events" on public.game_events for all to authenticated
  using ((select public.is_organiser(public.game_team(game_id)))) with check ((select public.is_organiser(public.game_team(game_id))));
create policy "organisers manage the live game" on public.live_matches for all to authenticated
  using ((select public.is_organiser(team_id))) with check ((select public.is_organiser(team_id)));
create policy "organisers read and clear logged goals" on public.goal_queue for select to authenticated using ((select public.is_organiser(team_id)));
create policy "organisers clear logged goals" on public.goal_queue for delete to authenticated using ((select public.is_organiser(team_id)));

-- ---------- functions the app calls
-- Everything about one team, by its follow code. Only organisers get the organiser invite code back.
create or replace function public.get_team(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; org boolean;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  org := public.is_organiser(t.id);
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
      values (public.random_code(6), public.random_code(10), trim(p_name), coalesce(trim(p_short), ''), coalesce(p_color, '#1f6b4a'), p_crest, coalesce(p_settings, '{}'::jsonb), uid)
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

-- A signed-in user with an organiser invite code becomes an organiser of that team.
create or replace function public.join_as_organiser(p_organiser_code text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where organiser_code = upper(trim(p_organiser_code));
  if not found then return null; end if;
  insert into public.team_members (team_id, user_id) values (t.id, uid) on conflict do nothing;
  return t.code;
end $$;

-- An organiser replaces the invite code (for example after sharing it by mistake).
create or replace function public.new_organiser_code(p_team uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_organiser(p_team) then raise exception 'Not an organiser of this team' using errcode = '42501'; end if;
  c := public.random_code(10);
  update public.teams set organiser_code = c where id = p_team;
  return c;
end $$;

-- Followers log a goal, if the team allows it. The organiser's app folds it into the live game.
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
    'min', case when jsonb_typeof(p_payload->'min') = 'number' then p_payload->'min' end,
    'x', case when jsonb_typeof(p_payload->'x') = 'number' then p_payload->'x' end,
    'ts', case when jsonb_typeof(p_payload->'ts') = 'number' then p_payload->'ts' end));
  if clean->'us' is null then return false; end if;
  insert into public.goal_queue (team_id, payload) values (t.id, clean);
  return true;
end $$;

-- ---------- who may call what
revoke all on function public.is_organiser(uuid), public.game_team(uuid), public.random_code(integer), public.get_team(text),
  public.create_team(text, text, text, text, jsonb, jsonb), public.join_as_organiser(text), public.new_organiser_code(uuid),
  public.queue_goal(text, jsonb) from public, anon, authenticated;
grant execute on function public.get_team(text), public.queue_goal(text, jsonb) to anon, authenticated;
grant execute on function public.create_team(text, text, text, text, jsonb, jsonb), public.join_as_organiser(text), public.new_organiser_code(uuid),
  public.is_organiser(uuid), public.game_team(uuid) to authenticated;
