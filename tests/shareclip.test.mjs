// Sharing one highlight on its own (Ethan, November 2026: "There should be a way to share a specific highlight of a game
// easily and quickly"). Under every list of clips, every game's reel and in the whole-match player there's a Share button:
// one tap downloads that moment's clip as it is (the score box, the bar and Gaffer's mark are already on it; with
// commentary when it's on) and opens the share sheet. Nothing is made again or uploaded, and the website opens the clip.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: share one highlight');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const tail = (u) => String(u || '').replace(/^.*\//, '');

const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- a game with three clips, one cut with commentary (kept twice), and a reel
let db = w.db();
const sop = db.teams[0], T = 1791660000000;
db.games.push({ id: 'g-cat', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 2, them: 1, finished_at: T - 864e5, friendly: false });
db.clips.push({ team_id: sop.id, game_id: 'g-cat', seq: 0, path: sop.id + '/cat/01.mp4', vpath: sop.id + '/cat/01v.mp4', store: 'r2', at: T - 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' },
  { team_id: sop.id, game_id: 'g-cat', seq: 1, path: sop.id + '/cat/02.mp4', store: 'r2', at: T - 864e5 + 6e5, dur: 14, pids: [2], label: '14\' Goal: Jake (Spice)' },
  { team_id: sop.id, game_id: 'g-cat', seq: 2, path: sop.id + '/cat/03.mp4', store: 'r2', at: T - 864e5 + 9e5, dur: 14, pids: [1], label: '21\' Save by Spice' });
w.setDb(db);
await A.ctx.addInitScript(() => { // a stand-in for the iPhone's reel maker
  window.__rc = []; window.__hold = null; window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  window.Capacitor.Plugins.ReelCutter = { addListener: (n, f) => { (window.__rcOn = window.__rcOn || {})[n] = f; return { remove() {} }; }, cancel: async () => ({}),
    share: async (o) => { window.__rc.push(['share', o.path]); return { completed: false }; },
    saveVideo: async (o) => { window.__rc.push(['save', o]); const on = window.__rcOn.progress; if (on) on({ stage: 'save', p: 0.4, job: o.job });
      if (window.__hold) await window.__hold; if (window.__fail) throw new Error('The Internet connection appears to be offline.'); return { path: '/phone/save/' + o.file, size: 1000 }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); if (o.job === 'mk') await new Promise(() => {}); return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; } };
});
await A.page.reload(); await A.run(1500);
const rc = (k) => A.page.evaluate((x) => window.__rc.filter((c) => c[0] === x).map((c) => c[1]), k);

// ---------- Highlights, a game's clips one at a time: Share this clip, for the one picked
await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
await A.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; });
const btn = '#hlList .hcard [data-clipshare="clip"]';
eq(await A.page.$$eval(btn, (b) => b.map((x) => x.textContent)), ['Share this clip'], 'under the game\'s clips: Share this clip');
await shot(A, 'shareclip-card');
await A.click('#hlList .hcard [data-clip="1"]'); await A.run(200);
await A.click(btn); await A.run(400);
let saves = await rc('save');
eq(saves.length, 1, 'one tap gets the clip');
eq(tail(saves[0].url), '02.mp4', 'the one picked (Jake\'s goal), not the whole game');
check(/^gaffer-14-goal-jake-spice\.mp4$/.test(saves[0].file) && /^cs-/.test(saves[0].job), `named after the moment, as a job of its own (${saves[0].file})`);
check(!/supabase/.test(saves[0].url), 'straight from the clip storage (R2), never Supabase');
eq(await rc('share'), ['/phone/save/' + saves[0].file], 'and the share sheet opens with it straight away');
eq((await rc('join')).filter((o) => /^cs-/.test(o.job || '')).length, 0, 'nothing is joined or made again (the joins here are the game\'s one video, which Gaffer makes by itself)');
await A.click(btn); await A.run(300);
eq([(await rc('save')).length, (await rc('share')).length], [1, 2], 'sharing it again uses the same download');

// commentary on: the copy with commentary is shared; off: the clean one
await A.click('#hlList .hcard [data-clip="0"]'); await A.run(200);
await A.click(btn); await A.run(400);
eq(tail((await rc('save'))[1].url), '01v.mp4', 'a clip cut with commentary is shared with it while Commentary is on');
await A.page.evaluate(() => { localStorage.setItem('apt-say', '0'); }); await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
await A.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; });
await A.click(btn); await A.run(400);
eq(tail((await rc('save'))[0].url), '01.mp4', 'and without it when Commentary is off');

