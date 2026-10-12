// Cutting highlights: the clip timing can be checked and moved before cutting. Ethan's first cut from a real game had
// every clip starting just after the goal: the kick-off time worked out from when the recording started was off (a video
// trimmed in Photos keeps its old start time; and goals are often logged a few seconds after they go in). The kick-off
// step now shows each clip from the video: the gaffer finds the moment in it and taps "It happens here", and that
// camera's clips are lined up from it, so each moment comes 15 seconds in.
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
const prev = () => A.page.evaluate(() => { const v = document.getElementById('cutPrev'); return v ? { src: v.getAttribute('src'), start: +v.getAttribute('data-start'), t: +v.getAttribute('data-t') } : null; });
const p0 = await prev();
check(/^0[5-9]:\d\d$/.test(kick), `kick-off is worked out from when the recording started (${kick})`);
eq([!!p0, p0 && p0.src, /Line up the clips/.test(await A.text('#cutBody')), /Clip 1 of 2: .*Jake/.test(await A.text('#cutBody'))], [true, '/phone/game1.mov', true, true],
  'the kick-off step shows the first clip, from the video picked, with what it is');
check(/drag the video to the moment it happens, then tap It happens here\. Every clip is lined up from it, so each moment comes 15 seconds in, after the build-up/.test(await A.text('#cutBody')), 'and says what to do');
const secs = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
check(Math.abs(p0.t - (secs(kick) + 40)) <= 2 && Math.abs(p0.t - p0.start - 15) < 0.5, `it starts 15 seconds before where the goal was worked out to be (${p0.start}, goal at ${p0.t}, kick-off ${kick})`);
// the gaffer drags the video to the goal (here the video stands in: it reports where it's been dragged to)
const here = async (t) => { await A.page.evaluate((x) => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => x, set: () => {} }); }, t); await A.click('#cutBody [data-cutdo="here"]'); };

// ---------- the goals came out late: the goal is really 22 seconds earlier in the video than worked out
await here(p0.t - 22);
const p1 = await prev(), kick1 = await A.page.inputValue('#cutSync-0');
eq([Math.round(p0.t - p1.t), Math.round(p1.t - p1.start), secs(kick) - secs(kick1), await A.text('#cutMoved')], [22, 15, 22, 'The clips moved 22 seconds earlier, so each moment comes 15 seconds in.'],
  '"It happens here" lines the clips up from that moment: 22 seconds earlier, the goal 15 seconds in, kick-off moved to match, and it says so');
await here(p1.t);
eq(await A.text('#cutMoved'), 'The clips were already lined up.', 'tapped again at the same moment: nothing moves');
await here(p1.t + 3);
eq([Math.round((await prev()).t - p1.t), await A.text('#cutMoved')], [3, 'The clips moved 3 seconds later, so each moment comes 15 seconds in.'], 'and it can move them later as well');
await here(-5000);
eq([await A.text('#cutBody .msg.bad'), Math.round((await prev()).t - p1.t)], ['That would put kick-off before the video starts. Check you’ve found the right moment.', 3], 'a moment before the video could start is turned away');
const p2t = (await prev()).t;
await A.click('#cutBody [data-cutdo="pvnext"]');
const p2 = await prev();
check(/Clip 2 of 2: .*Goal for Dog Squad/.test(await A.text('#cutBody')) && p2.t > p2t + 60 && Math.abs(p2.t - p2.start - 15) < 0.5, `Next clip shows the goal against, lined up the same way (${p2.start}, goal at ${p2.t})`);
await A.click('#cutBody [data-cutdo="pvnext"]');
check(/Clip 1 of 2/.test(await A.text('#cutBody')), 'and round to the first again');
eq(secs(await A.page.inputValue('#cutSync-0')), secs(kick1) + 3, 'the kick-off box keeps the lined-up time across redraws');

// ---------- the cut uses the lined-up timing
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = await A.page.evaluate(() => (window.__rc.filter((x) => x[0] === 'cut').pop() || [])[1]);
check(!!cut && cut.clips.length === 2, 'the highlights are cut');
check(cut && Math.abs(cut.clips[0].start - (p2t - 15)) < 1 && Math.round(p0.start - cut.clips[0].start) === 19, `the first clip starts 15 seconds before where the goal was found (${cut && cut.clips[0].start}; the goal at ${p2t})`);

for (const e of A.errs) check(false, 'page error: ' + e);
await w.close();
done();
