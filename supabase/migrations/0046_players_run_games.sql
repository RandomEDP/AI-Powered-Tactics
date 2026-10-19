-- Anyone in the squad can start a game; only the gaffers can delete one (Ethan, 18 October 2026).
--
-- A player who has claimed their place in the team (signed in, players.user_id is them) can set a game up and run it from
-- their phone when there's no game going. Their phone then writes only that game: the live game (its state carries `by`,
-- their account), the goals followers log for it, and at full time the finished game (games.run_by is them). Never the
-- team, the squad, another game, or a game a gaffer started. Only the gaffers can delete a finished game. The player who
-- started the game can abandon it while it's going (it hasn't counted for anything yet), as can the gaffers.
-- Friendlies teams (teams.personal) are left out: they're one person's own.

alter table public.games add column if not exists run_by uuid references auth.users (id) on delete set null;

-- Is the signed-in person one of this team's players (not a friendlies team)?
create or replace function private.is_team_player(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.players p join public.teams t on t.id = p.team_id
    where p.team_id = p_team and p.user_id = auth.uid() and not coalesce(t.personal, false));
$$;

-- Who ran a finished game from their phone (null when a gaffer's phone saved it).
create or replace function private.game_run_by(p_game uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select g.run_by from public.games g where g.id = p_game;
$$;

revoke all on function private.is_team_player(uuid), private.game_run_by(uuid) from public, anon;
grant execute on function private.is_team_player(uuid), private.game_run_by(uuid) to authenticated;

-- The live game: a player may start one (none going) and keep saving it, and end or abandon it, only while it's theirs.
create policy "players run the game they started" on public.live_matches for all to authenticated
  using ((select private.is_team_player(team_id)) and state->>'by' = (select auth.uid())::text)
  with check ((select private.is_team_player(team_id)) and state->>'by' = (select auth.uid())::text);

-- Goals followers log for it: folded in by the phone running the game.
create policy "players running the game read logged goals" on public.goal_queue for select to authenticated
  using (exists (select 1 from public.live_matches l where l.team_id = goal_queue.team_id and l.state->>'by' = (select auth.uid())::text)
         and (select private.is_team_player(team_id)));
create policy "players running the game clear logged goals" on public.goal_queue for delete to authenticated
  using (exists (select 1 from public.live_matches l where l.team_id = goal_queue.team_id and l.state->>'by' = (select auth.uid())::text)
         and (select private.is_team_player(team_id)));

-- The finished game: saved and re-saved by the player who ran it. No delete policy: only the gaffers delete games.
create policy "players see the games they ran" on public.games for select to authenticated
  using (run_by = (select auth.uid()) and (select private.is_team_player(team_id)));
create policy "players save the games they ran" on public.games for insert to authenticated
  with check (run_by = (select auth.uid()) and (select private.is_team_player(team_id)));
create policy "players update the games they ran" on public.games for update to authenticated
  using (run_by = (select auth.uid()) and (select private.is_team_player(team_id)))
  with check (run_by = (select auth.uid()) and (select private.is_team_player(team_id)));
-- (its players' minutes and goals, and its events, are rewritten whole on each save, as a gaffer's phone does)
create policy "players save the line-ups of games they ran" on public.game_players for all to authenticated
  using ((select private.game_run_by(game_id)) = (select auth.uid()) and (select private.is_team_player(private.game_team(game_id))))
  with check ((select private.game_run_by(game_id)) = (select auth.uid()) and (select private.is_team_player(private.game_team(game_id))));
create policy "players save the events of games they ran" on public.game_events for all to authenticated
  using ((select private.game_run_by(game_id)) = (select auth.uid()) and (select private.is_team_player(private.game_team(game_id))))
  with check ((select private.game_run_by(game_id)) = (select auth.uid()) and (select private.is_team_player(private.game_team(game_id))));
