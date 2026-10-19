// Cutting highlights when the second half wasn't filmed (Ethan forgot to press record for it): "No second-half footage"
// under the line-up cuts the first half only. Second-half moments drop out of the line-up and get no clip, but stay in the
// game's stats; a second camera that did film the second half still gives them a clip; and it can be undone.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: no second-half footage');
const w = await world();

const cutter = () => { // the native ReelCutter: every video is the first half only (30 minutes)
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => { window.__rc.push(['pick', o.slot]); return { path: '/phone/game' + o.slot + '.mov', duration: 1800 }; },
    cut: async (o) => { window.__rc.push(['cut', o]); const clips = o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })); return { clips, reel: { path: '/phone/' + o.reelFile } }; },
    readable: async () => ({ bad: [] }),
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
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

const labels = () => A.page.$$eval('#cutBody .marks li b', (b) => b.map((x) => x.textContent.replace(/^\d+[’'] /, '')));
const here = async (t) => { await A.page.evaluate((x) => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => x, set: () => {} }); }, t); await A.click('#cutBody [data-cutdo="here"]'); };
const count = () => A.text('#cutCount');

eq(await labels(), ['Kick-off', 'Goal: Jake (1–0)', 'Second-half kick-off', 'Goal for Dog Squad (1–1)'], 'to start with, both halves can be marked');
check(await A.visible('#cutBody [data-cutdo="no2"]'), 'next to Add a second-half video there is No second-half footage');
check(/If the second half wasn’t recorded, tap No second-half footage\./.test(await A.text('#cutBody')), 'it says when to use it');
await here(200); // kick-off 3:20 into the video
check(/^2 clips/.test(await count()), `both moments would be cut from the one video (${await count()})`);

// ---------- no second-half footage
await A.click('#cutBody [data-cutdo="no2"]');
eq(await labels(), ['Kick-off', 'Goal: Jake (1–0)'], 'the second-half kick-off and second-half moments leave the line-up');
check(/No second-half footage, so its second-half moments get no clip\. They still count in the game’s stats\./.test(await A.text('#cutNo2')), 'it says what that means');
eq([await A.visible('#cutBody [data-cutdo="vid2"]'), await A.visible('#cutBody [data-cutdo="no2"]'), await A.visible('#cutBody [data-cutdo="yes2"]')], [false, false, true], 'and it can be taken back: There is second-half footage');
check(/^1 clip will be cut/.test(await count()), `only the first half's moment is cut (${await count()})`);

// ---------- undo, then say it again; then cut
await A.click('#cutBody [data-cutdo="yes2"]');
eq((await labels()).length, 4, 'There is second-half footage brings the second half back');
await A.click('#cutBody [data-cutdo="no2"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = await A.page.evaluate(() => (window.__rc.filter((x) => x[0] === 'cut').pop() || [])[1]);
eq(cut && cut.clips.map((c) => [c.lower.tag, c.lower.title]), [['Goal', 'Jake']], 'the cut has the first-half goal only');
eq([(w.db().clips || []).length, (await A.team()).results[0].them], [1, 1], 'one clip goes up, and the goal against still counts in the result');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);

for (const e of A.errs) check(false, 'page error: ' + e);
await w.close();
done();
