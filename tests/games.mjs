// Several games lined up at once: the Games screen, swiping between polls, and the bar along the bottom.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const errs = [], wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = process.argv[2];
const view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push(String(e))); await A.goto(BASE); await wait(300);
console.log('bar before a team is open:', await A.isVisible('#tabs'));
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.check('#aTerms'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await wait(400);
await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#meCard [data-me="pick"]'); await wait(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await wait(600);
// shirt numbers, set in Settings, replace the initials on the line-up map
await A.click('#mOptions'); await A.fill('#squad [data-shirt="8"]', '9'); await A.fill('#squad [data-shirt="1"]', '13'); await wait(1200); await A.click('#tabs [data-tab="home"]'); await wait(200);
console.log('shirt numbers in db:', JSON.stringify((await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).players.filter((p) => p.shirt_number != null).map((p) => p.name + ' ' + p.shirt_number)))));
console.log('bar on home:', await A.isVisible('#tabs'), '|', (await A.$$eval('#tabs .tabrow button:not([hidden])', (b) => b.map((x) => x.textContent).join(' '))).replace(/\s+/g, ' ').trim()); // (only the tabs that show)
await A.click('#tabs [data-tab="games"]'); await wait(300); console.log('games, empty:', await view(A), '|', await A.textContent('#gamesEmpty'));
for (const [opp, date] of [['Athletico Pathetico', '2026-10-13'], ['Borussia Teeth', '2026-10-20'], ['Inter Row Z', '2026-10-27']]) {
  await A.click('#gamesNew'); await A.fill('#pOpp', opp); await A.fill('#pDate', date); await A.fill('#pTime', '19:30'); await A.click('#pSave'); await wait(700);
}
console.log('after three polls:', await view(A), '| cards:', await A.$$eval('#gamesTrack .fxc h2', (h) => h.map((x) => x.textContent)), '|', await A.textContent('#gamesCount'), '| badge:', await A.textContent('#tabBadge'));
// answer the second game from its own card
await A.click('#gamesTrack .fxc:nth-child(2) [data-vote="in"]'); await wait(600); await A.click('#askNo', { timeout: 2000 }).catch(() => {});
console.log('dot label on the map:', await A.textContent('#gamesTrack .fxc:nth-child(2) .dot i'));
console.log('second card after "I\'m in":', (await A.textContent('#gamesTrack .fxc:nth-child(2)')).match(/\d of \d outfield/)[0], '| first card:', (await A.textContent('#gamesTrack .fxc:nth-child(1)')).match(/\d of \d outfield/)[0], '| still showing', await A.textContent('#gamesCount'), '| badge:', await A.textContent('#tabBadge'));
if (out) { fs.mkdirSync(out, { recursive: true }); await A.screenshot({ path: `${out}/games.png` }); }
const votes = await A.evaluate(() => { const d = JSON.parse(localStorage.getItem('__mockdb')); return d.fixture_votes.map((v) => d.fixtures.find((f) => f.id === v.fixture_id).opp + ':' + v.choice); });
console.log('votes in db:', JSON.stringify(votes));
await A.click('#tabs [data-tab="home"]'); await wait(300); console.log('home card:', (await A.textContent('#fxCard')).replace(/\s+/g, ' '));
if (out) await A.screenshot({ path: `${out}/home-tabs.png` });
await A.click('#fxCard [data-fx="all"]'); await wait(200); console.log('see all ->', await view(A));
await A.click('#tabs [data-tab="home"]'); await A.click('#mOptions'); await wait(200); console.log('settings tab ->', await view(A), '| bar still shown:', await A.isVisible('#tabs'));
await A.click('#tabs [data-tab="home"]'); await A.click('#mStats'); await wait(200); console.log('bar on stats:', await A.isVisible('#tabs'));
console.log('errors:', JSON.stringify(errs)); await b.close();
