// The database itself: every migration in supabase/migrations loaded into a real Postgres (in memory), then the
// functions and security rules exercised as different people — a gaffer, a player, a stranger, someone not signed in.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database');
const d = await database();
eq(d.applied.length >= 15, true, 'every migration applies cleanly to an empty database, in order');

const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com'), rival = await d.user('rival@example.com'), third = await d.user('third@example.com');
const count = async (who, table, where = 'true') => { try { return (await d.as(who, `select count(*)::int as n from ${table} where ${where}`))[0].n; } catch (e) { return 'denied'; } };
const squad = (names) => names.map((name, i) => ({ pid: i + 1, name }));
const future = Date.now() + 7 * 86400000;

// ---------- teams
check(/permission denied|Sign in/i.test(await d.fails(d.rpc(null, 'create_team', { p_name: 'Nope', p_short: '', p_color: '#1f6b4a', p_crest: null, p_settings: {}, p_players: [] }))), 'nobody can make a team without signing in');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#1f6b4a', p_crest: null, p_settings: { half: 15 }, p_players: squad(['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac']) });
check(/^[A-Z0-9]{6}$/.test(sop.code) && /^[A-Z0-9]{10}$/.test(sop.organiser_code), 'a new team gets a 6-character code and a 10-character gaffer code');
let t = await d.rpc(null, 'get_team', { p_code: sop.code.toLowerCase() + ' ' });
eq([t.team.name, t.players.length, t.is_organiser, t.team.organiser_code ?? null, t.my_pid ?? null], ['Sons of Pitches FC', 6, false, null, null], 'anyone with the code can open the team (any case, stray spaces), but is never shown the gaffer code');
t = await d.rpc(ethan, 'get_team', { p_code: sop.code });
eq([t.is_organiser, t.team.organiser_code], [true, sop.organiser_code], 'its gaffer is, and sees the gaffer code');
eq(await d.rpc(null, 'get_team', { p_code: 'ZZZZZZ' }), null, 'a wrong code opens nothing');

// ---------- nobody can go round the app and read or change tables directly
for (const [who, label] of [[null, 'someone not signed in'], [sam, 'a signed-in stranger'], [jake, 'a signed-in stranger (later a player)']]) {
  const seen = [];
  for (const table of ['teams', 'team_members', 'players', 'games', 'game_events', 'live_matches', 'goal_queue', 'fixtures', 'fixture_votes', 'clips', 'push_tokens', 'messages', 'message_reports', 'team_rivalry', 'challenges', 'voice_usage', 'join_requests', 'team_streams', 'clip_hides', 'profiles', 'follows', 'blocks', 'profile_reports']) seen.push(await count(who, 'public.' + table));
  check(seen.every((n) => n === 0 || n === 'denied'), `${label} reading the tables directly sees nothing (${seen.join(',')})`);
}
await d.as(sam, `update public.teams set name = 'Hacked FC'`).catch(() => {});
await d.as(sam, `delete from public.players`).catch(() => {});
check(/row-level security|permission denied/.test(await d.fails(d.as(sam, `insert into public.players (team_id, pid, name) values ('${sop.id}', 99, 'Ringer')`))), 'a stranger cannot add a player to someone else\'s team');
check(/row-level security|permission denied/.test(await d.fails(d.as(sam, `insert into public.team_members (team_id, user_id) values ('${sop.id}', '${sam.id}')`))), 'nor make themselves its gaffer');
t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.team.name, t.players.length], ['Sons of Pitches FC', 6], 'and their attempts to rename the team or clear its squad did nothing');
eq(await d.rpc(sam, 'join_as_organiser', { p_organiser_code: 'AAAAAAAAAA' }), null, 'a guessed gaffer code gets nowhere');

// ---------- the gaffer's own edits (what the app sends when it saves)
await d.as(ethan, `update public.teams set name = 'Sons of Pitches' where id = '${sop.id}'`);
await d.as(ethan, `insert into public.players (team_id, pid, name) values ('${sop.id}', 7, 'Reece'), ('${sop.id}', 8, 'Ethan')`);
await d.as(ethan, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', '{"phase":"h1","events":[]}', 'x')`);
t = await d.rpc(null, 'get_team', { p_code: sop.code });
eq([t.team.name, t.players.length, t.live.phase], ['Sons of Pitches', 8, 'h1'], 'the gaffer can rename the team, add players and put a live game up; followers see it');

// ---------- players claiming their profile
eq(await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: 'Smith', p_position: 'fwd' }), 'ok', 'a player claims their profile');
eq(await d.rpc(sam, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: 'Other', p_position: 'def' }), 'taken', 'nobody else can claim the same one');
eq(await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 99, p_last_name: '', p_position: 'def' }), 'missing', 'or one that does not exist');
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'claim_player', { p_code: sop.code, p_pid: 3, p_last_name: '', p_position: 'def' }))), 'or without signing in');
t = await d.rpc(jake, 'get_team', { p_code: sop.code }); const mine = t.players.find((p) => p.pid === 2);
eq([t.my_pid, mine.claimed, mine.last_name, mine.position, t.is_organiser], [2, true, 'Smith', 'fwd', false], 'the player sees which one is theirs, and is not a gaffer');
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).players.find((p) => p.pid === 2).last_name ?? null, null, 'their surname is not shown to people who are not signed in');
eq((await d.rpc(ethan, 'get_team', { p_code: sop.code })).players.find((p) => p.pid === 2).last_name, 'Smith', 'the gaffer sees it');
eq([await d.rpc(jake, 'set_my_number', { p_code: sop.code, p_number: 9 }), (await d.rpc(null, 'get_team', { p_code: sop.code })).players.find((p) => p.pid === 2).number], [true, 9], 'a player sets their own shirt number');
eq(await d.rpc(sam, 'set_my_number', { p_code: sop.code, p_number: 10 }), false, 'someone with no profile on the team cannot');
check((await d.fails(d.rpc(jake, 'set_my_number', { p_code: sop.code, p_number: 1234 }))) !== '' || (await d.rpc(null, 'get_team', { p_code: sop.code })).players.find((p) => p.pid === 2).number !== 1234, 'a silly shirt number is refused');
eq(await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 3, p_last_name: 'Smith', p_position: 'def' }), 'ok', 'claiming a different profile…');
t = await d.rpc(jake, 'get_team', { p_code: sop.code });
eq([t.my_pid, t.players.find((p) => p.pid === 2).claimed], [3, false], '…moves them to it and frees the old one');
eq((await d.rpc(jake, 'my_teams')).map((x) => [x.name, x.org]), [['Sons of Pitches', false]], 'their teams list shows the team, as a player');
eq((await d.rpc(ethan, 'my_teams')).map((x) => [x.name, x.org]), [['Sons of Pitches', true]], 'the gaffer\'s shows it as a gaffer');

