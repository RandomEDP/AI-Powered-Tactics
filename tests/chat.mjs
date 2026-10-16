// Squad chat, recording a play on the tactics board and sending it to the chat, the calendar prompt, and signing out.
import { chromium } from './pinned.mjs';
import fs from 'fs';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); const errs = [], out = process.argv[2];
const mk = async () => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
  return ctx; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), view = (p) => p.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join());
// the two phones keep separate stand-in databases, so messages are carried across by hand
const carry = async (from, to) => { const m = await from.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).messages); await to.evaluate((m) => { const d = JSON.parse(localStorage.getItem('__mockdb')); d.messages = m; localStorage.setItem('__mockdb', JSON.stringify(d)); }, m); };
const ctx = await mk(); const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push('A: ' + e)); await A.goto(BASE); await wait(300);
await A.click('#createBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.fill('#aUser', 'gaffer_fc'); await A.check('#aTerms'); await A.click('#aSignUp'); await A.click('#aSignIn'); await wait(300);
await A.fill('#tName', 'Sons of Pitches FC'); await A.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan\nAli'); await A.click('#tCreate'); await wait(400);
const code = await A.textContent('#codeBig'); await A.click('#v-code [data-go="home"]'); await wait(300);
await A.click('#meCard [data-me="pick"]'); await wait(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await wait(600);
console.log('my row badges:', (await A.$$eval('#squadList .prow', (r) => r.map((x) => x.textContent))).find((x) => x.startsWith('Ethan')));
// a second phone: Ali
const ctx2 = await mk(); const D = await ctx2.newPage(); D.on('pageerror', (e) => errs.push('D: ' + e));
await D.addInitScript((db) => { if (!localStorage.getItem('__mockdb')) localStorage.setItem('__mockdb', db); }, await A.evaluate(() => localStorage.getItem('__mockdb')));
await D.goto(BASE); await wait(300); await D.fill('#joinCode', code); await D.click('#joinBtn'); await wait(400);
// chat
await A.click('#tabs [data-tab="home"]'); await A.click('#mChat'); await wait(400); console.log('chat:', await view(A), '|', (await A.textContent('#chatBody')).slice(0, 40));
await A.fill('#chatText', 'Tuesday, 7:30. Who is driving?'); await A.press('#chatText', 'Enter'); await wait(500);
console.log('sent:', (await A.$$eval('.cmsg', (m) => m.map((x) => x.textContent))).join(' / '), '| notify:', JSON.stringify((await A.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).calls || [])).filter((c) => c.body.kind === 'chat').map((c) => Object.keys(c.body))));
// record a play
await A.click('#tabs [data-tab="home"]'); await A.click('#mBoard'); await wait(300); await A.click('[data-tb="rec"]'); await wait(200); console.log('recording bar:', await A.isVisible('.tbrec'));
const box = await (await A.$('#tbSvg')).boundingBox(), at = (x, y) => [box.x + box.width * x / 100, box.y + box.height * y / 140];
const drag = async (from, to, steps = 8) => { await A.mouse.move(...at(...from)); await A.mouse.down(); for (let i = 1; i <= steps; i++) { await A.mouse.move(...at(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps)); await wait(40); } await A.mouse.up(); };
await drag([30, 60], [20, 30]); await wait(150);
await A.click('[data-tbmode="pass"]'); await drag([50, 70], [22, 32]); await wait(200);
console.log('line showing while recording:', await A.$$eval('#tbFx path', (p) => p.length), '| kept as a permanent line:', await A.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':board')))).lines.length));
await wait(2600); console.log('after a couple of seconds:', await A.$$eval('#tbFx path', (p) => p.length), 'lines');
await A.click('[data-tbmode="move"]'); await drag([50, 70], [22, 32]); await A.click('[data-tb="stop"]'); await wait(200);
console.log('done panel:', (await A.textContent('.hcard h3')).trim()); await A.fill('#tbPlayName', 'Corner routine'); await A.click('[data-tb="keep"]'); await wait(200);
console.log('saved plays:', (await A.$$eval('.tbplay b', (x) => x.map((y) => y.textContent))).join());
if (out) { fs.mkdirSync(out, { recursive: true }); await A.screenshot({ path: `${out}/board-plays.png`, fullPage: true }); }
await A.click('[data-tbrun="0"]'); await wait(700); const mid = await A.$eval('#tbSvg [data-pc="u3"]', (g) => g.getAttribute('transform')); await wait(6000); console.log('playback moved a player:', mid, '-> back to', await A.$eval('#tbSvg [data-pc="u3"]', (g) => g.getAttribute('transform')));
await A.click('[data-tbsend="0"]'); await wait(700); console.log('send ->', await view(A), '| play cards:', await A.$$eval('.cplay', (x) => x.length), '|', await A.textContent('.cplay b'));
if (out) await A.screenshot({ path: `${out}/chat.png` });
// Ali signs up, claims, reads, reports, mutes
await D.click('#joinList [data-pid="9"]'); await D.fill('#jLast', 'Khan'); console.log('claim form asks for a shirt number:', await D.isVisible('#jNum')); await D.fill('#jNum', '56'); await D.click('#joinList [data-pos="mix"]'); await D.fill('#jEmail', 'ali@example.com'); await D.fill('#jUser', 'ali_k'); await D.fill('#jPass', 'longenough1'); await D.check('#jTerms'); await D.click('#joinList [data-do="up"]'); await wait(500);
await D.click('#pendCard [data-go="account"]'); await D.fill('#aEmail', 'ali@example.com'); await D.fill('#aPass', 'longenough1'); await D.click('#aSignIn'); await wait(900);
await carry(A, D); await D.reload(); await wait(900);
console.log('Ali’s number after claiming: in the database', await D.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).players.find((p) => p.name === 'Ali').shirt_number), '| on his card', await D.inputValue('#myNum'));
await D.fill('#myNum', '7'); await D.press('#myNum', 'Tab'); await wait(500); console.log('changed on his card:', await D.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).players.find((p) => p.name === 'Ali').shirt_number));
console.log('Ali unread badge:', await D.textContent('#mChatBadge').catch(() => ''), 'visible', await D.isVisible('#mChatBadge'));
await D.click('#mChat'); await wait(500); console.log('Ali sees:', (await D.$$eval('.cmsg > small', (m) => m.map((x) => x.textContent.split(' · ')[0]))).join(), '| badge gone:', !(await D.isVisible('#mChatBadge')));
await D.click('[data-chplay]'); await wait(500); console.log('Ali plays it:', (await D.$eval('.cplay svg [data-pc="u3"]', (g) => g.getAttribute('transform'))));
await D.fill('#chatText', 'I can drive'); await D.press('#chatText', 'Enter'); await wait(700);
await carry(D, A); await A.click('#tabs [data-tab="home"]'); await A.click('#mChat'); await wait(500);
console.log('gaffer sees it:', (await A.$$eval('.cmsg .bubble', (m) => m.map((x) => x.textContent))).join(' / '));
await D.click('.cmsg:not(.mine) .bubble'); await wait(100); console.log('actions on someone else’s:', (await D.$$eval('.cmsg .cacts:last-child button', (x) => x.map((y) => y.textContent))).join());
await D.click('[data-chrep]'); await wait(300); console.log('report:', await D.textContent('#chatBody .msg'));
await D.click('.cmsg:not(.mine) .bubble'); await D.click('[data-chmute]'); await wait(400); console.log('after mute:', await D.$$eval('.cmsg', (x) => x.length), 'messages |', await D.textContent('[data-chunmute]'));
await A.click('.cmsg:not(.mine) .bubble'); await wait(100); await A.click('[data-chdel]'); await wait(500); console.log('gaffer deleted Ali’s:', await A.$$eval('.cmsg', (x) => x.length), 'left');
// calendar prompt
await A.click('#tabs [data-tab="games"]'); await A.click('#gamesNew'); await A.fill('#pOpp', 'Athletico Pathetico'); await A.fill('#pDate', '2026-10-13'); await A.fill('#pTime', '19:30'); await A.click('#pSave'); await wait(700);
await A.click('#gamesTrack .fxc [data-vote="in"]'); await wait(600); console.log('calendar prompt:', await A.isVisible('#askPop'), '|', await A.textContent('#askText'));
if (out) await A.screenshot({ path: `${out}/cal-ask.png` });
await A.click('#askNo'); await A.click('#gamesTrack .fxc [data-vote="gk"]'); await wait(500); console.log('asked again for the same game:', await A.isVisible('#askPop'));
// sign out leaves nothing behind
await A.click('#tabs [data-tab="home"]'); await A.click('#mOptions'); await wait(200); await A.click('#optSignOut'); await A.click('#optSignOut'); await wait(700);
console.log('signed out ->', await view(A), '| teams listed:', await A.$$eval('#myTeams button', (x) => x.length), '| stored:', await A.evaluate(() => JSON.stringify([JSON.parse(localStorage.getItem('apt-app')).teams.length, JSON.parse(localStorage.getItem('apt-app')).active])));
await A.reload(); await wait(500); console.log('after reload:', await view(A), '| tab bar:', await A.isVisible('#tabs'));
await A.click('#acctBtn'); await A.fill('#aEmail', 'gaffer@example.com'); await A.fill('#aPass', 'longpassword'); await A.click('#aSignIn'); await wait(900);
console.log('signed back in ->', await view(A), '| teams offered:', (await A.$$eval('#myTeams button', (x) => x.map((y) => y.textContent))).join());
await A.click('#myTeams button').catch(() => {}); await wait(700); console.log('opened:', await view(A), '| my row:', (await A.$$eval('#squadList .prow', (r) => r.map((x) => x.textContent))).find((x) => x.startsWith('Ethan')));
console.log('errors:', JSON.stringify(errs)); await b.close();
