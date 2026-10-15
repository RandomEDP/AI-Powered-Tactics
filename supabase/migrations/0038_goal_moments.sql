-- When the ball goes in, lined up by eye (Ethan: "an on device way of looking at the clips, deciding when the ball goes in
-- so it would be lined up perfectly"). A beat edit lands each goal on the beat; the moment it was logged is often a few
-- seconds out, so someone in the team watches the clip and taps where the ball goes in. Kept by game and moment (clips.at),
-- like clip_hides, as seconds from that moment (off), so it still holds when the game is cut again (new clip rows, the same
-- moments). Anyone with the team's code can read them (as get_team gives the clips); gaffers and claimed players set them.

create table if not exists public.clip_hits (
  team_id uuid not null references public.teams (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  at bigint not null,
  off real check (off is null or (off >= -60 and off <= 60)),
  by_user uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (game_id, at)
);
create index if not exists clip_hits_team_idx on public.clip_hits (team_id);
alter table public.clip_hits enable row level security; -- no policies: only the functions below touch it

-- [{game_id, at, off}] for the team's clips that have been lined up.
create or replace function public.clip_hits(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('game_id', h.game_id, 'at', h.at, 'off', h.off) order by h.game_id, h.at)
    from public.clip_hits h where h.team_id = t.id and h.off is not null), '[]'::jsonb);
end $$;
revoke all on function public.clip_hits(text) from public, anon, authenticated;
grant execute on function public.clip_hits(text) to anon, authenticated;

-- Where the ball goes in, as seconds from the moment the clip was cut around; null clears it. Returns 'ok', or
-- 'not_in_team' (not a gaffer or claimed player of this team), 'no_clip' (no clip of that game at that moment), 'bad'.
create or replace function public.set_clip_hit(p_code text, p_game uuid, p_at bigint, p_off real) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.in_team(t.id) then return 'not_in_team'; end if;
  if p_off is not null and (p_off < -60 or p_off > 60) then return 'bad'; end if;
  if not exists (select 1 from public.clips c where c.team_id = t.id and c.game_id = p_game and c.at = p_at) then return 'no_clip'; end if;
  insert into public.clip_hits (team_id, game_id, at, off, by_user) values (t.id, p_game, p_at, p_off, auth.uid())
    on conflict (game_id, at) do update set off = excluded.off, by_user = excluded.by_user, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.set_clip_hit(text, uuid, bigint, real) from public, anon, authenticated;
grant execute on function public.set_clip_hit(text, uuid, bigint, real) to authenticated;
