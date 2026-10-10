import { chromium } from 'playwright';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 400, height: 900 } }); const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.route('**/*', (r) => r.request().url().startsWith(BASE) && !r.request().url().includes('supabase') ? r.continue() : r.abort());
await pg.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true })); }); // skip the first-launch intro
await pg.addInitScript(() => {
  window.__log = [];
  const pend = [];
  const LN = { getPending: async () => ({ notifications: pend.slice() }), cancel: async ({ notifications }) => { window.__log.push('cancel ' + notifications.length); pend.length = 0; },
    checkPermissions: async () => ({ display: 'prompt' }), requestPermissions: async () => { window.__log.push('ask permission'); return { display: 'granted' }; },
    schedule: async ({ notifications }) => { notifications.forEach((n) => pend.push(n)); window.__log.push('schedule ' + notifications.map((n) => n.title + ' @' + Math.round((n.schedule.at - Date.now()) / 1000) + 's: ' + n.body).join(' | ')); } };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: LN, Haptics: { notification: async (o) => window.__log.push('haptic ' + o.type) }, KeepAwake: { keepAwake: async () => window.__log.push('awake'), allowSleep: async () => window.__log.push('sleep ok') } } };
});
await pg.goto(BASE); await pg.waitForTimeout(300);
await pg.click('#createBtn'); await pg.fill('#tName', 'Test United'); await pg.fill('#tPlayers', 'K\nA\nB\nC\nD\nE\nF\nG'); await pg.click('#tCreate'); await pg.click('#v-code [data-go="home"]');
await pg.click('#mNew'); await pg.fill('#opp', 'Dog'); await pg.click('#startGame'); await pg.click('#kick');
await pg.waitForTimeout(300); const before = (await pg.evaluate(() => window.__log)).length;
await pg.click('#go'); await pg.waitForTimeout(500);
console.log('after kick-off:', (await pg.evaluate(() => window.__log)).slice(before).join('\n  '));
let n = (await pg.evaluate(() => window.__log)).length;
await pg.click('#go'); await pg.waitForTimeout(400); console.log('after pause:', (await pg.evaluate(() => window.__log)).slice(n).join(' ; '));
await pg.click('#go'); await pg.waitForTimeout(400); n = (await pg.evaluate(() => window.__log)).length;
await pg.click('#finish'); await pg.click('#finish'); await pg.waitForTimeout(400); console.log('after finish:', (await pg.evaluate(() => window.__log)).slice(n).join(' ; '));
console.log('errors:', JSON.stringify(errs)); await b.close();
