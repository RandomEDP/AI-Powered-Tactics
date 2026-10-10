-- Positions, game polls and highlight clips.

-- ---------- positions: each player has a base position, chosen when they claim their profile
alter table public.players add column if not exists position text check (position is null or position in ('fwd', 'def', 'mix', 'gk'));

-- The earlier three-argument version is kept only to tell old copies of the app that a position is now needed.
create or replace function public.claim_player(p_code text, p_pid integer, p_last_name text) returns text
language sql stable security definer set search_path = '' as $$ select 'position'::text; $$;
create or replace function public.claim_player(p_code text, p_pid integer, p_last_name text, p_position text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; holder uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_position is null or p_position not in ('fwd', 'def', 'mix', 'gk') then return 'position'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'missing'; end if;
  select user_id into holder from public.players where team_id = t.id and pid = p_pid for update;
  if not found then return 'missing'; end if;
  if holder is not null and holder <> uid then return 'taken'; end if;
  update public.players set user_id = null where team_id = t.id and user_id = uid and pid <> p_pid;
  update public.players set user_id = uid, position = p_position, last_name = nullif(left(trim(coalesce(p_last_name, '')), 40), '') where team_id = t.id and pid = p_pid;
  return 'ok';
end $$;

create or replace function public.set_my_position(p_code text, p_position text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_position is null or p_position not in ('fwd', 'def', 'mix', 'gk') then return false; end if;
  update public.players p set position = p_position from public.teams t where t.id = p.team_id and t.code = upper(trim(p_code)) and p.user_id = uid;
  return found;
end $$;

-- ---------- polls: an upcoming game the squad says in or out for
create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  opp text not null default '' check (char_length(opp) <= 60),
  ko_at bigint not null,
  location text not null default '' check (char_length(location) <= 120),
  cost text not null default '' check (char_length(cost) <= 40),
  max_outfield integer not null default 7 check (max_outfield between 1 and 14),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  lineup jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fixtures_team_idx on public.fixtures (team_id);

create table if not exists public.fixture_votes (
  fixture_id uuid not null references public.fixtures (id) on delete cascade,
  pid integer not null,
  choice text not null check (choice in ('gk', 'in', 'no')),
  voted_at timestamptz not null default now(),
  primary key (fixture_id, pid)
);

create or replace function private.fixture_team(p_fixture uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select f.team_id from public.fixtures f where f.id = p_fixture;
$$;
revoke all on function private.fixture_team(uuid) from public, anon;
grant execute on function private.fixture_team(uuid) to authenticated;

alter table public.fixtures enable row level security;
alter table public.fixture_votes enable row level security;
create policy "gaffers manage polls" on public.fixtures for all to authenticated
  using ((select private.is_organiser(team_id))) with check ((select private.is_organiser(team_id)));
create policy "gaffers manage poll answers" on public.fixture_votes for all to authenticated
  using ((select private.is_organiser(private.fixture_team(fixture_id)))) with check ((select private.is_organiser(private.fixture_team(fixture_id))));

-- Answer a poll: 'gk' (in goal), 'in' (outfield) or 'no'. One keeper, and no more outfield players than the poll allows.
-- Players answer for themselves; a gaffer can answer for anyone by passing p_pid.
create or replace function public.vote_fixture(p_fixture uuid, p_choice text, p_pid integer default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); f public.fixtures; v_pid integer;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_choice is null or p_choice not in ('gk', 'in', 'no') then return 'invalid'; end if;
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then return 'missing'; end if;
  if f.status <> 'open' then return 'closed'; end if;
  if p_pid is not null and private.is_organiser(f.team_id) then
    select pid into v_pid from public.players where team_id = f.team_id and pid = p_pid;
  else
    select pid into v_pid from public.players where team_id = f.team_id and user_id = uid;
  end if;
  if v_pid is null then return 'not_player'; end if;
  if p_choice = 'gk' and exists (select 1 from public.fixture_votes where fixture_id = f.id and choice = 'gk' and pid <> v_pid) then return 'gk_taken'; end if;
  if p_choice = 'in' and (select count(*) from public.fixture_votes where fixture_id = f.id and choice = 'in' and pid <> v_pid) >= f.max_outfield then return 'full'; end if;
  insert into public.fixture_votes (fixture_id, pid, choice) values (f.id, v_pid, p_choice)
    on conflict (fixture_id, pid) do update set choice = excluded.choice, voted_at = case when public.fixture_votes.choice = excluded.choice then public.fixture_votes.voted_at else now() end;
  return 'ok';
end $$;

-- ---------- highlight clips: cut on the gaffer's phone, stored as small video files
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  seq integer not null,
  path text not null check (char_length(path) <= 300),
  label text not null default '' check (char_length(label) <= 200),
  at bigint,
  dur real,
  pids integer[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);
create index if not exists clips_team_idx on public.clips (team_id);
alter table public.clips enable row level security;
create policy "gaffers manage clips" on public.clips for all to authenticated
  using ((select private.is_organiser(team_id))) with check ((select private.is_organiser(team_id)));

-- Video files live in a public bucket under <team id>/...; only that team's gaffers can add or change them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do nothing;
create policy "gaffers read clip files" on storage.objects for select to authenticated
  using (bucket_id = 'clips' and private.is_organiser(((storage.foldername(name))[1])::uuid));
create policy "gaffers add clip files" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and private.is_organiser(((storage.foldername(name))[1])::uuid));
create policy "gaffers replace clip files" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and private.is_organiser(((storage.foldername(name))[1])::uuid));
create policy "gaffers remove clip files" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and private.is_organiser(((storage.foldername(name))[1])::uuid));

-- ---------- get_team now also returns positions, open polls with answers, and clips
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
        'position', p.position,
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
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'opp', f.opp, 'ko_at', f.ko_at, 'location', f.location, 'cost', f.cost,
        'max_outfield', f.max_outfield, 'lineup', f.lineup,
        'votes', coalesce((select jsonb_agg(jsonb_build_object('pid', v.pid, 'choice', v.choice) order by v.voted_at) from public.fixture_votes v where v.fixture_id = f.id), '[]'::jsonb)
      ) order by f.ko_at) from public.fixtures f where f.team_id = t.id and f.status = 'open'), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(jsonb_build_object('game_id', c.game_id, 'seq', c.seq, 'path', c.path, 'label', c.label, 'at', c.at, 'dur', c.dur, 'pids', c.pids)
      order by c.at, c.seq) from public.clips c where c.team_id = t.id), '[]'::jsonb),
    'live', (select l.state from public.live_matches l where l.team_id = t.id)
  );
end $$;

revoke all on function public.claim_player(text, integer, text, text), public.set_my_position(text, text), public.vote_fixture(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_player(text, integer, text, text), public.set_my_position(text, text), public.vote_fixture(uuid, text, integer) to authenticated;