// ---------- polls
await d.as(ethan, `insert into public.fixtures (id, team_id, opp, ko_at, max_outfield) values ('00000000-0000-4000-8000-000000000001', '${sop.id}', 'Athletico Pathetico', ${future}, 1)`);
const fx = '00000000-0000-4000-8000-000000000001';
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).fixtures.length, 1, 'a poll the gaffer makes is visible to the team');
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'in' }), 'ok', 'a player says they are in');
eq(await d.rpc(sam, 'vote_fixture', { p_fixture: fx, p_choice: 'in' }), 'not_player', 'someone with no profile cannot answer');
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'maybe' }), 'invalid', 'only in, out or in goal');
eq(await d.rpc(ethan, 'vote_fixture', { p_fixture: fx, p_choice: 'in', p_pid: 4 }), 'full', 'the gaffer answering for a player is told when the outfield spots are gone');
eq(await d.rpc(ethan, 'vote_fixture', { p_fixture: fx, p_choice: 'gk', p_pid: 1 }), 'ok', 'the gaffer puts the keeper in goal');
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'gk' }), 'gk_taken', 'only one keeper');
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'gk', p_pid: 1 }), 'gk_taken', 'a player passing someone else\'s number still only answers for themselves');
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'no' }), 'ok', 'changing an answer');
eq((await d.rpc(null, 'get_team', { p_code: sop.code })).fixtures[0].votes.map((v) => v.pid + ':' + v.choice).sort(), ['1:gk', '3:no'], 'the answers everyone sees');
await d.as(ethan, `update public.fixtures set status = 'done' where id = '${fx}'`);
eq(await d.rpc(jake, 'vote_fixture', { p_fixture: fx, p_choice: 'in' }), 'closed', 'no answers once the game is done');

// ---------- goals logged by followers
await d.as(ethan, `update public.teams set followers_can_score = false where id = '${sop.id}'`);
eq(await d.rpc(null, 'queue_goal', { p_code: sop.code, p_payload: { us: true, p: 2 } }), false, 'followers cannot log goals when the gaffer has switched that off');
await d.as(ethan, `update public.teams set followers_can_score = true where id = '${sop.id}'`);
eq(await d.rpc(null, 'queue_goal', { p_code: sop.code, p_payload: { us: true, p: 2, ts: 1000, junk: '<script>', on: [1, 2, 3] } }), true, 'and can when it is on');
eq(await d.rpc(null, 'queue_goal', { p_code: sop.code, p_payload: { p: 2 } }), false, 'a goal for nobody is refused');
eq([await count(null, 'public.goal_queue'), await count(sam, 'public.goal_queue')], [0, 0], 'followers cannot read the queue back');
const queued = await d.as(ethan, `select payload from public.goal_queue`);
eq(queued.map((r) => [r.payload.us, r.payload.p, r.payload.ts, Object.keys(r.payload).length]), [[true, 2, 1000, 3]], 'the gaffer reads it, with anything unexpected stripped out');
for (let i = 0; i < 60; i++) await d.rpc(null, 'queue_goal', { p_code: sop.code, p_payload: { us: false } });
eq(await count(ethan, 'public.goal_queue'), 50, 'the queue stops at 50, so it cannot be flooded');
await d.as(ethan, `delete from public.goal_queue where team_id = '${sop.id}'`);
eq(await count(ethan, 'public.goal_queue'), 0, 'the gaffer clears it');

// ---------- chat
const m1 = await d.rpc(jake, 'chat_send', { p_code: sop.code, p_body: '  Who is bringing the bibs?  ' });
const m2 = await d.rpc(ethan, 'chat_send', { p_code: sop.code, p_body: '', p_play: { v: 1, frames: [] }, p_play_name: 'Corner routine' });
check(!!m1 && !!m2, 'a player and the gaffer can both post');
eq([await d.rpc(sam, 'chat_send', { p_code: sop.code, p_body: 'spam' }), await d.rpc(sam, 'chat_list', { p_code: sop.code })], [null, null], 'a stranger can neither post nor read');
check(/permission denied/.test(await d.fails(d.rpc(null, 'chat_list', { p_code: sop.code }))), 'nor can someone not signed in');
eq(await d.rpc(jake, 'chat_send', { p_code: sop.code, p_body: '   ' }), null, 'an empty message is not posted');
let chat = await d.rpc(jake, 'chat_list', { p_code: sop.code });
eq(chat.map((m) => [m.name, m.body, m.play_name ?? null, m.mine, m.can_delete]), [['Chaplin', 'Who is bringing the bibs?', null, true, true], ['Gaffer', '', 'Corner routine', false, false]], 'the player sees both, oldest first, and can delete only their own');
eq((await d.rpc(ethan, 'chat_list', { p_code: sop.code })).map((m) => m.can_delete), [true, true], 'the gaffer can delete either');
eq([await d.rpc(sam, 'chat_delete', { p_id: m1 }), await d.rpc(jake, 'chat_delete', { p_id: m2 }), await d.rpc(sam, 'chat_report', { p_id: m1, p_reason: 'x' })], [false, false, false], 'a stranger cannot delete or report; a player cannot delete the gaffer\'s');
eq([await d.rpc(jake, 'chat_report', { p_id: m2, p_reason: 'rude' }), await d.rpc(jake, 'chat_report', { p_id: m2, p_reason: 'again' }), (await d.admin('select count(*)::int as n from public.message_reports'))[0].n], [true, true, 1], 'a report is recorded once per person');
eq([await d.rpc(ethan, 'chat_delete', { p_id: m1 }), (await d.rpc(jake, 'chat_list', { p_code: sop.code })).length], [true, 1], 'the gaffer deletes the player\'s message');
const long = await d.rpc(jake, 'chat_send', { p_code: sop.code, p_body: 'x'.repeat(5000) });
eq((await d.admin(`select char_length(body) as n from public.messages where id = '${long}'`))[0].n, 1000, 'a very long message is cut to 1,000 characters');
let slow = ''; for (let i = 0; i < 35 && !slow; i++) slow = await d.fails(d.rpc(jake, 'chat_send', { p_code: sop.code, p_body: 'msg ' + i }));
check(/Slow down/.test(slow), 'more than 30 messages in a minute is stopped');

