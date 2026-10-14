// Several phones on one team: a gaffer running the game, a follower watching and logging goals, a second gaffer,
// no signal at the pitch, the app closed with changes not yet uploaded, signing out and back in.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: sync');
const w = await world();
const A = await w.phone({ db: true, native: true, label: 'gaffer' });

// ---------- the gaffer signs up, makes a team and starts a game
await A.click('#createBtn'); eq(await A.view(), 'account', 'making a team while signed out asks for an account first');
await A.signUp('ethan@example.com');
eq(await A.view(), 'create', 'signed in: on to the team form');
await A.page.fill('#tName', 'Sunday Strikers'); await A.page.fill('#tPlayers', 'Keeper\nAce\nBen\nCal\nDan\nEd\nFin\nGus'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig');
eq([w.db().teams.length, w.db().players.length, w.db().team_members.length], [1, 8, 1], 'the team, its eight players and its gaffer are in the database');
await A.click('#v-code [data-go="home"]');
await A.newGame(); await A.run(1500);
eq([w.db().live_matches.length, w.db().live_matches[0].state.phase], [1, 'pre'], 'the game is in the database before kick-off');
await A.click('#go'); await A.run(1500);
eq(w.db().live_matches[0].state.phase, 'h1', 'and kick-off reaches it within a second or so');
check((w.db().calls || []).some((c) => c.name === 'team-notify' && c.body.kind === 'kickoff'), 'the team is notified the game has started');

// ---------- a follower joins with the code and watches
const B = await w.phone({ db: true, label: 'follower' });
await B.page.fill('#joinCode', code.toLowerCase()); await B.click('#joinBtn'); await B.run(500); await B.click('#jFollow'); await B.run(800);
eq([await B.text('#heroName'), await B.page.getAttribute('#mNew', 'aria-disabled'), await B.page.evaluate(() => document.body.className.includes('ro'))], ['Sunday Strikers', 'true', true], 'the follower sees the team, with "New game" greyed out');
await B.tap('#mNew'); await B.tap('#mNew');
eq([await B.view(), await B.text('#lockMsg'), !!(await B.match())], ['home', 'Only the gaffer can start games.', true], 'tapping it explains, and does not scrap the game on this phone');
await B.click('#mResume');
eq([await B.view(), await B.visible('#go'), await B.visible('#endHalf'), await B.visible('#outBtn'), await B.visible('#undo')], ['game', false, false, false, false], 'watching the game: no clock, whistle, injury or undo controls');
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]');
await w.run(2500, A, B);
eq([await B.text('#usN'), await B.text('#themN')], ['1', '0'], 'a goal on the gaffer\'s phone shows on the follower\'s within a couple of seconds');
check(await B.page.isDisabled('#goalUs'), 'and locks the follower\'s goal buttons for a moment');
const bClock = await B.text('#played'), aClock = await A.text('#played');
check(Math.abs(parseInt(bClock.split(':')[1]) - parseInt(aClock.split(':')[1])) <= 2, `both phones show the same clock (${aClock} / ${bClock})`);

// ---------- the follower logs a goal; the gaffer's phone folds it in, once
await w.run(9000, A, B);
await B.click('#goalThem'); await w.run(3000, A, B);
let m = await A.match();
eq([m.events.length, m.events[1].us, m.events[1].by, w.db().goal_queue.length], [2, false, 'team', 0], 'a goal logged by the follower lands on the gaffer\'s phone, marked as from a teammate, and the queue is cleared');
eq([await B.text('#themN'), await A.text('#themN')], ['1', '1'], 'both show 1–1');
check((w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'goal').length === 2, 'each goal sent one notification');
// two followers tap for the same goal: only one counts
const B2 = await w.phone({ db: true, label: 'follower 2' });
await B2.page.fill('#joinCode', code); await B2.click('#joinBtn'); await B2.run(500); await B2.click('#jFollow'); await B2.run(800); await B2.click('#mResume');
await w.run(9000, A, B, B2);
w.holdLive(); await B.page.click('#goalThem'); await B2.page.click('#goalThem'); w.releaseLive(); await w.run(4000, A, B, B2);
m = await A.match();
eq([m.events.length, await A.text('#themN'), w.db().goal_queue.length], [3, '2', 0], 'the same goal tapped on two followers\' phones at once is counted once');

