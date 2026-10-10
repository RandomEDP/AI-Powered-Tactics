// The "why notifications" screen before iOS asks, and a notification to the team for each goal.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await ctx.addInitScript(() => { window.__p = []; let perm = 'prompt'; const L = {};
  window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: { addListener: (n, cb) => { L[n] = cb; }, checkPermissions: async () => ({ receive: perm }),
    requestPermissions: async () => { window.__p.push('ios asked'); perm = 'granted'; return { receive: perm }; }, register: async () => { window.__p.push('register'); L.registration({ value: 'a'.repeat(64) }); } } } }; });
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const A = await ctx.newPage(); const errs = []; A.on('pageerror', (e) => errs.push(String(e))); const wait = (ms) => A.waitForTimeout(ms);
await A.goto(BASE); await wait(300);
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac'); await A.click('#tCreate'); await wait(700);
console.log('explainer shown:', await A.isVisible('#pushPop'), '| iOS asked yet:', JSON.stringify(await A.evaluate(() => window.__p)), '|', (await A.textContent('#pushPop .tier')).replace(/\s+/g, ' ').trim().slice(0, 90));
if (out) { fs.mkdirSync(out, { recursive: true }); await A.screenshot({ path: `${out}/push-why.png` }); }
await A.click('#pushNo'); await A.reload(); await wait(800); console.log('after "Not now" and a relaunch: shown again', await A.isVisible('#pushPop'));
await A.evaluate(() => localStorage.setItem('apt-push-asked', String(Date.now() - 8 * 86400000))); await A.reload(); await wait(800);
console.log('a week later: shown', await A.isVisible('#pushPop')); await A.click('#pushYes'); await wait(400);
console.log('after "Turn on":', JSON.stringify(await A.evaluate(() => window.__p)), '| saved to the database:', (await A.evaluate(() => window.__mockCalls)).includes('rpc:register_push'), '| pop-up gone:', !(await A.isVisible('#pushPop')));
await A.reload(); await wait(800); console.log('next launch: shown', await A.isVisible('#pushPop'));
if (await A.isVisible('#v-code [data-go="home"]')) await A.click('#v-code [data-go="home"]');
await A.click('#tabs [data-tab="home"]').catch(() => {}); await A.click('#mNew'); await A.fill('#opp', 'Dog'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go'); await wait(500);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p]:not([data-p="x"])'); await wait(600);
console.log('goal notification:', JSON.stringify((await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).calls)).filter((c) => c.body.kind === 'goal').map((c) => [c.body.title, c.body.body])));
console.log('errors:', JSON.stringify(errs)); await b.close();
