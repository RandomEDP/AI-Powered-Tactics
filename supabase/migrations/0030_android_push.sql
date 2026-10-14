-- Notifications on the Android app. Each phone's address is marked iPhone or Android, so team-notify knows whether to
-- send it through Apple or through Google's Firebase Cloud Messaging. Firebase's addresses are longer than Apple's.

alter table public.push_tokens add column if not exists platform text not null default 'ios';
alter table public.push_tokens drop constraint if exists push_tokens_platform_check;
alter table public.push_tokens add constraint push_tokens_platform_check check (platform in ('ios', 'android'));
alter table public.push_tokens drop constraint if exists push_tokens_token_check;
alter table public.push_tokens add constraint push_tokens_token_check check (char_length(token) between 32 and 400);

-- The apps say which kind of phone they are (the iPhone app's older builds still call the one-argument version, which
-- stays and means an iPhone).
create or replace function public.register_push(p_token text, p_platform text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_token is null or char_length(p_token) not between 32 and 400 then return false; end if;
  if p_platform is null or p_platform not in ('ios', 'android') then return false; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, uid, p_platform)
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return true;
end $$;
revoke all on function public.register_push(text, text) from public, anon, authenticated;
grant execute on function public.register_push(text, text) to authenticated;
