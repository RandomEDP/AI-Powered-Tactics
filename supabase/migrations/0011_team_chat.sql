-- Team chat: one conversation per team, for its signed-in players and gaffers. A message is text, a recorded
-- play from the tactics board, or both. Anyone in the chat can report a message; its sender or a gaffer can delete it.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  pid integer,
  name text not null default '' check (char_length(name) <= 40),
  body text not null default '' check (char_length(body) <= 1000),
  play jsonb check (play is null or pg_column_size(play) <= 120000),
  play_name text check (play_name is null or char_length(play_name) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists messages_team_idx on public.messages (team_id, created_at desc);
alter table public.messages enable row level security; -- no policies: only the functions below touch it

create table if not exists public.message_reports (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reports enable row level security;

-- Is the signed-in person a claimed player or a gaffer of this team?
create or replace function private.in_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.players p where p.team_id = p_team and p.user_id = auth.uid())
    or exists (select 1 from public.team_members m where m.team_id = p_team and m.user_id = auth.uid()));
$$;
revoke all on function private.in_team(uuid) from public, anon;
grant execute on function private.in_team(uuid) to authenticated;

-- The latest messages (or the ones before p_before), oldest first. Null if you aren't in the team.
create or replace function public.chat_list(p_code text, p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; org boolean;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.in_team(t.id) then return null; end if;
  org := private.is_organiser(t.id);
  return coalesce((select jsonb_agg(j order by at) from (
    select jsonb_build_object('id', m.id, 'pid', m.pid, 'name', m.name, 'body', m.body, 'play', m.play, 'play_name', m.play_name,
      'at', (extract(epoch from m.created_at) * 1000)::bigint, 'mine', m.user_id = auth.uid(), 'can_delete', org or m.user_id = auth.uid()) as j,
      m.created_at as at
    from public.messages m where m.team_id = t.id and (p_before is null or m.created_at < p_before)
    order by m.created_at desc limit 80) x), '[]'::jsonb);
end $$;

-- Post a message. Returns its id, or null if you aren't in the team or there is nothing to post.
create or replace function public.chat_send(p_code text, p_body text, p_play jsonb default null, p_play_name text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; who public.players; txt text := left(trim(coalesce(p_body, '')), 1000); new_id uuid; recent integer;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.in_team(t.id) then return null; end if;
  if txt = '' and p_play is null then return null; end if;
  select count(*) into recent from public.messages m where m.user_id = auth.uid() and m.created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'Slow down a little' using errcode = '42501'; end if;
  select * into who from public.players p where p.team_id = t.id and p.user_id = auth.uid() limit 1;
  insert into public.messages (team_id, user_id, pid, name, body, play, play_name)
    values (t.id, auth.uid(), who.pid, left(coalesce(nullif(trim(who.name), ''), 'Gaffer'), 40), txt, p_play, nullif(left(trim(coalesce(p_play_name, '')), 40), ''))
    returning id into new_id;
  return new_id;
end $$;

-- Delete a message: your own, or any if you are a gaffer.
create or replace function public.chat_delete(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_id;
  if not found then return false; end if;
  if m.user_id is distinct from auth.uid() and not private.is_organiser(m.team_id) then return false; end if;
  delete from public.messages where id = p_id;
  return true;
end $$;

-- Report a message for the people who run the app to look at.
create or replace function public.chat_report(p_id uuid, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_id;
  if not found or not private.in_team(m.team_id) then return false; end if;
  insert into public.message_reports (message_id, user_id, reason) values (p_id, auth.uid(), left(coalesce(p_reason, ''), 200))
    on conflict (message_id, user_id) do nothing;
  return true;
end $$;

-- Signing out: stop sending this phone that account's notifications.
create or replace function public.unregister_push(p_token text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
  return true;
end $$;

revoke all on function public.chat_list(text, timestamptz), public.chat_send(text, text, jsonb, text), public.chat_delete(uuid), public.chat_report(uuid, text), public.unregister_push(text) from public, anon, authenticated;
grant execute on function public.chat_list(text, timestamptz), public.chat_send(text, text, jsonb, text), public.chat_delete(uuid), public.chat_report(uuid, text), public.unregister_push(text) to authenticated;
