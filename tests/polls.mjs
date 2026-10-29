// Game polls: create, answer, caps (one keeper, limited outfield), line-up map, start a game from the poll.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const mk = async () => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
  return ctx; };
const errs = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2]; const shot = async (p, name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); } };
const view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
const G = async (p) => { if (!(await p.isVisible('#v-games'))) { await p.click('#tabs [data-tab="games"]'); await p.waitForTimeout(300); } };
const fx = async (p) => (await p.textContent((await p.isVisible('#v-games')) ? '#gamesTrack .fxc' : '#fxCard')).replace(/\s+/g, ' ');

const ctx = await mk(); const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push('A: ' + e)); await A.goto(BASE); await wait(300);
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.check('#aTerms'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]');
await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan\nAli\nAdrian\nMark'); await A.click('#tCreate'); await wait(400);
const code = await A.textContent('#codeBig'); await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#meCard [data-me="pick"]'); await wait(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await wait(600);
console.log('no poll yet:', await fx(A));
await A.click('#fxCard [data-fx="new"]'); console.log('form:', await view(A), '| default squad size:', await A.inputValue('#pMax'));
await A.click('#pSave'); console.log('empty opponent:', await A.textContent('#pMsg'));
await A.fill('#pOpp', 'Athletico Pathetico'); await A.fill('#pDate', '2026-10-13'); await A.fill('#pTime', '19:30'); await A.fill('#pLoc', 'Powerleague Romford, pitch 4'); await A.fill('#pCost', '£5 each');
await shot(A, 'poll-form'); await A.click('#pSave'); await wait(700);
console.log('created:', await view(A), '|', (await fx(A)).slice(0, 150));
// gaffer answers for himself, then for others, to test the caps
await A.click('#gamesTrack .fxc [data-vote="in"]'); await wait(500); await A.click('#askNo', { timeout: 2000 }).catch(() => {});
await A.click('#gamesTrack .fxc [data-fx="answer"]');
for (const pid of [2, 3, 4, 5, 6, 7]) { await A.click(`#gamesTrack .fxc [data-for="${pid}"][data-vote="in"]`); await wait(350); }
console.log('7 outfield in:', (await fx(A)).match(/\d+ of \d+ outfield[^,]*/)[0]);
await A.click('#gamesTrack .fxc [data-for="9"][data-vote="in"]'); await wait(400); console.log('8th outfield:', await A.textContent('#gamesTrack .fxc .msg').catch(() => 'no message'));
await A.click('#gamesTrack .fxc [data-for="1"][data-vote="gk"]'); await wait(400);
await A.click('#gamesTrack .fxc [data-for="10"][data-vote="gk"]'); await wait(400); console.log('second keeper:', await A.textContent('#gamesTrack .fxc .msg').catch(() => 'no message'));
await A.click('#gamesTrack .fxc [data-for="11"][data-vote="no"]'); await wait(400);
await A.click('#gamesTrack .fxc [data-fx="answer"]'); await wait(200);
console.log('card:', (await fx(A)).slice(0, 330));
console.log('dots on pitch:', (await A.$$eval('#gamesTrack .pitchmap .dot', (d) => d.map((x) => x.textContent + '@' + x.style.left + ',' + x.style.top))).join(' '));
await shot(A, 'home-poll-gaffer');
// drag Ethan, then tap Jake to bench him
const dot = await A.$('#gamesTrack .pitchmap [data-dot="8"]'); await dot.scrollIntoViewIfNeeded(); const bb = await dot.boundingBox(); await A.mouse.move(bb.x + 20, bb.y + 20); await A.mouse.down(); await A.mouse.move(bb.x + 90, bb.y + 60, { steps: 5 }); await A.mouse.up(); await wait(400);
console.log('after drag, saved lineup:', JSON.stringify(await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).fixtures[0].lineup)));
const benchBefore = (await fx(A)).match(/Bench(.*?)(Can|No answer|Start)/)[1];
await A.click('#gamesTrack .pitchmap [data-dot="2"]'); await wait(400); console.log('bench before:', benchBefore.trim(), '| after tapping Jake:', (await fx(A)).match(/Bench(.*?)(Can|No answer|Start)/)[1].trim());

