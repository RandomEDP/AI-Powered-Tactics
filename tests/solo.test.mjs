// "Just me": a game with no line-up and no subs, only goals for and against, the clock and highlights, on the phone and
// the watch (Ethan's ask). Kept out of the team's record, and nobody is sent a notification.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: a game of just me');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
let n = 0; const pid = () => 'solo-press-' + (++n);
const notes = () => (w.db().calls || []).filter((c) => c.body && ['kickoff', 'goal'].includes(c.body.kind)).length;

const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const F = await w.phone({ db: true, label: 'follower' }); // someone following the team
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);

// ---------- set up: no line-up, just a length and (if you like) who it's against
await A.click('#mNew'); await A.run(300);
await A.click('#gKind [data-kind="solo"]'); await A.run(200);
eq([await A.visible('#soloBox'), await A.visible('#oppSetup'), await A.visible('#houseBox')], [true, false, false], 'New game has Just me: no line-up to pick');
await A.page.fill('#sOpp', 'Dog Squad'); await A.page.fill('#sHalf', '12');
await shot(A, 'solo-setup');
await A.click('#sKick'); await A.run(500);
let m = await A.match();
eq([await A.view(), m.solo, m.opp, m.half, m.periods, m.order, m.friendly], ['game', true, 'Dog Squad', 12, 2, [], true], 'it goes straight to kick-off: 2 × 12 minutes, nobody in the line-up, a friendly');
check(/\(just me\)/.test(await A.text('#gameTitle')), 'the title says it\'s just you');
eq([await A.visible('#nowSec'), await A.visible('#swapCard'), await A.visible('#rotaSec'), await A.visible('#svBtn')], [false, false, false, false], 'no line-up, no subs, no rota, no keeper\'s save');
let ws = await A.watch();
eq([ws.live, ws.team, ws.opp, ws.players, ws.changes, ws.half, ws.periods], [true, 'SOP FC', 'Dog Squad', [], [], 12, 2], 'the watch gets the game with no players and no changes, so it never asks who scored or buzzes for subs');

// ---------- kick off and score
const gid = m.gid;
await A.click('#go'); await A.run(60000);
await A.click('#goalUs'); await A.run(300);
m = await A.match();
eq([await A.visible('#picker .picker'), m.events.map((e) => [e.us, e.p ?? null])], [false, [[true, null]]], 'Goal for us logs straight away: nobody to ask who scored');
check(/1/.test(await A.text('#usN')), 'the score goes up');
await A.run(9000); await A.click('#goalThem'); await A.run(300);
eq((await A.match()).events.map((e) => e.us), [true, false], 'a goal against too');
await A.run(9000);
const t = await A.now();
await A.fromWatch({ type: 'goal', us: true, id: pid(), at: t, gid });
eq([(await A.match()).events.filter((e) => e.us).length, (await A.watch()).us], [2, 2], 'a goal pressed on the watch counts, and the watch is told the score');
await A.run(9000); await A.click('#hlBtn'); await A.run(300);
eq([await A.visible('#picker .picker'), (await A.match()).events.filter((e) => e.hl).length], [false, 1], 'a highlight is marked without asking whose it is');
eq([await A.page.$$eval('#events [data-hlwho]', (x) => x.length), await A.text('#finNote')], [0, 'Finish game saves the result. It’s kept out of the team’s record.'], 'nor asking afterwards; and Finish says what it saves');
await shot(A, 'solo-game');
eq(notes(), 0, 'nobody on the team gets a kick-off or goal notification');
eq(await F.visible('#kickPop'), false, 'and a follower\'s phone doesn\'t pop up "Game started"');
check(/^1:/.test(await A.text('#played')), `the time played shows (${await A.text('#played')})`);

// ---------- full time: the result, kept out of the record
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
const db = w.db(), g = db.games[db.games.length - 1];
eq([!!g, g && g.us, g && g.them, g && g.friendly, db.game_players.filter((x) => g && x.game_id === g.id).length], [true, 2, 1, true, 0], 'it\'s saved as a friendly, 2–1, with nobody\'s minutes or goals');
await A.click('#tabs [data-tab="home"]').catch(() => {}); await A.run(300);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
await A.run(300); await A.click('#mStats'); await A.run(300);
check(/No league games yet/.test(await A.text('#record')), `and doesn't count in the team's record (${await A.text('#record')})`);

await w.close();
await done(A, F);
