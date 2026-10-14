import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 400, height: 900 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); }); // skip the first-launch intro
await ctx.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK });
  if (u.startsWith(BASE)) return r.continue();
  return r.abort();
});
const errs = [];
const open = async (label) => { const p = await ctx.newPage();  p.on('pageerror', (e) => errs.push(label + ': ' + e)); await p.goto(BASE); await p.waitForTimeout(300); return p; };
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
const vis = (p, s) => p.isVisible(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- organiser A: sign up, sign in, create a team
const A = await open('A');
console.log('A welcome:', await vis(A, '#v-welcome'), '|', await A.textContent('#acctLine'));
await A.click('#createBtn'); console.log('create while signed out goes to:', await A.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.hidden).id));
await A.fill('#aEmail', 'ethan@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'ethan_fc'); await A.check('#aTerms'); await A.click('#aSignUp'); await wait(100); console.log('sign up:', await A.textContent('#aMsg'));
await A.click('#aSignIn'); await wait(300); console.log('after sign in view:', await A.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.hidden).id));
await A.fill('#tName', 'Sunday Strikers'); await A.fill('#tPlayers', 'Keeper\nAce\nBen\nCal\nDan\nEd\nFin\nGus'); await A.click('#tCreate'); await wait(400);
const code = await A.textContent('#codeBig'); console.log('created code:', code, '| db teams:', (await db(A)).teams.length, 'players:', (await db(A)).players.length);
await A.click('#v-code [data-go="home"]'); await wait(200);
console.log('A home:', await A.textContent('#heroName'), '| sync:', await A.textContent('#sync'));

// --- a game: line-up, slider, kick-off, goal, highlight, finish
await A.click('#mNew'); await A.fill('#opp', 'Dog'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go');
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p="x"]'); await A.click('#hlBtn'); await A.click('#picker [data-p="x"]');
await wait(900); console.log('live in db during game:', !!(await db(A)).live_matches.length, '| events:', (await db(A)).live_matches[0]?.state.events.length);

// --- follower B (new device): follows by code and sees the live game
const B = await open('B');
await B.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('apt-')).forEach((k) => localStorage.removeItem(k)); }); await B.reload(); await wait(300);
await B.fill('#joinCode', code.toLowerCase()); await B.click('#joinBtn'); await wait(400); await B.click('#jFollow'); await wait(400);
console.log('B joined:', await B.textContent('#heroName'), '| watch btn:', await B.textContent('#mResumeLbl'), '| new game hidden:', !(await vis(B, '#mNew')), '| options hidden:', !(await vis(B, '#mOptions')));
await B.click('#mResume'); await wait(200);
console.log('B game score:', await B.textContent('#usN'), '-', await B.textContent('#themN'), '| clock controls hidden:', !(await vis(B, '#go')), '| goal button hidden:', !(await vis(B, '#goalUs')));

// --- A scores again; B updates live via broadcast
await A.click('#goalThem'); await wait(1200);
console.log('B after A logs goal against:', await B.textContent('#usN'), '-', await B.textContent('#themN'));
console.log('B lock notice:', await B.textContent('#goalMsg'), '| A buttons locked:', await A.isDisabled('#goalUs'), await A.isDisabled('#goalThem'));

