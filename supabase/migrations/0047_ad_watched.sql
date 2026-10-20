-- Rewarded ads: a watched ad unlocks the reel straight away (Ethan, 20 October 2026: he watched one and got "Google hasn't
-- confirmed it yet", and the reel stayed locked). Google's signed call (ad-reward) had never once reached the server: a
-- phone set up as an AdMob test device gets test ads, which never call it, and a real one can take minutes or not come.
--
-- The app has Google's own reward event the moment the ad is watched to the end, so this takes the app's word for it, like
-- ad_nofill (0043). It only ever unlocks the caller's own ticket (made by ad_ticket: their own reel), is marked app_said
-- so it can be told apart from one Google confirmed (Google's call still marks it by_google when it comes), and is capped
-- at 20 a day per account. ad_settings.watched_unlock turns it off (then only Google's call unlocks, as before).

alter table public.ad_unlocks add column if not exists app_said boolean not null default false;
alter table public.ad_settings add column if not exists watched_unlock boolean not null default true;

-- 'granted' (or it already was), 'no_ticket', 'off' (switched off), 'too_many' (20 in the last day).
create or replace function public.ad_watched(p_ticket uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.ad_unlocks;
begin
  if auth.uid() is null then return 'no_ticket'; end if;
  select * into u from public.ad_unlocks where id = p_ticket and user_id = auth.uid() for update;
  if not found then return 'no_ticket'; end if;
  if u.granted_at is not null then return 'granted'; end if;
  if not coalesce((select s.watched_unlock from public.ad_settings s where s.id = 1), false) then return 'off'; end if;
  if (select count(*) from public.ad_unlocks x where x.user_id = auth.uid() and x.app_said and x.granted_at > now() - interval '1 day') >= 20 then return 'too_many'; end if;
  update public.ad_unlocks set granted_at = now(), app_said = true where id = u.id;
  return 'granted';
end $$;
revoke all on function public.ad_watched(uuid) from public, anon, authenticated;
grant execute on function public.ad_watched(uuid) to authenticated;
