-- Asking to join a team when your name isn't in its squad. Someone with the team's code and an account sends their
-- details; the team's gaffers see the request and let them in (which adds them to the squad with their profile already
-- theirs) or turn it down.

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  last_name text check (last_name is null or char_length(last_name) <= 40),
  position text not null check (position in ('fwd', 'def', 'mix', 'gk')),
  shirt_number smallint check (shirt_number is null or shirt_number between 0 and 99),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  pid integer,                -- the player made for them, once let in
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  notified_at timestamptz,    -- when the gaffers were sent a notification about it (once per request)
  unique (team_id, user_id)
);
create index if not exists join_requests_team_idx on public.join_requests (team_id, status);
alter table public.join_requests enable row level security; -- no policies: only the functions below touch it

-- Ask to join. Returns 'ok' (sent), 'pending' (already waiting; details updated), 'member' (already in the team),
-- 'denied' (turned down in the last week), 'full' (the team has too many waiting), 'slow' (this person has too many
-- requests out), 'name', 'position' or 'missing'.
create or replace function public.request_join(p_code text, p_name text, p_last_name text default null, p_position text default 'mix', p_number integer default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.teams; r public.join_requests;
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  v_last text := nullif(left(trim(regexp_replace(coalesce(p_last_name, ''), '\s+', ' ', 'g')), 40), '');
  v_num smallint := case when p_number between 0 and 99 then p_number::smallint else null end;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_name = '' then return 'name'; end if;
  if p_position is null or p_position not in ('fwd', 'def', 'mix', 'gk') then return 'position'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'missing'; end if;
  if private.in_team(t.id) then return 'member'; end if;
  select * into r from public.join_requests where team_id = t.id and user_id = uid for update;
  if found then
    if r.status = 'pending' then
      update public.join_requests set name = v_name, last_name = v_last, position = p_position, shirt_number = v_num where id = r.id;
      return 'pending';
    end if;
    if r.status = 'denied' and r.decided_at > now() - interval '7 days' then return 'denied'; end if;
    -- turned down a while ago, or let in and since taken off the squad: they may ask again
    update public.join_requests set name = v_name, last_name = v_last, position = p_position, shirt_number = v_num, status = 'pending', pid = null,
      created_at = now(), decided_at = null, decided_by = null, notified_at = null where id = r.id;
    return 'ok';
  end if;
  if (select count(*) from public.join_requests j where j.team_id = t.id and j.status = 'pending') >= 30 then return 'full'; end if;
  if (select count(*) from public.join_requests j where j.user_id = uid and j.status = 'pending') >= 5 then return 'slow'; end if;
  insert into public.join_requests (team_id, user_id, name, last_name, position, shirt_number) values (t.id, uid, v_name, v_last, p_position, v_num);
  return 'ok';
end $$;

-- The signed-in person's own request to this team, if they have made one.
create or replace function public.my_join_request(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; r public.join_requests;
begin
  if auth.uid() is null then return null; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  select * into r from public.join_requests where team_id = t.id and user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('status', r.status, 'name', r.name);
end $$;

-- Gaffers: the requests waiting for an answer, oldest first. Null if you aren't a gaffer of the team.
create or replace function public.team_join_requests(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'last_name', j.last_name, 'position', j.position, 'number', j.shirt_number,
      'at', (extract(epoch from j.created_at) * 1000)::bigint) order by j.created_at)
    from public.join_requests j where j.team_id = t.id and j.status = 'pending'), '[]'::jsonb);
end $$;

-- Gaffers: let someone in or turn them down. Letting them in adds a player to the squad that is already theirs.
-- Returns 'ok', 'closed' (already answered), 'missing' or 'not_gaffer'.
create or replace function public.decide_join(p_code text, p_id uuid, p_allow boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; r public.join_requests; have integer; new_pid integer; next_id integer;
begin
  select * into t from public.teams where code = upper(trim(p_code)) for update; -- one decision at a time per team, so two players never get the same number in the squad list
  if not found or not private.is_organiser(t.id) then return 'not_gaffer'; end if;
  select * into r from public.join_requests where id = p_id and team_id = t.id for update;
  if not found then return 'missing'; end if;
  if r.status <> 'pending' then return 'closed'; end if;
  if not coalesce(p_allow, false) then
    update public.join_requests set status = 'denied', decided_at = now(), decided_by = auth.uid() where id = r.id;
    return 'ok';
  end if;
  select pid into have from public.players where team_id = t.id and user_id = r.user_id;
  if found then -- they have claimed a player in the meantime: nothing to add
    update public.join_requests set status = 'approved', pid = have, decided_at = now(), decided_by = auth.uid() where id = r.id;
    return 'ok';
  end if;
  next_id := case when (t.settings->>'nextId') ~ '^[0-9]{1,6}$' then (t.settings->>'nextId')::integer else 0 end;
  select greatest(coalesce(max(pid), 0) + 1, next_id) into new_pid from public.players where team_id = t.id;
  insert into public.players (team_id, pid, name, position, shirt_number, user_id, last_name)
    values (t.id, new_pid, r.name, r.position, r.shirt_number, r.user_id, r.last_name);
  update public.teams set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{nextId}', to_jsonb(new_pid + 1)) where id = t.id;
  update public.join_requests set status = 'approved', pid = new_pid, decided_at = now(), decided_by = auth.uid() where id = r.id;
  return 'ok';
end $$;

revoke all on function public.request_join(text, text, text, text, integer), public.my_join_request(text), public.team_join_requests(text), public.decide_join(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.request_join(text, text, text, text, integer), public.my_join_request(text), public.team_join_requests(text), public.decide_join(text, uuid, boolean) to authenticated;
