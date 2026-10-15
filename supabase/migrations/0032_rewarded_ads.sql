-- Rewarded ads (the free tier): someone chooses to watch a short ad, and it unlocks one thing.
--   game   another game's highlights (the newest game's are free), for the person who watched, for good
--   voice  AI commentary on one cut or one reel, for the person who watched
--   cut    one more cut of a game's highlights for the team (a gaffer watches; one a calendar month), after the team's
--          one free try
-- Nobody gets an ad unless they ask for one, and the app never offers one during a game.
--
-- How an unlock can't be faked: the app first asks for a ticket (ad_ticket), and the ad is loaded carrying that ticket and
-- the person's account id. When the ad has been watched, Google's AdMob calls our ad-reward edge function (server-side
-- verification), signed with Google's key; the function checks the signature and only then grants the ticket (ad_grant,
-- which only the server can call). The app then asks ad_claim whether it was granted.
-- Google's test ads never call the server, so while ad_settings.trust_app is on (to start with, for TestFlight) ad_claim
-- also takes the app's word that the ad finished. Turn it off when real ads go live (see CLAUDE.md, "Rewarded ads").
-- A paid team never sees an ad: the app doesn't ask (adFree() in index.html).

create table if not exists public.unlocks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,      -- (kept for the team's cut count if the account goes)
  kind text not null check (kind in ('game', 'voice', 'cut')),
  target text,                                                     -- the game, for 'game'; for 'cut', the game it went on
  source text not null default 'ad' check (source in ('ad', 'free')),
  created_at timestamptz not null default now(),
  granted_at timestamptz,                                          -- the ad was watched (null: a ticket still waiting)
  by_google boolean not null default false,                        -- granted by Google's signed call, not the app's word
  tx text unique,                                                  -- Google's transaction id, so one ad pays once
  used_at timestamptz
);
create index if not exists unlocks_team_idx on public.unlocks (team_id, kind);
create index if not exists unlocks_user_idx on public.unlocks (user_id);
create unique index if not exists unlocks_one_free_cut on public.unlocks (team_id) where kind = 'cut' and source = 'free';
alter table public.unlocks enable row level security; -- no policies: only the functions below touch it

create table if not exists public.ad_settings (
  id integer primary key default 1 check (id = 1),
  trust_app boolean not null default true
);
insert into public.ad_settings (id) values (1) on conflict do nothing;
alter table public.ad_settings enable row level security;

