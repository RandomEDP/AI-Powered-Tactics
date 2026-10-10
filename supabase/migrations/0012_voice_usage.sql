-- How many characters of spoken commentary each team has had made this month, so the allowance can be enforced.
-- Only the reel-voice function (with the service key) reads or writes it.
create table if not exists public.voice_usage (
  team_id uuid not null references public.teams (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  chars integer not null default 0,
  primary key (team_id, month)
);
alter table public.voice_usage enable row level security;
