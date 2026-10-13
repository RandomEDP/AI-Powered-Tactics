// Game modes: 7-a-side, games with no half time, and tournaments with their own section in Stats.
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
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
const shot = async (n, full) => { if (out) { fs.mkdirSync(out, { recursive: true }); await A.waitForTimeout(400); await A.screenshot({ path: `${out}/${n}.png`, fullPage: !!full }); } };
const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push(String(e))); await A.goto(BASE); await wait(300);
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'K\nA\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nL'); await A.click('#tCreate'); await wait(400);
await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#meCard [data-me="pick"]'); await wait(300); await A.click('#joinList [data-pid="2"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await wait(600);

// --- a 7-a-side league game
await A.click('#mNew'); console.log('new game default:', await A.textContent('#gFmtNote'), '|', await A.textContent('#lineMsg'));
await A.click('#gFmt [data-side="7"]'); console.log('7-a-side:', await A.textContent('#gFmtNote'), '|', await A.textContent('#lineNote'), '|', await A.textContent('#lineMsg'));
await A.fill('#gHalf', '20'); await A.fill('#opp', 'Seven Up'); await shot('setup-7');
await A.click('#startGame'); await wait(300); console.log('minutes screen:', await view(A), '|', (await A.$$eval('#minsList .mrow, #minsList > *', (r) => r.length)), 'rows |', await A.textContent('#minsMsg'));
await A.click('#kick'); await wait(300);
let m = (await db(A)).live_matches[0]?.state || await A.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^apt-team-[A-Z0-9]+$/.test(k)))).match);
console.log('7-a-side match: pitch', m.pitch, '| half', m.half, '| periods', m.periods, '| on at kick-off', m.segs[0].on.length + 1, '| squad', m.squad.length, '| stretches', m.segs.length);
await A.click('#go'); await wait(300); await A.click('#finish'); await A.click('#finish'); await wait(1200);
await A.click('.view:not([hidden]) [data-go="home"]'); await wait(300);

// --- a tournament: one poll, several short games with no half time
await A.click('#tabs [data-tab="games"]'); await A.click('#gamesNew'); await A.click('#pKind [data-kind="tournament"]');
console.log('tournament form:', await A.textContent('#pOppLbl'), '|', await A.textContent('#pFmtNote'), '| half time ticked:', await A.isChecked('#pTwo'), '| squad slider', await A.getAttribute('#pMax', 'min') + '-' + await A.getAttribute('#pMax', 'max'));
await A.click('#pFmt [data-side="7"]'); console.log('7-a-side tournament slider:', await A.getAttribute('#pMax', 'min') + '-' + await A.getAttribute('#pMax', 'max'), '|', await A.textContent('#pMaxNote')); await A.click('#pFmt [data-side="5"]');
await A.fill('#pOpp', 'Summer 5s'); await A.fill('#pDate', '2026-10-17'); await A.fill('#pTime', '10:00'); await A.fill('#pLoc', 'Goals Dagenham'); await shot('poll-tournament', true); await A.click('#pSave'); await wait(800);
console.log('card:', (await A.textContent('#gamesTrack .fxc')).replace(/\s+/g, ' ').slice(0, 150));
await A.click('#gamesTrack [data-fx="answer"]'); for (const pid of [2, 3, 4, 5, 6, 7]) { await A.click(`#gamesTrack [data-for="${pid}"][data-vote="in"]`); await wait(300); } await A.click('#gamesTrack [data-for="1"][data-vote="gk"]'); await wait(300);
const play = async (opp, usGoals) => {
  await A.click('#gamesTrack [data-fx="start"]'); await wait(300);
  console.log(`  setup for ${opp}:`, await A.textContent('#tourLine'), '| opponent blank:', (await A.inputValue('#opp')) === '', '| friendly hidden:', !(await A.isVisible('#friendlyWrap')), '|', await A.textContent('#gFmtNote'));
  await A.fill('#opp', opp); await A.click('#startGame'); await wait(200); await A.click('#kick'); await A.click('#go'); await wait(300);
  for (let i = 0; i < usGoals; i++) { await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); if (i < usGoals - 1) await wait(8200); }
  console.log('  phase:', await A.textContent('#phase'), '| whistle button:', await A.textContent('#endHalf'));
  await A.click('#endHalf'); await A.click('#endHalf'); await wait(300); console.log('  after the whistle:', await A.textContent('#phase'));
  await A.click('#finish'); await A.click('#finish'); await wait(1200);
  await A.click('.view:not([hidden]) [data-go="home"]'); await wait(300); await A.click('#tabs [data-tab="games"]'); await wait(300);
};
await play('Dog', 1); await play('Cat', 2);
console.log('card after two games:', (await A.textContent('#gamesTrack .fxc')).replace(/\s+/g, ' ').match(/v Dog.*?(?=\d of)/)?.[0], '| buttons:', await A.$$eval('#gamesTrack .fxc [data-fx]', (x) => x.map((y) => y.textContent).slice(0, 3)));
await shot('tournament-card');
const d = await db(A); console.log('games in db:', JSON.stringify(d.games.map((g) => [g.opp, g.us + '-' + g.them, g.side, g.periods, g.tournament])), '| poll still open:', d.fixtures[0].status || 'open');
// --- stats: the season, and the tournament on its own
await A.click('#tabs [data-tab="home"]'); await A.click('#mStats'); await wait(300);
console.log('season:', await A.textContent('#record'), '| scopes:', await A.$$eval('#scopeRow button', (x) => x.map((y) => y.textContent)), '| results listed:', await A.$$eval('#results li', (x) => x.length), '| top scorer row:', await A.textContent('#season tr'));
await A.click('#scopeRow button:nth-child(2)'); await wait(200);
console.log('tournament:', await A.textContent('#record'), '| results listed:', await A.$$eval('#results li', (x) => x.map((y) => y.textContent.replace(/\s+/g, ' ').slice(0, 14))), '| players shown:', await A.$$eval('#season tr', (x) => x.length));
await shot('stats-tournament', true);
await A.click('#v-stats .back'); console.log('home record:', await A.textContent('#homeRecord'));
await A.click('#tabs [data-tab="games"]'); await A.click('#gamesTrack [data-fx="endtour"]'); await wait(800); console.log('after Finish tournament, games lined up:', await A.$$eval('#gamesTrack .fxc', (x) => x.length));
console.log('errors:', JSON.stringify(errs)); await b.close();
