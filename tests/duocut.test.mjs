// Lining up the video on iPhone Duo's inner screen (Ethan, 3 November 2026, a screenshot of Cut highlights on his open Duo:
// "This page needs work better on the duo", then "the biggest possible view window"): the video was small in a narrow column.
// On a big screen it now runs the screen's width, as tall as fits with It happens here under it, and picking a moment further
// down the list brings the video back into view. An ordinary iPhone is as before.
// Ethan, 5 November 2026: "When scrolling through the moments of the game the video preview should stay at the top":
// on every screen the video (and It happens here) stays pinned while the moments scroll under it.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: lining up the video on iPhone Duo');
const w = await world();
const out = process.argv[2];

const cutter = () => {
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 3600 }),
    readable: async () => ({ bad: [] }), share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const A = await w.phone({ db: true, native: true, label: 'gaffer', viewport: { width: 390, height: 844 } });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');

// a game with a few goals, so there's a list of moments to mark
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
for (const p of [2, 7, 1]) { await A.click('#goalUs'); await A.click(`#picker button[data-p="${p}"]`); await A.click('#picker button[data-p="x"]'); await A.run(30000); }
await A.click('#goalThem'); await A.run(20000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(60000); await A.click('#go'); await A.run(50000);
await A.click('#goalThem'); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]'); await A.run(300);

const p = A.page;
await p.emulateMedia({ reducedMotion: 'reduce' });
const size = async (width, height) => { await p.setViewportSize({ width, height }); await p.evaluate(() => window.dispatchEvent(new Event('resize'))); await A.run(150); };
const look = () => p.evaluate(() => {
  const r = (el) => el.getBoundingClientRect(), v = r(document.getElementById('cutPrev')), b = r(document.querySelector('#cutBody [data-cutdo="here"]'));
  const m = r(document.querySelector('#cutBody .marks')), go = r(document.querySelector('#cutBody [data-cutdo="go"]'));
  return { vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth, v: { l: Math.round(v.left), r: Math.round(v.right), t: Math.round(v.top), h: Math.round(v.height), w: Math.round(v.width) },
    here: { t: Math.round(b.top), b: Math.round(b.bottom) }, marks: { l: Math.round(m.left), r: Math.round(m.right), t: Math.round(m.top) }, go: { l: Math.round(go.left) } };
});

// ---------- an ordinary iPhone: one column, the moments under the video
await p.evaluate(() => window.scrollTo(0, 0)); await A.run(100);
let L = await look();
check(L.marks.t > L.v.t + L.v.h && Math.abs(L.marks.l - L.v.l) < 30 && !L.over, `an ordinary iPhone keeps the moments under the video (${JSON.stringify(L)})`);
// scrolling down the moments keeps the video at the top, with It happens here under it (Ethan, 5 November 2026)
const pinned = async (where) => { const shot = where.replace(/\W+/g, "-");
  const y = await p.evaluate(() => { [...document.querySelectorAll('#cutBody .marks li')].pop().scrollIntoView({ block: 'end' }); return scrollY; }); await A.run(150);
  if (out) await p.screenshot({ path: `${out}/pinned-${shot}.png` });
  const P = await look(), hit = await p.evaluate(() => { const v = document.getElementById('cutPrev').getBoundingClientRect(); const e = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2); return e && e.id; });
  check(y > 100 && P.v.t >= 40 && P.v.t <= 160 && P.here.b <= P.vh - 100 && hit === 'cutPrev', `${where}: scrolled down to the last moment, the video stays at the top and on top (scrolled ${y}, video top ${P.v.t}, button bottom ${P.here.b} of ${P.vh}, ${hit})`);
  await p.evaluate(() => window.scrollTo(0, 0)); await A.run(100);
};
await pinned('an ordinary iPhone');

// ---------- Duo open on its side: the video as big as the screen allows
await size(932, 678); await p.evaluate(() => window.scrollTo(0, 0)); await A.run(150); L = await look();
check(L.v.w >= L.vw - 80, `open, the video runs the width of the screen (${L.v.w} of ${L.vw})`);
check(L.v.h >= 330, `and is as tall as leaves a few moments in view under it (${L.v.w}×${L.v.h})`);
check(L.marks.t > L.v.t + L.v.h && !L.over, 'the moments are listed under it, nothing off the side');
await pinned('Duo open');
// picking a moment further down the list brings the whole video and its button back into view
await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await A.run(150);
await p.evaluate(() => [...document.querySelectorAll('#cutBody .marks [data-cutdo="sel"]')].pop().click()); await A.run(300); L = await look();
if (out) await p.screenshot({ path: `${out}/duo-open-lineup.png` });
check(L.v.t >= 40 && L.here.b <= L.vh, `picking a moment shows the whole video with It happens here under it (video top ${L.v.t}, button bottom ${L.here.b} of ${L.vh})`);
await p.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]'); await A.run(200);
check(/Marked at 03:20/.test(await A.text('#cutBody .marks')), 'tapping It happens here marks the moment as before');
await p.evaluate(() => window.scrollTo(0, 0));

// ---------- at the biggest text size, and on the outer screen: one column again
await p.evaluate(() => window.gafferTextSize(26)); await A.run(100); L = await look();
check(L.marks.t > L.v.t + L.v.h && !L.over, 'at the biggest text size it still fits');
await p.evaluate(() => window.gafferTextSize(17)); await A.run(100);
await size(466, 678); L = await look();
check(L.marks.t > L.v.t + L.v.h && !L.over && L.v.r <= L.vw, 'closed (the outer screen), the video and the moments under it fit too');
await pinned('Duo closed');

// ---------- the whole-match player: the video stays at the top while its moments scroll
await size(390, 844);
const mh = await p.evaluate(() => {
  const pop = document.getElementById('mhPop'); pop.hidden = false;
  document.getElementById('mhList').innerHTML = Array.from({ length: 30 }, (_, i) => '<li><button type="button">' + (i + 1) + "' Goal</button></li>").join('');
  pop.scrollTop = pop.scrollHeight; void pop.offsetHeight;
  const v = document.getElementById('mhVideo').getBoundingClientRect(), b = document.getElementById('mhClose').getBoundingClientRect(), sc = pop.scrollTop;
  pop.hidden = true; document.getElementById('mhList').innerHTML = '';
  return { vt: Math.round(v.top), vh: Math.round(v.height), ct: Math.round(b.top), sc };
});
check(mh.sc > 300 && mh.vt >= 0 && mh.vt < 120 && mh.vh > 150 && mh.ct >= 0, `the whole-match player keeps its video and Close at the top while the moments scroll (${JSON.stringify(mh)})`);
check(!A.errs.length, 'no errors: ' + A.errs.join(' | '));
await w.close(); done();
