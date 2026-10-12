-- Streaming a game live. Each team has one camera link (a Cloudflare Stream live input) that its GoPro sends to; the
-- gaffer pastes it into GoPro Quik once and it is remembered there. The live-stream edge function makes the link and keeps
-- this row up to date (with the service role); the app only reads it, through team_stream below. The link itself (the
-- stream key) is never stored here: only Cloudflare has it, and the edge function hands it to the team's gaffers.

create table if not exists public.team_streams (
  team_id uuid primary key references public.teams (id) on delete cascade,
  input_uid text not null check (input_uid ~ '^[0-9A-Za-z]{1,64}$'),                 -- the team's Cloudflare live input
  hls text not null check (hls ~ '^https://[a-z0-9.-]+\.cloudflarestream\.com/'), -- where the stream plays from
  gid text check (gid is null or char_length(gid) <= 64),                         -- the game it is on for; null when off
  started_at timestamptz,     -- when a gaffer pressed Go live; null when no stream is on
  on_air_at timestamptz,      -- when the camera first got through for this stream
  updated_at timestamptz not null default now()
);
alter table public.team_streams enable row level security; -- no policies: only the function below and the edge function touch it

-- Anyone with the team's code: the stream that is on now, if there is one. A stream nobody ended is taken as over after
-- four hours, so a forgotten one doesn't sit on everyone's home screen.
create or replace function public.team_stream(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; s public.team_streams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  select * into s from public.team_streams where team_id = t.id;
  if not found or s.started_at is null or s.started_at < now() - interval '4 hours' then return null; end if;
  return jsonb_build_object('hls', s.hls, 'gid', s.gid,
    'started', (extract(epoch from s.started_at) * 1000)::bigint,
    'on_air', case when s.on_air_at is null then null else (extract(epoch from s.on_air_at) * 1000)::bigint end);
end $$;
revoke all on function public.team_stream(text) from public, anon, authenticated;
grant execute on function public.team_stream(text) to anon, authenticated;
