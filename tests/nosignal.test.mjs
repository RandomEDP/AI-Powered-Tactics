// Highlights with no signal, or a weak one (Ethan, November 2026: "when no signal it shows the highlights as no footage.
// We should show a no signal or low signal"). A game whose clips this phone hasn't heard about yet used to say "No footage
// for this game yet", as if nobody had cut it. Now, until the team has been read this time (or when the read fails),
// Highlights says the signal is the problem, keeps showing the clips saved on the phone, and fills in the rest once it's back.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: highlights with no signal');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

const A = await w.phone({ db: true, native: true, label: 'player' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- two games: Cat FC already cut, Dog FC not yet
let db = w.db();
const sop = db.teams[0], T = 1791660000000;
const ev = (at) => [{ k: 'goal', us: true, p: 3, at, m: 4 }];
db.games.push({ id: 'g-cat', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 1, them: 0, finished_at: T - 2 * 864e5, ko_at: T - 2 * 864e5 - 6e5, friendly: false },
  { id: 'g-dog', team_id: sop.id, seq: 2, opp: 'Dog FC', us: 1, them: 0, finished_at: T - 864e5, ko_at: T - 864e5 - 6e5, friendly: false });
db.game_events.push({ game_id: 'g-cat', seq: 0, kind: 'goal', us: true, pid: 3, at: T - 2 * 864e5, minute: 4 },
  { game_id: 'g-dog', seq: 0, kind: 'goal', us: true, pid: 3, at: T - 864e5, minute: 4 });
db.clips.push({ team_id: sop.id, game_id: 'g-cat', seq: 0, path: sop.id + '/cat/01.mp4', store: 'r2', at: T - 2 * 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' });
w.setDb(db);
await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
const card = async (opp) => A.page.evaluate((o) => { const c = [...document.querySelectorAll('#hlList .hcard')].find((x) => x.textContent.includes(o)); return c ? c.textContent.replace(/\s+/g, ' ') : ''; }, opp);
check(!(await A.visible('#hlNet')), 'with a good signal there\'s no signal warning');
check(/No footage for this game yet/.test(await card('Dog FC')), 'with a good signal, a game nobody has cut says so (Dog FC)');
check(/Watch the whole match highlights/.test(await card('Cat FC')), 'and a cut game has its highlights (Cat FC)');

// ---------- someone cuts Dog FC; this phone opens Gaffer again with a signal too weak to reach the server
db = w.db(); db.clips.push({ team_id: sop.id, game_id: 'g-dog', seq: 0, path: sop.id + '/dog/01.mp4', store: 'r2', at: T - 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' }); w.setDb(db);
await A.ctx.addInitScript(() => { if (sessionStorage.getItem('__weak')) window.__offline = true; if (sessionStorage.getItem('__slow')) window.__slow = true; });
await A.page.evaluate(() => sessionStorage.setItem('__weak', '1'));
await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
check(/^Weak signal\./.test(await A.text('#hlNet')), `a failed read says the signal's weak (${await A.text('#hlNet')})`);
const dogWeak = await card('Dog FC');
check(!/No footage for this game yet/.test(dogWeak), 'Dog FC no longer says it has no footage (the bug)');
check(/signal’s too weak to check for this game’s footage/.test(dogWeak), 'it says the signal is too weak to check');
check(/Watch the whole match highlights/.test(await card('Cat FC')), 'the clips saved on the phone still show (Cat FC)');
await A.run(1500);
check(await A.page.evaluate(() => [...document.querySelectorAll('#hlList .vnet')].every((p) => /too weak to play/.test(p.textContent))), 'a video that can\'t load says the signal is why');
await shot(A, 'nosignal-weak');

// ---------- no signal at all
await A.page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); }); await A.run(300);
check(/^No signal\./.test(await A.text('#hlNet')), `no signal says so (${await A.text('#hlNet')})`);
check(/No signal, so Gaffer can’t check for this game’s footage/.test(await card('Dog FC')), 'and Dog FC says there\'s no signal to check');
await shot(A, 'nosignal-none');

// Just me, with no signal
await A.tap('#hlScope [data-scope="me"]'); await A.run(800);
check(/^No signal\. Your highlights show up here/.test(await A.text('#hlMeMsg')), `Just me says there's no signal (${await A.page.textContent('#hlList')})`);
await A.tap('#hlScope [data-scope="team"]'); await A.run(300);

// ---------- back online: Dog FC's clips arrive and the warning goes
await A.page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.__offline = false; sessionStorage.removeItem('__weak'); window.dispatchEvent(new Event('online')); }); await A.run(1500);
check(!(await A.visible('#hlNet')), 'back online, the warning goes');
check(/Watch the whole match highlights/.test(await card('Dog FC')), 'and Dog FC\'s highlights show');

// ---------- a read that never answers: checking first, then weak signal after 8 seconds
await A.page.evaluate(() => { const a = JSON.parse(localStorage.getItem('apt-app')).active, k = 'apt-team-' + a + ':roster', rc = JSON.parse(localStorage.getItem(k)); rc.clips = []; localStorage.setItem(k, JSON.stringify(rc)); }); // (a phone that never got the clips)
await A.page.evaluate(() => sessionStorage.setItem('__slow', '1'));
await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="highlights"]'); await A.run(500);
check(!(await A.visible('#hlNet')), 'while it\'s still checking there\'s no warning yet');
check(/Checking for this game’s footage/.test(await card('Dog FC')), `Dog FC says it's checking, not that there's no footage (${await card('Dog FC')})`);
await A.run(8000);
check(/^Weak signal\./.test(await A.text('#hlNet')), 'no answer in 8 seconds: weak signal');
await A.page.evaluate(() => sessionStorage.removeItem('__slow'));

await done(A);
await w.close();