-- Grants a waiting ticket, if it still can be. 'granted' (also when it already was), 'month' (the team has had its cut
-- from an ad this month).
create or replace function private.ad_grant_row(p_id uuid, p_google boolean, p_tx text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.unlocks;
begin
  select * into u from public.unlocks where id = p_id for update;
  if u.granted_at is not null then
    if p_google and not u.by_google then update public.unlocks set by_google = true, tx = coalesce(tx, p_tx) where id = p_id; end if;
    return 'granted';
  end if;
  if u.kind = 'cut' and exists (select 1 from public.unlocks x where x.team_id = u.team_id and x.kind = 'cut' and x.source = 'ad'
      and x.granted_at >= date_trunc('month', now()) and x.id <> u.id) then return 'month'; end if;
  update public.unlocks set granted_at = now(), by_google = p_google, tx = p_tx where id = p_id;
  return 'granted';
end $$;
revoke all on function private.ad_grant_row(uuid, boolean, text) from public, anon, authenticated;

-- A ticket for one ad. Returns { ticket } or { error }: 'sign_in', 'no_team', 'not_allowed' (a cut is for a gaffer;
-- commentary for a gaffer or a player who has joined as themselves), 'no_game', 'not_needed' (that game is already
-- unlocked for them), 'month' (the team's cut from an ad this month is used).
create or replace function public.ad_ticket(p_code text, p_kind text, p_target text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'no_team'); end if;
  if p_kind = 'game' then
    if not exists (select 1 from public.games g where g.team_id = t.id and g.id::text = p_target) then return jsonb_build_object('error', 'no_game'); end if;
    if exists (select 1 from public.unlocks u where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'game' and u.target = p_target and u.granted_at is not null)
      then return jsonb_build_object('error', 'not_needed'); end if;
  elsif p_kind = 'voice' then
    if not (private.is_organiser(t.id) or exists (select 1 from public.players p where p.team_id = t.id and p.user_id = auth.uid()))
      then return jsonb_build_object('error', 'not_allowed'); end if;
    p_target := null;
  elsif p_kind = 'cut' then
    if not private.is_organiser(t.id) then return jsonb_build_object('error', 'not_allowed'); end if;
    if exists (select 1 from public.unlocks x where x.team_id = t.id and x.kind = 'cut' and x.source = 'ad' and x.granted_at >= date_trunc('month', now()))
      then return jsonb_build_object('error', 'month'); end if;
    p_target := null;
  else return jsonb_build_object('error', 'not_allowed');
  end if;
  insert into public.unlocks (team_id, user_id, kind, target) values (t.id, auth.uid(), p_kind, p_target) returning id into v_id;
  return jsonb_build_object('ticket', v_id);
end $$;
revoke all on function public.ad_ticket(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_ticket(text, text, text) to authenticated;

-- Has the ad for this ticket been watched? 'granted', 'waiting' (Google hasn't called yet), 'month', 'no_ticket'.
-- p_app_says: the app saw the ad finish. Only believed while ad_settings.trust_app is on (test ads).
create or replace function public.ad_claim(p_ticket uuid, p_app_says boolean default false) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.unlocks;
begin
  if auth.uid() is null then return 'no_ticket'; end if;
  select * into u from public.unlocks where id = p_ticket and user_id = auth.uid();
  if not found then return 'no_ticket'; end if;
  if u.granted_at is not null then return 'granted'; end if;
  if p_app_says and coalesce((select s.trust_app from public.ad_settings s where s.id = 1), false) then return private.ad_grant_row(u.id, false, null); end if;
  return 'waiting';
end $$;
revoke all on function public.ad_claim(uuid, boolean) from public, anon, authenticated;
grant execute on function public.ad_claim(uuid, boolean) to authenticated;

-- Google's signed call, passed on by the ad-reward edge function (service role only). p_user is the account id the ad
-- was loaded with. 'granted', 'month', 'no_ticket', 'wrong_user', 'duplicate' (that transaction already paid).
create or replace function public.ad_grant(p_ticket text, p_user text, p_tx text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.unlocks;
begin
  if p_ticket !~ '^[0-9a-fA-F-]{36}$' then return 'no_ticket'; end if;
  select * into u from public.unlocks where id = p_ticket::uuid;
  if not found then return 'no_ticket'; end if;
  if u.user_id is null or u.user_id::text <> coalesce(p_user, '') then return 'wrong_user'; end if;
  if p_tx is not null and exists (select 1 from public.unlocks x where x.tx = p_tx and x.id <> u.id) then return 'duplicate'; end if;
  return private.ad_grant_row(u.id, true, p_tx);
end $$;
revoke all on function public.ad_grant(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_grant(text, text, text) to service_role;

-- What the caller has unlocked in this team:
--   free_cut      the team's free try at cutting highlights is still there
--   cut_games     games whose cut is already paid for (cutting them again costs nothing)
--   cut_ready     a cut from an ad is waiting to be used
--   cut_month     the team has had its cut from an ad this month
--   voice         commentary unlocks waiting to be used (the caller's)
--   games         games whose highlights the caller has unlocked
create or replace function public.my_unlocks(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or auth.uid() is null then return null; end if;
  return jsonb_build_object(
    'free_cut', not exists (select 1 from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.source = 'free'),
    'cut_games', coalesce((select jsonb_agg(distinct u.target) from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.used_at is not null and u.target is not null), '[]'::jsonb),
    'cut_ready', exists (select 1 from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.granted_at is not null and u.used_at is null),
    'cut_month', exists (select 1 from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.source = 'ad' and u.granted_at >= date_trunc('month', now())),
    'voice', (select count(*)::int from public.unlocks u where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'voice' and u.granted_at is not null and u.used_at is null),
    'games', coalesce((select jsonb_agg(distinct u.target) from public.unlocks u where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'game' and u.granted_at is not null), '[]'::jsonb));
end $$;
revoke all on function public.my_unlocks(text) from public, anon, authenticated;
grant execute on function public.my_unlocks(text) to authenticated;

-- Uses an unlock as the thing starts.
--   cut (a gaffer, p_target the game): 'ok' (that game is already paid for), 'free' (the team's free try), 'ad' (a cut
--     from an ad), 'none' (nothing left: watch an ad, or next month)
--   voice: 'ok' (one used), 'none'
create or replace function public.use_unlock(p_code text, p_kind text, p_target text default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_id uuid;
begin
  if auth.uid() is null then return 'none'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'none'; end if;
  if p_kind = 'cut' then
    if not private.is_organiser(t.id) or not exists (select 1 from public.games g where g.team_id = t.id and g.id::text = p_target) then return 'none'; end if;
    if exists (select 1 from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.target = p_target and u.used_at is not null) then return 'ok'; end if;
    insert into public.unlocks (team_id, user_id, kind, target, source, granted_at, used_at) values (t.id, auth.uid(), 'cut', p_target, 'free', now(), now())
      on conflict do nothing returning id into v_id;
    if v_id is not null then return 'free'; end if;
    select u.id into v_id from public.unlocks u where u.team_id = t.id and u.kind = 'cut' and u.granted_at is not null and u.used_at is null order by u.granted_at limit 1 for update skip locked;
    if v_id is null then return 'none'; end if;
    update public.unlocks set used_at = now(), target = p_target where id = v_id;
    return 'ad';
  elsif p_kind = 'voice' then
    select u.id into v_id from public.unlocks u where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'voice' and u.granted_at is not null and u.used_at is null order by u.granted_at limit 1 for update skip locked;
    if v_id is null then return 'none'; end if;
    update public.unlocks set used_at = now(), target = p_target where id = v_id;
    return 'ok';
  end if;
  return 'none';
end $$;
revoke all on function public.use_unlock(text, text, text) from public, anon, authenticated;
grant execute on function public.use_unlock(text, text, text) to authenticated;