// a player on his own phone
const ctx2 = await mk(); const D = await ctx2.newPage(); D.on('pageerror', (e) => errs.push('D: ' + e));
await D.addInitScript((db) => { if (!localStorage.getItem('__mockdb')) localStorage.setItem('__mockdb', db); }, await A.evaluate(() => localStorage.getItem('__mockdb')));
await D.goto(BASE); await wait(300); await D.fill('#joinCode', code); await D.click('#joinBtn'); await wait(400);
await D.click('#joinList [data-pid="9"]'); await D.fill('#jLast', 'Khan'); await D.click('#joinList [data-pos="mix"]'); await D.fill('#jEmail', 'ali@example.com'); await D.fill('#jUser', 'ali_k'); await D.fill('#jPass', 'longenough1'); await D.check('#jTerms'); await D.click('#joinList [data-do="up"]'); await wait(500);
await D.click('#pendCard [data-go="account"]'); await D.fill('#aEmail', 'ali@example.com'); await D.fill('#aPass', 'longenough1'); await D.click('#aSignIn'); await wait(800);
console.log('player sees on home:', (await fx(D)).slice(0, 160)); await shot(D, 'home-compact'); await D.click('#fxCard [data-fx="all"]'); await wait(300); console.log('button ->', await view(D));
console.log('player buttons: full, so', JSON.stringify(await D.textContent('#gamesTrack .fxc [data-vote="wait"]')), '| no I\'m in', !(await D.isVisible('#gamesTrack .fxc [data-vote="in"]')), '| gk disabled', await D.isDisabled('#gamesTrack .fxc [data-vote="gk"]'), '| gaffer tools:', await D.isVisible('#gamesTrack .fxc [data-fx="start"]').catch(() => false));
await D.click('#gamesTrack .fxc [data-vote="no"]'); await wait(500); console.log('after "can\'t make it":', (await fx(D)).match(/Can’t make it: [^N]*/)?.[0]);
await shot(D, 'home-poll-player');

// start the game from the poll
await A.click('#gamesTrack .fxc [data-fx="start"]'); await wait(300);
console.log('start ->', await view(A), '| opponent:', await A.inputValue('#opp'), '| line-up msg:', await A.textContent('#lineMsg'));
console.log('rows:', (await A.$$eval('#lineup .lrow', (r) => r.map((x) => x.querySelector('.who').firstChild.textContent + ':' + (x.querySelector('.gk.is') ? 'GK' : x.querySelector('.seg .is').textContent)))).join(' '));
await A.click('#v-setup .back'); await G(A);
// edit: switch to 4-a-side with no subs, and check defaults stick for the next poll
await A.click('#gamesTrack .fxc [data-fx="edit"]'); console.log('edit form prefilled:', await A.inputValue('#pOpp'), await A.inputValue('#pDate'), await A.inputValue('#pTime'), await A.inputValue('#pLoc'));
await A.click('#pCancel'); await A.click('#pCancel'); await wait(600); console.log('after cancel:', await view(A), '|', await A.textContent('#gamesEmpty'));
await A.click('#gamesNew'); console.log('next poll defaults:', await A.inputValue('#pLoc'), '|', await A.inputValue('#pCost'), '|', await A.inputValue('#pTime'), '|', await A.inputValue('#pDate'), '(a Tuesday:', new Date(await A.inputValue('#pDate')).getDay() === 2, ')');
await A.fill('#pMax', '4'); await A.fill('#pOpp', 'Real Sociable'); await A.click('#pSave'); await wait(600);
console.log('4-a-side poll:', (await fx(A)).match(/\d+ of \d+ outfield/)[0]);
console.log('errors:', JSON.stringify(errs)); await b.close();
