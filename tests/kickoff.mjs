// Kick-off: everyone with the team open gets a "Game started" pop-up, can watch along and log goals; the score locks for 8 seconds.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const errs = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (label) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(label + ': ' + e)); await p.goto(BASE); await wait(300); return p; };
const view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
const out = process.argv[2];

const A = await open('A');
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tShort', 'SOP FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await wait(400);
const code = await A.textContent('#codeBig'); await A.click('#v-code [data-go="home"]'); await wait(300);
const B = await open('B');
await B.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('apt-')).forEach((k) => localStorage.removeItem(k)); }); await B.reload(); await wait(300);
await B.fill('#joinCode', code); await B.click('#joinBtn'); await wait(400); await B.click('#jFollow'); await wait(500);
console.log('B before kick-off:', await view(B), '| pop-up showing:', await B.isVisible('#kickPop'));
await A.click('#mNew'); await A.fill('#opp', 'Dog'); await A.click('#startGame'); await A.click('#kick'); await A.click('#go'); await wait(1800);
console.log('B pop-up:', await B.isVisible('#kickPop'), '|', await B.textContent('#kickPopText'));
if (out) { fs.mkdirSync(out, { recursive: true }); await B.screenshot({ path: `${out}/kick-pop.png` }); }
console.log('announce call:', JSON.stringify((await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).calls)) || []).replace(code, '<code>'));
await B.click('#kickWatch'); await wait(500);
console.log('B after Watch along:', await view(B), '| can log goals:', await B.isVisible('#goalUs'), '| class:', await B.evaluate(() => document.body.className));
await B.click('#goalUs'); await B.click('#picker button[data-p]'); await B.click('#picker button[data-p="x"]'); await wait(1500);
console.log('A after B logs a goal:', await A.textContent('#usN'), '-', await A.textContent('#themN'), '| A notice:', await A.textContent('#goalMsg'), '| A locked:', await A.isDisabled('#goalUs'));
await wait(5000); console.log('still locked after 6.5s:', await A.isDisabled('#goalUs')); await wait(2000); console.log('locked after 8.5s:', await A.isDisabled('#goalUs'));
// polls: a new one notifies the team, and the gaffer can nudge whoever hasn't answered
await A.click('#v-game .back'); await wait(300);
await A.click('#fxCard [data-fx="new"]'); await A.fill('#pOpp', 'Athletico Pathetico'); await A.fill('#pDate', '2026-10-13'); await A.fill('#pTime', '19:30'); await A.click('#pSave'); await wait(800);
await A.click('#gamesTrack .fxc [data-fx="nudge"]'); await wait(500);
console.log('nudge:', await A.textContent('#gamesTrack .fxc .msg'), '| button now disabled:', await A.isDisabled('#gamesTrack .fxc [data-fx="nudge"]'));
console.log('notifications asked for:', JSON.stringify((await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).calls)).map((c) => [c.name, c.body.kind, c.body.title, c.body.body])));
console.log('zoom locked:', await A.evaluate(() => document.querySelector('meta[name=viewport]').content.includes('user-scalable=no') && getComputedStyle(document.documentElement).touchAction));
await A.click('#tabs [data-tab="home"]'); await wait(200); console.log('coming soon hidden by default:', !(await A.isVisible('#soonPill')));
await A.click('#mOptions'); await wait(200); console.log('plans button before switching on:', await A.isVisible('#planOpen'));
await A.check('#expTrack'); await wait(200); await A.click('#planOpen'); console.log('plans pop-up:', await A.isVisible('#planPop'), '|', (await A.textContent('#planPop .pro h3')).replace(/\s+/g, ' ')); await A.click('#planOk');
console.log('settings buttons:', await A.isVisible('#soonOpen'), await A.isVisible('#planOpen'), '| sign out shown:', await A.isVisible('#optSignOut'), '|', await A.textContent('#optSignedAs'));
await A.click('#tabs [data-tab="home"]'); await wait(200); await A.click('[data-go="soon"]'); await wait(500); console.log('coming soon:', await view(A), '|', (await A.$$eval('.soon-list b', (b) => b.map((x) => x.textContent))).join(' / '));
if (out) { await A.screenshot({ path: `${out}/soon.png`, fullPage: true }); await A.click('#v-soon .back'); await wait(500); await A.screenshot({ path: `${out}/home.png`, fullPage: true }); }
if (await A.isVisible('#v-soon .back')) await A.click('#v-soon .back'); await wait(300); await A.click('#mOptions'); await wait(200); await A.click('#optSignOut'); console.log('first tap:', await A.textContent('#optSignOut')); await A.click('#optSignOut'); await wait(500); console.log('signed out ->', await view(A));
console.log('errors:', JSON.stringify(errs)); await b.close();
