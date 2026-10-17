-- Rewarded ads: when Google has no ad to show, the reel unlocks anyway (Ethan chose this, 17 October 2026). A brand-new
-- AdMob app gets very few real ads until it's live on the App Store, so "No ad to show" was leaving people's own reels
-- locked with nothing they could do about it.
--
-- The app says Google had no ad (the load failed or never answered), so this takes the app's word, like ad_claim's
-- trust_app. It only ever unlocks the caller's own ticket (made by ad_ticket: their own reel), is marked no_fill so it can
-- be told apart from a watched ad, and is capped at 10 a day per account. ad_settings.no_fill_unlock turns it off.

alter table public.ad_unlocks add column if not exists no_fill boolean not null default false;
alter table public.ad_settings add column if not exists no_fill_unlock boolean not null default true;

-- 'granted' (or it already was), 'no_ticket', 'off' (switched off), 'too_many' (10 in the last day).
create or replace function public.ad_nofill(p_ticket uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare u public.ad_unlocks;
begin
  if auth.uid() is null then return 'no_ticket'; end if;
  select * into u from public.ad_unlocks where id = p_ticket and user_id = auth.uid() for update;
  if not found then return 'no_ticket'; end if;
  if u.granted_at is not null then return 'granted'; end if;
  if not coalesce((select s.no_fill_unlock from public.ad_settings s where s.id = 1), false) then return 'off'; end if;
  if (select count(*) from public.ad_unlocks x where x.user_id = auth.uid() and x.no_fill and x.granted_at > now() - interval '1 day') >= 10 then return 'too_many'; end if;
  update public.ad_unlocks set granted_at = now(), no_fill = true where id = u.id;
  return 'granted';
end $$;
revoke all on function public.ad_nofill(uuid) from public, anon, authenticated;
grant execute on function public.ad_nofill(uuid) to authenticated;
