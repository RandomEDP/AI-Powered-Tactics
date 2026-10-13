// Takes the app screens the App Store pictures are made from, from the real app (with the stand-in database the tests
// use), at the iPhone's own size: 402 × 874 points at 3×. Plays a game for SOP FC v Borussia Teeth to get them.
//   node store/capture.mjs            writes store/raw/*.png; then node store/compose.mjs lays out the pictures
import { world } from '../tests/lib.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), RAW = path.join(HERE, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const w = await world();
const A = await w.phone({ db: true, native: true, label: 'gaffer', viewport: { width: 402, height: 874 }, scale: 3 });
const p = A.page;
const shot = async (name, css = '') => { // with room at the top for the phone's own status bar and camera
  await A.run(400);
  await p.addStyleTag({ content: 'body { padding-top: 56px !important; } #tabs { padding-bottom: 22px !important; } #planPop { padding-top: 76px !important; } *, *::before, *::after { animation: none !important; transition: none !important; }' + css });
  await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.planbox').forEach((b) => { b.scrollTop = 0; }); }); await A.run(200);
  await p.screenshot({ path: path.join(RAW, name + '.png') });
  await p.addStyleTag({ content: 'body { padding-top: 0 !important; } #tabs { padding-bottom: 0 !important; }' });
  console.log('took', name);
};

// ---------- the team
await A.click('#createBtn'); await A.signUp('gaffer@example.com');
await p.fill('#tName', 'Sons of Pitches FC'); await p.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]');
await p.fill('#tPlayers', 'Ezra\nDev\nTobi\nKofi\nLuca\nAsh\nNiko\nMarsh'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.click('#tabs [data-tab="home"]'); await A.click('#mOptions'); await p.check('#expTrack'); await A.run(300); await A.click('#tabs [data-tab="home"]');

// ---------- a game: 7:44 played, 2–1 up
await A.newGame('Borussia Teeth'); await A.click('#go');
const play = async (secs) => { for (let t = 0; t < secs; t += 10) { await A.run(10000); if (await A.visible('#subPopDone')) await A.click('#subPopDone'); } };
const goal = async (us, scorer, assist) => {
  await A.click(us ? '#goalUs' : '#goalThem');
  if (us) { await A.click(`#picker button[data-p="${scorer}"]`); await A.click(`#picker button[data-p="${assist ?? 'x'}"]`); }
};
await play(90); await goal(true, 1, 2); await play(130); await goal(false); await play(150); await goal(true, 3, 1); await play(80);
const left = 464 - Math.round(((await A.now()) - (await A.match()).t0) / 1000); if (left > 0) await A.run(left * 1000);
if (await A.visible('#subPopDone')) await A.click('#subPopDone');
await shot('game');

// ---------- streaming it: the gaffer goes live and the camera gets through
await A.click('#streamBtn'); await A.click('#liveGo'); w.setDb(Object.assign(w.db(), { camera: true })); await A.run(6000);
await A.click('#liveClose'); await A.click('#v-game .back'); await A.run(1500);
await shot('live-home');

// ---------- the Gaffer tier
await A.click('#tabs [data-tab="home"]'); await A.click('#mOptions'); await A.click('#planOpen'); await shot('plans', ' .view { visibility: hidden; }'); // (just the pop-up, over the dimmed screen)
 await A.click('#planOk'); await A.click('#tabs [data-tab="home"]');

// ---------- highlights: finish the game, then cut it from two cameras
await A.click('#mResume'); await A.click('#streamBtn'); await A.click('#liveEnd'); await A.click('#liveEnd'); await A.run(1500); await A.click('#liveClose');
await A.click('#endHalf'); await A.click('#endHalf'); await A.click('#go'); await play(200); await goal(true, 4, 3); await play(120);
await A.click('#endHalf'); await A.click('#endHalf'); await A.click('#finish'); await A.click('#finish'); await A.run(1500);
const code = await p.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).active), ko = (await A.team()).results.slice(-1)[0].koAt;
await p.evaluate(([c, ko]) => { // two cameras, where they stood last time; their videos come from Photos (here, stand-ins)
  localStorage.setItem('apt-cams:' + c, JSON.stringify({ swap: true, cams: [{ u: 0.88, v: 0.08 }, { u: 0.12, v: 0.94 }] }));
  window.Capacitor.Plugins.ReelCutter = { pickVideo: async ({ slot }) => ({ path: '/videos/' + slot + '.mov', name: slot < 3 ? 'GX010042.MP4' : 'IMG_4471.MOV', duration: slot < 3 ? 3140 : 2930, created: ko - (slot < 3 ? 95000 : 41000) }) };
}, [code, ko]);
await A.click('#v-stats .back'); await A.click('#mHighlights'); await A.run(500);
await A.click('#hlList button[data-cut]'); await A.run(500);
for (const cam of [0, 1]) { await A.click(`#cutBody button[data-cutdo="vid"][data-cam="${cam}"]`); await A.run(500); }
await shot('cut');

for (const e of A.errs) console.log('page error:', e);
await w.close();
process.exit(0);
