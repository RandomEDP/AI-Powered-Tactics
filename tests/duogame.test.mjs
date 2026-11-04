// The game screen on iPhone Duo's inner screen (Ethan, 4 November 2026, a screenshot of a friendly on his open Duo: "This screen
// is poorly optimised for duo, we should use all the screen space ... two side phones"). On a wide screen the clock, the score
// and the buttons to log with are the left half, kept in view; the next change, what's happened, who's on and the rota are the
// right half. An ordinary iPhone, the outer screen and the biggest text sizes keep the dock along the bottom.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: the game screen on iPhone Duo');
const w = await world();
const out = process.argv[2];

const A = await w.phone({ db: true, native: true, label: 'gaffer', viewport: { width: 390, height: 844 } });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); if (await A.visible('#benchOk')) await A.click('#benchOk');
await A.click('#go'); await A.run(20000);

const p = A.page;
await p.emulateMedia({ reducedMotion: 'reduce' });
const size = async (width, height) => { await p.setViewportSize({ width, height }); await p.evaluate(() => window.dispatchEvent(new Event('resize'))); await A.run(150); };
const look = () => p.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
  return { vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth, dockPos: getComputedStyle(document.getElementById('dock')).position,
    clock: r('clock'), us: r('goalUs'), them: r('goalThem'), hl: r('hlBtn'), swap: r('swapCard'), now: r('nowSec'), events: r('events'), finish: r('finish') };
});

// ---------- an ordinary iPhone: the dock along the bottom, as before
let L = await look();
check(L.dockPos === 'fixed' && L.us.b > L.vh - 120, `an ordinary iPhone keeps Goal for us along the bottom (${JSON.stringify(L.us)})`);

// ---------- Duo open on its side: two halves
await size(932, 678); await p.evaluate(() => window.scrollTo(0, 0)); await A.run(150); L = await look();
if (out) await p.screenshot({ path: `${out}/duo-open-game.png` });
const mid = L.vw / 2;
check(L.clock.r <= mid && L.us.r <= mid && L.them.r <= mid && L.hl.r <= mid, `open, the clock and the buttons to log with are the left half (${JSON.stringify({ clock: L.clock, us: L.us, them: L.them })})`);
check(L.swap.l >= mid && L.now.l >= mid, `the next change and who's on are the right half (${JSON.stringify({ swap: L.swap, now: L.now })})`);
check(L.us.t > L.clock.b && L.dockPos === 'static', 'the goal buttons sit under the clock, not floating over the page');
check(L.us.b <= L.vh && L.clock.t >= 0, `the clock and Goal for us are both on screen (${L.clock.t}–${L.us.b} of ${L.vh})`);
check(Math.abs((L.clock.r + L.swap.l) / 2 - mid) <= 24, `the gap between the halves is down the middle, where the fold is (${L.clock.r}, ${L.swap.l})`);
check(!L.over, 'nothing off the side');
// scrolled to the end of the right half, the clock and the buttons are still there
await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await A.run(200); L = await look();
if (out) { await p.waitForTimeout(600); await p.screenshot({ path: `${out}/duo-open-game-scrolled.png` }); } // (a real pause: a screenshot straight after scrolling can show old tiles)
check(L.us.t >= 0 && L.us.b <= L.vh && L.clock.t >= 40, `scrolled down to Finish game, the clock and Goal for us stay in view, clear of the small title bar (clock ${L.clock.t}, button ${L.us.t}–${L.us.b})`);
// logging a goal from there works as before
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(500);
eq(await A.text('#usN'), '1', 'Goal for us, scorer, no assist: 1–0');
await A.run(9000);

// ---------- the biggest text size and the outer screen: the dock along the bottom again
await p.evaluate(() => window.gafferTextSize(26)); await A.run(150); L = await look();
check(L.dockPos === 'fixed' && L.us.b > L.vh - 140, 'at the biggest text size it goes back to the dock along the bottom');
await p.evaluate(() => window.gafferTextSize(17)); await A.run(100);
await size(466, 678); L = await look();
check(L.dockPos === 'fixed' && L.us.l >= 0 && L.them.r <= L.vw && !L.over, 'closed (the outer screen), the dock along the bottom, on the screen');
check(!A.errs.length, 'no errors: ' + A.errs.join(' | '));
await w.close(); done();
