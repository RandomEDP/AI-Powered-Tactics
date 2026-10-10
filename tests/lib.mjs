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
/// without it the app runs on its own, as it does with no account. `native: true` makes it think it is the iOS app.
export async function world() {
  await serve();
  const local = '/opt/pw-browsers/chromium';
  browser = browser || await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync(local) ? local : undefined) });
  const made = [], pages = [], clocks = [], id = 'w' + (++worlds);
  let held = null, release = () => {}; // live updates between phones can be held back for a moment, to make two things happen "at once"
  let worldT = T0 + 1500; // every phone in a world keeps the same time, as real phones do
  const advance = async (ms, skip) => { for (let left = ms; left > 0; left -= 250) for (const c of clocks) if (c !== skip) await c.runFor(Math.min(250, left)); worldT += ms; };
  const phone = async ({ db = false, native = false, clock = true, label = 'phone', storage = null } = {}) => {
    const at = worldT - 1500;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storage || undefined, serviceWorkers: 'block', timezoneId: 'Europe/London', locale: 'en-GB' });
    made.push(ctx);
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.includes('vendor/supabase.js')) return db ? r.fulfill({ contentType: 'application/javascript', body: MOCK }) : r.abort();
      return u.startsWith(base) ? r.continue() : r.abort();
    });
    await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
    if (native) await ctx.addInitScript(() => {
      const T = window.__t = { watch: [], haptics: [], notes: [], pending: [], watchCb: null };
      const WL = { push: async (o) => { T.watch.push({ state: o.state, sent: Date.now() }); return { sent: true }; }, addListener: (n, cb) => { T.watchCb = cb; } };
      const LN = { getPending: async () => ({ notifications: T.pending.slice() }), cancel: async () => { T.pending.length = 0; }, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
        schedule: async ({ notifications }) => { notifications.forEach((n) => { T.pending.push(n); T.notes.push({ title: n.title, body: n.body, at: +n.schedule.at }); }); } };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { WatchLink: WL, LocalNotifications: LN, Haptics: { impact: async () => {}, notification: async (o) => { T.haptics.push(o.type); } }, KeepAwake: { keepAwake: async () => {}, allowSleep: async () => {} } } };
    });
    if (db) {
      await ctx.addInitScript((url) => { window.__mockRemote = url; }, '/__db/' + id);
      const relay = (from, msg) => { for (const other of pages) if (other !== from) other.evaluate((m) => window.__rtRecv && !window.__offline && window.__rtRecv(m), msg).catch(() => {}); };
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
      /// This phone is finished with.
      close: async () => { const i = clocks.indexOf(page.clock); if (i >= 0) clocks.splice(i, 1); const j = pages.indexOf(page); if (j >= 0) pages.splice(j, 1); await ctx.close().catch(() => {}); },
      /// Lets `ms` of time pass on this phone with the app running.
      run: async (ms) => { if (clock) await advance(ms); else await page.waitForTimeout(ms); },
      /// Lets time pass with the app frozen (phone asleep in a pocket), then wakes it.
      sleep: async (ms) => { await advance(ms, page.clock); await page.clock.fastForward(ms); await advance(300); },
      now: () => page.evaluate(() => Date.now()),
      click: async (sel) => { await page.click(sel); if (clock) await advance(300); },
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
      /// A press arriving from the watch.
      fromWatch: async (ev) => { await page.evaluate((e) => window.__t.watchCb({ event: typeof e === 'string' ? e : JSON.stringify(e) }), ev); if (clock) await advance(300); },
      haptics: () => page.evaluate(() => window.__t.haptics.splice(0)),
      /// Makes a team with eight players in the app's no-account mode and returns to the home screen.
      localTeam: async (names = ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac', 'Reece', 'Ethan']) => {
        await P.click('#createBtn'); await page.fill('#tName', 'Sons of Pitches FC'); await page.fill('#tPlayers', names.join('\n')); await P.click('#tCreate'); await P.click('#v-code [data-go="home"]');
      },
      /// Sets a game up against `opp` and stops on the game screen, before kick-off.
      newGame: async (opp = 'Dog') => { await P.click('#mNew'); await page.fill('#opp', opp); await P.click('#startGame'); await P.click('#kick'); },
      signUp: async (email) => { await page.fill('#aEmail', email); await page.fill('#aPass', 'longpassword'); await P.click('#aSignUp'); await P.click('#aSignIn'); await P.run(500); },
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