// ---------- notifications
const tok = 'a'.repeat(64);
eq([await d.rpc(jake, 'register_push', { p_token: tok }), await d.rpc(jake, 'register_push', { p_token: 'short' })], [true, false], 'a phone registers for notifications; a malformed token is refused');
eq([await d.rpc(ethan, 'team_push', { p_code: sop.code }), await d.rpc(jake, 'team_push', { p_code: sop.code })], [[3], null], 'the gaffer is told which players have notifications on; players are not');
eq([await d.rpc(sam, 'register_push', { p_token: tok }), await d.rpc(ethan, 'team_push', { p_code: sop.code })], [true, []], 'the same phone signing in as someone else moves to them');
eq([await d.rpc(jake, 'unregister_push', { p_token: tok }), (await d.admin('select count(*)::int as n from public.push_tokens'))[0].n], [true, 1], 'signing out only removes your own registration');

// ---------- a second gaffer
eq(await d.rpc(third, 'join_as_organiser', { p_organiser_code: sop.organiser_code.toLowerCase() }), sop.code, 'the gaffer code lets a second gaffer in');
eq((await d.rpc(third, 'get_team', { p_code: sop.code })).is_organiser, true, 'who is then a gaffer');
const fresh = await d.rpc(ethan, 'new_organiser_code', { p_team: sop.id });
check(/^[A-Z0-9]{10}$/.test(fresh) && fresh !== sop.organiser_code, 'a gaffer can change the gaffer code');
eq(await d.rpc(sam, 'join_as_organiser', { p_organiser_code: sop.organiser_code }), null, 'after which the old one no longer works');
check((await d.fails(d.rpc(jake, 'new_organiser_code', { p_team: sop.id }))) !== '' , 'a player cannot change it');

// ---------- playing other teams: home grounds, finding teams, challenges
const ath = await d.rpc(rival, 'create_team', { p_name: 'Athletico Pathetico', p_short: 'ATH', p_color: '#aa0000', p_crest: null, p_settings: {}, p_players: squad(['Ant', 'Baz', 'Col', 'Daz', 'Ed']) });
const far = await d.rpc(sam, 'create_team', { p_name: '100%_Effort', p_short: '', p_color: '#0000aa', p_crest: null, p_settings: {}, p_players: squad(['A', 'B', 'C', 'D', 'E']) });
eq([await d.rpc(jake, 'set_home', { p_code: sop.code, p_name: 'x', p_lat: 51.5, p_lng: 0.1 }), await d.rpc(ethan, 'set_home', { p_code: sop.code, p_name: 'Powerleague Romford', p_lat: 51.57461, p_lng: 0.18333 })], [false, true], 'only a gaffer sets the home ground');
await d.rpc(rival, 'set_home', { p_code: ath.code, p_name: 'Goals Dagenham', p_lat: 51.5466, p_lng: 0.1483 });
await d.rpc(sam, 'set_home', { p_code: far.code, p_name: 'Leeds', p_lat: 53.8, p_lng: -1.55 });
eq((await d.admin(`select lat, lng from public.team_rivalry where team_id = '${sop.id}'`))[0], { lat: 51.575, lng: 0.183 }, 'its position is kept only to about 100 metres');
let near = await d.rpc(ethan, 'find_teams', { p_code: sop.code });
eq(near.map((x) => [x.name, x.home, x.elo, x.km > 3 && x.km < 5]), [['Athletico Pathetico', 'Goals Dagenham', 1000, true]], 'nearby teams: the one 4 km away, not the one in Leeds');
eq((await d.rpc(ethan, 'find_teams', { p_code: sop.code, p_query: 'effort' })).map((x) => x.name), ['100%_Effort'], 'searching by name finds teams anywhere');
eq([(await d.rpc(ethan, 'find_teams', { p_code: sop.code, p_query: '%' })).map((x) => x.name), (await d.rpc(ethan, 'find_teams', { p_code: sop.code, p_query: '_' })).map((x) => x.name)], [['100%_Effort'], ['100%_Effort']], 'a % or _ in the search is taken literally, not as "match anything"');
eq((await d.rpc(jake, 'find_teams', { p_code: sop.code })).length, 1, 'players can look too');
eq(await d.rpc(third, 'find_teams', { p_code: ath.code }), null, 'but not on behalf of a team they are not in');
eq((await d.rpc(jake, 'rival_home', { p_code: ath.code })).elo, 1000, 'every team starts on 1000');

const terms = { side: 5, half: 20, periods: 2, subs: 3, ko_at: future, location: 'Goals Dagenham', note: 'Loser buys the oranges' };
check(/Only a gaffer/.test(await d.fails(d.rpc(jake, 'challenge_send', { p_code: sop.code, p_to: ath.id, p_kind: 'elo', p_terms: terms }))), 'a player cannot challenge another team');
check(/can.t be challenged/.test(await d.fails(d.rpc(ethan, 'challenge_send', { p_code: sop.code, p_to: sop.id, p_kind: 'elo', p_terms: terms }))), 'a team cannot challenge itself');
check(/hasn.t passed/.test(await d.fails(d.rpc(ethan, 'challenge_send', { p_code: sop.code, p_to: ath.id, p_kind: 'elo', p_terms: Object.assign({}, terms, { ko_at: Date.now() - 86400000 }) }))), 'nor for a time that has gone');
const ch = await d.rpc(ethan, 'challenge_send', { p_code: sop.code, p_to: ath.id, p_kind: 'elo', p_terms: Object.assign({}, terms, { half: 500, subs: -2, side: 11, hack: 'x' }) });
let mineC = (await d.rpc(ethan, 'my_challenges', { p_code: sop.code }))[0], theirs = (await d.rpc(rival, 'my_challenges', { p_code: ath.code }))[0];
eq([mineC.terms.half, mineC.terms.subs, mineC.terms.side, mineC.terms.hack ?? null, mineC.sent, mineC.my_turn, theirs.sent, theirs.my_turn, theirs.other.name], [60, 0, 5, null, true, false, false, true, 'Sons of Pitches'], 'a challenge is tidied to sensible terms and waits for the other gaffer');
eq(await d.rpc(sam, 'my_challenges', { p_code: sop.code }), null, 'a stranger cannot read a team\'s challenges');
eq([await d.rpc(ethan, 'challenge_reply', { p_code: sop.code, p_id: ch, p_action: 'accept' }), await d.rpc(sam, 'challenge_reply', { p_code: far.code, p_id: ch, p_action: 'accept' }), await d.rpc(jake, 'challenge_reply', { p_code: sop.code, p_id: ch, p_action: 'accept' })],
  ['not_your_turn', 'missing', 'not_gaffer'], 'the sender cannot accept their own challenge; a third team cannot touch it; nor can a player');