// ---------- no signal at the pitch
await A.offline();
await w.run(9000, A, B);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); await A.run(2000);
eq([(await A.match()).events.length, w.db().live_matches[0].state.events.length], [4, 3], 'with no signal the goal is kept on the gaffer\'s phone and has not reached the database');
check(/kept on this phone/.test(await A.page.textContent('#sync2') || await A.page.textContent('#sync')), 'and the app says so');
// the app is closed and reopened, still with no signal
await A.page.reload(); await A.offline(); await A.run(1500);
eq([await A.view(), (await A.match()).events.length, (await A.match()).phase], ['game', 4, 'h1'], 'reopened with no signal: the game and the goal are still there');
check(await A.visible('#go') && !(await A.page.isDisabled('#goalUs')), 'and the gaffer can carry on running it');
await A.click('#goalThem'); await A.run(1000);
await A.online(); await w.run(20000, A, B);
eq([w.db().live_matches[0].state.events.length, await B.text('#usN'), await B.text('#themN')], [5, '2', '3'], 'signal back: both goals go up and the follower sees 2–3');

// ---------- a second gaffer joins with the gaffer code
const orgCode = w.db().teams[0].organiser_code;
const C = await w.phone({ db: true, native: true, label: 'second gaffer' });
await C.click('#acctNew'); await C.signUp('co@example.com');
await C.click('#acctBtn'); await C.page.fill('#aOrgCode', orgCode.toLowerCase()); await C.click('#aOrgJoin'); await C.run(1500);
eq([await C.text('#heroName'), await C.visible('#mNew'), w.db().team_members.length], ['Sunday Strikers', true, 2], 'the second gaffer is in, with the gaffer\'s buttons');
await C.click('#mResume');
eq([await C.visible('#go'), await C.text('#usN') + '-' + await C.text('#themN')], [true, '2-3'], 'and can run the game in progress');
await w.run(9000, A, B, C);
await C.click('#goalUs'); await C.click('#picker button[data-p]'); await C.click('#picker button[data-p="x"]'); await w.run(3000, A, B, C);
eq([await A.text('#usN'), (await A.match()).events.length, await B.text('#usN')], ['3', 6, '3'], 'a goal logged by the second gaffer reaches the first gaffer and the follower');
const aw = await A.watch(), cw = await C.watch();
eq([aw.us, aw.them, cw.us, cw.them, aw.gid === cw.gid, aw.t0 === cw.t0], [3, 3, 3, 3, true, true], 'each gaffer\'s watch is told the same game, clock and score');

// ---------- the second gaffer's phone goes into a pocket, and comes out after a lot has happened
C.freeze();
await w.run(9000);
await A.click('#goalThem'); await w.run(9000);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]');
await w.run(16 * 60000); // well past time up; the change at 5:00 has come due on the first gaffer's phone on the way
if (await A.visible('#subPopDone')) await A.click('#subPopDone');
if (await A.visible('#subPopDone')) await A.click('#subPopDone');
await w.run(3000);
const before = w.db().live_matches[0].state;
eq([before.events.length, before.ok >= 1], [8, true], 'meanwhile the first gaffer has logged two more goals and made the changes');
await C.thaw(); await w.run(4000);
const after = w.db().live_matches[0].state;
eq([after.events.length, after.ok, after.t0], [before.events.length, before.ok, before.t0], 'the second gaffer\'s phone waking with its old copy of the game does not write it over the real one');
eq([(await C.match()).events.length, await C.text('#usN') + '-' + await C.text('#themN'), (await A.match()).events.length, await A.text('#usN') + '-' + await A.text('#themN')], [8, '4-4', 8, '4-4'], 'it catches up instead, and the first gaffer\'s phone is untouched');
eq([(await A.watch()).us, (await A.watch()).them, (await C.watch()).us, (await C.watch()).them], [4, 4, 4, 4], 'both watches agree');

// ---------- whistle on one gaffer's phone, finish on the other
await A.click('#endHalf'); await w.run(3000, A, B, C); // (time is up, so no "End it early?")
eq([(await C.match()).phase, await B.text('#phase')], ['ht', 'Half time'], 'half time blown by one gaffer shows everywhere');
await C.click('#go'); await w.run(3000, A, B, C);
eq((await A.match()).phase, 'h2', 'second half started by the other');
await C.click('#endHalf'); await C.click('#endHalf'); await C.click('#finish'); await C.click('#finish'); await w.run(4000, A, B, C);
let d = w.db();
eq([d.games.length, d.games[0].us, d.games[0].them, d.live_matches.length, d.game_players.length, d.game_events.length], [1, 4, 4, 0, 8, 8], 'finished: one game, 4–4, with its players and events, and no live game left');
eq([(await A.team()).match, (await A.team()).results.length, await A.view()], [null, 1, 'home'], 'the first gaffer\'s phone leaves the game screen and has the result');
eq([(await B.team()).results.length, await B.view()], [1, 'home'], 'so does the follower\'s');
eq((await A.watch()).live, false, 'and the first gaffer\'s watch is told it is over');

