-- Commentary voices you buy once. Fenrir (the live commentator) stays free; every other voice, and the Sweary delivery,
-- is a one-off £2.99 purchase in the iPhone app through Apple (non-consumable), kept on the account that bought it, so it
-- works on any phone signed in to that account. The team-pass edge function checks each purchase with Apple before it
-- counts (action "voice"), and is the only thing that writes here (with the service role, through voice_credit below).
-- reel-voice won't use a paid voice for anyone who hasn't bought it (private.has_voice).
--
-- Each voice also has a short sample to hear before buying. They are made once by reel-voice (action "sample") and kept
-- in the public voice-samples bucket, so playing one costs nothing and sends nothing about anyone to Google.

create table if not exists public.voice_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  voice text not null check (voice ~ '^[a-z]{2,20}$'),                                     -- "puck", "kore", "sweary"…
  transaction_id text not null unique check (transaction_id ~ '^[0-9A-Za-z_-]{1,64}$'),   -- Apple's: each counts once
  environment text not null default 'Production' check (environment in ('Production', 'Sandbox')),
  at timestamptz not null default now(),
  primary key (user_id, voice)
);
alter table public.voice_unlocks enable row level security; -- no policies: only the functions below touch it

-- Whether someone may use a voice ('fenrir' is free to everyone).
create or replace function private.has_voice(p_user uuid, p_voice text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(p_voice) = 'fenrir' or exists (select 1 from public.voice_unlocks where user_id = p_user and voice = lower(p_voice))
$$;
revoke all on function private.has_voice(uuid, text) from public, anon, authenticated;

-- The edge function, once Apple has said the purchase is real. Returns { added } (false when that account already had
-- the voice, or that purchase was already counted for it). A purchase counts for one account only.
create or replace function public.voice_credit(p_user uuid, p_voice text, p_tx text, p_env text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare was public.voice_unlocks; n integer;
begin
  select * into was from public.voice_unlocks where transaction_id = p_tx;
  if found then
    if was.user_id <> p_user then raise exception 'That purchase unlocked a voice for another account' using errcode = '22023'; end if;
    return jsonb_build_object('added', false);
  end if;
  insert into public.voice_unlocks (user_id, voice, transaction_id, environment) values (p_user, lower(p_voice), p_tx, p_env)
    on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('added', n > 0);
end $$;
revoke all on function public.voice_credit(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.voice_credit(uuid, text, text, text) to service_role;

-- The voices the signed-in account has bought (never anything about Apple).
create or replace function public.my_voices() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(voice order by voice), '{}') from public.voice_unlocks where user_id = auth.uid()
$$;
revoke all on function public.my_voices() from public, anon, authenticated;
grant execute on function public.my_voices() to authenticated;

-- The samples: public to play, written only by reel-voice with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-samples', 'voice-samples', true, 1048576, array['audio/mpeg'])
on conflict (id) do nothing;
