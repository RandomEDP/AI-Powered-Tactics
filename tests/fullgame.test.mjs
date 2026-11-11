// Watch the full game (Ethan, November 2026: "When uploading using GoPro cloud, or looking at previous highlights of the
// game there should be a button to view the full game. This would still be hosted on GoPro servers and would just take
// you there to watch it, there should be a way to upload links for previous games"; an iPhone video's link works too).
// A game keeps the link to its whole video (games.full_video, 0053): the GoPro share link a cut downloaded from is kept by
// itself, and a gaffer can paste one onto any earlier game (a GoPro or an iPhone video's link). Everyone in the team then
// gets Watch the full game, which only opens the link: the video is never copied anywhere.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: watch the full game from its GoPro or iPhone video link');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const opened = (P) => P.page.evaluate(() => window.__opened || []);
const spyOpen = () => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; };

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(spyOpen);
await A.ctx.addInitScript(() => { // the cutter, enough for a GoPro link's download
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }), pickVideo: async () => ({ cancelled: true }),
    fetchVideo: async (o) => ({ path: '/phone/downloads/' + o.key + '.mp4', duration: 2400 }),
    readable: async () => ({ bad: [] }), share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
});
await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- two earlier games: Cat FC already cut, Dog FC not
let db = w.db();
const sop = db.teams[0], T = 1791660000000;
db.games.push({ id: 'g-cat', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 1, them: 0, finished_at: T - 2 * 864e5, ko_at: T - 2 * 864e5 - 6e5, friendly: false },
  { id: 'g-dog', team_id: sop.id, seq: 2, opp: 'Dog FC', us: 1, them: 0, finished_at: T - 864e5, ko_at: T - 864e5 - 6e5, friendly: false });
db.game_events.push({ game_id: 'g-cat', seq: 0, kind: 'goal', us: true, pid: 3, at: T - 2 * 864e5, minute: 4 },
  { game_id: 'g-dog', seq: 0, kind: 'goal', us: true, pid: 3, at: T - 864e5, minute: 4 });
