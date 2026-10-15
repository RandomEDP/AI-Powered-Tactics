// Takes the app screens the App Store and social pictures are made from, from the real app (with the stand-in database the
// tests use), at the iPhone's own size: 402 × 874 points at 3×, in dark mode as most of the squad have it. Plays Sons of
// Pitches FC v Dog Squad the way the real game went (the first half's goals, from the game's real highlights), cuts its
// highlights, posts one, and takes each screen. Videos show a still from the real footage (store/src/footage/*.jpg), as
// the test browser can't play the clips themselves.
//   node store/capture.mjs            writes store/raw/*.png; then node store/compose.mjs lays out the pictures
import { world } from '../tests/lib.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), RAW = path.join(HERE, 'raw'), FOOT = path.join(HERE, 'src/footage');
fs.mkdirSync(RAW, { recursive: true });
const scheme = process.env.SCHEME || 'dark', only = process.argv.slice(2);
const w = await world();

// The clips' stills, by the clip's file name (01.mp4 → 01.jpg); any video without one gets the first.
const stills = fs.existsSync(FOOT) ? Object.fromEntries(fs.readdirSync(FOOT).filter((f) => f.endsWith('.jpg')).map((f) => [f.replace('.jpg', ''), 'data:image/jpeg;base64,' + fs.readFileSync(path.join(FOOT, f)).toString('base64')])) : {};
const cutter = () => { // the native ReelCutter, as the web app sees it (as in tests/reels.test.mjs)
  let cb = null;
  window.Capacitor.Plugins.ReelCutter = {
    addListener: (n, f) => { cb = f; return { remove() {} }; },
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', name: o.slot < 3 ? 'GX010042.MP4' : 'IMG_4471.MOV', duration: 3600 }),
    readable: async () => ({ ok: true, bad: [] }),
    cut: async (o) => ({ clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14) } }),
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }),
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
};
// Every <video> shows a still from the real footage as its poster (the frame the app would show before it plays).
const posters = (map) => {
  const set = () => document.querySelectorAll('video').forEach((v) => {
    const src = v.getAttribute('src') || ''; const f = (src.split('/').pop() || '').replace(/[?#].*$/, '').replace(/v?\.mp4$/, '').replace(/-[a-z0-9]+$/, '');
    const pm = window.__posterMap || {}, key = pm[(src.split('/').pop() || '').replace(/[?#].*$/, '')] || f;
    const img = map[key] || map['04-goal']; if (img && v.getAttribute('poster') !== img) v.setAttribute('poster', img);
  });
  const go = () => { new MutationObserver(set).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] }); set(); };
  if (document.documentElement) go(); else document.addEventListener('DOMContentLoaded', go);
};

const A = await w.phone({ db: true, native: true, label: 'gaffer', viewport: { width: 402, height: 874 }, scale: 3 });
const p = A.page;
await p.emulateMedia({ colorScheme: scheme });
await A.ctx.addInitScript(cutter); await A.ctx.addInitScript(posters, stills); await p.reload(); await A.run(500);
const STATUS = 'body { padding-top: 56px !important; } #mhPop .mhbox { padding-top: 62px !important; } #postPop .planbox { margin-top: 56px !important; } #topbar { padding-top: 56px !important; } #tabs { padding-bottom: 22px !important; } #dock { padding-bottom: 30px !important; } *, *::before, *::after { animation: none !important; transition: none !important; } video::-webkit-media-controls { display: none !important; }';
const shot = async (name, css = '', { top = true } = {}) => { // with room at the top for the phone's own status bar and camera
  if (only.length && !only.includes(name)) return;
  await A.run(400);
  const h = await p.addStyleTag({ content: (top ? STATUS : '') + css });
  await A.run(250);
  await p.screenshot({ path: path.join(RAW, name + '.png') });
  await h.evaluate((el) => el.remove());
  console.log('took', name);
};
const scrollTo = (sel) => p.evaluate((s) => { const el = document.querySelector(s); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110); }, sel);

// ---------- the team: Sons of Pitches FC, in purple, with Ethan's own account claiming Ethan
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'sop_ethan');
await p.fill('#tName', 'Sons of Pitches FC'); await p.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]');
await p.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIsaac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);
if (await A.visible('#meCard [data-me="pick"]')) { await A.click('#meCard [data-me="pick"]'); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await A.run(600); }


// ---------- the game: SOP FC v Dog Squad, 2 × 15. The first half's goals as they really went in.
await A.newGame('Dog Squad');
await shot('bench', '', {}); // the bench at kick-off
if (await A.visible('#benchSheet')) await A.click('#benchOk').catch(() => {});
await A.click('#go');
const at = async (min) => { const t0 = (await A.match()).t0; const ms = min * 60000 - ((await A.now()) - t0); for (let left = ms; left > 0; left -= 10000) { await A.run(Math.min(10000, left)); if (await A.visible('#subPopDone')) await A.click('#subPopDone'); } };
const P = { Spice: 1, Jake: 2, Chaplin: 3, Harrison: 4, Puxley: 5, Isaac: 6, Reece: 7, Ethan: 8 };
const goal = async (scorer, assist) => { await A.click('#goalUs'); await A.click(`#picker button[data-p="${P[scorer]}"]`); await A.click(`#picker button[data-p="${assist ? P[assist] : 'x'}"]`); await A.run(9000); };
await at(4); await goal('Isaac', 'Reece'); await at(7); await goal('Harrison', 'Chaplin'); await at(8.3); await goal('Ethan');
await at(9.6);
await shot('game');
await at(11); await goal('Isaac'); await at(12); await goal('Reece'); await at(13); await goal('Reece'); await at(14.6); await goal('Reece', 'Spice');
await at(15); await A.tap('#endHalf'); await A.tap('#endHalf'); await A.run(60000); await A.click('#go');
await at(3); await goal('Jake'); await at(6); await goal('Ethan'); await at(7); await goal('Isaac'); await at(8); await goal('Isaac');
await at(12); await goal('Ethan', 'Jake'); await at(13); await A.click('#goalThem'); await A.run(9000); await at(13.5); await goal('Ethan', 'Jake'); await at(14); await goal('Chaplin');
await at(15); await goal('Isaac'); await A.run(20000); await A.click('#goalThem'); await A.run(9000);
await A.tap('#endHalf'); await A.tap('#endHalf'); await A.click('#finish').catch(() => {}); await A.click('#finish').catch(() => {}); await A.run(1500);
console.log('result:', JSON.stringify((await A.team()).results.slice(-1)[0].us), JSON.stringify((await A.team()).results.slice(-1)[0].them));