eq(await d.rpc(rival, 'challenge_reply', { p_code: ath.code, p_id: ch, p_action: 'counter', p_terms: Object.assign({}, terms, { half: 15 }) }), 'ok', 'the other gaffer sends back different terms');
mineC = (await d.rpc(ethan, 'my_challenges', { p_code: sop.code }))[0];
eq([mineC.terms.half, mineC.my_turn, mineC.rounds], [15, true, 1], 'and now it is the first gaffer\'s turn');
eq(await d.rpc(rival, 'challenge_reply', { p_code: ath.code, p_id: ch, p_action: 'accept' }), 'not_your_turn', 'the one who countered cannot also accept');
eq(await d.rpc(ethan, 'challenge_result', { p_code: sop.code, p_id: ch, p_us: 9, p_them: 0 }), 'closed', 'no result can be reported for a game not yet agreed');
eq(await d.rpc(ethan, 'challenge_reply', { p_code: sop.code, p_id: ch, p_action: 'accept' }), 'ok', 'accepted');
const polls = await d.admin(`select t.name, f.opp, f.ko_at, f.location, f.max_outfield, f.status from public.fixtures f join public.teams t on t.id = f.team_id where f.opp in ('Sons of Pitches', 'Athletico Pathetico') and f.status = 'open' order by 1`);
eq(polls.map((p) => [p.name, p.opp, Number(p.ko_at), p.location, p.max_outfield]), [['Athletico Pathetico', 'Sons of Pitches', future, 'Goals Dagenham', 7], ['Sons of Pitches', 'Athletico Pathetico', future, 'Goals Dagenham', 7]], 'accepting puts a poll in both teams\' games, against each other');
eq(await d.rpc(rival, 'challenge_reply', { p_code: ath.code, p_id: ch, p_action: 'decline' }), 'closed', 'an agreed game cannot then be declined through the challenge');

// ---------- results and Elo
const elo = async (id) => (await d.admin(`select elo, elo_games from public.team_rivalry where team_id = '${id}'`))[0];
eq(await d.rpc(ethan, 'challenge_result', { p_code: sop.code, p_id: ch, p_us: 3, p_them: 1 }), 'waiting', 'one team reports 3–1: nothing moves until the other has');
eq([(await elo(sop.id)).elo, (await elo(ath.id)).elo], [1000, 1000], 'ratings unchanged');
eq(await d.rpc(rival, 'challenge_result', { p_code: ath.code, p_id: ch, p_us: 2, p_them: 3 }), 'disputed', 'the other reports a different score: disputed');
eq([(await elo(sop.id)).elo, (await d.rpc(ethan, 'my_challenges', { p_code: sop.code }))[0].status], [1000, 'disputed'], 'still no change');
eq(await d.rpc(rival, 'challenge_result', { p_code: ath.code, p_id: ch, p_us: 1, p_them: 3 }), 'played', 'they correct it to 1–3: settled');
eq([await elo(sop.id), await elo(ath.id)], [{ elo: 1030, elo_games: 1 }, { elo: 970, elo_games: 1 }], 'two level teams, a two-goal win: +30 and −30');
mineC = (await d.rpc(ethan, 'my_challenges', { p_code: sop.code }))[0]; theirs = (await d.rpc(rival, 'my_challenges', { p_code: ath.code }))[0];
eq([mineC.status, mineC.elo_change, theirs.elo_change, mineC.my_score, theirs.my_score], ['played', 30, -30, { us: 3, them: 1 }, { us: 1, them: 3 }], 'each team sees its own side of it');
eq(await d.rpc(ethan, 'challenge_result', { p_code: sop.code, p_id: ch, p_us: 9, p_them: 0 }), 'closed', 'a settled result cannot be reported again');

const play = async (kind, a, b, us, them) => { // a challenges b, b accepts, both report
  const id = await d.rpc(a.who, 'challenge_send', { p_code: a.code, p_to: b.id, p_kind: kind, p_terms: terms });
  await d.rpc(b.who, 'challenge_reply', { p_code: b.code, p_id: id, p_action: 'accept' });
  await d.rpc(a.who, 'challenge_result', { p_code: a.code, p_id: id, p_us: us, p_them: them });
  return d.rpc(b.who, 'challenge_result', { p_code: b.code, p_id: id, p_us: them, p_them: us });
};
const S = { who: ethan, code: sop.code, id: sop.id }, R = { who: rival, code: ath.code, id: ath.id };
eq([await play('friendly', S, R, 10, 0), await elo(sop.id), await elo(ath.id)], ['played', { elo: 1030, elo_games: 1 }, { elo: 970, elo_games: 1 }], 'a friendly, however one-sided, moves nothing');
await play('elo', R, S, 2, 2);
eq([(await elo(sop.id)).elo, (await elo(ath.id)).elo], [1027, 973], 'a draw nudges the lower-rated team up (1030 v 970: −3 / +3)');
await play('elo', R, S, 1, 0);
eq([(await elo(sop.id)).elo, (await elo(ath.id)).elo], [1004, 996], 'the lower-rated team winning by one takes more than half the usual swing (−23 / +23)');
await play('elo', S, R, 12, 0);
const big = [(await elo(sop.id)).elo, (await elo(ath.id)).elo];
eq(big, [1060, 940], 'a 12–0 moves the ratings almost three times as far as a one-goal win (+56 / −56)');
eq(big[0] + big[1], 2000, 'between two new teams, what one gains the other loses');
for (let i = 0; i < 7; i++) await play('elo', S, R, 1, 0);
const before = [await elo(sop.id), await elo(ath.id)];
eq([before[0].elo_games, before[1].elo_games], [11, 11], 'eleven Elo matches each');
await play('elo', R, S, 1, 0);
const after = [await elo(sop.id), await elo(ath.id)];
const expected = 1 / (1 + Math.pow(10, (before[0].elo - before[1].elo) / 400));
eq([after[1].elo - before[1].elo, after[0].elo - before[0].elo], [Math.round(32 * (1 - expected)), Math.round(32 * (expected - 1))], 'after ten games a team\'s rating settles down: it moves by 32 a game, not 40');
await d.admin(`update public.team_rivalry set elo = 105 where team_id = '${ath.id}'`);
await play('elo', S, R, 30, 0);
eq((await elo(ath.id)).elo >= 100, true, 'a rating never drops below 100');
eq((await d.rpc(ethan, 'my_challenges', { p_code: sop.code })).every((c) => c.status === 'played'), true, 'every game shows as played');

