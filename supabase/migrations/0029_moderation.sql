-- Looking after what people share (Apple's guideline 1.2: reports must be acted on quickly).
-- 1. moderators: the accounts told straight away when anything is reported. Filled in the live database only (never a
--    user id in a file): Ethan's account, found by his kept-back username.
-- 2. stream_reports: anyone watching a team's live stream can report it (report_stream), like posts, profiles and chat.
-- team-notify kind "report" tells the moderators, once the caller really has just reported something.
-- No deletes or drops anywhere, so it can all go in through the Supabase MCP.

create table if not exists public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.moderators enable row level security; -- no policies: only the edge function reads it

create table if not exists public.stream_reports (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.stream_reports enable row level security; -- no policies: read in the dashboard

-- Report a team's live stream to Gaffer. Once per person a team; reporting again updates the reason and the time.
create or replace function public.report_stream(p_code text, p_reason text default '') returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select id into tid from public.teams where code = upper(trim(p_code));
  if tid is null then return false; end if;
  insert into public.stream_reports (team_id, user_id, reason) values (tid, uid, left(coalesce(p_reason, ''), 200))
  on conflict (team_id, user_id) do update set reason = excluded.reason, created_at = now();
  return true;
end $$;
revoke all on function public.report_stream(text, text) from public, anon, authenticated;
grant execute on function public.report_stream(text, text) to authenticated;
