// Experimental player tracking: the per-person switch in Settings, and the tracking screen with a stand-in for the native plugin.
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const errs = [], out = process.argv[2]; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.route('**/*', (r) => r.request().url().startsWith(BASE) && !r.request().url().includes('supabase') ? r.continue() : r.abort());
await pg.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await pg.addInitScript(() => {
  window.__mv = [];
  const none = async () => ({}), grid = (hot) => Array.from({ length: 150 }, (_, i) => Math.max(0, 9 - Math.abs((i % 10) - hot[0]) * 3 - Math.abs(Math.floor(i / 10) - hot[1]) * 2));
  const PIC = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const MV = { addListener: (n, cb) => { MV.cb = cb; }, cancel: none,
    name: async (o) => { window.__mv.push('name ' + JSON.stringify(o)); const r = JSON.parse(JSON.stringify(MV.last)); r.ask = []; r.unknownSeconds = 5; r.players[0].seconds += 36; return r; },
    analyse: async (o) => { window.__mv.push(JSON.stringify(o)); MV.cb && MV.cb({ stage: 'look', p: 0.5 }); await new Promise((r) => setTimeout(r, 300));
      return MV.last = { ask: [{ piece: 7, seconds: 36, pictures: [PIC, PIC] }], more: 3, duration: 300, frames: 2400, pitch: { width: 20.7, length: o.length }, cameraHeight: 2.3, columns: 10, rows: 15, pieces: 64, unknownSeconds: 41, numbersRead: 37,
        players: o.players.map((p, i) => ({ pid: p.pid, number: p.number, seconds: 200 + i * 20, readSeconds: i ? 30 : 0, metres: 400 + i * 50, pieces: 9, heat: grid([2 + i * 2, 4 + i * 3]) })), team: { heat: grid([5, 7]) } }; } };
  const RC = { addListener: () => {}, pickVideo: async (o) => { window.__mv.push('pick ' + o.slot); return { path: '/tmp/game.mov', duration: 1830 }; } };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { MatchVision: MV, ReelCutter: RC, Haptics: { impact: none, notification: none }, KeepAwake: { keepAwake: none, allowSleep: none }, LocalNotifications: { getPending: async () => ({ notifications: [] }), cancel: none, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: none } } };
});
const wait = (ms) => pg.waitForTimeout(ms), view = () => pg.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
await pg.goto(BASE); await wait(300);
await pg.click('#createBtn'); await pg.fill('#tName', 'Test United'); await pg.fill('#tPlayers', 'Marsh\nTobi\nDev\nKofi\nLuca\nAsh'); await pg.click('#tCreate'); await pg.click('#v-code [data-go="home"]');
await pg.click('#mInsights'); console.log('tracking button before switching on:', await pg.isVisible('#trackOpen')); await pg.click('#v-insights .back');
await pg.click('#mOptions'); await wait(200); console.log('settings:', await view(), '| experimental section:', await pg.isVisible('#expTrack'));
await pg.check('#expTrack'); await pg.click('#expTrackOpen'); await wait(200); console.log('opened:', await view());
await pg.click('[data-tr="pick"]'); await wait(200); console.log('video:', await pg.textContent('#trackBody .msg'));
await pg.click('[data-tr="go"]'); console.log('nobody ticked, no numbers:', await pg.textContent('#trackBody .msg.bad'));
for (const [pid, n] of [[2, '56'], [3, '14'], [4, '22'], [5, '2']]) { await pg.check(`[data-tron="${pid}"]`); if (pid !== 5) await pg.fill(`[data-trnum="${pid}"]`, n); }
await pg.click('[data-tr="go"]'); console.log('missing number:', await pg.textContent('#trackBody .msg.bad'));
await pg.fill('[data-trnum="5"]', '2'); await pg.type('#trFrom', '0500'); await pg.type('#trTo', '1000'); await pg.click('[data-tr="go"]'); await wait(100);
console.log('working:', await pg.textContent('#trProg')); await wait(600);
const sent = JSON.parse((await pg.evaluate(() => window.__mv)).find((x) => x.startsWith('{')));
console.log('asked the phone for:', JSON.stringify(sent));
console.log('result:', (await pg.textContent('#trackBody section:has(.heatwrap)')).replace(/\s+/g, ' ').slice(0, 330), '| heat maps:', await pg.$$eval('.heatcard svg', (x) => x.length));
if (out) { fs.mkdirSync(out, { recursive: true }); await wait(300); await pg.screenshot({ path: `${out}/track.png`, fullPage: true }); }
console.log('asks who:', await pg.$$eval('.whois', (x) => x.length), '| pictures:', await pg.$$eval('.whopics img', (x) => x.length), '| choices:', (await pg.$$eval('[data-trask]', (x) => x.map((b) => b.textContent))).join());
await pg.click('[data-trask="7"][data-num="56"]'); await wait(200);
console.log('named:', (await pg.evaluate(() => window.__mv)).find((x) => x.startsWith('name')), '| still asking:', await pg.$$eval('.whois', (x) => x.length), '|', (await pg.textContent('.heatcard small')).trim());
await pg.reload(); await wait(400); console.log('after reload:', await view(), '| ticks kept:', await pg.$$eval('[data-tron]:checked', (x) => x.length), '| earlier runs:', await pg.$$eval('[data-trrun]', (x) => x.length));
await pg.click('[data-trrun="0"]'); console.log('earlier run reopened:', await pg.$$eval('.heatcard', (x) => x.length), 'cards');
console.log('errors:', JSON.stringify(errs)); await b.close();
