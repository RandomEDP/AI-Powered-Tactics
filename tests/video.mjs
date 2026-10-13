// Cutting highlights on the phone: a stand-in for the native ReelCutter plugin, against the mock database.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true, exp: { track: true } })); });
await ctx.addInitScript((base) => {
  window.__rc = [];
  const RC = { addListener: (n, cb) => { RC.cb = cb; return { remove() {} }; },
    pickVideo: async (o) => { window.__rc.push('pick ' + o.slot); if (window.__cancelPick) { window.__cancelPick = false; return { cancelled: true }; }
      return o.slot === 2 ? { path: '/tmp/half2.mov', duration: 1500, created: Date.now() - 20000 } : o.slot > 2 ? { path: '/tmp/cam' + o.slot + '.mov', duration: 1500, created: Date.now() - 120000 } : { path: '/tmp/game.mov', duration: 3000, created: Date.now() - 120000 }; },
    cut: async (o) => { window.__rc.push('cut ' + JSON.stringify(o)); RC.cb({ stage: 'cut', i: 0, n: o.clips.length, p: 0.5 });
      return { clips: o.clips.map((c) => Object.assign({ file: c.file, path: '/tmp/' + c.file }, c.voice ? { voiced: { file: c.file.replace('.mp4', 'v.mp4'), path: '/tmp/' + c.file.replace('.mp4', 'v.mp4') } } : {})), reel: { path: '/tmp/' + o.reelFile } }; },
    share: async (o) => { window.__rc.push('share ' + o.path); }, cleanup: async () => { window.__rc.push('cleanup'); } };
  const none = async () => ({});
  window.Capacitor = { isNativePlatform: () => true, convertFileSrc: () => base + 'icons/icon-192.png',
    Plugins: { ReelCutter: RC, GameCalendar: { addEvent: async (o) => { window.__rc.push('calendar ' + JSON.stringify(o)); return { saved: true }; } }, LocalNotifications: { getPending: async () => ({ notifications: [] }), cancel: none, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: none }, Haptics: { impact: none, notification: none }, KeepAwake: { keepAwake: none, allowSleep: none } } };
}, BASE);
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const errs = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2]; const shot = async (p, name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); } };
const view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));

const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push(String(e))); await A.goto(BASE); await wait(300);
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await wait(400);
await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#mNew'); await A.fill('#opp', 'Dog'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go'); await wait(300);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); await wait(1200);
await A.click('#hlBtn'); await A.click('#picker [data-p="x"]'); await wait(300); // (whose highlight: No one)
await A.click('#endHalf'); await A.click('#endHalf'); await wait(24000); await A.click('#go'); await wait(500); // a half-time long enough that the two goals are separate clips
await A.click('#goalThem'); await wait(600);
await A.click('#finish'); await A.click('#finish'); await wait(1500);
console.log('after finish:', await view(A)); await A.click('.view:not([hidden]) [data-go="home"]'); await wait(400);
await A.click('#mHighlights'); await wait(300);
console.log('before:', (await A.textContent('#hlList')).replace(/\s+/g, ' ').slice(0, 260));
await shot(A, 'hl-before');
await A.click('#hlList [data-cut]'); console.log('view:', await view(A));
console.log('cameras screen:', (await A.textContent('#cutBody')).replace(/\s+/g, ' ').slice(0, 420));
await shot(A, 'cut-cams-empty');
// a tap on the drawing puts a camera there and asks for its video; giving up on the video takes the camera away again
const tap = async (fx, fy) => { const bx = await A.locator('#camSvg').boundingBox(); await A.mouse.click(bx.x + bx.width * fx, bx.y + bx.height * fy); await wait(400); };
await A.evaluate(() => { window.__cancelPick = true; }); await tap(0.08, 0.6);
console.log('cancelled pick leaves', await A.locator('#camSvg [data-cam]').count(), 'cameras | next button:', await A.isVisible('[data-cutdo="next"]'));
await tap(0.08, 0.6);
console.log('after a tap and a video:', await A.locator('#camSvg [data-cam]').count(), 'camera |', (await A.textContent('.camlist')).replace(/\s+/g, ' '));
await shot(A, 'cut-cams-one');
await A.click('#cutBody [data-cutdo="next"]'); await wait(300);
const marks = () => A.$$eval('#cutBody .marks li', (li) => li.map((x) => x.querySelector('b').textContent + ' ' + x.querySelector('span').textContent).join(' | '));
// marking a moment: the video stands in, reporting where it has been dragged to
const mark = async (key, t) => { if (key) await A.click(`#cutBody [data-cutdo="sel"][data-key="${key}"]`); await wait(200);
  await A.evaluate((x) => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => x, set: () => {} }); }, t); await A.click('#cutBody [data-cutdo="here"]'); await wait(200); };
