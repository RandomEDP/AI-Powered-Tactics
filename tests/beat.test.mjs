// Beat edits (Ethan: "a full Instagram edit to a specific song ... not just joining some videos together, it needs to
// sync to the beat, have effects"). From a game's highlights (or a player's) anyone on the iPhone app picks one of
// Gaffer's own tracks and gets a tall edit: every cut on a beat, quick black-and-white glimpses in the build, the best
// moment's ball going in on the drop, a flash, punch-in and slow motion on each moment after it, the end card over the
// last bars. The music is Gaffer's own (scripts/make-music.py), so nothing is muted when it's posted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: beat edits');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = await world();

// ---------- the music: each track as long as BEATS says, and BEATS the same as the script that made it
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BEATS = new Function('return ' + html.slice(html.indexOf('var BEATS = [') + 12, html.indexOf('];', html.indexOf('var BEATS = [')) + 1).replace(/\/\/.*$/gm, ''))();
const mp4secs = (file) => { // the length of an .m4a, from its movie header
  const b = fs.readFileSync(file), i = b.indexOf('mvhd'); if (i < 0) return null;
  const v = b[i + 4], scale = v ? b.readUInt32BE(i + 24) : b.readUInt32BE(i + 16), dur = v ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
  return dur / scale;
};
const py = fs.readFileSync(path.join(ROOT, 'scripts/make-music.py'), 'utf8');
for (const t of BEATS) {
  const secs = mp4secs(path.join(ROOT, 'music', t.id + '.m4a')), want = t.bars * 4 * 60 / t.bpm;
  check(secs != null && Math.abs(secs - want) < 0.1, `${t.name}: music/${t.id}.m4a is ${want.toFixed(2)} seconds, ${t.bars} bars at ${t.bpm} bpm (it's ${secs && secs.toFixed(2)})`);
  const fn = py.slice(py.indexOf('def ' + t.id.replace('-', '_') + '():'));
  const made = /Mix\((\d+), (\d+)\)/.exec(fn), drop = /Build bars 0-(\d+)/.exec(fn), end = /\(bars (\d+)-\d+\)\."""/.exec(fn);
  eq(made && [+made[1], +made[2], +drop[1] + 1, +end[1]], [t.bpm, t.bars, t.drop, t.end], `${t.name}: its tempo, length, drop and end card bar are the ones the script made it with`);
}
check(fs.readFileSync(path.join(ROOT, 'scripts/build-web.mjs'), 'utf8').includes("'music'"), 'the music is copied into the app with the web files');

const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = []; let cb = null;
  window.Capacitor.Plugins.ReelCutter = {
    addListener: (n, f) => { if (n === 'progress') cb = f; return { remove() {} }; },
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14) } }; },
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': o.contentType || 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); if (window.__hold) await window.__hold; return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; },
    beatEdit: async (o) => { window.__rc.push(['beat', o]); if (cb) { cb({ stage: 'fetch', i: 0, n: o.items.length, p: 0 }); cb({ stage: 'beat', p: 0.4 }); }
      if (window.__beatHold) await window.__beatHold; return { path: '/phone/beat/' + o.file, size: 4000 }; },
    share: async (o) => { window.__rc.push(['share', o.path]); return {}; }, cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  HTMLMediaElement.prototype.play = function () { window.__rc.push(['play', this.getAttribute('src')]); return Promise.resolve(); };
};
const calls = (P, kind) => P.page.evaluate((k) => window.__rc.filter((x) => x[0] === k).map((x) => x[1]), kind);
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const tail = (u) => String(u || '').replace(/^.*\//, '');

// ---------- the plan on its own, for every track and any number of moments
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
const kinds = ['goal', 'save', 'against', 'goal', 'hl', 'goal', 'hl', 'goal', 'save'];
const plans = [];
for (const t of BEATS) for (let n = 1; n <= kinds.length; n++) {
  const ms = kinds.slice(0, n).map((k, i) => ({ len: i === 2 ? 9 : 14, at: i === 2 ? 3 : 8, kind: k })); // (one clip short, as at the start of a video)
  const p = await A.page.evaluate(([m, id]) => window.gafferBeatPlan(m, id), [ms, t.id]);
  const bt = 60 / t.bpm, onBeat = (x) => Math.abs(x / bt - Math.round(x / bt)) < 1e-3, bad = [];
  let at = 0;
  for (const s of p.segs) {
    if (Math.abs(s.t - at) > 1e-3) bad.push('a gap at ' + s.t);
    if (!onBeat(s.t)) bad.push('a cut off the beat at ' + s.t);
    if (s.from < 0 || s.from + s.len > ms[s.i].len + 1e-3) bad.push('past the end of clip ' + s.i);
    if (s.len / s.out < 0.29 || s.len / s.out > 1.31) bad.push('a speed of ' + (s.len / s.out).toFixed(2));
    at = s.t + s.out;
  }
  if (Math.abs(at - p.len) > 1e-3) bad.push('it stops at ' + at);
  const drop = t.drop * 4 * bt, hitAt = (x) => p.segs.find((s) => Math.abs(s.t - x) < 1e-3);
  const first = hitAt(drop), stars = p.stars;
  if (!first || first.i !== stars[0] || Math.abs(first.from - ms[stars[0]].at) > 1e-3) bad.push('the drop isn\'t the moment itself');
  if (p.segs.some((s) => s.t < drop - 1e-3 && !s.mono) || p.segs.some((s) => s.t >= drop - 1e-3 && s.mono)) bad.push('black and white isn\'t exactly the build');
  if (n > 1 && kinds.slice(0, n).includes('goal') && ms[stars[0]].kind !== 'goal' && !stars.some((i) => ms[i].kind === 'goal')) bad.push('no goal among the stars');
  if (stars.some((i) => ms[i].kind === 'against') && kinds.slice(0, n).some((k) => k !== 'against')) bad.push('a goal against in it');
  stars.forEach((i, k) => { const H = p.segs.filter((s) => s.t >= drop - 1e-3 && s.i === i && Math.abs(s.from - ms[i].at) < 1e-3)[0]; if (!H || !p.fx.some((f) => f.k === 'flash' && Math.abs(f.t - H.t) < 1e-3) || Math.abs(H.t / (4 * bt) - Math.round(H.t / (4 * bt))) > 1e-3) bad.push('star ' + k + ' doesn\'t land on a bar with a flash'); });
  if (Math.abs(p.outroAt - t.end * 4 * bt) > 1e-3 || Math.abs(p.len - t.bars * 4 * bt) > 1e-3) bad.push('the end card isn\'t over the last bars');
  if (p.fx.some((f) => f.k === 'punch' && f.a < 0.1 && p.segs.some((s) => Math.abs(s.t - f.t) > 1e-3 && f.t > s.t + 1e-3 && f.t < s.t + s.out - 1e-3 && s.len / s.out < 0.6))) bad.push('a beat bounce in the middle of slow motion');
  eq(bad.slice(0, 3), [], `${t.name}, ${n} moment${n > 1 ? 's' : ''}: every cut on a beat with no gaps, inside its clip, the best moment on the drop and each one after on a bar with a flash`);
  plans.push({ name: t.name + ' with ' + n, drop, plan: p });
}
// ---------- the ball going in wherever it is in its clip (lined up by eye, 0038): each moment still lands exactly on its
// bar, and the run-up into it ends on it, even right at the start or the end of a clip
const ats = [8, 0.6, 3, 13.6, 1.4, 11, 8, 4.5, 12.9];
for (const t of BEATS) for (let n = 1; n <= kinds.length; n++) {
  const ms = kinds.slice(0, n).map((k, i) => ({ len: 14, at: ats[i], kind: k }));
  const p = await A.page.evaluate(([m, id]) => window.gafferBeatPlan(m, id), [ms, t.id]);
  const bt = 60 / t.bpm, drop = t.drop * 4 * bt, bad = [];
  let at = 0;
  for (const s of p.segs) { if (Math.abs(s.t - at) > 1e-3) bad.push('a gap at ' + s.t); if (s.from < 0 || s.from + s.len > 14 + 1e-3) bad.push('past the end of clip ' + s.i); at = s.t + s.out; }
  p.stars.forEach((i, k) => {
    const H = p.segs.find((s) => s.t >= drop - 1e-3 && s.i === i && Math.abs(s.from - ms[i].at) < 1e-3 && p.fx.some((f) => f.k === 'flash' && Math.abs(f.t - s.t) < 1e-3));
    if (!H) { bad.push('star ' + k + ' (at ' + ms[i].at + ') isn\'t on its bar'); return; }
    const before = p.segs.find((s) => Math.abs(s.t + s.out - H.t) < 1e-3);
    if (before && before.i === i && Math.abs(before.from + before.len - ms[i].at) > 0.01) bad.push('the run-up into star ' + k + ' ends at ' + (before.from + before.len).toFixed(2) + ', not ' + ms[i].at);
  });
  eq(bad.slice(0, 3), [], `${t.name}, ${n} moment${n > 1 ? 's' : ''} anywhere in their clips: each lands on its bar, the run-up ending on it`);
}
eq(await A.page.evaluate(() => [{ dur: 14 }, { dur: 20.271 }, { dur: 11 }, {}].map((c) => window.gafferClipRel(c))), [8, 8, 5, 8],
  'Gaffer\'s guess for a clip\'s moment is 8 seconds in: also in a longer clip holding two moments (it was put 6 from the end), less if the video started late');
const nine = await A.page.evaluate(() => window.gafferBeatPlan(['goal', 'save', 'against', 'goal', 'hl', 'goal', 'hl', 'goal', 'save'].map((k) => ({ len: 14, at: 8, kind: k })), 'floodlights'));
eq(nine.stars, [0, 3, 5, 7], 'with more moments than room, the goals go in first, in the order they happened');
const one = await A.page.evaluate(() => window.gafferBeatPlan([{ len: 14, at: 8, kind: 'goal' }], 'terrace'));
eq(one.stars, [0, 0], 'with only one moment, it\'s shown again as a replay');
if (process.env.BEATCHECK) { // the same plans through the Swift that reads them on the phone
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beat-')), 'plans.json'); fs.writeFileSync(file, JSON.stringify(plans));
  const r = spawnSync(process.env.BEATCHECK, [file], { encoding: 'utf8' });
  check(r.status === 0, 'the phone reads every one of these plans, the colour coming in on the drop with a flash, every frame sensible: ' + (r.stdout || r.stderr).trim().split('\n').slice(-3).join(' / '));
} else console.log('(no swiftc: the plans weren\'t checked against BeatEdit.swift here; CI does)');

// ---------- a game, cut into highlights: two goals of ours, one against and a highlight
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(30000);
await A.click('#goalThem'); await A.run(30000);
await A.click('#hlBtn'); await A.click('#picker [data-p="x"]'); await A.run(30000);
await A.click('#goalUs'); await A.click('#picker button[data-p="3"]'); await A.click('#picker button[data-p="2"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
eq((w.db().clips || []).length, 4, 'the game is cut into four clips');

// ---------- Make a beat edit, from the game's card
eq(await A.page.$$eval('#hlList .hcard:first-child [data-beat]', (b) => b.map((x) => x.textContent)), ['Make a beat edit'], 'a game\'s highlights have Make a beat edit');
await A.click('#hlList .hcard:first-child [data-beat]'); await A.run(200);
eq([await A.visible('#beatPop'), await A.page.$$eval('#beBody [data-betrack]', (b) => b.map((x) => [x.firstChild.textContent, x.getAttribute('aria-pressed')]))],
  [true, [['Floodlights', 'true'], ['Last Minute', 'false'], ['Terrace', 'false']]], 'it offers Gaffer\'s three tracks, the first picked');
check(/Floodlights.*House, 128 bpm, 36 seconds/.test(await A.text('#beBody')), 'each with its feel, tempo and length');
eq(await A.text('#beCount'), 'Shows 3 moments of 4 (the best ones, goals first), 36 seconds with the end card.', 'saying how many moments it shows (not the goal against) and how long it is');
check(/won’t be muted/.test(await A.text('#beBody')), 'and that the music is Gaffer\'s own, so it won\'t be muted when it\'s posted');
await A.click('#beBody [data-behear="terrace"]'); await A.run(100);
eq([(await calls(A, 'play')).pop(), await A.page.$eval('#beBody [data-behear="terrace"]', (b) => b.getAttribute('aria-label'))], ['music/terrace.m4a', 'Stop Terrace'], '▶ plays a track to hear it first');
await A.click('#beBody [data-betrack="terrace"]'); await A.run(100);
eq([await A.page.$eval('#beBody [data-betrack="terrace"]', (b) => b.getAttribute('aria-pressed')), await A.page.evaluate(() => localStorage.getItem('apt-beat'))], ['true', 'terrace'], 'tapping a track picks it, and it\'s remembered on this phone');
await shot(A, 'beat-sheet');
// ---------- lining up when the ball goes in (Ethan: "an on device way of looking at the clips, deciding when the ball goes in")
eq(await A.page.$$eval('#beLuList [data-belu]', (b) => b.map((x) => x.textContent)), ['1\' Jake (Chaplin)Not lined up yet', '2\' HighlightNot lined up yet', '3\' Chaplin (Jake)Not lined up yet'], 'the moments it lands on the beat are listed, none lined up yet');
check(/None are lined up yet/.test(await A.text('#beLuNote')), 'saying Gaffer goes by when they were logged until they are');
await A.click('#beLuList [data-belu="0"]'); await A.run(200);
eq([await A.text('#beTitle'), tail(await A.page.$eval('#beVid', (v) => v.getAttribute('src'))), /\(1 of 3\)/.test(await A.text('#beBody'))], ['When does the ball go in?', '01.mp4', true], 'tapping one shows its clip (the clean copy) to find when the ball goes in');
await A.page.evaluate(() => { let t = 8; Object.defineProperty(document.getElementById('beVid'), 'currentTime', { configurable: true, get: () => t, set: (x) => { t = x; } }); });
await A.click('#beBody [data-benudge="1"]'); await A.click('#beBody [data-benudge="0.2"]'); await A.click('#beBody [data-benudge="0.2"]'); await A.click('#beBody [data-benudge="-0.2"]');
await shot(A, 'beat-lineup');
await A.click('#beHit'); await A.run(300);
const g0 = w.db().clips.find((c) => c.seq === 0);
eq([(w.db().clip_hits || []).map((h) => [h.at, Math.round(h.off * 100) / 100]), /\(2 of 3\)/.test(await A.text('#beBody'))], [[[g0.at, 1.2]], true], 'The ball goes in here keeps it for the team (1.2 seconds after it was logged) and moves on to the next one');
await A.click('#beLuBack'); await A.run(200);
eq(await A.page.$eval('#beLuList [data-belu="0"] small', (s) => s.textContent), '✓ Lined up', 'back on the list it shows as lined up');
check(/2 aren’t lined up yet/.test(await A.text('#beLuNote')), 'and how many are still to do');
await A.page.evaluate(() => { window.__beatHold = new Promise((r) => { window.__beatGo = r; }); });
await A.click('#beMake'); await A.run(300);
eq([await A.page.evaluate(() => document.getElementById('beAudio').paused), await A.page.$eval('#beMake', (b) => b.disabled), await A.text('#beProg')], [true, true, 'Cutting it to the beat, 40%'], 'making it stops the preview and shows how far it\'s got');
await A.page.evaluate(() => window.__beatGo()); await A.run(500);
const job = (await calls(A, 'beat')).pop(), rows = w.db().clips.slice().sort((a, b) => a.seq - b.seq);
eq([job.music, job.items.map((x) => tail(x.url)), job.file], ['terrace', ['01.mp4', '03.mp4', '04.mp4'], '2026-10-10-dog-squad-terrace.mp4'], 'the plugin is asked for the edit to Terrace, fetching only the clips it uses (the clean copies, and not the goal against)');
check(job.segs.every((s) => s.i >= 0 && s.i < job.items.length) && Math.abs(job.len - 28.8) < 1e-3 && Math.abs(job.outroAt - 24) < 1e-3, 'every stretch points at one of those clips, and the edit is as long as the track with the end card at bar 10');
const dropSeg = job.segs.find((s) => Math.abs(s.t - 4 * 4 * 0.6) < 1e-3);
eq([dropSeg && dropSeg.i, dropSeg && Math.round(dropSeg.from * 100) / 100], [0, 9.2], 'the first goal lands on the drop where the ball went in, 9.2 seconds into its clip, not where it was logged');
eq([job.outro.kicker, job.outro.title], ['Full time', 'Sons of Pitches FC 2–1 Dog Squad'], 'it ends on the full-time card');
eq([(await calls(A, 'share')).pop(), await A.text('#beMsg'), await A.visible('#beShare')], ['/phone/beat/' + job.file, 'The edit is ready.', true], 'when it\'s made, the share sheet opens (save it, or post it to Instagram), with Share or save it to do it again');
await shot(A, 'beat-done');
await A.click('#beClose'); await A.run(200);
eq(await A.visible('#beatPop'), false, 'Close puts it away');
check(rows.length === 4, 'nothing is uploaded or changed in the team');

// ---------- from a player's card too
await A.click('#hlToggle [data-by="player"]'); await A.run(300);
const jake = await A.page.$$eval('#hlList [data-pbeat]', (b) => b.map((x) => x.getAttribute('data-pbeat')));
check(jake.includes('2'), 'each player with clips has Make a beat edit on their card');
await A.click('#hlList [data-pbeat="2"]'); await A.run(200);
check(/^Jake\./.test(await A.page.$eval('#beBody .note', (n) => n.textContent)) && /Terrace/.test(await A.page.$eval('#beBody [aria-pressed="true"]', (b) => b.textContent)), 'it\'s Jake\'s, on the track picked last time');
await A.click('#beMake'); await A.run(500);
const pj = (await calls(A, 'beat')).pop();
eq([pj.items.length, pj.outro.kicker, pj.outro.title], [2, 'Player edit', 'Jake'], 'made from his two clips (his goal and the one he set up), ending on his card');
await A.click('#beClose');

// ---------- not on the website (no phone to make it on)
const B = await w.phone({ db: true, label: 'web' });
await B.page.evaluate((c) => { localStorage.setItem('apt-app', JSON.stringify({ teams: [{ code: c, name: 'Sons of Pitches FC', role: 'viewer' }], active: c })); }, w.db().teams[0].follow_code || w.db().teams[0].code);
await B.page.reload(); await B.run(1500);
await B.page.evaluate(() => { const b = document.querySelector('#mHighlights'); if (b) b.click(); }); await B.run(500);
eq(await B.page.$$eval('[data-beat], [data-pbeat]', (b) => b.length), 0, 'the website has no beat edit button (it\'s made on the iPhone)');

await done(A, B);
await w.close();
