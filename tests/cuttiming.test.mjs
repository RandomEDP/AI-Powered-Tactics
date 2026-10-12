// Cutting highlights: the clip timing can be checked and moved before cutting. Ethan's first cut from a real game had
// every clip starting just after the goal: the kick-off time worked out from when the recording started was off (a video
// trimmed in Photos keeps its old start time; and goals are often logged a few seconds after they go in). The kick-off
// step now shows each clip from the video, and "5 seconds earlier / later" moves every clip, in every camera's video.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: checking the highlight timing');
const w = await world();

const cutter = () => { // the native ReelCutter, as the web app sees it: the recording "started" ten minutes before it was picked
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => { window.__rc.push(['pick', o.slot]); return { path: '/phone/game' + o.slot + '.mov', duration: 3000, created: Date.now() - 600000 }; },
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile } }; },
    share: async () => ({}), cleanup: async () => ({}),
  };
};
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');

// ---------- a game: kick-off, a goal for, a goal against, full time
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(60000);
await A.click('#goalThem'); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');

// ---------- the kick-off step shows the first clip from the video
const kick = await A.page.inputValue('#cutSync-0');
const prev = () => A.page.evaluate(() => { const v = document.getElementById('cutPrev'); return v ? { src: v.getAttribute('src'), start: +v.getAttribute('data-start'), end: +v.getAttribute('data-end') } : null; });
const p0 = await prev();
check(/^0[5-9]:\d\d$/.test(kick), `kick-off is worked out from when the recording started (${kick})`);
eq([!!p0, p0 && p0.src, /Check the timing/.test(await A.text('#cutBody')), /Clip 1 of 2: .*Jake/.test(await A.text('#cutBody'))], [true, '/phone/game1.mov', true, true],
  'the kick-off step shows the first clip, from the video picked, with what it is');
check(/should start a few seconds before the moment/.test(await A.text('#cutBody')), 'and says what to look for');
const secs = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
check(Math.abs(p0.start - (secs(kick) + 40 - 15)) <= 2 && Math.abs(p0.end - p0.start - 21) <= 1, `it plays from 15 seconds before the goal to 6 after, in the video (${p0.start}–${p0.end}, kick-off ${kick})`);

// ---------- the goals came out late: move every clip 20 seconds earlier
for (let i = 0; i < 4; i++) await A.click('#cutBody [data-cutdo="nudge"][data-by="-5"]');
const p1 = await prev(), kick1 = await A.page.inputValue('#cutSync-0');
eq([Math.round(p0.start - p1.start), secs(kick) - secs(kick1), await A.text('#cutMoved')], [20, 20, 'Every clip moved 20 seconds earlier.'],
  'four taps on "5 seconds earlier" move the clip, and kick-off in the video, 20 seconds earlier, and it says so');
await A.click('#cutBody [data-cutdo="nudge"][data-by="5"]');
eq([Math.round((await prev()).start - p1.start), await A.text('#cutMoved')], [5, 'Every clip moved 15 seconds earlier.'], '"5 seconds later" moves them back');
await A.click('#cutBody [data-cutdo="pvnext"]');
const p2 = await prev();
check(/Clip 2 of 2: .*Goal for Dog Squad/.test(await A.text("#cutBody")) && p2.start > p1.start + 60, `Next clip shows the goal against (${p2.start} after ${p1.start}: ${await A.text("#cutBody .cutprev .note")})`);
await A.click('#cutBody [data-cutdo="pvnext"]');
check(/Clip 1 of 2/.test(await A.text('#cutBody')), 'and round to the first again');
eq(secs(await A.page.inputValue('#cutSync-0')), secs(kick1) + 5, 'what was moved stays in the kick-off box across redraws');

// ---------- the cut uses the moved timing
const typed = secs(await A.page.inputValue('#cutSync-0'));
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = await A.page.evaluate(() => (window.__rc.filter((x) => x[0] === 'cut').pop() || [])[1]);
check(!!cut && cut.clips.length === 2, 'the highlights are cut');
check(cut && Math.abs(cut.clips[0].start - (typed + 40 - 15)) <= 2 && Math.round(p0.start - cut.clips[0].start) === 15, `the first clip starts 15 seconds earlier than first worked out (${cut && cut.clips[0].start} v ${p0.start})`);

for (const e of A.errs) check(false, 'page error: ' + e);
await w.close();
done();