db.clips.push({ team_id: sop.id, game_id: 'g-cat', seq: 0, path: sop.id + '/cat/01.mp4', store: 'r2', at: T - 2 * 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' });
w.setDb(db);
await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
const card = (P, opp) => P.page.evaluate((o) => { const c = [...document.querySelectorAll('#hlList .hcard')].find((x) => x.textContent.includes(o)); return c ? c.id : null; }, opp);
const inCard = async (P, opp, sel) => { const id = await card(P, opp); return id ? P.page.locator('#' + id + ' ' + sel).count() : 0; };
eq([await inCard(A, 'Cat FC', '[data-full]'), await inCard(A, 'Dog FC', '[data-full]')], [0, 0], 'no game has Watch the full game until it has a link');

// ---------- a game with no footage: Add a full-game link (gaffers)
const dog = await card(A, 'Dog FC');
check(await A.page.isVisible(`#${dog} [data-hlm^="full:"]`), 'a game with no footage offers the gaffer Add a full-game link');
await A.click(`#${dog} [data-hlm^="full:"]`); await A.run(300);
check(await A.page.isVisible('#fullLink'), 'which asks for the link');
const say = await A.text('#hlSheet');
check(/GoPro Quik/.test(say) && /iPhone/.test(say) && /video stays where it is/.test(say), 'saying where to get a GoPro link, that an iPhone video\'s link works too, and that only the link is kept');
await A.page.fill('#fullLink', 'not a link'); await A.click('#hlSheet [data-fullsave]'); await A.run(300);
check(/doesn’t look like a link/.test(await A.text('#fullMsg')), 'something that isn\'t a link says so');
eq(await A.page.inputValue('#fullLink'), 'not a link', 'and what was typed stays in the box to fix');
await A.page.fill('#fullLink', 'Check out my GoPro video! https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44.'); await A.click('#hlSheet [data-fullsave]'); await A.run(600);
eq(w.db().games.find((g) => g.id === 'g-dog').full_video, 'https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44', 'the link is found in the shared message and kept with the game (nothing else of the message)');
check(!(await A.page.isVisible('#fullLink')), 'the sheet closes');
check(/Everyone in the team can now watch the full game/.test(await A.text('#' + dog)), 'and the card says it\'s saved');
const dogBtn = `#${dog} [data-full]`;
eq(await A.page.$eval(dogBtn, (b) => b.querySelector('b').textContent + ' · ' + b.querySelector('small').textContent), 'Watch the full game · On GoPro', 'Dog FC now has Watch the full game, saying it\'s on GoPro');
check(!(await A.page.isVisible(`#${dog} [data-hlm^="full:"]`)), 'and Add a full-game link has gone from it');
await A.click(dogBtn); await A.run(200);
eq(await opened(A), ['https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44'], 'tapping it opens the GoPro link (the video stays on GoPro)');
await shot(A, 'fullgame-nofootage');

// ---------- a cut game: through Edit footage, an iPhone video's link
const cat = await card(A, 'Cat FC');
await A.click(`#${cat} [data-hlm^="edit:"]`); await A.run(300);
check(/Add a full-game link/.test(await A.text('#hlSheet')), 'Edit footage on a cut game has Add a full-game link');
await A.click('#hlSheet [data-hlm^="full:"]'); await A.run(300);
await A.page.fill('#fullLink', 'https://www.icloud.com/photos/#0a1B2c3D4e'); await A.click('#hlSheet [data-fullsave]'); await A.run(600);
eq(w.db().games.find((g) => g.id === 'g-cat').full_video, 'https://www.icloud.com/photos/#0a1B2c3D4e', 'an iPhone video\'s iCloud link is kept too');
const order = await A.page.$$eval(`#${cat} .mhbtn`, (b) => b.map((x) => x.querySelector('b').textContent));
eq(order, ['Watch the whole match highlights', 'Watch the full game'], 'on a cut game it sits just under the whole match highlights');
eq(await A.page.$eval(`#${cat} [data-full]`, (b) => b.querySelector('b').textContent + ' · ' + b.querySelector('small').textContent), 'Watch the full game · On iCloud', 'saying where it is');
await A.click(`#${cat} [data-hlm^="edit:"]`); await A.run(300);
check(/Change the full-game link/.test(await A.text('#hlSheet')), 'once there is one, Edit footage offers to change it');
await A.click('#hlSheet [data-hlm^="full:"]'); await A.run(300);
eq(await A.page.inputValue('#fullLink'), 'https://www.icloud.com/photos/#0a1B2c3D4e', 'with the link it has in the box');
await shot(A, 'fullgame-sheet');
await A.click('#hlSheet [data-fulloff]'); await A.run(600);
eq([w.db().games.find((g) => g.id === 'g-cat').full_video, await inCard(A, 'Cat FC', '[data-full]')], [null, 0], 'Take the link off takes it off the game and the button goes');

// ---------- the rest of the team sees it
const F = await w.phone({ db: true, native: true, label: 'follower' });
await F.ctx.addInitScript(spyOpen); await F.page.reload(); await F.run(500);
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
await F.click('#mHighlights'); await F.run(800);
const fdog = await card(F, 'Dog FC');
eq([await inCard(F, 'Dog FC', '[data-full]'), await inCard(F, 'Dog FC', '[data-hlm^="full:"]')], [1, 0], 'someone following the team gets Watch the full game, but not the gaffer\'s Add a full-game link');
await F.click(`#${fdog} [data-full]`); await F.run(200);
eq(await opened(F), ['https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44'], 'and it opens the same GoPro link on their phone');
await F.close();

// ---------- cutting from a GoPro link keeps the link with the game by itself
await A.page.evaluate(() => { window.__gopro = { 'https://gopro.com/v/OneHalfVid01': { videos: [{ id: 'LvV9MVbapDqKy', name: 'GX010042.MP4', captured: '2026-10-10T17:58:00Z', duration: 2400, quality: '1080p', size: 1400000000, url: 'https://media-cdn.gopro.com/x/1.mp4' }] } }; });
await A.click(`#${cat} [data-hlm^="edit:"]`); await A.run(300);
await A.click('#hlSheet [data-cut]'); await A.run(500);
check(!(await A.page.isVisible('#cutBody [data-full]')), 'the cut screen has no full-game button while the game has no link');
await A.click('#cutBody [data-cutdo="gpadd"]');
await A.page.fill('#gpLink', 'https://gopro.com/v/OneHalfVid01'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(1500);
eq(w.db().games.find((g) => g.id === 'g-cat').full_video, 'https://gopro.com/v/OneHalfVid01', 'the GoPro share link the video came from is kept with the game');
check(await A.page.isVisible('#cutBody [data-full]'), 'and the cut screen shows Watch the full game straight away');
await A.page.evaluate(() => { window.__opened = []; });
await A.click('#cutBody [data-full]'); await A.run(200);
eq(await opened(A), ['https://gopro.com/v/OneHalfVid01'], 'which opens it');
await shot(A, 'fullgame-cut');
// a different link for the second half doesn't replace the game's link
await A.page.evaluate(() => { window.__gopro['https://gopro.com/v/TwoHalves002'] = { videos: [{ id: 'Half2bbbbbbbb', name: 'GX010052.MP4', captured: '2026-10-10T18:20:00Z', duration: 1080, quality: '1080p', size: 9e8, url: 'https://media-cdn.gopro.com/x/2.mp4' }] }; });
await A.click('#cutBody [data-cutdo="gp"]'); await A.page.fill('#gpLink', 'https://gopro.com/v/TwoHalves002'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(1500);
eq(w.db().games.find((g) => g.id === 'g-cat').full_video, 'https://gopro.com/v/OneHalfVid01', 'a second link on the same game doesn\'t replace the first');

await w.close();
await done();
