// A change waits for the gaffer: when it comes due a pop-up asks, the line-up stays put until "Subs done", and a goal can be logged in between.
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(BASE) && !u.includes('vendor/supabase.js') ? r.continue() : r.abort(); });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await ctx.addInitScript(() => { window.__w = []; window.Capacitor = { isNativePlatform: () => true, Plugins: { WatchLink: { addListener: (n, cb) => { window.__wcb = cb; }, push: async (o) => { window.__w.push(o.state); return { sent: true }; } } } }; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
const wait = (ms) => p.waitForTimeout(ms), pitch = async () => (await p.textContent('#pitchNow')).replace(/\s+/g, ' ').trim(), watch = async () => JSON.parse((await p.evaluate(() => window.__w)).pop());
const shift = async (sec) => { await p.evaluate((sec) => { const k = 'apt-team-' + JSON.parse(localStorage.getItem('apt-app')).active; const s = JSON.parse(localStorage.getItem(k)); s.match.t0 -= sec * 1000; localStorage.setItem(k, JSON.stringify(s)); }, sec); await p.reload(); await wait(900); };
await p.goto(BASE); await wait(300);
await p.click('#createBtn'); await p.fill('#tName', 'Sons of Pitches FC'); await p.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await p.click('#tCreate'); await p.click('#v-code [data-go="home"]');
await p.click('#mNew'); await p.fill('#opp', 'Dog'); await p.click('#startGame'); await p.click('#kick'); await p.click('#go'); await wait(400);
const before = await pitch(); console.log('at kick-off:', before, '|', await p.textContent('#swapTitle'), '| pop-up:', await p.isVisible('#subPop'));
await shift(303);
console.log('5:03 in: pop-up', await p.isVisible('#subPop'), '|', (await p.textContent('#subPopBody')).replace(/\s+/g, ' ').trim(), '| line-up unchanged:', (await pitch()) === before, '|', await p.textContent('#swapTitle'), '|', await p.textContent('#countLabel'), '| watch told:', (await watch()).due);
if (out) { fs.mkdirSync(out, { recursive: true }); await p.screenshot({ path: `${out}/sub-pop.png` }); }
await p.click('#subPopLater'); await wait(200); console.log('closed with the x: pop-up', await p.isVisible('#subPop'), '| card button:', await p.isVisible('#subsDoneBtn'));
await p.click('#goalUs'); await wait(300); const offered = await p.$$eval('#picker .pick', (x) => x.map((y) => y.textContent)); await p.click('#picker button[data-p]'); await p.click('#picker button[data-p="x"]'); await wait(300);
const ev = await p.evaluate(() => { const k = 'apt-team-' + JSON.parse(localStorage.getItem('apt-app')).active; const m = JSON.parse(localStorage.getItem(k)).match; return { on: m.events[0].on, ok: m.ok }; });
console.log('goal logged while the change waits: score', await p.textContent('#usN'), '| picker still offers the old line-up first:', offered.slice(0, 4).join(','), '| on the pitch for it:', ev.on.length, 'players | confirmed block:', ev.ok);
await p.click('#subsDoneBtn'); await wait(300);
console.log('subs done:', await pitch(), '| changed:', (await pitch()) !== before, '|', await p.textContent('#swapTitle'), '| watch told due:', (await watch()).due);
await shift(300); console.log('next one due at 10:00: pop-up', await p.isVisible('#subPop'));
await p.evaluate(() => window.__wcb({ event: JSON.stringify({ type: 'subs', id: 'w1' }) })); await wait(300);
console.log('"Subs done" from the watch: pop-up', await p.isVisible('#subPop'), '|', await p.textContent('#swapTitle'));
console.log('errors:', JSON.stringify(errs)); await b.close();