let limit = ''; for (let i = 0; i < 12 && !limit; i++) limit = await d.fails(d.rpc(ethan, 'challenge_send', { p_code: sop.code, p_to: far.id, p_kind: 'friendly', p_terms: terms }));
check(/ten challenges/.test(limit), 'a team cannot leave more than ten challenges waiting');
const open = (await d.rpc(ethan, 'my_challenges', { p_code: sop.code })).filter((c) => c.status === 'proposed');
eq([await d.rpc(ethan, 'challenge_reply', { p_code: sop.code, p_id: open[0].id, p_action: 'decline' }), await d.rpc(sam, 'challenge_reply', { p_code: far.code, p_id: open[1].id, p_action: 'decline' })], ['ok', 'ok'], 'the sender can withdraw one and the other team can turn one down');
const closed = await d.admin(`select status from public.challenges where id in ('${open[0].id}', '${open[1].id}') order by status`);
eq(closed.map((c) => c.status), ['cancelled', 'declined'], 'shown as cancelled and declined');

// ---------- asking to join when your name isn't in the squad
const woody = await d.user('woody@example.com'), josh = await d.user('josh@example.com'), pat = await d.user('pat@example.com');
const ask = (who, extra = {}) => d.rpc(who, 'request_join', Object.assign({ p_code: sop.code, p_name: 'Woody', p_last_name: 'Wood', p_position: 'def', p_number: 14 }, extra));
const squadSize = async () => (await d.rpc(null, 'get_team', { p_code: sop.code })).players.length;
const size0 = await squadSize();
check(/Sign in|permission denied/i.test(await d.fails(ask(null))), 'nobody can ask to join without signing in');
eq([await ask(woody, { p_name: '   ' }), await ask(woody, { p_position: 'striker' }), await ask(woody, { p_code: 'ZZZZZZ' })], ['name', 'position', 'missing'], 'a request needs a name, a real position and a real team');
eq([await ask(jake), await ask(ethan)], ['member', 'member'], 'someone already in the team (player or gaffer) has no need to ask');
eq(await ask(woody, { p_code: ' ' + sop.code.toLowerCase(), p_name: '  Woody   ' }), 'ok', 'someone with the code and an account asks to join');
let mineR = await d.rpc(woody, 'my_join_request', { p_code: sop.code });
eq([mineR.status, mineR.name], ['pending', 'Woody'], 'and can see their request is waiting');
eq(await ask(woody, { p_number: 15 }), 'pending', 'asking again while waiting just updates the details');
eq([await d.rpc(jake, 'team_join_requests', { p_code: sop.code }), await d.rpc(sam, 'team_join_requests', { p_code: sop.code }), await count(woody, 'public.join_requests'), await count(jake, 'public.join_requests')], [null, null, 0, 0], 'players and strangers cannot see who has asked, by function or by reading the table');
let waiting = await d.rpc(ethan, 'team_join_requests', { p_code: sop.code });
eq(waiting.map((r) => [r.name, r.last_name, r.position, r.number]), [['Woody', 'Wood', 'def', 15]], 'the gaffer sees the request with the details given');
eq([await d.rpc(jake, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: true }), await d.rpc(woody, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: true }),
  await d.rpc(rival, 'decide_join', { p_code: ath.code, p_id: waiting[0].id, p_allow: true }), await squadSize()], ['not_gaffer', 'not_gaffer', 'missing', size0], 'a player, the person asking and another team\'s gaffer cannot let them in');