// --- A lets followers log goals; B logs one; A folds it in
await A.click('#v-game .back'); await A.click('#mOptions'); await A.check('#oScore'); await wait(1200);
console.log('A organiser code shown:', await A.textContent('#orgCode'));
await B.waitForTimeout(500); await B.reload(); await wait(500); if (await vis(B, '#v-options')) { await B.click('#v-options .back'); await wait(200); } if (await vis(B, '#mResume')) { await B.click('#mResume'); await wait(200); } // both test phones share one browser's storage
console.log('B role after setting:', await B.evaluate(() => document.body.className), '| goal btn visible:', await vis(B, '#goalUs'));
await wait(7200); console.log('unlocked after 8s:', !(await B.isDisabled('#goalUs')));
await B.click('#goalUs'); await B.click('#picker button[data-p]'); await B.click('#picker button[data-p="x"]'); await wait(1500);
// a second follower goal inside the 10 seconds is the same goal logged twice, and is dropped
await B.reload(); await wait(500); if (await vis(B, '#v-options')) { await B.click('#v-options .back'); await wait(200); } if (await vis(B, '#mResume')) { await B.click('#mResume'); await wait(200); } await B.click('#goalUs'); await B.click('#picker button[data-p]'); await B.click('#picker button[data-p="x"]'); await wait(1500); // a reloaded phone has lost the lock, like a second follower tapping at the same moment
console.log('B message:', await B.textContent('#goalMsg'));
await A.click('#v-options .back'); await A.click('#mResume'); await wait(300);
console.log('A score after follower goal:', await A.textContent('#usN'), '-', await A.textContent('#themN'), '| tag:', (await A.textContent('#events')).includes('teammate'), '| queue empty:', (await db(A)).goal_queue.length === 0);

// --- finish; stats land in the database; B sees them
await A.click('#finish'); await A.click('#finish'); await wait(1500);
const d1 = await db(A);
console.log('db after finish: games', d1.games.length, '| game_players', d1.game_players.length, '| events', d1.game_events.length, '| live rows', d1.live_matches.length);
await wait(800); await B.click('#v-game .back').catch(() => {}); await B.goto(BASE); await wait(500); await B.click('#mStats').catch(() => {}); await wait(200);
console.log('B stats:', await B.textContent('#record'));

// --- organiser C joins with the organiser code
const orgCode = d1.teams[0].organiser_code;
const C = await open('C');
await C.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('apt-')).forEach((k) => localStorage.removeItem(k)); }); await C.reload(); await wait(300);
await C.click('#acctNew'); await C.fill('#aEmail', 'co@example.com'); await C.fill('#aPass', 'anotherpassword'); await C.fill('#aUser', 'co_fc'); await C.check('#aTerms'); await C.click('#aSignUp'); await C.click('#aSignIn'); await wait(300);
await C.click('#acctBtn'); await C.fill('#aOrgCode', orgCode.toLowerCase()); await C.click('#aOrgJoin'); await wait(500);
console.log('C after organiser code:', await C.textContent('#heroName'), '| role:', await C.evaluate(() => document.body.className || 'owner'), '| new game visible:', await vis(C, '#mNew'));
await C.click('#mStats'); console.log('C stats:', await C.textContent('#record'));

// --- A reloads: everything comes back from the database
await A.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('apt-team')).forEach((k) => localStorage.removeItem(k)); }); await A.goto(BASE); await wait(600);
console.log('A after wiping its copy and reloading:', await A.textContent('#heroName'), '|', await A.textContent('#homeRecord'));
await A.click('#mStats'); await wait(100); console.log('A stats rows:', (await A.$$eval('#season tr', (r) => r.slice(0, 3).map((x) => x.textContent))).join(' / '));
await A.click('#results button[data-reel]'); await wait(300);
console.log('a result\'s Highlights:', await A.evaluate(() => [...document.querySelectorAll('.view[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join()), '| that game picked out:', await A.$$eval('#hlList .hcard.focus h3', (h) => h.map((x) => x.textContent)));
{ const d0 = await db(A); console.log('stored for chemistry:', JSON.stringify(d0.games[0].lineups).slice(0, 90), '|', JSON.stringify(d0.game_events.filter((e) => e.kind !== 'highlight').map((e) => e.kind + ':' + (e.on_pitch || []).length))); }
await A.click('#v-highlights .back'); await wait(200); await A.click('#mInsights'); await wait(300); console.log('insights:', (await A.textContent('#insBody')).replace(/\s+/g, ' ').slice(0, 420)); await A.click('#v-insights .back'); await wait(200); await A.click('#mStats');
console.log('on-pitch goals in db:', JSON.stringify((await db(A)).game_players.map((p) => p.pid + ':' + p.scored_on + '/' + p.conceded)), '| stats header:', (await A.textContent('#v-stats thead')).replace(/\s+/g, ' '));
console.log('errors:', JSON.stringify(errs));
await b.close();