// ---------- its highlights, cut from a GoPro on the cage (an iPhone works too)
await p.evaluate(() => { const b = document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.tap('#tabs [data-tab="home"]'); await A.click('#mHighlights'); await A.run(500);
await A.click('#hlList [data-cut]'); await A.run(500);
const bx = await p.locator('#camSvg').boundingBox(); await p.mouse.click(bx.x + bx.width * 0.5, bx.y + bx.height * 0.1); await A.run(600);
await shot('cut-cams');
await A.click('#cutBody [data-cutdo="next"]');
await p.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]'); await A.run(400);
await shot('cut-line');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(4000);
if (await A.visible('#aiPop')) { await A.click('#aiYes'); await A.run(4000); }
await shot('cut-done');
// which real clip each of ours is: the same score (the real game's moments, store/src/footage/<nn>.jpg)
const REAL = { '1-0': '01', '2-0': '02', '3-0': '04-goal', '4-0': '06', '5-0': '07', '6-0': '08', '7-0': '10', '8-0': '11', '9-0': '13', '10-0': '14', '11-0': '15', '12-0': '19', '12-1': '20', '13-1': '21', '14-1': '22', '15-1': '23', '15-2': '27' };
const pmap = {}; for (const c of w.db().clips || []) { const sc = (String(c.label).match(/(\d+-\d+) Dog Squad$/) || [])[1]; for (const f of [c.path, c.vpath]) if (f && sc && REAL[sc]) pmap[f.split('/').pop()] = REAL[sc]; }
await A.ctx.addInitScript((m) => { window.__posterMap = m; }, pmap); await p.evaluate((m) => { window.__posterMap = m; }, pmap);
console.log('posters:', JSON.stringify(pmap).slice(0, 200));
await p.evaluate(() => { const b = document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(800);
await shot('hl');
await p.evaluate(() => document.querySelectorAll('#hlList details').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); })); await A.run(500);
await scrollTo('#hlList .reelp'); await shot('hl-reel');
await p.evaluate(() => window.scrollTo(0, 0));
await A.click('#hlList .mhbtn'); await A.run(1500);
await p.evaluate(() => { // on Ethan's 3–0, as if skipped to it (the stand-in video can't play, so the list is set as the app sets it)
  const v = document.getElementById('mhVideo'); v.pause && v.pause();
  document.querySelectorAll('#mhList button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 2)));
  const n = document.getElementById('mhNow'); n.textContent = n.textContent.replace(/Moment \d+/, 'Moment 3');
});
await shot('mh');
await A.click('#mhClose'); await A.run(400);

// ---------- posting Ethan's 3–0 to Home, like Instagram
await A.tap('#tabs [data-tab="feed"]'); await A.run(800);
await A.click('#fdNew'); await A.run(800);
const ethan = await p.$$eval('#npList [data-np]', (x) => x.map((y) => [y.getAttribute('data-np'), y.parentElement.textContent]));
console.log('clips to post:', JSON.stringify(ethan.slice(0, 6)));
const pick = ethan.find((x) => /3[–-]0/.test(x[1])) || ethan[0]; if (pick) await p.check(`#npList [data-np="${pick[0]}"]`); await A.run(400);
await p.fill('#npCap', 'Get in 🙌 3–0 up after 9 minutes and we never looked back');
await shot('post');
await A.click('#npPost'); await A.run(1500);
await shot('feed');

// ---------- the next game's poll, stats and a profile
await A.tap('#tabs [data-tab="games"]'); await A.run(600);
await A.click('#gamesNew'); await A.run(400);
await p.fill('#pOpp', 'Borussia Teeth'); await p.fill('#pDate', '2026-10-13'); await p.fill('#pTime', '19:30'); await p.fill('#pLoc', 'The Arena, pitch 2'); await p.fill('#pCost', '£5 each');
await A.click('#pSave'); await A.run(700);
await A.click('#gamesTrack .fxc [data-vote="in"]').catch(() => {}); await A.run(400); await A.click('#askNo', { timeout: 1500 }).catch(() => {});
await A.click('#gamesTrack .fxc [data-fx="answer"]').catch(() => {}); await A.run(300);
for (const [pid, v] of [[2, 'in'], [3, 'in'], [4, 'in'], [6, 'in'], [7, 'in'], [1, 'gk'], [5, 'no']]) await A.click(`#gamesTrack .fxc [data-for="${pid}"][data-vote="${v}"]`).catch(() => {});
await A.click('#gamesTrack .fxc [data-fx="answer"]').catch(() => {}); await A.run(400);
await p.evaluate(() => window.scrollTo(0, 0));
await shot('games');
await A.tap('#tabs [data-tab="home"]'); await A.run(400); await A.click('#mStats'); await A.run(600);
await shot('stats');
await A.tap('#tabs [data-tab="profile"]'); await A.run(1000);
await shot('profile');
for (const e of A.errs) console.log('page error:', e);
await w.close(); process.exit(0);
