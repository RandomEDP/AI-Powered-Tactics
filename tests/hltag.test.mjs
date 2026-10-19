// Whose highlight, and taking one out from under your own name. Ethan's asks: marking a highlight brings up the four
// outfield players on the pitch (or No one), so the clip goes under the right player; and a player can remove a clip from
// their own highlights, which leaves it in the game's highlights for everyone.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: whose highlight, and remove from my highlights');
const w = await world();

const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile } }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file, size: 1000 }), share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const names = (P) => P.page.$$eval('#picker [data-p]', (b) => b.map((x) => x.textContent));
const hls = async (P) => (await P.match()).events.filter((e) => e.hl).map((e) => e.p ?? null);

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);

// ---------- Mark a highlight: whose was it?
const tapped = await A.now();
await A.click('#hlBtn');
eq([await A.visible('#picker .picker'), await A.text('#picker strong')], [true, 'Whose highlight?'], 'marking a highlight asks whose it was');
const NAMES = ['', 'Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac', 'Reece', 'Ethan'];
const now0 = (await A.match()).segs[0], on = now0.on.filter((id) => id !== now0.gk), P1 = on[0], P2 = on[1], P3 = on[2];
eq([on.length, await names(A)], [4, on.map((id) => NAMES[id]).concat('No one')], `offering the four outfield players on the pitch (not the keeper, ${NAMES[now0.gk]}, not the bench), or No one`);
await shot(A, 'hl-whose');
eq((await A.match()).events.filter((e) => e.hl).map((e) => e.at >= tapped && e.at <= tapped + 400), [true], 'the moment is kept from the tap, before anyone is picked');
await A.run(5000); await A.click(`#picker [data-p="${P1}"]`);
const first = (await A.match()).events.filter((e) => e.hl)[0];
eq([first.p, first.at <= tapped + 400, await A.visible('#picker .picker')], [P1, true, false], `${NAMES[P1]} picked: it goes under him, still timed from the tap`);
check(new RegExp('Highlight: ' + NAMES[P1]).test(await A.text('#events')), 'and the list says so');

await A.run(30000); await A.click('#hlBtn'); await A.click('#picker [data-p="x"]');
eq(await hls(A), [P1, null], 'No one: marked, under nobody');
check(/Highlight marked: whose\?/.test(await A.text('#events')), 'which the list asks about');
await A.click('#events [data-hlwho]:not([data-hlwho="' + first.at + '"])');
eq(await A.text('#picker strong'), 'Whose highlight?', 'tapping it opens the same question again');
await A.click(`#picker [data-p="${P2}"]`);
eq(await hls(A), [P1, P2], 'so one marked without a name (on the watch, say) can be put under someone afterwards');

await A.run(30000); await A.click('#hlBtn'); await A.page.click('#picker .pickpop', { position: { x: 8, y: 8 } }); await A.run(300); // a tap outside the question
eq([await A.visible('#picker .picker'), await hls(A)], [false, [P1, P2, null]], 'closing it without picking leaves the highlight marked, under nobody');

// a highlight straight after a goal: the score lock mustn't shut the question
await A.run(30000); await A.click('#goalUs'); await A.click(`#picker [data-p="${P3}"]`); await A.click('#picker [data-p="x"]');
await A.run(1000); await A.click('#hlBtn');
eq(await A.visible('#picker .picker'), true, 'a highlight just after a goal still asks whose it was, during the 8-second lock');
await A.click(`#picker [data-p="${P1}"]`);
eq(await hls(A), [P1, P2, null, P1], 'and takes the answer');

// the keeper's save stays its own button
await A.run(30000); await A.click('#svBtn');
eq((await A.match()).events.filter((e) => e.hl).pop().k, 'save', 'Save is still marked for the keeper straight away');
eq(await A.visible('#picker .picker'), false, 'without asking');

await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);
const ev = w.db().game_events.filter((e) => e.kind === 'highlight');
eq(ev.map((e) => e.pid ?? null), [P1, P2, null, P1], 'whose highlight each was is saved with the game');

// ---------- cut it: Jake's highlight is a clip under his name
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000); await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
const rows = () => (w.db().clips || []).slice().sort((a, b) => a.seq - b.seq);
const jakeClip = rows().find((c) => (c.pids || []).includes(P1));
check(!!jakeClip, `${NAMES[P1]}'s highlight is cut as a clip under his name (${JSON.stringify(rows().map((c) => c.pids))})`);
const total = rows().length;

