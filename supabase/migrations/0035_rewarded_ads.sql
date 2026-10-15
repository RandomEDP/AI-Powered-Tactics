-- Rewarded ads (the free tier). No banners: on the free tier, your own highlight reel (the player reel on your card,
-- 0026) is behind a 30-second ad you choose to watch. Watching it unlocks that reel for you for good; a new reel needs a
-- new ad. Nobody gets an ad unless they ask for one, and the app never offers one during a game or to a paid team
-- (adFree() in index.html).
--
-- How an unlock can't be faked: the app first asks for a ticket (ad_ticket), and the ad is loaded carrying that ticket and
-- the person's account id. When the ad has been watched, Google's AdMob calls our ad-reward edge function (server-side
-- verification), signed with Google's key; the function checks the signature and only then grants the ticket (ad_grant,
-- which only the server can call). The app then asks ad_claim whether it was granted.
-- Google's test ads never call the server, so while ad_settings.trust_app is on (to start with, for TestFlight) ad_claim
-- also takes the app's word that the ad finished. Turn it off when real ads go live (see CLAUDE.md, "Rewarded ads").

create table if not exists public.ad_unlocks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('reel')),
  target text not null,                                            -- the reel's file (player_reels.path)
  created_at timestamptz not null default now(),
  granted_at timestamptz,                                          -- the ad was watched (null: a ticket still waiting)
  by_google boolean not null default false,                        -- granted by Google's signed call, not the app's word
  tx text unique                                                   -- Google's transaction id, so one ad pays once
);
create index if not exists ad_unlocks_user_idx on public.ad_unlocks (user_id, team_id);
alter table public.ad_unlocks enable row level security; -- no policies: only the functions below touch it

create table if not exists public.ad_settings (
  id integer primary key default 1 check (id = 1),
  trust_app boolean not null default true
);
insert into public.ad_settings (id) values (1) on conflict do nothing;
alter table public.ad_settings enable row level security;

-- A ticket for one ad. Returns { ticket } or { error }: 'sign_in', 'no_team', 'not_allowed' (only the player themselves,
-- joined as themselves), 'no_reel' (that isn't their reel now), 'not_needed' (already unlocked).
create or replace function public.ad_ticket(p_code text, p_kind text, p_target text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_pid integer; v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'no_team'); end if;
  if p_kind is distinct from 'reel' then return jsonb_build_object('error', 'not_allowed'); end if;
  select p.pid into v_pid from public.players p where p.team_id = t.id and p.user_id = auth.uid();
  if v_pid is null then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from public.player_reels r where r.team_id = t.id and r.pid = v_pid and r.path = p_target) then return jsonb_build_object('error', 'no_reel'); end if;
  if exists (select 1 from public.ad_unlocks u where u.user_id = auth.uid() and u.team_id = t.id and u.kind = 'reel' and u.target = p_target and u.granted_at is not null)
    then return jsonb_build_object('error', 'not_needed'); end if;
  insert into public.ad_unlocks (team_id, user_id, kind, target) values (t.id, auth.uid(), 'reel', p_target) returning id into v_id;
  return jsonb_build_object('ticket', v_id);
end $$;
revoke all on function public.ad_ticket(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_ticket(text, text, text) to authenticated;

-- Has the ad for this ticket been watched? 'granted', 'waiting' (Google hasn't called yet), 'no_ticket'.
-- p_app_says: the app saw the ad finish. Only believed while ad_settings.trust_app is on (test ads).
create or replace function public.ad_claim(p_ticket uuid, p_app_says boolean default false) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.ad_unlocks;
begin
  if auth.uid() is null then return 'no_ticket'; end if;
  select * into u from public.ad_unlocks where id = p_ticket and user_id = auth.uid();
  if not found then return 'no_ticket'; end if;
  if u.granted_at is not null then return 'granted'; end if;
  if p_app_says and coalesce((select s.trust_app from public.ad_settings s where s.id = 1), false) then
    update public.ad_unlocks set granted_at = now() where id = u.id;
    return 'granted';
  end if;
  return 'waiting';
end $$;
revoke all on function public.ad_claim(uuid, boolean) from public, anon, authenticated;
grant execute on function public.ad_claim(uuid, boolean) to authenticated;

-- Google's signed call, passed on by the ad-reward edge function (service role only). p_user is the account id the ad
-- was loaded with. 'granted', 'no_ticket', 'wrong_user', 'duplicate' (that transaction already paid for another).
create or replace function public.ad_grant(p_ticket text, p_user text, p_tx text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.ad_unlocks;
begin
  if p_ticket !~ '^[0-9a-fA-F-]{36}$' then return 'no_ticket'; end if;
  select * into u from public.ad_unlocks where id = p_ticket::uuid for update;
  if not found then return 'no_ticket'; end if;
  if u.user_id::text <> coalesce(p_user, '') then return 'wrong_user'; end if;
  if p_tx is not null and exists (select 1 from public.ad_unlocks x where x.tx = p_tx and x.id <> u.id) then return 'duplicate'; end if;
  update public.ad_unlocks set granted_at = coalesce(granted_at, now()), by_google = true, tx = coalesce(tx, p_tx) where id = u.id;
  return 'granted';
end $$;
revoke all on function public.ad_grant(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_grant(text, text, text) to service_role;

-- What the caller has unlocked in this team: { reels: [the reel files they've watched an ad for] }.
create or replace function public.my_unlocks(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or auth.uid() is null then return null; end if;
  return jsonb_build_object('reels', coalesce((select jsonb_agg(distinct u.target) from public.ad_unlocks u
    where u.team_id = t.id and u.user_id = auth.uid() and u.kind = 'reel' and u.granted_at is not null), '[]'::jsonb));
end $$;
revoke all on function public.my_unlocks(text) from public, anon, authenticated;
grant execute on function public.my_unlocks(text) to authenticated;
