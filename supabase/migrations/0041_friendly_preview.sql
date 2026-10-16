-- A friendly's personal link, opened in Gaffer's App Clip (Ethan: "when you send out a link to show guests their
-- highlights they can see it in an app clip, and just their highlights"). The App Clip has no account, so it reads one
-- player's friendlies by the link's own token: the games they played (the score from their side) and the clips they're
-- in. The token is the link: whoever holds it could already open those highlights on the website. Nothing else about the
-- team is returned: not its code, its squad, its other players' clips or the gaffer's account.
-- Nothing here removes anything, so it can go in through the Supabase MCP.

create or replace function public.friendly_preview(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.friendly_invites; t public.teams; pl public.players; gs jsonb; cs jsonb;
begin
  select * into i from public.friendly_invites where token = p_token;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  select * into t from public.teams where id = i.team_id and personal;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  select * into pl from public.players where team_id = t.id and pid = i.pid;
  if not found then return jsonb_build_object('status', 'missing'); end if;

  select coalesce(jsonb_agg(x.j order by x.f desc), '[]'::jsonb) into gs from (
    select g.finished_at as f, jsonb_build_object('id', g.id, 'at', g.finished_at,
      'mine', case when s.side = 'b' then g.them else g.us end, 'theirs', case when s.side = 'b' then g.us else g.them end,
      'for', case when s.side = 'b' then coalesce(g.house->>'b', g.opp) else coalesce(g.house->>'a', 'Us') end,
      'against', case when s.side = 'b' then coalesce(g.house->>'a', 'Us') else coalesce(g.house->>'b', g.opp) end,
      'goals', gp.goals, 'assists', gp.assists) as j
    from public.game_players gp
    join public.games g on g.id = gp.game_id and g.team_id = t.id
    cross join lateral (select g.house->'side'->>(gp.pid::text) as side) s
    where gp.pid = i.pid and g.finished_at is not null
    order by g.finished_at desc limit 20) x;

  select coalesce(jsonb_agg(x.j order by x.f desc, x.seq), '[]'::jsonb) into cs from (
    select g.finished_at as f, c.seq, jsonb_build_object('game', c.game_id, 'path', c.path, 'vpath', c.vpath, 'store', c.store,
      'label', c.label, 'at', c.at, 'dur', c.dur) as j
    from public.clips c
    join public.games g on g.id = c.game_id and g.team_id = t.id
    where i.pid = any(c.pids)
      and exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.pid = i.pid)
      and not exists (select 1 from public.clip_hides h where h.game_id = c.game_id and h.at = c.at and h.pid = i.pid)
    order by g.finished_at desc, c.seq limit 60) x;

  return jsonb_build_object('status', 'ok', 'player', pl.name, 'team', t.name, 'color', t.color,
    'claimed', pl.user_id is not null, 'games', gs, 'clips', cs);
end $$;

revoke all on function public.friendly_preview(uuid) from public, anon, authenticated;
grant execute on function public.friendly_preview(uuid) to anon, authenticated;
