// Cutting highlights: lining the video up by marking moments in it. Ethan's first cut from a real game had every clip
// starting just after the goal (the time the recording started is a poor guess, and goals are logged a little late). Now
// the gaffer marks kick-off, the second-half kick-off and a few goals in the video ("It happens here"), and every other
// moment is worked out from them: kick-off sets each half's clock, and the marked goals show how late goals were logged.
// Also: a game's highlights can be deleted, to start again; and if the full reel can't be joined, the clips still go up.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: lining up the highlights');
const w = await world();

const cutter = () => { // the native ReelCutter, as the web app sees it; the video says nothing about when it was recorded
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => { window.__rc.push(['pick', o.slot]); return { path: '/phone/game' + o.slot + '.mov', duration: 5400 }; },
    cut: async (o) => { window.__rc.push(['cut', o]); const clips = o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file }));
      return window.__reelFail ? { clips, reelError: window.__reelFail } : { clips, reel: { path: '/phone/' + o.reelFile } }; },
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path; // (a file on the phone, as the web view reads it)
};
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');

// ---------- a game: a goal for in the first half, a goal against in the second
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(60000); await A.click('#go'); await A.run(50000);
await A.click('#goalThem'); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');

const secs = (s) => { const m = /(\d+):(\d\d)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
const rows = () => A.page.$$eval('#cutBody .marks li', (li) => li.map((x) => ({ key: x.querySelector('[data-key]').getAttribute('data-key'), label: x.querySelector('b').textContent, when: x.querySelector('span').textContent, on: x.classList.contains('on') })));
const row = async (re) => (await rows()).find((x) => re.test(x.label));
const vid = () => A.page.evaluate(() => { const v = document.getElementById('cutPrev'); return v && { key: v.getAttribute('data-key'), seek: +v.getAttribute('data-seek'), src: v.getAttribute('src').replace(location.origin, '') }; });
const here = async (t) => { await A.page.evaluate((x) => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => x, set: () => {} }); }, t); await A.click('#cutBody [data-cutdo="here"]'); };
const pick = async (re) => { const r = await row(re); await A.click(`#cutBody [data-cutdo="sel"][data-key="${r.key}"]`); };

// ---------- the line-up step: nothing known yet about where things are in the video
let list = await rows();
eq(list.map((x) => x.label.replace(/^\d+[’'] /, '')), ['Kick-off', 'Goal: Jake (1–0)', 'Second-half kick-off', 'Goal for Dog Squad (1–1)'], 'kick-off, the second-half kick-off and every moment can be marked, in the order they happened');
eq([list.every((x) => x.when === 'Not known yet'), list[0].on, (await vid()).key, (await vid()).src], [true, true, 'ko', '/_capacitor_file_/phone/game1.mov'], 'with no time on the video, nothing is known yet; kick-off is picked first, in the video chosen');
check(/Mark kick-off, the second-half kick-off and two or three goals/.test(await A.text('#cutBody')) && /when the ball hits the net/.test(await A.text('#cutBody')), 'it says what to mark, and when a goal counts');
await A.click('#cutBody [data-cutdo="go"]');
eq(await A.text('#cutBody .msg.bad'), 'Mark kick-off (or a goal) in the video first.', 'cutting before anything is marked says what to do');

// ---------- kick-off: 3:20 into the video
await here(200);
const g1 = secs((await row(/Jake/)).when), ko2 = secs((await row(/Second-half/)).when), g2 = secs((await row(/Dog Squad/)).when);
eq([(await row(/^Kick-off/)).when, (await row(/Jake/)).on, (await vid()).key.slice(0, 2)], ['Marked at 03:20', true, 'e:'], 'kick-off marked; the next thing to mark (the first goal) is picked');
check(g1 > 200 + 35 && g1 < 200 + 50 && /^About/.test((await row(/Jake/)).when), `every moment now has a place, from kick-off (first goal about ${g1})`);
check(Math.abs((await vid()).seek - (g1 - 12)) <= 1, 'the video opens a few seconds before where the goal should be');
check(/Kick-off: marked at 03:20\./.test(await A.text('#cutMoved')), 'and it says what was marked');

// ---------- the first goal: really 20 seconds before it was logged
await here(g1 - 20);
eq([secs((await row(/Jake/)).when), secs((await row(/Dog Squad/)).when), (await row(/Second-half/)).on], [g1 - 20, g2 - 20, true],
  'marking a goal places it exactly, and moves the goals not marked by as much (goals are logged late); the second-half kick-off is next');
eq(secs((await row(/Second-half/)).when), ko2, 'kick-offs aren\'t moved by how late goals were logged');

// ---------- the second-half kick-off: the recording was paused for 30 seconds at half time
await here(ko2 + 30);
eq(secs((await row(/Dog Squad/)).when), g2 - 20 + 30, 'the second half has its own clock from its kick-off, still corrected for how late goals were logged');

// ---------- a mark in the wrong place is noticed, and can be cleared
await pick(/Dog Squad/); await here(g2 + 400);
check(/That’s \d+ min from where the other marks put it: check it’s the right moment\./.test(await A.text('#cutMoved')), `a mark far from where the others put it is questioned (${await A.text('#cutMoved')})`);
await A.click(`#cutBody [data-cutdo="unmark"][data-key="${(await row(/Dog Squad/)).key}"]`);
eq([secs((await row(/Dog Squad/)).when), /^About/.test((await row(/Dog Squad/)).when)], [g2 + 10, true], 'Clear takes the mark away again');

// ---------- the cut uses all of it (and this time the full reel can't be joined)
await A.page.evaluate(() => { window.__reelFail = 'It stopped making progress, so it was stopped. Keep Gaffer open on screen while it works, and try again.'; });
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = await A.page.evaluate(() => (window.__rc.filter((x) => x[0] === 'cut').pop() || [])[1]);
eq(cut && cut.clips.map((c) => Math.round(c.start)), [g1 - 20 - 15, g2 + 10 - 15], 'each clip starts 15 seconds before its moment: the marked goal exactly, the other worked out from the marks');
eq([/2 clips are now in Highlights/.test(await A.text('#cutBody')), (w.db().clips || []).length, await A.text('#cutBody .msg.bad'), await A.visible('#cutBody [data-cutdo="share"]')],
  [true, 2, 'The full reel couldn’t be joined: It stopped making progress, so it was stopped. Keep Gaffer open on screen while it works, and try again. The clips are all in Highlights; cut again to try the reel once more.', false],
  'if the full reel can\'t be joined, the clips are still uploaded, and it says why the reel is missing');

// ---------- deleting the highlights, to start again
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
const files = () => (w.db().files || []).filter((f) => f.bucket === 'clips').length;
eq([await A.visible('#hlList [data-hldel]'), files()], [true, 2], 'a game with highlights has Delete these highlights');
await A.click('#hlList [data-hldel]');
eq([await A.text('#hlList [data-hldel]'), (w.db().clips || []).length], ['Tap again to delete them', 2], 'it needs a second tap');
await A.click('#hlList [data-hldel]'); await A.run(1500);
eq([(w.db().clips || []).length, files(), await A.visible('#hlList [data-hldel]'), await A.text('#hlList [data-cut]')], [0, 0, false, 'Cut from a video on this phone'],
  'deleted: the clips are gone from Highlights and from storage, and the game can be cut again from scratch');

for (const e of A.errs) check(false, 'page error: ' + e);
await w.close();
done();
