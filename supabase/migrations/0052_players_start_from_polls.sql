-- A player starting a game from a poll (Ethan, 8 November 2026: "make sure everyone can start a game not just the gaffer").
--
-- Since 0046 anyone who has claimed their place can set up and run a game from their phone. A game started from a poll
-- (or from an accepted challenge, which comes with its own poll) also closes that poll at full time and reports the score
-- to the other team; both were gaffer-only, so a game a player ran left its poll open and the challenge unscored.
-- Now the player running the game (the team's live game is theirs, `by`, and was started from that poll, `fx`) may do both.

-- Is the signed-in person the player running this team's live game, started from this poll?
create or replace function private.runs_fixture(p_team uuid, p_fixture uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_fixture is not null and (select private.is_team_player(p_team)) and exists (
    select 1 from public.live_matches l
    where l.team_id = p_team and l.state->>'by' = auth.uid()::text and l.state->>'fx' = p_fixture::text);
$$;
revoke all on function private.runs_fixture(uuid, uuid) from public, anon;
grant execute on function private.runs_fixture(uuid, uuid) to authenticated;

-- Close a poll once its game is played: the gaffers, or the player running that game.
create or replace function public.poll_played(p_code text, p_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; f public.fixtures;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'missing'; end if;
  select * into f from public.fixtures where id = p_id and team_id = t.id for update;
  if not found then return 'missing'; end if;
  if not (private.is_organiser(t.id) or private.runs_fixture(t.id, f.id)) then return 'not_allowed'; end if;
  update public.fixtures set status = 'done' where id = f.id;
  return 'ok';
end $$;
revoke all on function public.poll_played(text, uuid) from public, anon;
grant execute on function public.poll_played(text, uuid) to authenticated;

-- The score of a challenge: as 0014, but the player running the game played for it may send it too.
create or replace function public.challenge_result(p_code text, p_id uuid, p_us integer, p_them integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; c public.challenges; mine jsonb; fs jsonb; ts jsonb; ra public.team_rivalry; rb public.team_rivalry;
  ea double precision; sa double precision; gd integer; g double precision; da integer; db integer;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return 'not_gaffer'; end if;
  select * into c from public.challenges where id = p_id for update;
  if not found or (c.from_team <> t.id and c.to_team <> t.id) then
    return case when private.is_organiser(t.id) then 'missing' else 'not_gaffer' end;
  end if;
  if not (private.is_organiser(t.id) or private.runs_fixture(t.id, case when c.from_team = t.id then c.from_fixture else c.to_fixture end)) then return 'not_gaffer'; end if;
  if c.status not in ('accepted', 'disputed') then return 'closed'; end if;
  mine := jsonb_build_object('us', greatest(0, least(99, p_us)), 'them', greatest(0, least(99, p_them)));
  fs := case when c.from_team = t.id then mine else c.from_score end;
  ts := case when c.to_team = t.id then mine else c.to_score end;
  update public.challenges set from_score = fs, to_score = ts, updated_at = now() where id = p_id;
  if fs is null or ts is null then return 'waiting'; end if;
  if (fs->>'us') <> (ts->>'them') or (fs->>'them') <> (ts->>'us') then
    update public.challenges set status = 'disputed' where id = p_id;
    return 'disputed';
  end if;
  if c.kind = 'elo' then
    insert into public.team_rivalry (team_id) values (c.from_team), (c.to_team) on conflict (team_id) do nothing;
    select * into ra from public.team_rivalry where team_id = c.from_team for update;
    select * into rb from public.team_rivalry where team_id = c.to_team for update;
    gd := abs((fs->>'us')::integer - (fs->>'them')::integer);
    sa := case when (fs->>'us')::integer > (fs->>'them')::integer then 1 when gd = 0 then 0.5 else 0 end;
    ea := 1 / (1 + power(10, (rb.elo - ra.elo) / 400.0));
    g := case when gd <= 1 then 1 when gd = 2 then 1.5 else (11 + gd) / 8.0 end; -- a bigger win moves the ratings more
    da := round((case when ra.elo_games < 10 then 40 else 32 end) * g * (sa - ea));
    db := round((case when rb.elo_games < 10 then 40 else 32 end) * g * (ea - sa));
    update public.team_rivalry set elo = greatest(100, elo + da), elo_games = elo_games + 1, updated_at = now() where team_id = c.from_team;
    update public.team_rivalry set elo = greatest(100, elo + db), elo_games = elo_games + 1, updated_at = now() where team_id = c.to_team;
    update public.challenges set status = 'played', elo_change = jsonb_build_object('from', da, 'to', db) where id = p_id;
  else
    update public.challenges set status = 'played' where id = p_id;
  end if;
  return 'played';
end $$;
revoke all on function public.challenge_result(text, uuid, integer, integer) from public, anon;
grant execute on function public.challenge_result(text, uuid, integer, integer) to authenticated;
