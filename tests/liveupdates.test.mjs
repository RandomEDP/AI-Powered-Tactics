// Following a game live, and scrolling while it's on (Ethan's brother, 29 October 2026: "the scrolling was buggy, and
// when watching the game live the notifications came through but not in the app"). A player's iPhone that has slept
// through a goal (iOS drops the live connection while Gaffer is put away) catches up the moment the goal's notification
// arrives, it's tapped, Gaffer comes back to the front, or the connection joins again; and while a game is on, the screen
// someone is scrolling is left alone unless something on it really changed.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: following a game live, and scrolling');
const w = await world();

// ---------- the gaffer's team; Jake claims his place on his iPhone
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const J = await w.phone({ db: true, native: true, push: true, label: 'jake (player)', viewport: { width: 390, height: 600 } });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
if (await J.view() !== 'home') { await J.click('#tabs [data-tab="home"]'); await J.run(500); }
check(await J.page.evaluate(() => !!(window.__t.apns.pushNotificationReceived || []).length), 'Jake\'s iPhone is listening for notifications');

const score = async () => (await J.text('#usN')) + '–' + (await J.text('#themN'));
const goal = async () => { await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); };
const kickLater = async () => { if (await J.visible('#kickPop')) await J.click('#kickLater'); };

// ---------- kick-off while Jake's phone is in his pocket, connection dropped: back in Gaffer, he sees the game at once
J.deaf(true);
await A.newGame('Dog Squad'); await A.run(1500); if (await A.visible('#benchOk')) await A.click('#benchOk'); await A.click('#go'); await w.run(2000, A, J);
eq(await J.match(), null, 'with the connection dropped, Jake\'s phone hasn\'t heard about the game');
J.deaf(false);
await J.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await J.run(1000); await kickLater();
eq(((await J.match()) || {}).phase, 'h1', 'Gaffer back on screen: it reads the team straight away and has the game (before, no game known meant waiting for ever)');
await J.click('#mResume'); await J.run(300);
eq([await J.view(), await score()], ['game', '0–0'], 'he watches it live');

// ---------- a goal while his connection is down: the notification arriving with Gaffer open brings it in
await w.run(9000, A, J);
J.deaf(true);
await goal(); await w.run(1500, A, J);
eq(await score(), '0–0', 'with the connection down, the goal hasn\'t reached his screen');
await J.page.evaluate(() => window.__pushIn({ code: window.localStorage.getItem('apt-app') && JSON.parse(localStorage.getItem('apt-app')).active, kind: 'goal' }));
await J.run(1000);
eq(await score(), '1–0', 'the goal\'s notification arrives with Gaffer open: the score shows it within a second');

// ---------- the notification beats the goal to the database (the gaffer's phone sends both at once)
await w.run(9000, A, J);
await A.click('#goalUs'); await A.click('#picker button[data-p]');
await A.page.click('#picker button[data-p="x"]'); // (no time passes: the goal is on the gaffer's phone, not yet saved)
const active = await J.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).active);
await J.page.evaluate((c) => window.__pushIn({ code: c, kind: 'goal' }), active);
await J.run(1000);
await w.run(3000, A, J);
eq(await score(), '2–0', 'it reads the team again a few seconds later and the goal shows');

// ---------- tapping the notification after a sleep shows the goal, not the score from before
await w.run(9000, A, J);
await J.click('#v-game .bar [data-go="home"]'); await J.run(300);
await goal(); await w.run(1500, A, J);
eq(await J.text('#heroName'), 'Sons of Pitches FC', 'Jake is on the team page, his connection still down');
await J.page.evaluate((c) => window.__tap({ code: c, kind: 'goal' }), active); await J.run(1000);
eq([await J.view(), await score()], ['game', '3–0'], 'tapping the goal\'s notification opens the game with the new score');

// ---------- the connection joins again after dropping: whatever was said meanwhile is read
await w.run(9000, A, J);
await goal(); await w.run(1500, A, J);
eq(await score(), '3–0', 'another goal missed while the connection was down');
J.deaf(false);
await J.page.evaluate(() => (window.__rtJoins || []).forEach((cb) => cb('SUBSCRIBED'))); await J.run(1000);
eq(await score(), '4–0', 'joined again: the team is read and the goal shows');
await w.run(9000, A, J);
await goal(); await w.run(2500, A, J);
eq(await score(), '5–0', 'and goals come through live again');

// ---------- scrolling while the game is on: nothing on the screen is rewritten unless it changed
const watchDom = (sel) => J.page.evaluate((s) => { window.__muts = []; if (window.__mo) window.__mo.disconnect(); window.__mo = new MutationObserver((ms) => ms.forEach((m) => { const t = m.target.nodeType === 3 ? m.target.parentNode : m.target; const box = t.closest('[id]'); window.__muts.push(box ? box.id : '?'); })); window.__mo.observe(document.querySelector(s), { childList: true, subtree: true, characterData: true, attributes: true }); }, sel);
const muts = () => J.page.evaluate(() => { const c = {}; window.__muts.forEach((k) => { c[k] = (c[k] || 0) + 1; }); return c; });
await w.run(9000, A, J); // (the last goal's lock has gone)
await watchDom('#v-game');
await w.run(10000, A, J);
let c = await muts();
check(Object.keys(c).every((k) => ['played', 'count', 'minsLive'].includes(k)), `on the game screen only the clock and the minutes change while nothing happens (${JSON.stringify(c)})`);
check((c.played || 0) <= 11 && (c.minsLive || 0) <= 11, `and at most once a second, not four times (${c.played} / ${c.minsLive})`);
await J.page.evaluate(() => window.scrollTo(0, 300)); const y0 = await J.page.evaluate(() => Math.round(scrollY));
await w.run(21000, A, J); // (a 20-second check for updates comes and goes)
eq(await J.page.evaluate(() => Math.round(scrollY)), y0, 'and the screen stays where Jake scrolled it');

await J.click('#v-game .bar [data-go="home"]'); await J.run(300);
for (const [tab, box] of [['feed', '#v-feed'], ['highlights', '#v-highlights'], ['home', '#v-home']]) {
  await J.click(`#tabs [data-tab="${tab}"]`); await J.run(1500);
  await watchDom(box);
  await w.run(21000, A, J);
  c = await muts();
  eq(c, {}, `on ${tab === 'feed' ? 'Home' : tab === 'home' ? 'the Team page' : 'Highlights'}, the game ticking and the checks for updates leave the screen untouched`);
}
await A.run(9000); await goal(); await w.run(2500, A, J);
check(/6/.test(await J.text('#v-home')) || ((await J.match()) || {}).events.length === 6, 'a real change still comes through');

// ---------- a teammate's goal picker stays open through a check for updates that brings nothing new
await J.click('#mResume'); await w.run(9000, A, J);
await J.click('#goalUs'); check(await J.visible('#picker button[data-p]'), 'Jake opens the scorer picker');
await w.run(21000, A, J);
check(await J.visible('#picker button[data-p]'), 'it stays open while nothing changes (before, every check for updates closed it)');

eq([A.errs, J.errs], [[], []], 'no errors on either phone');
await w.close(); done();
