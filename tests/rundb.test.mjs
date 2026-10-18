// The database's side of "anyone in the squad can start a game, only the gaffers can delete one" (0044): a player who has
// claimed their place can run a game they started (the live game, the goals followers log for it, and the finished game),
// and nothing else: not a game a gaffer started, not another game, not the team or squad. Only the gaffers delete games.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: players running games');
const d = await database();
const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), chaplin = await d.user('chaplin@example.com'), sam = await d.user('sam@example.com');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#1f6b4a', p_crest: null, p_settings: { half: 15 }, p_players: ['Spice', 'Jake', 'Chaplin', 'Harrison'].map((name, i) => ({ pid: i + 1, name })) });
await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: '', p_position: 'fwd' });
await d.rpc(chaplin, 'claim_player', { p_code: sop.code, p_pid: 3, p_last_name: '', p_position: 'def' });
const denied = (e) => /row-level security|permission denied/.test(e);
const live = async () => (await d.rpc(null, 'get_team', { p_code: sop.code })).live;
const state = (by, phase = 'pre') => `'${JSON.stringify({ phase, by, events: [], gid: 'g1' })}'::jsonb`;

// ---------- the live game
check(denied(await d.fails(d.as(sam, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(sam.id)}, 'x')`))), 'someone not in the squad can\'t start a game');
check(denied(await d.fails(d.as(jake, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(chaplin.id)}, 'x')`))), 'a player can\'t start one in someone else\'s name');
await d.as(jake, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(jake.id)}, 'x')`);
eq((await live()).by, jake.id, 'a player who has claimed their place starts a game, and the team sees it');
await d.as(jake, `update public.live_matches set state = ${state(jake.id, 'h1')} where team_id = '${sop.id}'`);
eq((await live()).phase, 'h1', 'and keeps saving it as it goes');
await d.as(chaplin, `update public.live_matches set state = ${state(chaplin.id, 'ft')} where team_id = '${sop.id}'`).catch(() => {});
await d.as(chaplin, `delete from public.live_matches where team_id = '${sop.id}'`).catch(() => {});
eq([(await live()).phase, (await live()).by], ['h1', jake.id], 'another player can\'t change or delete it');
await d.as(ethan, `update public.live_matches set state = state || '{"phase":"h2"}'::jsonb where team_id = '${sop.id}'`);
eq((await live()).phase, 'h2', 'a gaffer still can (as with two gaffers\' phones)');

// ---------- goals followers log, folded in by the phone running it
await d.rpc(chaplin, 'queue_goal', { p_code: sop.code, p_payload: { us: true, p: 3, ts: Date.now() } });
eq((await d.as(jake, `select count(*)::int as n from public.goal_queue`))[0].n, 1, 'the player running the game sees the goals the others log');
eq((await d.as(chaplin, `select count(*)::int as n from public.goal_queue`))[0].n, 0, 'another player doesn\'t');
await d.as(jake, `delete from public.goal_queue where team_id = '${sop.id}'`);
eq((await d.admin(`select count(*)::int as n from public.goal_queue`))[0].n, 0, 'and clears them once folded in');

// ---------- the finished game
const g1 = '00000000-0000-4000-8000-0000000000a1';
check(denied(await d.fails(d.as(jake, `insert into public.games (id, team_id, seq, opp, us, them) values ('${g1}', '${sop.id}', 0, 'Dog', 2, 1)`))), 'a player can\'t save a game without saying they ran it');
check(denied(await d.fails(d.as(jake, `insert into public.games (id, team_id, seq, opp, us, them, run_by) values ('${g1}', '${sop.id}', 0, 'Dog', 2, 1, '${chaplin.id}')`))), 'nor as someone else');
await d.as(jake, `insert into public.games (id, team_id, seq, opp, us, them, run_by) values ('${g1}', '${sop.id}', 0, 'Dog', 2, 1, '${jake.id}') on conflict (id) do update set us = excluded.us`);
await d.as(jake, `insert into public.game_players (game_id, pid, mins, goals, assists) values ('${g1}', 2, 30, 2, 0), ('${g1}', 3, 30, 0, 1)`);
await d.as(jake, `insert into public.game_events (game_id, seq, kind, pid, min, at) values ('${g1}', 0, 'goal', 2, 3, 1)`);
let t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.games.length, t.games[0].us, t.games[0].players.length, t.games[0].events.length], [1, 2, 2, 1], 'at full time the player\'s phone saves the game, its minutes and goals, and its events');
await d.as(jake, `insert into public.games (id, team_id, seq, opp, us, them, run_by) values ('${g1}', '${sop.id}', 0, 'Dog', 3, 1, '${jake.id}') on conflict (id) do update set us = excluded.us`);
await d.as(jake, `delete from public.game_players where game_id = '${g1}'`);
await d.as(jake, `insert into public.game_players (game_id, pid, mins, goals, assists) values ('${g1}', 2, 30, 3, 0)`);
t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.games[0].us, t.games[0].players.length], [3, 1], 'and can save it again (a goal fixed, or it went up twice)');
await d.as(jake, `delete from public.games where id = '${g1}'`).catch(() => {});
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).games.length, 1, 'but can\'t delete it: only the gaffers delete games');
await d.as(chaplin, `update public.games set us = 9 where id = '${g1}'`).catch(() => {});
await d.as(chaplin, `delete from public.game_events where game_id = '${g1}'`).catch(() => {});
t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.games[0].us, t.games[0].events.length], [3, 1], 'another player can\'t change it either');

// a game a gaffer saved is the gaffers' alone
const g2 = '00000000-0000-4000-8000-0000000000a2';
await d.as(ethan, `insert into public.games (id, team_id, seq, opp, us, them) values ('${g2}', '${sop.id}', 1, 'Athletico', 1, 1)`);
await d.as(jake, `update public.games set us = 5 where id = '${g2}'`).catch(() => {});
await d.as(jake, `delete from public.game_players where game_id = '${g2}'`).catch(() => {});
check(denied(await d.fails(d.as(jake, `insert into public.game_events (game_id, seq, kind, min) values ('${g2}', 0, 'goal', 1)`))), 'a player can\'t add to a game they didn\'t run');
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).games.find((g) => g.id === g2).us, 1, 'nor change it');

// nothing else of the team's
await d.as(jake, `update public.teams set name = 'Jake FC' where id = '${sop.id}'`).catch(() => {});
await d.as(jake, `delete from public.players where team_id = '${sop.id}'`).catch(() => {});
t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.team.name, t.players.length], ['Sons of Pitches FC', 4], 'running a game doesn\'t let a player change the team or the squad');

// the player who started it can end or abandon it; the gaffers delete finished games
await d.as(ethan, `update public.live_matches set state = ${state(jake.id, 'h1')} where team_id = '${sop.id}'`);
await d.as(jake, `delete from public.live_matches where team_id = '${sop.id}'`);
eq(await live(), null, 'the player who started the game can end it, or abandon it');
await d.as(ethan, `delete from public.games where id = '${g1}'`);
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).games.map((g) => g.id), [g2], 'a gaffer deletes a game, whoever ran it');
await d.as(ethan, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(ethan.id)}, 'x')`);
await d.as(jake, `delete from public.live_matches where team_id = '${sop.id}'`).catch(() => {});
check(denied(await d.fails(d.as(jake, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(jake.id)}, 'x') on conflict (team_id) do update set state = excluded.state`))), 'a player can\'t take over or replace a game a gaffer started');
eq((await live()).by, ethan.id, 'nor abandon it');

// someone else's friendlies team (teams.personal) is theirs alone
await d.admin(`update public.teams set personal = true where id = $1`, [sop.id]);
await d.as(ethan, `delete from public.live_matches where team_id = '${sop.id}'`);
check(denied(await d.fails(d.as(jake, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', ${state(jake.id)}, 'x')`))), 'a player in someone\'s friendlies team can\'t start a game there');

await done();