// ---------- Jake, on his own phone, takes it out of his highlights
const db = w.db(); const jakeUser = { id: 'u-jake', email: 'jake@example.com', password: 'longpassword', meta: { terms: 1 } };
db.users.push(jakeUser); db.players.find((p) => p.pid === P1).user_id = 'u-jake'; db.profiles = (db.profiles || []).concat({ user_id: 'u-jake', username: 'jake_p', name: 'Jake', private: false, pins: [] }); w.setDb(db);
const J = await w.phone({ db: true, native: true, label: 'jake' });
await J.ctx.addInitScript(cutter); await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.page.evaluate(() => { const b = document.querySelector('[data-go="account"]'); if (b) b.click(); }); await J.run(300);
if (await J.visible('#aEmail')) { await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500); }
if (await J.view() !== 'home') { await J.click('#myTeams button, #myTeams a'); await J.run(1500); }
await J.click('#mHighlights'); await J.run(300); await J.click('#hlToggle [data-by="player"]'); await J.run(300);
const myCard = '#hlList .hcard:has(.badge.you)';
check(await J.page.$$eval('#hlList .hcard', (cs) => cs.every((c) => !(c.querySelector('[data-clip]') && /No clips for/.test(c.textContent)))), 'a card with clips never also says it has none');
eq(await J.page.$eval(myCard + ' h3', (h) => h.textContent), NAMES[P1] + 'You', 'Jake (the player) sees his own card');
const mine = () => J.page.$$eval(myCard + ' [data-clip]', (b) => b.length);
const before = await mine();
eq(await J.visible('#hlList [data-hide]'), true, 'with Remove this clip from my highlights');
await J.page.evaluate((at) => document.querySelector(`#hlList .hcard:has(.badge.you) [data-clip][data-at="${at}"]`).click(), jakeClip.at);
await J.click('#hlList [data-hide]'); await J.run(1500);
eq((w.db().clip_hides || []).map((h) => [h.game_id, h.at, h.pid]), [[jakeClip.game_id, jakeClip.at, P1]], 'the clip he was watching is taken out from under his name');
eq(await J.page.$$eval(myCard + ' [data-clip]', (b) => b.length), before - 1, 'it\'s gone from his card');
check(/^Taken out of your highlights/.test(await J.text('#hideMsg')) && /1 clip is taken out of your highlights/.test(await J.text(myCard)), 'which says so, and that it\'s still in the game\'s highlights');
await shot(J, 'hl-removed');
eq(rows().length, total, 'the clip itself is untouched');
await J.click('#hlToggle [data-by="game"]'); await J.run(300);
eq(await J.page.$$eval('#hlList .hcard [data-clip]', (b) => b.length), total, 'and still plays in the game\'s highlights');

// everyone else's phone: not under Jake either, but still in the game
await home(A); await A.run(300); await A.page.reload(); await A.run(1500); await A.click('#mHighlights'); await A.run(300);
eq(await A.page.$$eval('#hlList .hcard [data-clip]', (b) => b.length), total, 'the gaffer still has every clip in the game');
await A.click('#hlToggle [data-by="player"]'); await A.run(300);
const jakeOnA = await A.page.$$eval('#hlList .hcard', (cs, n) => { const c = cs.find((x) => x.querySelector('h3').textContent.startsWith(n)); return c ? c.querySelectorAll('[data-clip]').length : 0; }, NAMES[P1]);
eq(jakeOnA, before - 1, 'and it isn\'t under Jake on anyone else\'s phone');
eq(await A.visible('#hlList [data-hide]'), false, 'nobody else can take clips out from under Jake');

// re-cutting the game doesn't put it back
await A.click('#hlToggle [data-by="game"]'); await A.click('#hlList [data-hlm^="edit:"]'); await A.run(200); await A.click('#hlList .hlsheet [data-cut]'); await A.run(600);
if (await A.visible('#cutBody [data-cutdo="vid"]')) { await A.click('#cutBody [data-cutdo="vid"]'); await A.run(600); }
const go = async () => { for (let i = 0; i < 6 && !(await A.visible('#cutBody [data-cutdo="go"]')); i++) { const n = await A.page.$('#cutBody [data-cutdo="next"]'); if (n) await A.click('#cutBody [data-cutdo="next"]'); else break; await A.run(300); } };
await go();
if (await A.visible('#cutBody [data-cutdo="go"]')) {
  await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000); await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
  await J.page.reload(); await J.run(1500); if (await J.view() !== 'highlights') { await home(J); await J.run(300); await J.click('#mHighlights'); await J.run(300); }
  await J.click('#hlToggle [data-by="player"]'); await J.run(300);
  eq(await mine(), before - 1, 'cutting the game again doesn\'t put it back under him');
} else { await shot(A, 'recut-debug'); check(false, 'could not get to Cut again'); }

// and back
await J.click('#hlList [data-unhide]'); await J.run(1500);
eq([(w.db().clip_hides || []).length, await mine()], [0, before], 'Put it back: it\'s under his name again');

await w.close();
await done(A, J);