console.log('sync screen:', (await A.textContent('#cutBody')).replace(/\s+/g, ' ').slice(0, 330));
console.log('to mark:', await marks());
await shot(A, 'cut-sync');
await mark('ko', 130); console.log('kick-off marked at 2:10 ->', await marks());
await A.click('#cutBody [data-cutdo="vid2"]'); await wait(400);
console.log('second video:', await marks());
await mark('h2', 5); console.log('second half marked at 0:05 in it ->', await marks()); await shot(A, 'cut-two');
console.log('commentary switch:', await A.isVisible('#cutVoice')); await A.check('#cutVoice');
await A.click('#cutBody [data-cutdo="go"]'); await wait(2500);
{ const c = JSON.parse((await A.evaluate(() => window.__rc)).filter((x) => x.startsWith('cut ')).pop().slice(4)); const v = (await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).calls)).filter((x) => x.name === 'reel-voice').pop();
  console.log('lines sent for speech:', JSON.stringify(v.body.lines)); console.log('cut with voice: intro', !!c.introVoice, '| sign-off', !!c.outroVoice, '| clips', c.clips.map((x) => (x.voice ? 'voice@' + x.voiceAt.toFixed(1) : 'none')).join(' ')); }
console.log('done screen:', (await A.textContent('#cutBody')).replace(/\s+/g, ' '));
await shot(A, 'cut-done');
const d = await db(A); const cutArg = JSON.parse((await A.evaluate(() => window.__rc)).find((x) => x.startsWith('cut ')).slice(4));
console.log('plugin asked for:', JSON.stringify(cutArg.clips.map((c) => [c.path, Math.round(c.start), c.caption])), JSON.stringify(cutArg.outro));
console.log('files:', JSON.stringify(d.files), '\nclip rows:', JSON.stringify((d.clips || []).map((c) => ({ seq: c.seq, path: c.path.replace(/^[^/]+/, '<team>'), vpath: c.vpath && c.vpath.replace(/^[^/]+/, '<team>'), label: c.label, dur: c.dur, pids: c.pids }))));
await A.click('#cutBody [data-cutdo="share"]'); await wait(200); await A.click('#cutBody [data-cutdo="finish"]'); await wait(400);
console.log('plugin calls:', (await A.evaluate(() => window.__rc)).map((x) => x.split(' {')[0]).join(', '), '| view:', await view(A));
const srcs = () => A.$$eval('#hlList .hcard:first-child [data-clip]', (x) => x.map((y) => y.getAttribute('data-src').replace(/^.*\//, '')));
console.log('whole match:', await A.$$eval('#hlList .mhbtn', (b) => b.map((x) => x.textContent)));
await A.evaluate(() => document.querySelectorAll('#hlList details.allclips').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); }));
console.log('commentary:', await A.textContent('#hlList [data-say]'), await srcs()); await A.click('#hlList [data-say]'); await wait(200);
console.log('commentary:', await A.textContent('#hlList [data-say]'), await srcs()); await A.click('#hlList [data-say]'); await wait(200);
console.log('by game:', await A.$$eval('#hlList .vplayer video', (v) => v.map((x) => x.getAttribute('src').replace(/clips\/[^/]+/, 'clips/<team>'))), await A.$$eval('#hlList [data-clip]', (x) => x.map((y) => y.textContent)));
await shot(A, 'hl-by-game');
await A.click('#hlToggle [data-by="player"]'); await wait(300);
console.log('by player:', await A.$$eval('#hlList .hcard', (c) => c.filter((x) => x.querySelector('.vplayer')).map((x) => x.querySelector('h3').textContent + ': ' + [...x.querySelectorAll('[data-clip]')].map((y) => y.textContent).join(' | '))));
await shot(A, 'hl-by-player');
// cutting again with two cameras: the first one's spot is remembered; one goes behind Dog's goal
await A.click('#hlToggle [data-by="game"]'); await wait(200);
await A.evaluate(() => { window.__rc = []; }); await A.click('#hlList [data-cut]'); await wait(200);
console.log('remembered:', await A.locator('#camSvg [data-cam]').count(), 'camera |', (await A.textContent('.camlist')).replace(/\s+/g, ' '));
await A.click('#camSvg [data-cam="0"]', { force: true }); await wait(400); // a camera with no video yet: a tap asks for it
await tap(0.5, 0.07); // behind their goal
console.log('two cameras:', (await A.textContent('.camlist')).replace(/\s+/g, ' '), '| swap ends:', await A.isChecked('#camSwap'));
await shot(A, 'cut-cams-two');
await A.uncheck('#camSwap'); await A.click('#cutBody [data-cutdo="next"]'); await wait(300);
console.log('same ends all game:', (await A.textContent('#cutCount')).replace(/\s+/g, ' '));
await shot(A, 'cut-sync-two');
await A.click('#cutBody [data-cutdo="cams"]'); await A.check('#camSwap'); await A.click('#cutBody [data-cutdo="next"]'); await wait(300);
console.log('swapped at half time:', (await A.textContent('#cutCount')).replace(/\s+/g, ' '));
// camera 2 started its kick-off late in a short video, so it hasn't got the second goal: that comes from camera 1 instead
await A.click('#cutBody [data-cutdo="lc"][data-cam="1"]'); await wait(200); await mark('ko', 1490); console.log('camera 2:', await marks()); await A.uncheck('#cutVoice'); await A.click('#cutBody [data-cutdo="go"]'); await wait(2500);
{ const c = JSON.parse((await A.evaluate(() => window.__rc)).filter((x) => x.startsWith('cut ')).pop().slice(4)); console.log('two-camera cut:', JSON.stringify(c.clips.map((x) => [x.path, x.caption]))); }
console.log('plugin calls:', (await A.evaluate(() => window.__rc)).map((x) => x.split(' {')[0]).join(', '));
await A.click('#cutBody [data-cutdo="finish"]'); await wait(300);
// a poll, and its calendar entry
await A.click('.view:not([hidden]) [data-go="home"], .view:not([hidden]) .back'); await wait(300);
await A.click('#fxCard [data-fx="new"]'); await A.fill('#pOpp', 'Athletico Pathetico'); await A.fill('#pDate', '2026-10-13'); await A.fill('#pTime', '19:30'); await A.fill('#pLoc', 'Powerleague Romford, pitch 4'); await A.fill('#pCost', '£5 each'); await A.click('#pSave'); await wait(700);
console.log('poll card:', (await A.textContent('#gamesTrack .fxc')).replace(/\s+/g, ' ').slice(0, 120), '| class:', await A.getAttribute('#gamesTrack .fxc', 'class'));
await A.click('#gamesTrack .fxc [data-fx="cal"]'); await wait(300);
console.log((await A.evaluate(() => window.__rc)).find((x) => x.startsWith('calendar')), '|', await A.textContent('#gamesTrack .fxc .msg'));
await shot(A, 'home-poll');
console.log('errors:', JSON.stringify(errs)); await b.close();