// ---------- while it's being got, it says how far; a failure says so and can be tapped again
await A.page.evaluate(() => { window.__hold = new Promise((r) => { window.__let = r; }); });
await A.click('#hlList .hcard [data-clip="2"]'); await A.run(200);
await A.click(btn); await A.run(300);
eq([await A.text(btn), await A.page.$eval(btn, (b) => b.disabled)], ['Getting it ready, 40%', true], 'it says how far it\'s got');
await A.page.evaluate(() => { window.__fail = true; window.__let(); window.__hold = null; }); await A.run(400);
check(/Couldn’t get the clip/.test(await A.text(btn)) && !(await A.page.$eval(btn, (b) => b.disabled)), 'a failure says so, and it can be tried again');
await A.page.evaluate(() => { window.__fail = false; });
await A.click(btn); await A.run(400);
eq([await A.text(btn), (await rc('share')).slice(-1)[0]], ['Share this clip', '/phone/save/gaffer-21-save-by-spice.mp4'], 'the second go shares it');

// ---------- the whole-match player: Share this moment, for the one playing
await A.click('#hlList .hcard .mhbtn'); await A.run(500);
eq(await A.page.$$eval('#mhTools [data-clipshare]', (b) => b.map((x) => x.textContent)), ['Share this moment'], 'the whole-match player has Share this moment');
await shot(A, 'shareclip-player');
await A.click('#mhList [data-mhi="1"]'); await A.run(300);
const before = (await rc('save')).length;
await A.click('#mhTools [data-clipshare]'); await A.run(400);
const sv = (await rc('save'))[before];
eq([tail(sv && sv.url), (await rc('share')).slice(-1)[0]], ['02.mp4', '/phone/save/' + (sv && sv.file)], 'it shares the moment picked, not the whole match');
check(await A.visible('#mhPop'), 'and the player stays open');
await A.click('#mhClose'); await A.run(200);

// ---------- a game with its reel: Share the moment playing
db = w.db(); const g = db.games.find((x) => x.id === 'g-cat'); g.reel = { path: sop.id + '/cat/reel.mp4', store: 'r2' };
db.clips.filter((c) => c.game_id === 'g-cat').forEach((c, i) => { c.reel_at = i * 14; }); w.setDb(db);
await A.page.reload(); await A.run(1500); await A.click('#tabs [data-tab="highlights"]'); await A.run(800);
await A.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; });
check(await A.visible('#hlList .reelp [data-clipshare]'), 'a game\'s reel has Share this clip too');
await A.click('#hlList .reelp [data-seek="28"]'); await A.run(200);
await A.click('#hlList .reelp [data-clipshare]'); await A.run(400);
eq(tail((await rc('save')).slice(-1)[0].url), '03.mp4', 'sharing the moment skipped to, on its own (not the reel)');

// ---------- the website: the clip opens, to save or share from there
const W = await w.phone({ db: true, label: 'web' });
await W.click('#createBtn'); await W.signUp('web@example.com');
await W.page.fill('#tName', 'Web Wanderers'); await W.page.fill('#tShort', 'WW'); await W.page.fill('#tPlayers', 'Ann\nBea\nCal'); await W.click('#tCreate'); await W.run(600);
await W.click('#v-code [data-go="home"]'); await W.run(300);
db = w.db(); const ww = db.teams.find((t) => t.name === 'Web Wanderers');
db.games.push({ id: 'g-web', team_id: ww.id, seq: 1, opp: 'Rovers', us: 1, them: 0, finished_at: T, friendly: false });
db.clips.push({ team_id: ww.id, game_id: 'g-web', seq: 0, path: ww.id + '/rov/01.mp4', store: 'r2', at: T, dur: 14, pids: [1], label: '7\' Goal: Ann' });
w.setDb(db); await W.page.reload(); await W.run(1500);
await W.page.evaluate(() => { window.open = (u) => { window.__opened = u; }; });
await W.click('#tabs [data-tab="highlights"]'); await W.run(800);
await W.page.evaluate(() => { const d = document.querySelector('#hlList details.allclips'); if (d) d.open = true; });
eq(await W.text('#hlList [data-clipshare]'), 'Save this clip', 'on the website it says Save this clip');
await W.click('#hlList [data-clipshare]'); await W.run(200);
const opened = await W.page.evaluate(() => window.__opened);
check(/01\.mp4$/.test(opened || '') && !/github/i.test(opened) && !/supabase/.test(opened), `and opens the clip from the clip storage (${opened})`);
done();
