-- A waitlist for a full poll (Ethan, 29 October 2026: "if the squad is full you should be able to join the waitlist").
-- A player who wants in once the outfield spots are all taken answers 'wait'. Whenever a spot comes free (someone in
-- says they're out or goes in goal, or the gaffer allows more outfield players), the first
-- on the waitlist moves up to 'in' by themselves, in the order they joined it. `moved_at` marks who moved up, so
-- team-notify (kind "movedup") can tell them once (`told_at`).
alter table public.fixture_votes drop constraint if exists fixture_votes_choice_check;
alter table public.fixture_votes add constraint fixture_votes_choice_check check (choice in ('gk', 'in', 'no', 'wait'));
alter table public.fixture_votes add column if not exists moved_at timestamptz;
alter table public.fixture_votes add column if not exists told_at timestamptz;

-- Fills the poll's free outfield spots from the waitlist, first come first served. A player who moves up goes to the
-- end of who's in (voted_at now), so the gaffer's starters don't change under them.
create or replace function private.fixture_fill(p_fixture uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare f public.fixtures; v_free integer;
begin
  select * into f from public.fixtures where id = p_fixture;
  if not found or f.status <> 'open' then return; end if;
  v_free := f.max_outfield - (select count(*) from public.fixture_votes where fixture_id = f.id and choice = 'in');
  if v_free <= 0 then return; end if;
  update public.fixture_votes v set choice = 'in', voted_at = clock_timestamp(), moved_at = now(), told_at = null
    where v.fixture_id = f.id and v.pid in (
      select w.pid from public.fixture_votes w where w.fixture_id = f.id and w.choice = 'wait' order by w.voted_at, w.pid limit v_free);
end $$;
revoke all on function private.fixture_fill(uuid) from public, anon, authenticated;

create or replace function private.fixture_votes_fill() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.fixture_fill(new.fixture_id);
  return null;
end $$;
revoke all on function private.fixture_votes_fill() from public, anon, authenticated;

create or replace function private.fixtures_fill() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.fixture_fill(new.id);
  return null;
end $$;
revoke all on function private.fixtures_fill() from public, anon, authenticated;

-- someone who was in isn't any more (their answer changed, by them or the gaffer). Nothing in the app removes an answer.
create or replace trigger fixture_votes_fill_upd after update of choice on public.fixture_votes
  for each row when (old.choice = 'in' and new.choice <> 'in') execute function private.fixture_votes_fill();
-- the gaffer allowed more outfield players, or opened the poll again
create or replace trigger fixtures_fill after update of max_outfield, status on public.fixtures
  for each row when (new.max_outfield > old.max_outfield or (new.status = 'open' and old.status <> 'open')) execute function private.fixtures_fill();

-- Answer a poll: 'gk' (in goal), 'in' (outfield), 'wait' (the waitlist, once the outfield spots are all taken) or 'no'.
-- 'in' on a full poll is still 'full' (older apps say so); 'wait' with a spot free is simply 'in'.
create or replace function public.vote_fixture(p_fixture uuid, p_choice text, p_pid integer default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); f public.fixtures; v_pid integer; v_choice text := p_choice; v_old text;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_choice is null or v_choice not in ('gk', 'in', 'no', 'wait') then return 'invalid'; end if;
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then return 'missing'; end if;
  if f.status <> 'open' then return 'closed'; end if;
  if p_pid is not null and private.is_organiser(f.team_id) then
    select pid into v_pid from public.players where team_id = f.team_id and pid = p_pid;
  else
    select pid into v_pid from public.players where team_id = f.team_id and user_id = uid;
  end if;
  if v_pid is null then return 'not_player'; end if;
  select choice into v_old from public.fixture_votes where fixture_id = f.id and pid = v_pid;
  if v_choice = 'gk' and exists (select 1 from public.fixture_votes where fixture_id = f.id and choice = 'gk' and pid <> v_pid) then return 'gk_taken'; end if;
  if v_choice in ('in', 'wait') and (select count(*) from public.fixture_votes where fixture_id = f.id and choice = 'in' and pid <> v_pid) < f.max_outfield
    -- a spot is free: but someone already waiting has first claim on it, so a newcomer joins the end of the waitlist
    and (v_old in ('in', 'wait') or not exists (select 1 from public.fixture_votes where fixture_id = f.id and choice = 'wait' and pid <> v_pid)) then
    v_choice := 'in';
  elsif v_choice = 'in' then return 'full';
  elsif v_choice = 'wait' and v_old = 'in' then return 'ok'; -- already in: stays in
  end if;
  insert into public.fixture_votes (fixture_id, pid, choice) values (f.id, v_pid, v_choice)
    on conflict (fixture_id, pid) do update set choice = excluded.choice, moved_at = null,
      voted_at = case when public.fixture_votes.choice = excluded.choice then public.fixture_votes.voted_at else now() end;
  return case when v_choice = 'wait' then 'waiting' else 'ok' end;
end $$;
revoke all on function public.vote_fixture(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.vote_fixture(uuid, text, integer) to authenticated;