// ---------- a game the database won't take doesn't stop the next one being saved
const quickGame = async (opp) => { await A.newGame(opp); await A.click('#go'); await A.click('#goalThem'); await A.click('#endHalf'); await A.click('#endHalf'); await A.click('#go'); await A.click('#endHalf'); await A.click('#endHalf'); await A.click('#finish'); await A.click('#finish'); await A.run(2500); await A.click('#v-stats .back'); };
await A.page.evaluate(() => { window.__refuse = (table, op, body) => table === 'games' && op === 'upsert' && body && body.opp === 'Poison'; });
await quickGame('Poison');
eq([w.db().games.map((g) => g.opp), (await A.team()).results.map((r) => r.opp), w.db().live_matches.length], [['Dog'], ['Dog', 'Poison'], 0], 'a game the database turns down stays on the phone; the live game is still cleared');
check(/Couldn.t save/.test(await A.page.textContent('#sync')), 'and the app says it could not save');
await quickGame('Cat');
eq(w.db().games.map((g) => g.opp), ['Dog', 'Cat'], 'the next game is saved all the same');
eq([w.db().game_players.filter((x) => x.game_id === w.db().games[1].id).length, w.db().game_events.filter((x) => x.game_id === w.db().games[1].id).length], [8, 1], 'with its players and its goal');
await A.page.evaluate(() => { window.__refuse = null; });
await A.run(20000);
eq([w.db().games.map((g) => g.opp).sort(), /Saved/.test(await A.page.textContent('#sync'))], [['Cat', 'Dog', 'Poison'], true], 'and the one that was turned down goes up as soon as the database will take it');
await w.run(3000);

// ---------- closed with a change not yet uploaded
await A.click('#mOptions');
await A.offline();
await A.page.fill('#oName', 'Sunday Strikers FC'); await A.page.dispatchEvent('#oName', 'change'); await A.run(1500);
eq(w.db().teams[0].name, 'Sunday Strikers', 'renamed with no signal: not in the database yet');
await A.page.reload(); await A.run(3000);
eq([w.db().teams[0].name, await A.text('#heroName').catch(() => '')], ['Sunday Strikers FC', await A.text('#heroName').catch(() => '')], 'reopened with signal: the rename is sent up rather than lost');
await w.run(3000, A, B, C);
check(/Sunday Strikers FC/.test((await B.team()).name) && /Sunday Strikers FC/.test((await C.team()).name), 'and everyone gets it');

// ---------- this phone's copy wiped: everything comes back from the database
await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('apt-team')).forEach((k) => localStorage.removeItem(k)));
await A.page.reload(); await A.run(2500);
let t = await A.team();
eq([t.name, t.players.length, t.results.length, t.results[0].us, t.results[0].ev.length], ['Sunday Strikers FC', 8, 3, 4, 8], 'wiped and reopened: team, squad, results and their events are all back');

// ---------- signing out leaves nothing behind
await A.page.evaluate(() => { location.hash = ''; });
if (await A.view() !== 'options') { if (await A.visible('#v-options .back')) await A.click('#v-options .back'); await A.click('#mOptions'); }
await A.click('#optSignOut'); await A.click('#optSignOut'); await A.run(1500);
const left = await A.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('apt-team')));
const app = await A.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')));
eq([await A.view(), left, app.teams, app.active, document => 0].slice(0, 4), ['welcome', [], [], null], 'signed out: back at the welcome screen with no team data left on the phone');
eq(await A.page.evaluate(() => document.body.className), 'ro', 'and no gaffer controls');
await A.click('#acctBtn'); await A.page.fill('#aEmail', 'ethan@example.com'); await A.page.fill('#aPass', 'longpassword'); await A.click('#aSignIn'); await A.run(2000);
check(/Sunday Strikers FC/.test(await A.page.textContent('body')), 'signed back in: the team is offered again');

await w.close();
await done(A, B, B2, C);
