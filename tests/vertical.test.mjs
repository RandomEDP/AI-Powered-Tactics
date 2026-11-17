// Highlights made vertical (9:16) for Reels and TikTok, all on the phone (Ethan, November 2026: "a way to one exporting
// highlights in vertical phone mode all on device"). Beside every Share or save on the iPhone app there's Landscape or
// Vertical, kept per phone. Vertical hands the finished video to the plugin's verticalVideo (stood in for here; where the
// tall frame sits is checked in tests/follow/main.swift), with where each clip starts and its score box and bar, so they
// can be drawn again to fit, and the end card. A clip, the whole match and a made reel all work; nothing is uploaded.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: highlights made vertical');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const tail = (u) => String(u || '').replace(/^.*\//, '');

const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- a game against Dog Squad: two goals, a clip of each and the game's one video
let db = w.db();
const sop = db.teams[0], T = 1791660000000, KO = T - 864e5;
db.games.push({ id: 'g-dog', team_id: sop.id, seq: 1, opp: 'Dog Squad', us: 1, them: 1, finished_at: KO + 18e5, ko_at: KO, friendly: false });
db.game_events.push({ game_id: 'g-dog', seq: 0, kind: 'goal', us: true, pid: 3, assist: 2, at: KO + 24e4, minute: 4 },
  { game_id: 'g-dog', seq: 1, kind: 'against', us: false, at: KO + 6e5, minute: 10 });
db.clips.push({ team_id: sop.id, game_id: 'g-dog', seq: 0, path: sop.id + '/dog/01.mp4', store: 'r2', at: KO + 24e4, dur: 14, pids: [3], label: '4\' Goal: Ethan (Jake)' },
  { team_id: sop.id, game_id: 'g-dog', seq: 1, path: sop.id + '/dog/02.mp4', store: 'r2', at: KO + 6e5, dur: 14, pids: [], label: '10\' Goal: Dog Squad' });
w.setDb(db);
await A.ctx.addInitScript(() => { // a stand-in for the iPhone's reel maker
  window.__rc = []; window.__hold = null; window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  const say = (o, stage, p) => { const on = (window.__rcOn || {}).progress; if (on) on({ stage, p, job: o.job, i: 0, n: 1 }); };
  window.Capacitor.Plugins.ReelCutter = { addListener: (n, f) => { (window.__rcOn = window.__rcOn || {})[n] = f; return { remove() {} }; }, cancel: async () => ({}),
    share: async (o) => { window.__rc.push(['share', o.path]); return { completed: false }; },
    saveVideo: async (o) => { window.__rc.push(['save', o]); return { path: '/phone/save/' + o.file, size: 1000 }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); if (o.job === 'mk') await new Promise(() => {}); return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; },
    verticalVideo: async (o) => { window.__rc.push(['tall', JSON.parse(JSON.stringify(o))]); say(o, 'look', 0.5);
      if (window.__hold) await window.__hold; say(o, 'tall', 0.25);
      if (window.__fail) throw new Error(window.__fail); return { path: '/phone/vertical/' + o.file, size: 2000 }; } };
});
await A.page.reload(); await A.run(1500);
const rc = (k) => A.page.evaluate((x) => window.__rc.filter((c) => c[0] === x).map((c) => c[1]), k);
const openClips = async () => { await A.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; }); };

// ---------- the choice, beside Share this clip: Landscape to start with
await A.click('#tabs [data-tab="highlights"]'); await A.run(800); await openClips();
const seg = '#hlList .hcard .vplayer .shapeseg';
eq(await A.page.$$eval(seg + ' button', (b) => b.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? ' (on)' : ''))), ['Landscape (on)', 'Vertical'], 'beside Share this clip: Landscape or Vertical, Landscape to start with');
eq(await A.page.$$eval('#hlList .aimsel', (s) => s.length), 0, 'no choice of where the frame sits until Vertical is picked');
const btn = '#hlList .hcard .vplayer [data-clipshare="clip"]';
await A.click(btn); await A.run(400);
eq([(await rc('save')).length, (await rc('tall')).length], [1, 0], 'Landscape shares the clip as it is, nothing made vertical');

