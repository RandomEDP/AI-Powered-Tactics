// Shared by the *.test.mjs files: serves the app, opens it in a headless browser with a clock the test controls,
// stands in for the iPhone-only parts (Apple Watch link, haptics, notifications) and counts checks.
//   node tests/run.mjs            runs every suite
//   node tests/match.test.mjs     runs one
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = fs.readFileSync(path.join(ROOT, 'tests/mock-supabase.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
export const T0 = Date.parse('2026-10-10T17:00:00Z'); // every test starts at five on a Saturday evening

let server = null, base = '', browser = null, worlds = 0;
const dbs = {};
async function serve() {
  if (server) return base;
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/__db/')) { // the stand-in database for one test world, shared by all its phones
      const id = req.url.slice(6);
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(dbs[id] || '{}'); return; }
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { dbs[id] = body; res.writeHead(204); res.end(); }); return;
    }
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  return base;
}

/// One phone. `db: true` gives it the stand-in database (shared by every phone opened from the same `world`);
/// without it the app runs on its own, as it does with no account. `native: true` makes it think it is the iOS app;
/// `android: true` the Android app (which has none of the iPhone's plugins: anything it asks of them is noted in __t.asked);
/// `firebase: true` makes it a build with the team's Firebase file, so it has notifications (a stand-in for Firebase's, in __t.push).
export async function world() {
  await serve();
  const local = '/opt/pw-browsers/chromium';
  browser = browser || await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync(local) ? local : undefined) });
  const made = [], pages = [], clocks = [], id = 'w' + (++worlds);
  const frozen = new Map(); // phones asleep in a pocket: their apps don't run and live updates pass them by
  let held = null, release = () => {}; // live updates between phones can be held back for a moment, to make two things happen "at once"
  let worldT = T0 + 1500; // every phone in a world keeps the same time, as real phones do
  const advance = async (ms, skip) => { for (let left = ms; left > 0; left -= 250) for (const c of clocks) if (c !== skip) await c.runFor(Math.min(250, left)); worldT += ms; };
  const phone = async ({ db = false, native = false, android = false, firebase = false, clock = true, label = 'phone', storage = null, viewport = { width: 390, height: 844 }, scale = 1 } = {}) => {
    const at = worldT - 1500;
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, storageState: storage || undefined, serviceWorkers: 'block', timezoneId: 'Europe/London', locale: 'en-GB' }); // (a bigger screen and scale: the App Store pictures, store/make.mjs)
    made.push(ctx);
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.includes('vendor/supabase.js')) return db ? r.fulfill({ contentType: 'application/javascript', body: MOCK }) : r.abort();
      return u.startsWith(base) ? r.continue() : r.abort();
    });
    await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
    if (native) await ctx.addInitScript(() => {
      const T = window.__t = { watch: [], haptics: [], notes: [], pending: [], watchCb: null };
      // The native half of the watch link. Like the real plugin it keeps every press from the watch on disk (here: localStorage,
      // so it survives the page reloading) until the web app says it has dealt with it, and hands them over when asked.
      const NI = '__native_inbox', inbox = () => JSON.parse(localStorage.getItem(NI) || '[]');
      const WL = { addListener: (n, cb) => { T.watchCb = cb; }, pending: async () => ({ events: inbox().map((e) => e.event) }),
        push: async (o) => { T.watch.push({ state: o.state, sent: Date.now() }); if (o.seen && o.seen.length) { const seen = new Set(o.seen); localStorage.setItem(NI, JSON.stringify(inbox().filter((e) => !seen.has(e.id)))); } return { sent: true }; } };
      // A press reaching the phone: always kept; the web app is only told there and then if `live` (it may be asleep, or the telling may be lost).
      window.__nativeGot = (json, live) => {
        let id = null; try { id = JSON.parse(json).id; } catch (e) {}
        if (typeof id === 'string' && id) { const q = inbox(); if (!q.some((e) => e.id === id)) { q.push({ id, event: json }); localStorage.setItem(NI, JSON.stringify(q)); } }
        if (live && T.watchCb) T.watchCb({ event: json });
      };
      const LN = { getPending: async () => ({ notifications: T.pending.slice() }), cancel: async () => { T.pending.length = 0; }, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
        schedule: async ({ notifications }) => { notifications.forEach((n) => { T.pending.push(n); T.notes.push({ title: n.title, body: n.body, at: +n.schedule.at }); }); } };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { WatchLink: WL, LocalNotifications: LN, Haptics: { impact: async () => {}, notification: async (o) => { T.haptics.push(o.type); } }, KeepAwake: { keepAwake: async () => {}, allowSleep: async () => {} } } };
    });
    if (android) await ctx.addInitScript((fb) => {
      const T = window.__t = { asked: [], haptics: [], push: { perm: 'prompt', calls: [], channels: [], on: {} } };
      const missing = (name) => new Proxy({}, { get: (o, k) => (k === 'then' ? undefined : (...a) => { T.asked.push(name + '.' + String(k)); return Promise.reject(new Error('"' + name + '" plugin is not implemented on android')); }) });
      const have = { Haptics: { impact: async () => {}, notification: async (o) => { T.haptics.push(o.type); } }, GafferAndroid: { pushReady: async () => ({ ready: fb }) } };
      const N = T.push; // Firebase's notifications, as the Capacitor plugin gives them to the web app
      if (fb) have.PushNotifications = {
        addListener: async (n, f) => { (N.on[n] = N.on[n] || []).push(f); return { remove() {} }; },
        checkPermissions: async () => { N.calls.push('check'); return { receive: N.perm }; },
        requestPermissions: async () => { N.calls.push('ask'); if (N.perm !== 'denied') N.perm = N.answer || 'granted'; return { receive: N.perm }; },
        register: async () => { N.calls.push('register'); setTimeout(() => (N.on.registration || []).forEach((f) => f({ value: 'fcm-' + 'x'.repeat(150) })), 10); },
        createChannel: async (c) => { N.channels.push(c); },
      };
      window.__tap = (data) => (N.on.pushNotificationActionPerformed || []).forEach((f) => f({ actionId: 'tap', notification: { data } }));
      // Capacitor's Android bridge: plugins it doesn't have still come back from registerPlugin, and fail only when used
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (n) => n in have, Plugins: new Proxy(have, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' ? missing(k) : undefined) }),
        registerPlugin: (n) => have[n] || missing(n) };
    }, firebase);
    if (db) {
      await ctx.addInitScript((url) => { window.__mockRemote = url; }, '/__db/' + id);
      const relay = (from, msg) => { for (const other of pages) if (other !== from && !frozen.has(other)) other.evaluate((m) => window.__rtRecv && !window.__offline && window.__rtRecv(m), msg).catch(() => {}); };
      await ctx.exposeBinding('__rtSend', (src, msg) => { if (held) held.push([src.page, msg]); else relay(src.page, msg); });
      release = () => { const q = held || []; held = null; q.forEach((x) => relay(x[0], x[1])); };
    }
    const page = await ctx.newPage(); pages.push(page);
    const errs = []; page.on('pageerror', (e) => errs.push(label + ': ' + (e.stack || e)));
    if (clock) await page.clock.install({ time: at });
    await page.goto(base);
    if (clock) { await page.clock.pauseAt(at + 1000); await page.clock.runFor(500); clocks.push(page.clock); }
    const P = {
      page, ctx, errs, label,
      /// Asleep in a pocket: the app stops running and misses live updates, while time carries on for everyone else. `thaw` wakes it.
      freeze: () => { const i = clocks.indexOf(page.clock); if (i >= 0) clocks.splice(i, 1); frozen.set(page, worldT); },
      thaw: async () => { const since = frozen.get(page); if (since === undefined) return; frozen.delete(page); await page.clock.fastForward(worldT - since); clocks.push(page.clock); await advance(300); },
      /// Live updates from other phones pass this one by (its connection has dropped, as it does while a phone sleeps).
      deaf: (on) => { if (on) { if (!frozen.has(page)) frozen.set(page, worldT); } else frozen.delete(page); },
      /// This phone is finished with.
      close: async () => { const i = clocks.indexOf(page.clock); if (i >= 0) clocks.splice(i, 1); const j = pages.indexOf(page); if (j >= 0) pages.splice(j, 1); await ctx.close().catch(() => {}); },
      /// Lets `ms` of time pass on this phone with the app running.
      run: async (ms) => { if (clock) await advance(ms); else await page.waitForTimeout(ms); },
      /// Lets time pass with the app frozen (phone asleep in a pocket), then wakes it.
      sleep: async (ms) => { await advance(ms, page.clock); await page.clock.fastForward(ms); await advance(300); },
      now: () => page.evaluate(() => Date.now()),
      click: async (sel) => { await page.click(sel); if (clock) await advance(300); },
      check: (sel) => page.check(sel),
      /// A tap that goes through even if the button is greyed out or covered.
      tap: async (sel) => { await page.evaluate((x) => document.querySelector(x).click(), sel); if (clock) await advance(300); },
      text: async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim(),
      visible: (sel) => page.isVisible(sel),
      view: () => page.evaluate(() => { const v = [...document.querySelectorAll('.view[id^="v-"]')].find((x) => !x.hidden); return v ? v.id.replace('v-', '') : ''; }),
      /// The open team as this phone has saved it.
      team: () => page.evaluate(() => { const a = JSON.parse(localStorage.getItem('apt-app')); return a.active ? JSON.parse(localStorage.getItem('apt-team-' + a.active)) : null; }),
      match: async () => ((await P.team()) || {}).match || null,
      db: async () => JSON.parse(dbs[id] || '{}'),
      /// No signal: database calls fail and live updates stop, until `online()`.
      offline: () => page.evaluate(() => { window.__offline = true; }), online: async () => { await page.evaluate(() => { window.__offline = false; window.dispatchEvent(new Event('online')); }); },
      /// What the watch was last told, and everything it has been told.
      watch: async () => { const all = await page.evaluate(() => window.__t.watch); return all.length ? JSON.parse(all[all.length - 1].state) : null; },
      watchLog: () => page.evaluate(() => window.__t.watch.map((x) => ({ sent: x.sent, state: JSON.parse(x.state) }))),
      watchTake: () => page.evaluate(() => window.__t.watch.splice(0)),
      /// A press arriving from the watch with the app awake. `kept: false` skips the phone's own store, as if only the live message got through.
      fromWatch: async (ev, { kept = true } = {}) => { await page.evaluate(([e, k]) => { const json = typeof e === 'string' ? e : JSON.stringify(e); if (k) window.__nativeGot(json, true); else window.__t.watchCb({ event: json }); }, [ev, kept]); if (clock) await advance(300); },
      /// A press reaching the phone while the app is asleep: kept by the phone, the web app not told.
      toInbox: (ev) => page.evaluate((e) => window.__nativeGot(typeof e === 'string' ? e : JSON.stringify(e), false), ev),
      inbox: () => page.evaluate(() => JSON.parse(localStorage.getItem('__native_inbox') || '[]').map((e) => e.id)),
      haptics: () => page.evaluate(() => window.__t.haptics.splice(0)),
      /// Makes a team with eight players in the app's no-account mode and returns to the home screen.
      localTeam: async (names = ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac', 'Reece', 'Ethan']) => {
        await P.click('#createBtn'); await page.fill('#tName', 'Sons of Pitches FC'); await page.fill('#tPlayers', names.join('\n')); await P.click('#tCreate'); await P.click('#v-code [data-go="home"]');
      },
      /// Sets a game up against `opp` and stops on the game screen, before kick-off.
      newGame: async (opp = 'Dog') => { await P.click('#mNew'); await page.fill('#opp', opp); await P.click('#startGame'); await P.click('#kick'); },
      signUp: async (email, user) => { await page.fill('#aEmail', email); await page.fill('#aPass', 'longpassword'); await page.fill('#aUser', user || email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) + '_fc'); await page.check('#aTerms'); await P.click('#aSignUp'); await P.click('#aSignIn'); await P.run(500); },
    };
    return P;
  };
  return { phone, base, db: () => JSON.parse(dbs[id] || '{}'), setDb: (d) => { dbs[id] = JSON.stringify(d); },
    /// Lets time pass on several phones together, a little at a time, so live updates reach each other.
    run: (ms) => advance(ms), holdLive: () => { held = held || []; }, releaseLive: () => release(),
    close: async () => { for (const c of made) await c.close().catch(() => {}); } };
}

/// Counts checks for one suite and prints only what fails.
export function suite(name) {
  let checks = 0, failed = 0;
  const check = (ok, what) => { checks++; if (!ok) { failed++; console.log(`FAIL [${name}]: ${what}`); } return !!ok; };
  const eq = (got, want, what) => check(JSON.stringify(got) === JSON.stringify(want), `${what} (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`);
  const done = async (...phones) => {
    for (const p of phones) for (const e of p.errs) check(false, 'page error: ' + e);
    console.log(failed ? `${name}: ${failed} of ${checks} checks FAILED` : `${name}: all ${checks} checks passed`);
    if (browser) { await browser.close(); browser = null; }
    if (server) { server.close(); server = null; }
    process.exitCode = failed ? 1 : 0;
  };
  return { check, eq, done };
}

export const mmss = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
