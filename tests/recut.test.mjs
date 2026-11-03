// Re-cut one goal (Ethan, November 2026: "there should be a way to just recut one goal if needed, not the whole thing"):
// Edit footage → Re-cut one goal lists the game's clips; picking one opens the cut screen for just that moment. Only that
// clip is cut again (no reel, nothing else touched), it goes up under a new name, its row points at it, the old files go,
// and the game's one video is joined again with the new clip in it.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: re-cut one goal');
const w = await world();

const cutter = () => {
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => { window.__rc.push(['pick', o.slot]); return { path: '/phone/game' + o.slot + '.mov', duration: 4000 }; },
    cut: async (o) => { window.__rc.push(['cut', o]); const clips = o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })); return { clips, reel: o.reelFile ? { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14) } : undefined }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); return { path: '/phone/' + o.file, marks: o.items.map((c, i) => i * 14) }; },
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

// ---------- a game with two goals, cut in full
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(120000);
await A.click('#goalUs'); await A.click('#picker button[data-p="3"]'); await A.click('#picker button[data-p="x"]'); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="vid"]'); await A.run(300);
await A.click('#cutBody [data-cutdo="next"]');
const here = async (t) => { await A.page.evaluate((x) => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => x, set: () => {} }); }, t); await A.click('#cutBody [data-cutdo="here"]'); };
await here(200);
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(800);
const rows = () => (w.db().clips || []).slice().sort((a, b) => a.seq - b.seq);
const first = rows().map((c) => ({ ...c }));
eq(first.length, 2, 'the full cut makes two clips');
// the game's one video, as if it had been made
const gameId = first[0].game_id;
await A.page.evaluate(() => { const r = window.__rc; r.length = 0; });

// ---------- Edit footage → Re-cut one goal
await A.click('#hlList .hcard:first-child [data-hlm^="edit:"]'); await A.run(200);
check((await A.page.$$eval('#hlSheet .hlsheet .pick', (b) => b.map((x) => x.textContent))).includes('Re-cut one goal'), 'Edit footage has Re-cut one goal');
await A.click('#hlSheet .hlsheet [data-hlm^="recut:"]'); await A.run(200);
eq(await A.page.$$eval('#hlSheet .hlrm li', (l) => l.length), 2, 'it lists both clips');
check(/Chaplin/.test(await A.page.$$eval('#hlSheet .hlrm li', (l) => l[1].textContent)), 'the second one is Chaplin\'s goal');
await A.page.$$eval('#hlSheet [data-recut]', (b) => b[1].click()); await A.run(500);
check(await A.visible('#v-cut'), 'picking one opens the cut screen');
check(/Re-cutting one clip: .*Chaplin/.test(await A.text('#cutOne')), `it says which clip is being re-cut (${await A.text('#cutOne')})`);
await A.click('#cutBody [data-cutdo="vid"]'); await A.run(300);
await A.click('#cutBody [data-cutdo="next"]'); await A.run(200);
const labels = await A.page.$$eval('#cutBody .marks li b', (b) => b.map((x) => x.textContent.replace(/^\d+[’'] /, '')));
check(labels.length === 2 && labels[0] === 'Kick-off' && /Chaplin/.test(labels[1]), `only kick-off and that goal can be marked (${labels.join(', ')})`);
check(/Chaplin/.test(await A.text('#cutSel')), 'and that goal is picked to mark');
check(/Only this clip will be cut again/.test(await A.text('#cutCount')), 'it says only this clip is cut');
await here(400); // the ball goes in at 6:40
check(/Chaplin/.test(await A.text('#cutSel')), 'after marking it stays on that goal');
eq(await A.text('#cutBody [data-cutdo="go"]'), 'Re-cut this clip', 'the button says what it does');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);

const cut = await A.page.evaluate(() => (window.__rc.filter((x) => x[0] === 'cut').pop() || [])[1]);
eq(cut && cut.clips.length, 1, 'the phone cuts one clip');
check(cut && !cut.reelFile, 'and no reel');
check(cut && /^02-[a-z0-9]+\.mp4$/.test(cut.clips[0].file), `under a new name (${cut && cut.clips[0].file})`);
check(cut && Math.abs(cut.clips[0].start - (400 - 8)) < 0.01, `starting 8 seconds before where it was marked (${cut && cut.clips[0].start})`);
eq(cut && cut.clips[0].lower.title, 'Chaplin', 'it is Chaplin\'s goal');
const after = rows();
eq(after.length, 2, 'still two clips');
eq(after[0].path, first[0].path, 'the other clip is untouched');
check(after[1].path !== first[1].path && /02-[a-z0-9]+\.mp4$/.test(after[1].path), `the re-cut clip's row points at the new file (${after[1].path})`);
check(/The clip has been cut again/.test(await A.text('#cutBody')), 'the screen says it\'s done');
const joins = await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'join').map((x) => x[1].items.map((i) => i.url)));
check(joins.length >= 1 && joins[0].some((u) => /02-[a-z0-9]+\.mp4/.test(u)), `the game's one video is joined again with the new clip (${JSON.stringify(joins)})`);
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
check(await A.visible('#v-highlights'), 'Done goes back to Highlights');

for (const e of A.errs) check(false, 'page error: ' + e);
await w.close();
done();
