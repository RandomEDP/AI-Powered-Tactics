// Cutting highlights on the phone: a stand-in for the native ReelCutter plugin, against the mock database.
import { chromium } from 'playwright';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true })); });
await ctx.addInitScript((base) => {
  window.__rc = [];
  const RC = { addListener: (n, cb) => { RC.cb = cb; return { remove() {} }; },
    pickVideo: async (o) => { window.__rc.push('pick ' + o.slot); return o.slot === 2 ? { path: '/tmp/half2.mov', duration: 1500, created: Date.now() - 20000 } : { path: '/tmp/game.mov', duration: 3000, created: Date.now() - 120000 }; },
    cut: async (o) => { window.__rc.push('cut ' + JSON.stringify(o)); RC.cb({ stage: 'cut', i: 0, n: o.clips.length, p: 0.5 });
      return { clips: o.clips.map((c) => ({ file: c.file, path: '/tmp/' + c.file })), reel: { path: '/tmp/' + o.reelFile } }; },
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
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await wait(400);
await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#mNew'); await A.fill('#opp', 'Dog'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go'); await wait(300);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); await wait(1200);
await A.click('#hlBtn'); await wait(300);
await A.click('#endHalf'); await A.click('#endHalf'); await wait(24000); await A.click('#go'); await wait(500); // a half-time long enough that the two goals are separate clips
await A.click('#goalThem'); await wait(600);
await A.click('#finish'); await A.click('#finish'); await wait(1500);
console.log('after finish:', await view(A)); await A.click('.view:not([hidden]) [data-go="home"]'); await wait(400);
await A.click('#mHighlights'); await wait(300);
console.log('before:', (await A.textContent('#hlList')).replace(/\s+/g, ' ').slice(0, 260));
await shot(A, 'hl-before');
await A.click('#hlList [data-cut]'); console.log('view:', await view(A));
await A.click('#cutBody [data-cutdo="pick"]'); await wait(400);
console.log('sync screen:', (await A.textContent('#cutBody')).replace(/\s+/g, ' ').slice(0, 330), '| kick-off field:', await A.inputValue('#cutSync'));
await shot(A, 'cut-sync');
await A.fill('#cutSync', ''); await A.type('#cutSync', '0210'); console.log('typed 0210 ->', await A.inputValue('#cutSync'));
await A.click('#cutBody [data-cutdo="pick2"]'); await wait(400);
console.log('second video: kick-off kept', await A.inputValue('#cutSync'), '| second half at', await A.inputValue('#cutSync2'));
await A.fill('#cutSync2', ''); await A.type('#cutSync2', '0005'); await shot(A, 'cut-two');
await A.click('#cutBody [data-cutdo="go"]'); await wait(2500);
console.log('done screen:', (await A.textContent('#cutBody')).replace(/\s+/g, ' '));
await shot(A, 'cut-done');
const d = await db(A); const cutArg = JSON.parse((await A.evaluate(() => window.__rc)).find((x) => x.startsWith('cut ')).slice(4));
console.log('plugin asked for:', JSON.stringify(cutArg.clips.map((c) => [c.path, Math.round(c.start), c.caption])), JSON.stringify(cutArg.outro));
console.log('files:', JSON.stringify(d.files), '\nclip rows:', JSON.stringify((d.clips || []).map((c) => ({ seq: c.seq, path: c.path.replace(/^[^/]+/, '<team>'), label: c.label, dur: c.dur, pids: c.pids }))));
await A.click('#cutBody [data-cutdo="share"]'); await wait(200); await A.click('#cutBody [data-cutdo="finish"]'); await wait(400);
console.log('plugin calls:', (await A.evaluate(() => window.__rc)).map((x) => x.split(' {')[0]).join(', '), '| view:', await view(A));
console.log('commentary:', await A.$$eval('#hlList [data-clip]', (x) => x.map((y) => y.getAttribute('data-line'))), '| shown:', await A.textContent('#hlList .say'));
console.log('by game:', await A.$$eval('#hlList .vplayer video', (v) => v.map((x) => x.getAttribute('src').replace(/clips\/[^/]+/, 'clips/<team>'))), await A.$$eval('#hlList [data-clip]', (x) => x.map((y) => y.textContent)));
await shot(A, 'hl-by-game');
await A.click('#hlToggle [data-by="player"]'); await wait(300);
console.log('by player:', await A.$$eval('#hlList .hcard', (c) => c.filter((x) => x.querySelector('.vplayer')).map((x) => x.querySelector('h3').textContent + ': ' + [...x.querySelectorAll('[data-clip]')].map((y) => y.textContent).join(' | '))));
await shot(A, 'hl-by-player');
// a poll, and its calendar entry
await A.click('.view:not([hidden]) [data-go="home"], .view:not([hidden]) .back'); await wait(300);
await A.click('#fxCard [data-fx="new"]'); await A.fill('#pOpp', 'Athletico Pathetico'); await A.fill('#pDate', '2026-10-13'); await A.fill('#pTime', '19:30'); await A.fill('#pLoc', 'Powerleague Romford, pitch 4'); await A.fill('#pCost', '£5 each'); await A.click('#pSave'); await wait(700);
console.log('poll card:', (await A.textContent('#gamesTrack .fxc')).replace(/\s+/g, ' ').slice(0, 120), '| class:', await A.getAttribute('#gamesTrack .fxc', 'class'));
await A.click('#gamesTrack .fxc [data-fx="cal"]'); await wait(300);
console.log((await A.evaluate(() => window.__rc)).find((x) => x.startsWith('calendar')), '|', await A.textContent('#gamesTrack .fxc .msg'));
await shot(A, 'home-poll');
console.log('errors:', JSON.stringify(errs)); await b.close();
