-- The Highlights tab's "Just me" (Ethan, for 1.1): every clip you're in, from every team, with friendlies left out unless
-- you tick them in. my_clips already gives every clip you're in; this says which come from your friendlies (the hidden
-- personal team, 0040) and which games were friendlies, so the app can leave them out. Never a team's code.
-- No deletes or drops, so it can go in through the Supabase MCP.

create or replace function private.clips_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('game_id', c.game_id, 'at', c.at, 'seq', c.seq, 'path', c.path, 'vpath', c.vpath, 'store', c.store,
      'label', c.label, 'dur', c.dur, 'team', t.short, 'team_name', t.name, 'color', t.color, 'opp', g.opp, 'us', g.us, 'them', g.them,
      'house', case when g.house is not null then jsonb_build_object('a', g.house->'a', 'b', g.house->'b', 'side', g.house->'side'->(p.pid::text)) end,
      'personal', t.personal, 'friendly', g.friendly,
      'when', coalesce(g.finished_at, (extract(epoch from g.created_at) * 1000)::bigint)) order by c.at desc), '[]'::jsonb)
  from public.players p
  join public.teams t on t.id = p.team_id
  join public.clips c on c.team_id = p.team_id and p.pid = any (c.pids) and c.at is not null
  join public.games g on g.id = c.game_id
  where p.user_id = p_user
    and not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = p.pid);
$$;
revoke all on function private.clips_of(uuid) from public, anon, authenticated;