eq([await d.rpc(ethan, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: true }), await d.rpc(third, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: false })], ['ok', 'closed'], 'the gaffer lets them in; a second answer changes nothing');
t = await d.rpc(woody, 'get_team', { p_code: sop.code }); const wp = t.players.find((p) => p.name === 'Woody');
eq([t.players.length, t.my_pid === wp.pid, wp.claimed, wp.position, wp.number, wp.last_name, wp.pid > 8, t.team.settings.nextId], [size0 + 1, true, true, 'def', 15, 'Wood', true, wp.pid + 1], 'they are in the squad with a profile that is already theirs, and the next new player gets the number after');
eq([(await d.rpc(woody, 'my_join_request', { p_code: sop.code })).status, (await d.rpc(ethan, 'team_join_requests', { p_code: sop.code })).length, !!(await d.rpc(woody, 'chat_send', { p_code: sop.code, p_body: 'Evening all' }))], ['approved', 0, true], 'their request shows as accepted, nothing is left waiting, and they can use the team chat');
// turned down
eq(await ask(josh, { p_name: 'Josh', p_last_name: null, p_number: null }), 'ok', 'a second person asks');
waiting = await d.rpc(third, 'team_join_requests', { p_code: sop.code });
eq([await d.rpc(third, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: false }), (await d.rpc(josh, 'my_join_request', { p_code: sop.code })).status, await squadSize(), await ask(josh, { p_name: 'Josh' })], ['ok', 'denied', size0 + 1, 'denied'], 'the other gaffer turns them down: no player is added, and they cannot ask again straight away');
await d.admin(`update public.join_requests set decided_at = now() - interval '8 days' where user_id = '${josh.id}'`);
eq([await ask(josh, { p_name: 'Josh' }), (await d.rpc(ethan, 'team_join_requests', { p_code: sop.code })).length], ['ok', 1], 'a week later they can');
// they claim a player the gaffer has added for them while the request is still waiting
eq(await d.rpc(josh, 'claim_player', { p_code: sop.code, p_pid: 4, p_last_name: '', p_position: 'mix' }), 'ok', 'meanwhile they find their name in the squad and claim it');
waiting = await d.rpc(ethan, 'team_join_requests', { p_code: sop.code });
eq([await d.rpc(ethan, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: true }), await squadSize()], ['ok', size0 + 1], 'letting them in then adds no second player');
// the squad list's own numbering is respected
await d.as(ethan, `update public.teams set settings = settings || '{"nextId": 50}'::jsonb where id = '${sop.id}'`);
await ask(pat, { p_name: 'Pat', p_last_name: null, p_number: 150 });
waiting = await d.rpc(ethan, 'team_join_requests', { p_code: sop.code });
eq(waiting.map((r) => [r.name, r.number ?? null]), [['Pat', null]], 'a shirt number that makes no sense is left blank');
await d.rpc(ethan, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: true });
t = await d.rpc(pat, 'get_team', { p_code: sop.code });
eq([t.my_pid, t.team.settings.nextId, t.players.length], [50, 51, size0 + 2], 'a team whose own count of players is ahead (one being added on the gaffer\'s phone) gets the next number from that count');
// taken off the squad later: they may ask again
await d.rpc(woody, 'release_player', { p_code: sop.code });
eq(await ask(woody), 'ok', 'someone let in who has since given up their profile can ask again');
waiting = await d.rpc(ethan, 'team_join_requests', { p_code: sop.code });
await d.rpc(ethan, 'decide_join', { p_code: sop.code, p_id: waiting[0].id, p_allow: false });
// a flood
let flood = ''; const crowd = [];
for (let i = 0; i < 32 && flood !== 'full'; i++) { const u = await d.user(`crowd${i}@example.com`); crowd.push(u); flood = await ask(u, { p_name: 'Crowd ' + i }); }
eq([flood, (await d.rpc(ethan, 'team_join_requests', { p_code: sop.code })).length], ['full', 30], 'a team can have 30 requests waiting and no more');
await d.admin(`update public.join_requests set status = 'denied', decided_at = now() where team_id = '${sop.id}' and status = 'pending'`);

// ---------- streaming a game live (the live-stream edge function writes the row, with the service role)
eq([await d.rpc(null, 'team_stream', { p_code: sop.code }), await d.rpc(jake, 'team_stream', { p_code: sop.code })], [null, null], 'before any stream, there is nothing to watch');
const cfHls = 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/manifest/video.m3u8';
await d.admin(`insert into public.team_streams (team_id, input_uid, hls) values ('${sop.id}', '0123456789abcdef0123456789abcdef', '${cfHls}')`);
eq(await d.rpc(ethan, 'team_stream', { p_code: sop.code }), null, 'a team with a camera link but no stream on shows nothing');
await d.admin(`update public.team_streams set started_at = now(), gid = 'g-live-1' where team_id = '${sop.id}'`);
let st = await d.rpc(null, 'team_stream', { p_code: sop.code.toLowerCase() });
eq([st.hls, st.gid, typeof st.started, st.on_air], [cfHls, 'g-live-1', 'number', null], 'once a gaffer goes live, anyone with the code (no account needed) sees where it plays from');
eq(Object.keys(st).sort(), ['gid', 'hls', 'on_air', 'started'], 'and nothing else: never the camera link or its key');
await d.admin(`update public.team_streams set on_air_at = now() where team_id = '${sop.id}'`);
eq(typeof (await d.rpc(jake, 'team_stream', { p_code: sop.code })).on_air, 'number', 'when the camera gets through, that shows too');
eq(await d.rpc(null, 'team_stream', { p_code: 'ZZZZZZ' }), null, 'a wrong code shows nothing');
for (const [who, label] of [[null, 'someone not signed in'], [sam, 'a stranger'], [ethan, 'even the gaffer']]) {
  await d.as(who, `update public.team_streams set hls = 'https://evil.example.com/x' where true`).catch(() => {});
  await d.as(who, `insert into public.team_streams (team_id, input_uid, hls) values ('${sop.id}', 'abc', 'https://x.cloudflarestream.com/y')`).catch(() => {});
  const seen = await count(who, 'public.team_streams');
  eq([seen === 0 || seen === 'denied', (await d.rpc(null, 'team_stream', { p_code: sop.code })).hls], [true, cfHls], `${label} cannot read or change the stream row directly`);
}
check(/violates check constraint/.test(await d.fails(d.admin(`update public.team_streams set hls = 'https://evil.example.com/x' where team_id = '${sop.id}'`))), 'the database only takes Cloudflare addresses for where a stream plays from');
await d.admin(`update public.team_streams set started_at = now() - interval '5 hours' where team_id = '${sop.id}'`);
eq(await d.rpc(null, 'team_stream', { p_code: sop.code }), null, 'a stream nobody ended is over after four hours');
await d.admin(`update public.team_streams set started_at = now() where team_id = '${sop.id}'`);
const squadNow = await squadSize();

// ---------- Remove from my highlights (0022): a player takes a clip out from under their own name; it stays in the game
const hg = (await d.admin(`insert into public.games (id, team_id, opp) values (gen_random_uuid(), '${sop.id}', 'Dog Squad') returning id`))[0].id;
await d.admin(`insert into public.clips (team_id, game_id, seq, path, at, pids) values ('${sop.id}', '${hg}', 0, '${sop.id}/dog/01.mp4', 1000, '{3,2}'), ('${sop.id}', '${hg}', 1, '${sop.id}/dog/02.mp4', 5000, '{3}')`);
const clipsOf = async (who) => (await d.rpc(who, 'get_team', { p_code: sop.code })).clips.filter((c) => c.game_id === hg).map((c) => [c.seq, c.pids, c.off]);
eq(await clipsOf(null), [[0, [3, 2], []], [1, [3], []]], 'clips list who is in them, and nobody has taken any out');
eq(await d.rpc(jake, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 1000 }), 'ok', 'a player takes a clip out from under their own name');
eq(await clipsOf(null), [[0, [2], [3]], [1, [3], []]], 'it is still in the game, just not under them (for everyone, signed in or not)');
eq([await d.rpc(sam, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 5000 }), await d.rpc(rival, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 5000 })], ['not_in_squad', 'not_in_squad'], 'nobody outside the squad can take clips out from under anyone');
eq(await d.rpc(jake, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 9999 }), 'no_clip', 'only a clip that exists');
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 5000 }))), 'or without signing in');
await d.admin(`delete from public.clips where game_id = '${hg}'`);
await d.admin(`insert into public.clips (team_id, game_id, seq, path, at, pids) values ('${sop.id}', '${hg}', 0, '${sop.id}/dog/01.mp4', 1000, '{3,2}')`);
eq(await clipsOf(ethan), [[0, [2], [3]]], 'cutting the game again (new clip rows) leaves it out from under them');
eq(await d.rpc(jake, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 1000, p_hide: false }), 'ok', 'and they can put it back');
eq(await clipsOf(ethan), [[0, [3, 2], []]], 'back under their name, in its place');
eq(await count(jake, 'public.clip_hides'), 0, 'nobody reads the table directly');

