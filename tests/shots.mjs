// Walks every screen and saves screenshots, for checking the design by eye.
// Usage: node shots.mjs <output dir> [light|dark]
import { chromium } from './pinned.mjs';
import fs from 'fs';
const out = process.argv[2] || 'shots', scheme = process.argv[3] || 'light';
fs.mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(BASE) && !u.includes('vendor/supabase.js') ? r.continue() : r.abort(); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
let n = 0; const shot = async (name, full) => { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: !!full }); };
await p.goto(BASE); await p.waitForTimeout(500);
console.log('first screen:', await p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join()));
for (let i = 0; i < 5; i++) {
  await shot('intro-' + i);
  if (i === 4) { await p.evaluate(() => { const a = document.querySelectorAll('.ipage')[4]; a.scrollTop = a.scrollHeight; }); await shot('intro-4-scrolled'); }
  console.log(' page', i, '| button:', await p.textContent('#introNext'), '| skip shown:', await p.evaluate(() => document.getElementById('introSkip').style.visibility !== 'hidden'), '| overflow-x:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await p.click('#introNext'); await p.waitForTimeout(600);
}
console.log('after Get started:', await p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join()), '| seen saved:', await p.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).introSeen));
console.log('plans pop-up after the intro:', await p.isVisible('#planPop'), '| coming-soon pill:', await p.isVisible('#soonPill'));
await shot('welcome', true);
await p.reload(); await p.waitForTimeout(400); console.log('after reload:', await p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join()));
await p.click('#introOpen'); await p.waitForTimeout(300); console.log('how it works opens:', await p.isVisible('#v-intro')); await p.click('#introSkip');
await p.click('#createBtn'); await p.fill('#tName', 'Sons of Pitches FC'); await p.fill('#tShort', 'SOP FC'); await p.click('#tColors button[data-c="#4c2bb0"]');
await p.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await shot('create', true);
await p.click('#tCreate'); await shot('code'); await p.click('#v-code [data-go="home"]'); await shot('home');
// seed a couple of results so stats and the slider have something to show
await p.evaluate(() => { const k = 'apt-team-' + JSON.parse(localStorage.getItem('apt-app')).active; const s = JSON.parse(localStorage.getItem(k)); const ko = Date.now() - 7 * 864e5;
  s.results = [{ id: 'a', opp: 'Dog & Bone', us: 5, them: 2, koAt: ko, at: ko + 2e6, half: 15, ev: [{ us: true, p: 2, a: 4, min: 3, at: ko + 150000 }], per: { 1: { mins: 30, g: 0, a: 0 }, 2: { mins: 20, g: 3, a: 1 }, 3: { mins: 15, g: 0, a: 1 }, 4: { mins: 20, g: 1, a: 2 }, 5: { mins: 15, g: 0, a: 0 }, 6: { mins: 20, g: 1, a: 0 }, 7: { mins: 15, g: 0, a: 0 }, 8: { mins: 15, g: 0, a: 1 } } },
    { id: 'b', opp: 'Real Sociable', us: 1, them: 3, friendly: true, per: { 1: { mins: 30, g: 0, a: 0 }, 2: { mins: 15, g: 1, a: 0 } } }];
  localStorage.setItem(k, JSON.stringify(s)); });
await p.reload(); await p.waitForTimeout(400); await shot('home-record');
await p.click('#mNew'); await p.fill('#opp', 'Athletico Pathetico'); await shot('lineup', true);
await p.click('#startGame'); await p.$eval('#tactic', (el) => { el.value = 35; el.dispatchEvent(new Event('input', { bubbles: true })); }); await shot('minutes', true);
await p.click('#kick'); await p.click('#go');
await p.evaluate(() => { const k = 'apt-team-' + JSON.parse(localStorage.getItem('apt-app')).active; const s = JSON.parse(localStorage.getItem(k)); s.match.t0 -= 252000; localStorage.setItem(k, JSON.stringify(s)); });
await p.reload(); await p.waitForTimeout(500);
await p.click('#goalUs'); await p.waitForTimeout(350); console.log('scorer pop-up order:', (await p.$$eval('#picker .pick', (x) => x.map((y) => y.textContent))).join(' | ')); await shot('pick-scorer', false); await p.click('#picker button[data-p]'); await p.click('#picker button[data-p="x"]'); await p.click('#goalThem'); await p.click('#svBtn');
await shot('game'); await shot('game-full', true);
await p.click('#swapBody button[data-q="on"]'); await shot('game-swap-popup'); await p.click('#quickSwap button[data-cancel]');
await p.click('#outBtn'); await shot('game-out-popup'); await p.click('#outPicker button[data-cancel]');
await p.click('#v-game .back'); await p.click('#mStats'); await shot('stats', true);
await p.click('#results button[data-reel]'); await shot('highlights', true);
await p.click('#v-reel .back'); await p.click('#v-stats .back'); await p.click('#mOptions'); await shot('options', true);
await p.click('#v-options .back'); await p.click('#mSwitch'); await shot('welcome-teams', true);
await p.click('#acctBtn'); await shot('account');
console.log('errors:', JSON.stringify(errs)); await b.close();