// ---------- Vertical: the clip is made tall on the phone, with its graphics drawn again
await A.click(seg + ' [data-shape="tall"]'); await A.run(200);
eq(await A.page.$$eval(seg + ' button', (b) => b.map((x) => x.getAttribute('aria-pressed'))), ['false', 'true'], 'tapping Vertical picks it');
eq(await A.page.evaluate(() => localStorage.getItem('apt-shape')), 'tall', 'and the phone remembers it');
eq(await A.page.$eval('#hlList .aimsel', (s) => [...s.options].map((o) => o.textContent)), ['Follow the play', 'Keep it on the left', 'Keep it in the middle', 'Keep it on the right'], 'Vertical follows the play, or keeps the frame where you say');
await shot(A, 'vertical-choice');
await A.page.evaluate(() => { window.__hold = new Promise((ok) => { window.__go = ok; }); });
await A.click('#hlList .hcard [data-clip="0"]'); await A.run(200);
await A.click(btn); await A.run(300);
eq([await A.text(btn), await A.page.$eval(btn, (b) => b.disabled)], ['Watching the play, 50%…', true], 'while it works it says what it\'s doing (watching the play first)');
await A.page.evaluate(() => { window.__go(); window.__hold = null; }); await A.run(400);
let tall = await rc('tall');
eq(tall.length, 1, 'one vertical video made');
const t0 = tall[0];
eq([tail(t0.url), t0.path, t0.aim], ['01.mp4', undefined, 'auto'], 'from Ethan\'s goal straight from its address, following the play');
check(!/supabase/.test(t0.url), 'from the clip storage (R2), never Supabase');
check(/-vertical\.mp4$/.test(t0.file) && /^cs-/.test(t0.job), `named as a vertical copy (${t0.file})`);
eq(t0.spans.length, 1, 'one clip, one stretch');
const s0 = t0.spans[0];
eq([s0.at, s0.look && s0.look.home, s0.look && s0.look.away], [0, 'SOP', 'DOG'], 'its score box\'s teams, to draw again for a tall screen');
eq([s0.lower && s0.lower.tag, s0.lower && s0.lower.title, /Set up by Jake$/.test(s0.lower && s0.lower.sub)], ['Goal', 'Ethan', true], 'its bar: the goal, who scored and who set it up');
check(s0.bug && s0.bug.us === 0 && s0.bug.them === 0 && s0.bug.changes.length === 1 && s0.bug.changes[0].us === 1 && Math.abs(s0.bug.clock - 232) < 1, `its score box: 0–0, the clock from 3:52, changing to 1–0 as it goes in (${JSON.stringify(s0.bug)})`);
eq((await rc('share')).slice(-1)[0], '/phone/vertical/' + t0.file, 'the share sheet opens with the vertical one');
eq((await rc('save')).length, 1, 'nothing downloaded besides');
await A.click(btn); await A.run(300);
eq([(await rc('tall')).length, (await rc('share')).slice(-1)[0]], [1, '/phone/vertical/' + t0.file], 'sharing it again reuses it');

// keep it on the left: made again that way
await A.page.selectOption('#hlList .aimsel', 'left'); await A.run(200);
eq(await A.page.evaluate(() => localStorage.getItem('apt-aim')), 'left', 'the phone remembers where to keep the frame');
await A.click(btn); await A.run(400);
tall = await rc('tall');
eq([tall.length, tall[1].aim], [2, 'left'], 'a different choice makes it again, kept on the left');
await A.page.selectOption('#hlList .aimsel', 'auto'); await A.run(200);