// ---------- usernames, profiles and following (0023)
await d.admin(`update public.games set us = 3, them = 1, finished_at = (extract(epoch from now()) * 1000)::bigint where id = '${hg}'`);
await d.admin(`insert into public.game_players (game_id, pid, mins, goals, assists) values ('${hg}', 3, 30, 2, 1), ('${hg}', 2, 30, 1, 0)`);
await d.admin(`update public.reserved_usernames set user_id = '${ethan.id}' where handle in ('edp', 'ethan', 'ethandp', 'e_d_p_1')`); // (live: set on the real database, never in a file)
eq(await d.rpc(null, 'username_status', { p_username: 'jakey' }), 'ok', 'anyone can check a username is free, before their account exists');
eq(await Promise.all(['ab', 'jake smith', 'x'.repeat(21), 'jake!'].map((u) => d.rpc(null, 'username_status', { p_username: u }))), ['invalid', 'invalid', 'invalid', 'invalid'], 'usernames are 3 to 20 letters, numbers or _');
eq(await Promise.all(['EDP', 'ethan', 'EthanDP', 'E_D_P_1', 'gaffer'].map((u) => d.rpc(sam, 'username_status', { p_username: u }))), ['reserved', 'reserved', 'reserved', 'reserved', 'reserved'], 'Ethan\'s names are kept for him (and nobody can be "gaffer")');
eq(await d.rpc(sam, 'set_profile', { p_username: 'Ethan', p_name: 'Not Ethan' }), 'reserved', 'so nobody else can take them');
eq(await d.rpc(ethan, 'set_profile', { p_username: 'EDP', p_name: 'Ethan' }), 'ok', 'but Ethan can');
const mp = await d.rpc(ethan, 'my_profile');
eq(['username', 'name', 'private', 'pins', 'followers', 'following', 'requests'].map((k) => mp[k]), ['EDP', 'Ethan', false, [], 0, 0, 0], 'his profile, public to start with');
eq(await d.rpc(jake, 'my_profile'), null, 'someone who hasn\'t picked one has no profile yet (the app asks)');
eq(await d.rpc(jake, 'set_profile', { p_username: 'edp', p_name: 'Jake' }), 'reserved', 'names are the same whatever the capitals');
eq(await d.rpc(jake, 'set_profile', { p_username: 'Chappers', p_name: '  Chaplin   Smith ' }), 'ok', 'Jake (who plays as Chaplin) picks one');
eq(await d.rpc(sam, 'set_profile', { p_username: 'CHAPPERS', p_name: 'Sam' }), 'taken', 'nobody can take one that\'s in use, whatever the capitals');
eq(await d.rpc(sam, 'set_profile', { p_username: 'samwise', p_name: 'Sam', p_private: true }), 'ok', 'Sam goes private');
eq(await d.rpc(rival, 'set_profile', { p_username: 'rivalgaffer', p_name: 'Rival' }), 'ok', 'and the rival gaffer picks one');
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'set_profile', { p_username: 'ghost', p_name: '' }))), 'picking one needs an account');

eq((await d.rpc(sam, 'find_people', { p_query: 'chap' })).map((x) => [x.username, x.name, x.follow]), [['Chappers', 'Chaplin Smith', null]], 'people are found by username or name');
eq((await d.rpc(sam, 'find_people', { p_query: 'e' })), [], 'with at least two letters');
let pf = await d.rpc(sam, 'get_profile', { p_username: 'chappers' });
eq([pf.can_see, pf.teams.map((t) => t.name), ['games', 'goals', 'assists', 'wins'].map((k) => pf.stats[k]), pf.results.map((r) => [r.opp, r.us, r.them, r.goals, r.assists])], [true, ['Sons of Pitches'], [1, 2, 1, 1], [['Dog Squad', 3, 1, 2, 1]]],
  'a public profile shows their teams, stats and results to anyone signed in');
check(!('fixtures' in pf) && !JSON.stringify(pf).includes('organiser') && !JSON.stringify(pf).includes(sop.code), 'never upcoming games, and no team codes');
eq(pf.clips, [], 'no clips until they choose some');
const mineClips = await d.rpc(jake, 'my_clips');
eq(mineClips.map((c) => [c.game_id === hg, c.at, c.team, c.opp]), [[true, 1000, 'SOP FC', 'Dog Squad']], 'they can pick from their clips across all their teams');
eq(await d.rpc(jake, 'set_pins', { p_pins: [{ g: hg, at: 1000 }] }), 'ok', 'and show one');
eq((await d.rpc(sam, 'get_profile', { p_username: 'Chappers' })).clips.map((c) => [c.at, c.path.endsWith('01.mp4')]), [[1000, true]], 'it shows on their profile');
eq(await d.rpc(jake, 'set_pins', { p_pins: [{ g: hg, at: 1000 }, { g: hg, at: 1000 }, { g: hg, at: 1000 }, { g: hg, at: 1000 }] }), 'too_many', 'three at most');
eq(await d.rpc(ethan, 'set_pins', { p_pins: [{ g: hg, at: 1000 }] }), 'not_yours', 'and only their own clips');
await d.rpc(jake, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 1000 });
eq((await d.rpc(sam, 'get_profile', { p_username: 'Chappers' })).clips, [], 'a clip taken out of their highlights leaves their profile too');
await d.rpc(jake, 'hide_clip', { p_code: sop.code, p_game: hg, p_at: 1000, p_hide: false });

