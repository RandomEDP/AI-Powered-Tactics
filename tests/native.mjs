import { chromium } from './pinned.mjs';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 400, height: 900 } }); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.route('**/*', (r) => r.request().url().startsWith(BASE) && !r.request().url().includes('supabase') ? r.continue() : r.abort());
await pg.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); }); // skip the first-launch intro
await pg.addInitScript(() => {
  window.__log = [];
  const pend = [];
  const LN = { getPending: async () => ({ notifications: pend.slice() }), cancel: async ({ notifications }) => { window.__log.push('cancel ' + notifications.length); pend.length = 0; },
    checkPermissions: async () => ({ display: 'prompt' }), requestPermissions: async () => { window.__log.push('ask permission'); return { display: 'granted' }; },
    schedule: async ({ notifications }) => { notifications.forEach((n) => pend.push(n)); window.__log.push('schedule ' + notifications.map((n) => n.title + ' @' + Math.round((n.schedule.at - Date.now()) / 1000) + 's: ' + n.body).join(' | ')); } };
  window.__watch = []; const WL = { push: async (o) => { window.__watch.push(JSON.parse(o.state)); return { sent: true }; }, addListener: (n, cb) => { window.__watchCb = cb; } };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { WatchLink: WL, LocalNotifications: LN, Haptics: { impact: async () => {}, notification: async (o) => window.__log.push('haptic ' + o.type) }, KeepAwake: { keepAwake: async () => window.__log.push('awake'), allowSleep: async () => window.__log.push('sleep ok') } } };
});
await pg.goto(BASE); await pg.waitForTimeout(300);
await pg.click('#createBtn'); await pg.fill('#tName', 'Test United'); await pg.fill('#tPlayers', 'K\nA\nB\nC\nD\nE\nF\nG'); await pg.click('#tCreate'); await pg.click('#v-code [data-go="home"]');
await pg.click('#mNew'); await pg.fill('#opp', 'Dog'); await pg.click('#startGame'); await pg.click('#kick');
await pg.waitForTimeout(300); const before = (await pg.evaluate(() => window.__log)).length;
await pg.click('#go'); await pg.waitForTimeout(500);
console.log('after kick-off:', (await pg.evaluate(() => window.__log)).slice(before).join('\n  '));
// the Apple Watch: it is sent the game, and a goal logged on it lands on the phone
const ws = async () => pg.evaluate(() => window.__watch[window.__watch.length - 1]);
let w = await ws(); console.log('watch sees:', JSON.stringify({ live: w.live, team: w.team, opp: w.opp, score: w.us + '-' + w.them, phase: w.phase, running: w.running, half: w.half, changes: w.changes.slice(0, 2), players: w.players.length, onPitch: w.players.filter((x) => x.on).length }));
await pg.evaluate((pid) => window.__watchCb({ event: JSON.stringify({ type: 'goal', us: true, p: pid, id: 'w1', at: Date.now() }) }), w.players[1].id); await pg.waitForTimeout(500);
await pg.evaluate(() => window.__watchCb({ event: JSON.stringify({ type: 'goal', us: false, id: 'w2', at: Date.now() }) })); await pg.waitForTimeout(500);
w = await ws(); console.log('after a watch goal, then a second inside the lock:', await pg.textContent('#usN'), '-', await pg.textContent('#themN'), '| watch score', w.us + '-' + w.them, '| locked on watch:', w.lockUntil > Date.now(), '| event:', (await pg.textContent('#events')).trim().slice(0, 40));
await pg.evaluate(() => window.__watchCb({ event: JSON.stringify({ type: 'hl', id: 'w3', at: Date.now() }) })); await pg.waitForTimeout(300); console.log('watch highlight:', (await pg.textContent('#events')).includes('Highlight'));
let n = (await pg.evaluate(() => window.__log)).length;
await pg.click('#go'); await pg.waitForTimeout(400); console.log('after pause:', (await pg.evaluate(() => window.__log)).slice(n).join(' ; '));
await pg.click('#go'); await pg.waitForTimeout(400); n = (await pg.evaluate(() => window.__log)).length;
await pg.click('#finish'); await pg.click('#finish'); await pg.waitForTimeout(400); console.log('after finish:', (await pg.evaluate(() => window.__log)).slice(n).join(' ; '));
await pg.waitForTimeout(400); console.log('watch after full time:', JSON.stringify(await ws()));
console.log('errors:', JSON.stringify(errs)); await b.close();