// a failure says what went wrong, and it can be tried again
await A.page.evaluate(() => { window.__fail = 'This phone can\'t export that video'; });
await A.click('#hlList .hcard [data-clip="1"]'); await A.run(200);
await A.click(btn); await A.run(400);
check(/^Couldn’t make it vertical: This phone can't export that video/.test(await A.text(btn)) && !(await A.page.$eval(btn, (b) => b.disabled)), `a failure says why (${await A.text(btn)})`);
await A.page.evaluate(() => { window.__fail = null; });
await A.click(btn); await A.run(400);
tall = await rc('tall');
eq([tall.length, tail(tall[3].url), tall[3].spans[0].lower.title], [4, '02.mp4', 'Dog Squad'], 'tried again: Dog Squad\'s goal, its own bar');

// ---------- the whole match's one video, made vertical
db = w.db(); const g = db.games.find((x) => x.id === 'g-dog'); g.reel = { path: sop.id + '/dog/reel.mp4', store: 'r2' };
db.clips.filter((c) => c.game_id === 'g-dog').forEach((c, i) => { c.reel_at = i * 14; }); w.setDb(db);
await A.page.reload(); await A.run(1500); await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
eq(await A.page.$$eval('#hlList .reelp .shapeseg [aria-pressed="true"]', (b) => b.map((x) => x.textContent)), ['Vertical'], 'the choice is kept after Gaffer is opened again, on the game\'s reel too');
await A.click('#hlList .hcard .mhbtn'); await A.run(500);
eq(await A.page.$$eval('#mhTools .shapeseg [aria-pressed="true"]', (b) => b.map((x) => x.textContent)), ['Vertical'], 'and in the whole-match player');
await shot(A, 'vertical-player');
await A.click('#mhTools [data-mhsave]'); await A.run(500);
tall = await rc('tall'); const tm = tall[tall.length - 1];
eq([tail(tm.url), tm.spans.map((x) => x.at), tm.outroAt, tm.outro && tm.outro.kicker], ['reel.mp4', [0, 14], 28, 'Full time'], 'Save or share makes the one video vertical: where each clip starts, and its end card drawn tall from 0:28');
eq(tm.spans.map((x) => x.lower && x.lower.title), ['Ethan', 'Dog Squad'], 'with each clip\'s own bar');
eq((await rc('share')).slice(-1)[0], '/phone/vertical/' + tm.file, 'then the share sheet');
eq((await rc('save')).filter((o) => /reel/.test(o.url)).length, 0, 'the wide one isn\'t downloaded as well');
await A.click('#mhTools [data-shape="wide"]'); await A.run(200);
await A.click('#mhTools [data-mhsave]'); await A.run(400);
eq(tail((await rc('save')).slice(-1)[0].url), 'reel.mp4', 'Landscape downloads the one video as it is');
await A.click('#mhClose'); await A.run(200);

// ---------- a highlight reel made in the reel maker
await A.click('#hlList [data-hlm^="make:"]'); await A.run(200); await A.click('#hlSheet .hlsheet [data-greel]'); await A.run(300);
eq(await A.page.$$eval('#rbBody .shapeseg button', (b) => b.map((x) => x.textContent)), ['Landscape', 'Vertical'], 'the reel maker has the choice too');
await A.click('#rbBody [data-shape="tall"]'); await A.run(200);
check(/Vertical \(9:16\) for Reels, TikTok and Stories/.test(await A.text('#rbShapeNote')), 'and says what Vertical does');
await shot(A, 'vertical-reelmaker');
const joins = (await rc('join')).length;
await A.click('#rbMake'); await A.run(1200);
const jr = (await rc('join')).slice(joins).filter((o) => /^rb-/.test(o.job || ''));
tall = await rc('tall'); const tr = tall[tall.length - 1];
eq(jr.length, 1, 'the reel is joined as usual');
eq([tr.path, tr.spans.map((x) => x.at), tr.outroAt, tr.outro && tr.outro.kicker, tr.job], ['/phone/' + jr[0].file, [0, 14], 28, 'Full time', jr[0].job], 'then made vertical from it on the phone, its end card drawn tall (Cancel stops either)');
eq((await rc('share')).slice(-1)[0], '/phone/vertical/' + tr.file, 'and the vertical reel is shared');
await A.click('#rbBody [data-shape="wide"]'); await A.run(200);
await A.click('#rbShare'); await A.run(300);
eq((await rc('share')).slice(-1)[0], '/phone/' + jr[0].file, 'switched to Landscape, Share or save it shares the reel as it was made');
const madeTall = (await rc('tall')).length;
await A.click('#rbBody [data-shape="tall"]'); await A.run(200);
await A.click('#rbShare'); await A.run(300);
eq([(await rc('tall')).length, (await rc('share')).slice(-1)[0]], [madeTall, '/phone/vertical/' + tr.file], 'and back to Vertical, the vertical one, not made again');
await A.click('#rbClose'); await A.run(200);

// ---------- the website and Android: no choice (the clip just opens)
const W = await w.phone({ db: true, label: 'web' });
await W.click('#createBtn'); await W.signUp('web@example.com');
await W.page.fill('#tName', 'Web Wanderers'); await W.page.fill('#tShort', 'WW'); await W.page.fill('#tPlayers', 'Ann\nBea\nCal'); await W.click('#tCreate'); await W.run(600);
await W.click('#v-code [data-go="home"]'); await W.run(300);
db = w.db(); const ww = db.teams.find((t) => t.name === 'Web Wanderers');
db.games.push({ id: 'g-web', team_id: ww.id, seq: 1, opp: 'Rovers', us: 1, them: 0, finished_at: T, friendly: false });
db.clips.push({ team_id: ww.id, game_id: 'g-web', seq: 0, path: ww.id + '/rov/01.mp4', store: 'r2', at: T, dur: 14, pids: [1], label: '7\' Goal: Ann' });
w.setDb(db); await W.page.reload(); await W.run(1500);
await W.click('#tabs [data-tab="highlights"]'); await W.run(800);
await W.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; });
eq([await W.text('#hlList [data-clipshare]'), await W.page.$$eval('.shapeseg', (s) => s.length)], ['Save this clip', 0], 'on the website: Save this clip, and no Landscape or Vertical (it needs the iPhone)');
done();
