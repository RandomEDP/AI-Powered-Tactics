-- Game-start notifications, and everyone on a team can log goals by default.

alter table public.teams alter column followers_can_score set default true;

-- One row per phone that has allowed notifications, tied to the account signed in on it.
create table if not exists public.push_tokens (
  token text primary key check (char_length(token) between 32 and 200),
  user_id uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security; -- no policies: only the functions below and the server can touch it

create or replace function public.register_push(p_token text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_token is null or char_length(p_token) not between 32 and 200 then return false; end if;
  insert into public.push_tokens (token, user_id) values (p_token, uid)
    on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
  return true;
end $$;
revoke all on function public.register_push(text) from public, anon, authenticated;
grant execute on function public.register_push(text) to authenticated;
