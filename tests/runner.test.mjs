// Anyone in the squad can start a game; only the gaffers can delete one; and a game can be abandoned, with a big warning
// (Ethan, 18 October 2026). Jake, who has claimed his place, sets a game up on his own phone while the gaffer is away; his
// phone runs it (the watch, a goal a teammate logs, full time), saves only that game, and goes back to following once it's
// up. The gaffer can take it over, delete it after, and abandon a game; a player can't touch a game a gaffer started.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: anyone in the squad starts a game');
const w = await world();
const home = async (P) => { if (await P.visible("#kickPop")) await P.click("#kickLater"); const v = await P.view(); if (v === 'home') return; if (await P.page.$(`#v-${v} .bar [data-go="home"]`)) await P.click(`#v-${v} .bar [data-go="home"]`); else await P.click('#tabs [data-tab="home"]'); await P.run(300); };

// ---------- Ethan's team; Jake claims his place, Chaplin just follows
const A = await w.phone({ db: true, native: true, label: 'ethan (gaffer)' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const J = await w.phone({ db: true, native: true, label: 'jake (player)' });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
const C = await w.phone({ db: true, label: 'chaplin (follower)' });
await C.page.fill('#joinCode', code); await C.click('#joinBtn'); await C.run(500); await C.click('#jFollow'); await C.run(800);
eq(await J.page.getAttribute('#mNew', 'aria-disabled'), 'true', 'following without an account, New game is greyed out');
await J.tap('#mNew');
eq([await J.view(), await J.text('#lockMsg')], ['home', 'Sign in and pick yourself in the squad (on this page) to start a game.'], 'and says what to do to start one');
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
if (await J.view() !== 'home') { await J.click('#tabs [data-tab="home"]'); await J.run(500); }
const jakeId = w.db().users.find((u) => u.email === 'jake@example.com').id;
eq(w.db().players.find((p) => p.pid === 2).user_id, jakeId, 'Jake is in the squad as himself');

// ---------- Jake starts the game
eq(await J.page.getAttribute('#mNew', 'aria-disabled'), 'false', 'a player in the squad can start a game');
await J.newGame('Dog'); await J.run(1500);
let live = w.db().live_matches[0];
eq([await J.view(), live && live.state.by, live && live.state.phase], ['game', jakeId, 'pre'], 'Jake sets it up on his phone; it\'s in the database as his');
eq([await J.visible('#go'), await J.visible('#finish'), await J.visible('#abandonBtn')], [true, true, true], 'he has the clock, Finish game and Abandon game');
check(await J.page.evaluate(() => document.body.className === 'runner'), 'his phone runs the game, as a player');
await J.click('#benchOk'); await J.click('#go'); await J.run(1500);
eq(w.db().live_matches[0].state.phase, 'h1', 'kick-off on his phone reaches the database');
check((w.db().calls || []).some((c) => c.name === 'team-notify' && c.body.kind === 'kickoff'), 'and the team is told it\'s started');
check((await J.watch() || {}).live === true, 'his phone runs the watch too');
await w.run(2000);
eq([(await A.match() || {}).phase, (await C.match() || {}).phase], ['h1', 'h1'], 'the gaffer and the followers see the game');

// a goal on Jake's phone, then one Chaplin logs
await J.click('#goalUs'); await J.click('#picker button[data-p="2"]'); await J.click('#picker button[data-p="x"]'); await w.run(2500);
await w.run(9000);
if (await C.visible('#kickPop')) await C.click('#kickLater'); await C.click('#mResume'); await C.click('#goalThem'); await w.run(3000);
let m = await J.match();
eq([m.events.length, m.events[1].us, m.events[1].by, w.db().goal_queue.length], [2, false, 'team', 0], 'a goal Chaplin logs is folded in by Jake\'s phone, once');
eq(w.db().live_matches[0].state.events.length, 2, 'and saved');
const before = JSON.stringify([w.db().teams[0].name, w.db().players.length]);

// nothing else of the team's on Jake's phone
await home(J);
eq(await J.page.evaluate(() => ['gamesNew', 'optGaffer'].map((id) => getComputedStyle(document.getElementById(id)).display)), ['none', 'none'], 'running a game gives him no gaffer\'s settings or polls');

// full time
await J.click('#mResume'); await J.run(15 * 60000); await J.tap('#endHalf'); await J.tap('#endHalf'); await J.run(500);
await J.tap('#go'); await J.run(15 * 60000); await J.tap('#endHalf'); await J.tap('#endHalf'); await J.run(500);
await J.tap('#finish'); await J.tap('#finish'); await J.run(3000);
const db = w.db(), g = db.games[0];
eq([db.live_matches.length, db.games.length, g && g.run_by, g && g.us, g && g.them, db.game_players.filter((p) => g && p.game_id === g.id).length > 0], [0, 1, jakeId, 1, 1, true], 'full time: Jake\'s phone saves the result, the minutes and goals, as his');
eq(JSON.stringify([db.teams[0].name, db.players.length]), before, 'and nothing else of the team\'s');
check(await J.page.evaluate(() => document.body.className.includes('ro')), 'once it\'s up, his phone goes back to following');
await w.run(2000);
eq([(await A.team()).results.length, (await C.team()).results.length], [1, 1], 'the result is on everyone\'s phone');

// only the gaffers delete games
await home(J); await J.click('#mStats'); await J.run(300);
eq(await J.page.$$eval('#results [data-del]', (b) => b.length), 0, 'Jake has no Remove on the result');
await home(A); await A.click('#mStats'); await A.run(300);
await A.click('#results [data-del]'); await A.click('#results [data-del]'); await A.run(2000);
eq(w.db().games.length, 0, 'the gaffer can delete it');

// ---------- the gaffer's own game: a player can't abandon it; the gaffer can, with the warning
await home(A); await A.newGame('Athletico'); await A.run(1500); await A.click('#benchOk'); await A.click('#go'); await w.run(2500);
await home(J);
eq(await J.page.getAttribute('#mNew', 'aria-disabled'), 'true', 'with the gaffer\'s game going, Jake can\'t start another');
await J.tap('#mNew');
eq([await J.text('#lockMsg'), await J.visible('#abandonPop'), !!(await J.match())], ['A game is going. Only a gaffer, or whoever started it, can abandon it.', false, true], 'or abandon it');
if (await J.visible('#kickPop')) await J.click('#kickLater'); await J.click('#mResume');
eq([await J.visible('#abandonBtn'), await J.visible('#finish')], [false, false], 'his game screen has no Abandon or Finish');
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(1000);
await A.click('#abandonBtn');
check(await A.visible('#abandonPop'), 'Abandon game on the game screen asks first');
const warn = await A.text('#abandonPop');
check(/deletes everything from this game/.test(warn) && /Nothing is saved to anyone’s stats/.test(warn) && /won’t be able to make or edit highlights/.test(warn) && /can’t be undone/.test(warn), 'with a big warning: everything deleted, no stats, no highlights, can\'t be undone');
await A.click('#abandonKeep');
eq([await A.visible('#abandonPop'), (await A.match() || {}).events.length], [false, 1], 'Keep the game keeps it');
await A.click('#abandonBtn'); await A.click('#abandonYes'); await A.run(2000);
eq([await A.view(), await A.match(), w.db().live_matches.length, w.db().games.length], ['home', null, 0, 0], 'Abandon and delete it: the game is gone and nothing was saved');
check((await A.watch() || {}).live === false, 'the watch is told there\'s no game');
await w.run(2000);
eq([await J.match(), await C.match()], [null, null], 'it goes from everyone\'s phone');

// New game with one going goes through the same warning
await A.newGame('Dog'); await A.run(1500); await A.click('#benchOk');
await home(A); await A.tap('#mNew');
check(await A.visible('#abandonPop'), 'New game while one is going opens the same warning');
await A.click('#abandonYes'); await A.run(1500);
eq([await A.view(), w.db().live_matches.length], ['setup', 0], 'and then goes on to set the new one up');

// a player can abandon a game he started
await home(J); await J.newGame('Rovers'); await J.run(1500); await J.click('#benchOk');
eq(w.db().live_matches[0] && w.db().live_matches[0].state.by, jakeId, 'Jake starts another');
await J.click('#abandonBtn'); await J.click('#abandonYes'); await J.run(2000);
eq([w.db().live_matches.length, w.db().games.length, await J.page.evaluate(() => document.body.className.includes('ro'))], [0, 0, true], 'and abandons it: nothing saved, and his phone goes back to following');

await done(A, J, C);
