// Player accounts: join by code, claim a player, gaffer badge, locked buttons, highlights screen.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const errs = [];
const open = async (label, fresh) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(label + ': ' + e)); await p.goto(BASE); if (fresh) { await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('apt-')).forEach((k) => localStorage.removeItem(k))); await p.reload(); } await p.waitForTimeout(300); return p; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
const out = process.argv[2];
const shot = async (p, name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); } };

// gaffer creates the team and plays a game
const A = await open('A');
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await wait(400);
const code = await A.textContent('#codeBig'); await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#mNew'); await A.fill('#opp', 'Dog & Bone'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go');
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="8"]'); await A.click('#svBtn'); await A.click('#finish'); await A.click('#finish'); await wait(1500);
await A.click('#v-stats .back'); await wait(200);
console.log('gaffer home card:', (await A.textContent('#meCard')).trim().slice(0, 60));
await A.click('#meCard [data-me="pick"]'); await wait(400); console.log('gaffer picker view:', await view(A));
await A.click('#joinList [data-pid="8"]'); await A.fill('#jLast', 'Davison-Pearce'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await wait(600);
console.log('gaffer claimed:', await view(A), '|', (await A.textContent('#meCard')).replace(/\s+/g, ' ').slice(0, 90), '| squad row:', (await A.textContent('#squadList .prow:nth-child(8)')).replace(/\s+/g, ' '));
await shot(A, 'home-gaffer');

// a player on a new phone joins with the code
const D = await open('D', true);
console.log('player starts at:', await view(D));
await D.fill('#joinCode', 'zzzzzz'); await D.click('#joinBtn'); await wait(300); console.log('wrong code:', await D.textContent('#joinMsg'));
await D.fill('#joinCode', code); await D.click('#joinBtn'); await wait(400);
console.log('picker:', await view(D), '|', await D.textContent('#jName'), '| rows:', (await D.$$eval('#joinList .jhead', (r) => r.map((x) => x.textContent + (x.disabled ? ' [disabled]' : '')))).join(' / '));
await D.click('#joinList [data-pid="2"]'); await wait(100);
console.log('expanded stats:', (await D.textContent('#joinList .statgrid')).replace(/\s+/g, ' '));
await shot(D, 'join');
await D.fill('#jLast', 'Smith'); await D.fill('#jEmail', 'jake@example.com'); await D.fill('#jPass', 'short'); await D.click('#joinList [data-do="up"]'); console.log('short password:', await D.textContent('#jMsg'));
await D.fill('#jPass', 'longenough1'); await D.fill('#jUser', 'jake_s'); await D.click('#joinList [data-do="up"]'); console.log('no position:', await D.textContent('#jMsg')); await D.click('#joinList [data-pos="def"]'); await D.click('#joinList [data-do="up"]'); await wait(600);
console.log('after sign-up:', await view(D), '| pending card:', await D.isVisible('#pendCard'), await D.textContent('#pendTitle'));
await D.click('#pendCard [data-go="account"]'); await D.fill('#aEmail', 'jake@example.com'); await D.fill('#aPass', 'longenough1'); await D.click('#aSignIn'); await wait(800);
console.log('after confirming and signing in:', await view(D), '|', (await D.textContent('#meCard')).replace(/\s+/g, ' ').slice(0, 80));
console.log('squad:', (await D.$$eval('#squadList .prow', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')))).join(' / '));
console.log('new game class:', await D.getAttribute('#mNew', 'class'), '| settings tab class:', await D.getAttribute('#mOptions', 'class'));
await D.click('#mNew', { force: true }); console.log('tap New game:', await D.textContent('#lockMsg'), '| still on:', await view(D));
await D.click('#mOptions'); await wait(200); console.log('Settings for a player:', await view(D), '| team settings hidden:', !(await D.isVisible('#optGaffer')), '| experimental shown:', await D.isVisible('#expTrack'), '|', await D.textContent('#optViewer')); await D.click('#v-options .back'); await wait(200);
await shot(D, 'home-player');
await D.click('#mHighlights'); await wait(200); console.log('highlights by game:', (await D.textContent('#hlList')).replace(/\s+/g, ' ').slice(0, 170));
await shot(D, 'highlights-game');
await D.click('#hlToggle [data-by="player"]'); console.log('by player, first card:', (await D.textContent('#hlList .hcard')).replace(/\s+/g, ' ').slice(0, 130));
await shot(D, 'highlights-player');
// gaffer sees the claim; third person sees Jake as taken
await D.click('#v-highlights .back'); // pages in this test share one browser profile, so leave it on the home screen
await A.reload(); await wait(700); console.log('gaffer sees squad:', (await A.$$eval('#squadList .prow', (r) => r.slice(0, 2).map((x) => x.textContent.replace(/\s+/g, ' ')))).join(' / '));
await A.click('#mHighlights'); await wait(200); console.log('gaffer: the old computer-script button is gone:', !(await A.isVisible('#hlList [data-reel]')));
// same account on another device gets its teams back
const E = await open('E', true);
await E.click('#acctBtn'); await E.fill('#aEmail', 'jake@example.com'); await E.fill('#aPass', 'longenough1'); await E.click('#aSignIn'); await wait(700);
console.log('new device, teams listed:', (await E.textContent('#myTeams')).replace(/\s+/g, ' '));
await E.click('#myTeams button'); await wait(600); console.log('opens with stats:', (await E.textContent('#meCard')).replace(/\s+/g, ' ').slice(0, 40));
console.log('errors:', JSON.stringify(errs)); await b.close();
