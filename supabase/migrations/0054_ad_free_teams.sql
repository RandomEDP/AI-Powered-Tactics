-- No ads for a whole team's people (Ethan, 14 November 2026: "can we disable ads for all SOP members"). A team in
-- ad_free_teams makes everyone on it ad-free: each squad player linked to an account and each gaffer, in every team they
-- open (their friendlies and Just me too), for as long as the team is in the table, and anyone who joins later as well.
-- It's a table of its own, not a column on teams, because gaffers may update their own team's row. Rows go in through the
-- dashboard (insert into public.ad_free_teams (team_id) select id from public.teams where name = '...'); taking one out
-- brings the ads back. The app asks my_ad_free() (adFree() in index.html); ad_ticket says not_needed for them, so a
-- reel is never locked behind an ad on the server either.
create table if not exists public.ad_free_teams (
  team_id uuid primary key references public.teams (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ad_free_teams enable row level security; -- no policies: the dashboard only

create or replace function private.ad_free_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.ad_free_teams f
    where exists (select 1 from public.players p where p.team_id = f.team_id and p.user_id = p_user)
       or exists (select 1 from public.team_members m where m.team_id = f.team_id and m.user_id = p_user))
$$;
revoke all on function private.ad_free_user(uuid) from public, anon, authenticated;

create or replace function public.my_ad_free() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ad_free_user(auth.uid())
$$;
revoke all on function public.my_ad_free() from public, anon, authenticated;
grant execute on function public.my_ad_free() to authenticated;

create or replace function public.ad_ticket(p_code text, p_kind text, p_target text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_pid integer; v_id uuid; v_ms numeric;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if private.ad_free_user(auth.uid()) then return jsonb_build_object('error', 'not_needed'); end if; -- (0054: no ads for them at all)
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'no_team'); end if;
  if p_kind is distinct from 'reel' then return jsonb_build_object('error', 'not_allowed'); end if;
  select p.pid into v_pid from public.players p where p.team_id = t.id and p.user_id = auth.uid();
  if v_pid is null then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from public.player_reels r where r.team_id = t.id and r.pid = v_pid and r.path = p_target) then
    if coalesce(p_target, '') !~ ('^' || t.id::text || '/players/' || v_pid::text || '/reel-[0-9]{1,16}\.mp4$') then return jsonb_build_object('error', 'no_reel'); end if;
    v_ms := substring(p_target from '/reel-([0-9]+)\.mp4$')::numeric;
    if v_ms < extract(epoch from now()) * 1000 - 7 * 86400000 or v_ms > extract(epoch from now()) * 1000 + 86400000 then return jsonb_build_object('error', 'no_reel'); end if;
  end if;
  if exists (select 1 from public.ad_unlocks u where u.user_id = auth.uid() and u.team_id = t.id and u.kind = 'reel' and u.target = p_target and u.granted_at is not null)
    then return jsonb_build_object('error', 'not_needed'); end if;
  insert into public.ad_unlocks (team_id, user_id, kind, target) values (t.id, auth.uid(), 'reel', p_target) returning id into v_id;
  return jsonb_build_object('ticket', v_id);
end $$;
revoke all on function public.ad_ticket(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_ticket(text, text, text) to authenticated;

-- For builds from before this one (they only know the team pass): their own reels on this team count as unlocked, so
-- the kept reel on their card plays with no ad there too.
create or replace function public.my_unlocks(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or auth.uid() is null then return null; end if;
  return jsonb_build_object('reels', coalesce((select jsonb_agg(distinct x.target) from (
    select u.target from public.ad_unlocks u where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'reel' and u.granted_at is not null
    union all
    select r.path from public.player_reels r join public.players p on p.team_id = r.team_id and p.pid = r.pid
      where r.team_id = t.id and p.user_id = auth.uid() and r.path is not null and private.ad_free_user(auth.uid())) x), '[]'::jsonb));
end $$;
revoke all on function public.my_unlocks(text) from public, anon, authenticated;
grant execute on function public.my_unlocks(text) to authenticated;

-- Sons of Pitches FC, Ethan's own team.
insert into public.ad_free_teams (team_id, note)
  select id, 'Sons of Pitches FC (Ethan, 14 November 2026)' from public.teams where name = 'Sons of Pitches FC' and not personal
  on conflict (team_id) do nothing;