// following someone public, and a private profile
eq(await d.rpc(sam, 'follow', { p_username: 'chappers' }), 'accepted', 'following someone public is straight away');
eq(await d.rpc(third, 'follow', { p_username: 'chappers' }), 'no_profile', 'you need a username of your own to follow anyone');
pf = await d.rpc(jake, 'get_profile', { p_username: 'samwise' });
eq([pf.can_see, pf.name, 'teams' in pf, 'results' in pf, 'clips' in pf, pf.follows_me], [false, 'Sam', false, false, false, 'accepted'], 'a private profile shows only a name and counts to someone not following it');
eq(await d.rpc(jake, 'follow', { p_username: 'samwise' }), 'pending', 'following someone private is a request');
eq([(await d.rpc(sam, 'my_profile')).requests, (await d.rpc(sam, 'my_follows')).requests.map((x) => x.username)], [1, ['Chappers']], 'which they see');
eq((await d.rpc(jake, 'get_profile', { p_username: 'samwise' })).can_see, false, 'still private while it waits');
eq(await d.rpc(sam, 'answer_follow', { p_username: 'Chappers', p_accept: true }), true, 'they accept');
eq([(await d.rpc(jake, 'get_profile', { p_username: 'samwise' })).can_see, (await d.rpc(sam, 'my_profile')).followers], [true, 1], 'and now it\'s open to them');
eq(await d.rpc(sam, 'answer_follow', { p_username: 'Chappers', p_accept: false }), true, 'a follower can be removed');
eq((await d.rpc(jake, 'get_profile', { p_username: 'samwise' })).follow, null, 'which ends it');
await d.rpc(rival, 'follow', { p_username: 'samwise' });
await d.rpc(sam, 'set_profile', { p_username: 'samwise', p_name: 'Sam', p_private: false });
eq((await d.rpc(rival, 'get_profile', { p_username: 'samwise' })).follow, 'accepted', 'going public accepts every request waiting');

// the feed
await d.rpc(ethan, 'follow', { p_username: 'chappers' });
let feed = await d.rpc(sam, 'my_feed');
eq(feed.map((x) => [x.game_id === hg, x.team, x.opp, x.us, x.them, x.people.map((p) => [p.username, p.goals, p.assists]), x.clips.length]), [[true, 'SOP FC', 'Dog Squad', 3, 1, [['Chappers', 2, 1]], 1]],
  'the feed shows games played by people you follow, with their goals, assists and clips');
check(feed[0].code === sop.code, 'with the team\'s follow code, so the app can leave out teams it already follows');
eq(await d.rpc(ethan, 'my_feed'), [], 'but never your own team\'s games: you\'ve seen those');
eq(await d.rpc(jake, 'my_feed'), [], 'nothing from people you don\'t follow');

// blocking and reporting
eq(await d.rpc(jake, 'block_user', { p_username: 'samwise' }), true, 'anyone can be blocked');
eq([await d.rpc(sam, 'get_profile', { p_username: 'chappers' }), await d.rpc(jake, 'get_profile', { p_username: 'samwise' }), await d.rpc(sam, 'find_people', { p_query: 'chap' }), await d.rpc(sam, 'my_feed')], [null, null, [], []],
  'then neither can find or see the other, and the feed drops them');
eq([await d.rpc(sam, 'follow', { p_username: 'chappers' }), (await d.rpc(sam, 'my_follows')).following], ['missing', []], 'and following between them ends, and can\'t start again');
eq((await d.rpc(jake, 'my_blocks')).map((x) => x.username), ['samwise'], 'blocked people are listed, to unblock');
eq(await d.rpc(jake, 'block_user', { p_username: 'samwise', p_block: false }), true, 'unblocking');
check((await d.rpc(sam, 'get_profile', { p_username: 'chappers' })) !== null, 'makes them visible again (without following back)');
eq(await d.rpc(sam, 'report_user', { p_username: 'chappers', p_reason: 'Rude clip' }), true, 'anyone can be reported');
eq(await d.rpc(sam, 'report_user', { p_username: 'chappers', p_reason: 'Rude clip, again' }), true, 'reporting again updates it');
eq((await d.admin(`select count(*)::int as n, max(reason) as r from public.profile_reports`))[0], { n: 1, r: 'Rude clip, again' }, 'once per person');
for (const t of ['profiles', 'follows', 'blocks', 'profile_reports', 'reserved_usernames']) eq(await count(sam, 'public.' + t), 0, `nobody reads ${t} directly`);

// ---------- deleting an account
eq(await d.rpc(jake, 'delete_my_account'), 0, 'a player deleting their account takes no team with it');
t = await d.rpc(ethan, 'get_team', { p_code: sop.code });
eq([t.players.find((p) => p.pid === 3).claimed, t.players.length], [false, squadNow], 'their profile is freed, and stays in the squad with its stats');
eq((await d.rpc(ethan, 'chat_list', { p_code: sop.code })).filter((m) => m.name === 'Chaplin').length > 0, true, 'their chat messages stay, under their first name');
eq(await d.rpc(ethan, 'delete_my_account'), 0, 'one of two gaffers deleting their account leaves the team for the other');
eq((await d.rpc(third, 'get_team', { p_code: sop.code })).team.name, 'Sons of Pitches', 'who still has it');
eq(await d.rpc(third, 'delete_my_account'), 1, 'the last gaffer deleting their account deletes the team');
eq([await d.rpc(null, 'get_team', { p_code: sop.code }), (await d.admin(`select count(*)::int as n from public.players where team_id = '${sop.id}'`))[0].n, (await d.admin(`select count(*)::int as n from public.challenges where from_team = '${sop.id}' or to_team = '${sop.id}'`))[0].n, (await d.admin(`select count(*)::int as n from public.messages where team_id = '${sop.id}'`))[0].n],
  [null, 0, 0, 0], 'and with it the squad, its challenges and its chat');

eq((await d.admin(`select count(*)::int as n from public.join_requests where team_id = '${sop.id}'`))[0].n, 0, 'and every request to join it');
eq((await d.admin(`select count(*)::int as n from public.team_streams where team_id = '${sop.id}'`))[0].n, 0, 'and its stream');

await d.close();
await done();
