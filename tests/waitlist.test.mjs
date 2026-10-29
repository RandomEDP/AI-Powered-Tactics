// A poll's waitlist (Ethan, 29 October 2026: "if the squad is full you should be able to join the waitlist"). Once the
// outfield spots are all taken a player gets "Join the waitlist" instead of a greyed-out "I'm in"; the poll shows who's
// waiting, in order; when someone drops out the first waiting moves up by themselves and the server is asked to tell them.
// Reece is on the Android players' app, so it's covered there too; the gaffer is on the iPhone.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: poll waitlist');
const w = await world();

// ---------- the gaffer, on the iPhone: the squad, and a poll for Wednesday
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.click('#meCard [data-me="pick"]'); await A.run(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await A.run(600);
await A.click('#tabs [data-tab="games"]'); await A.click('#gamesNew'); await A.page.fill('#pOpp', 'Rovers'); await A.page.fill('#pDate', '2026-10-14'); await A.page.fill('#pTime', '19:30'); await A.click('#pSave'); await A.run(800);
// two outfield spots, both taken (Jake and Chaplin), Spice in goal
{ const d = w.db(); const f = d.fixtures[0]; f.max_outfield = 2; d.fixture_votes = [{ fixture_id: f.id, pid: 1, choice: 'gk' }, { fixture_id: f.id, pid: 2, choice: 'in' }, { fixture_id: f.id, pid: 3, choice: 'in' }]; w.setDb(d); }

// ---------- Reece, on an Android phone
const R = await w.phone({ db: true, android: true, label: 'reece (android)' });
await R.page.fill('#joinCode', code); await R.click('#joinBtn'); await R.run(500);
await R.click('#joinList [data-pid="7"]'); await R.page.fill('#jLast', 'James'); await R.click('#joinList [data-pos="mix"]');
await R.page.fill('#jEmail', 'reece@example.com'); await R.page.fill('#jUser', 'reece_j'); await R.page.fill('#jPass', 'longpassword'); await R.check('#jTerms'); await R.click('#joinList [data-do="up"]'); await R.run(800);
await R.click('#pendCard [data-go="account"]'); await R.page.fill('#aEmail', 'reece@example.com'); await R.page.fill('#aPass', 'longpassword'); await R.click('#aSignIn'); await R.run(2000);
if (await R.view() !== 'home') { await R.click('#tabs [data-tab="home"]'); await R.run(500); }
check(/full/.test(await R.text('#fxCard')) && /It’s full, but you can join the waitlist\./.test(await R.text('#fxCard')), 'the team page says the game is full, and that he can join the waitlist: ' + await R.text('#fxCard'));
await R.click('#tabs [data-tab="games"]'); await R.run(300);
const card = () => R.text('#gamesTrack .fxc');
eq([await R.visible('#gamesTrack .fxc [data-vote="in"]'), await R.text('#gamesTrack .fxc [data-vote="wait"]')], [false, 'Join the waitlist'], 'on the Games screen, no greyed-out "I\'m in": "Join the waitlist" instead');
check(/The outfield spots are all taken\. Join the waitlist/.test(await card()), 'with a line saying what it does');
await R.click('#gamesTrack .fxc [data-vote="wait"]'); await R.run(1500);
const reece = () => (w.db().fixture_votes || []).find((v) => v.pid === 7);
eq((reece() || {}).choice, 'wait', 'Reece is on the waitlist in the database');
eq([await R.visible('#askPop'), await R.text('#gamesTrack .fxc [data-vote="wait"]')], [false, 'On the waitlist'], 'no "add to calendar" yet (he isn\'t playing), and the button says he\'s on it');
check(/You’re first on the waitlist\. If a spot comes free you move up by yourself/.test(await card()), 'and where he is in the queue: ' + await card());
check(/Waitlist: 1\. Reece/.test(await card()), 'the waitlist is on the poll for everyone');

// ---------- the gaffer sees him waiting
await w.run(2000); await A.click('#tabs [data-tab="home"]'); await A.run(300);
check(/full, 1 on the waitlist/.test(await A.text('#fxCard')), 'the gaffer\'s team page: "full, 1 on the waitlist": ' + await A.text('#fxCard'));
await A.click('#tabs [data-tab="games"]'); await A.run(500);
check(/Waitlist: 1\. Reece/.test(await A.text('#gamesTrack .fxc')), 'and the waitlist is on the poll');
await A.click('#gamesTrack .fxc [data-fx="answer"]');
eq(await A.page.$$eval('#gamesTrack .fxc [data-for="2"]', (b) => b.map((x) => x.textContent)), ['In', 'GK', 'Wait', 'Out'], 'answering for a player, the gaffer can put someone on the waitlist too');

// ---------- Jake can't make it: Reece moves up
w.setDb(Object.assign(w.db(), { calls: [] }));
await A.click('#gamesTrack .fxc [data-for="2"][data-vote="no"]'); await A.run(1500);
eq(w.db().fixture_votes.map((v) => v.pid + ':' + v.choice), ['1:gk', '3:in', '2:no', '7:in'], 'Jake out frees a spot, and Reece moves up into it by himself');
eq((w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'movedup').map((c) => c.body.fixture), [w.db().fixtures[0].id], 'the server is asked to tell whoever moved up (it words it and sends it once)');
check(!/Waitlist:/.test(await A.text('#gamesTrack .fxc')), 'the waitlist is empty again');
await w.run(3000); await R.click('#tabs [data-tab="home"]'); await R.run(800);
check(/You’re in\./.test(await R.text('#fxCard')), 'Reece\'s phone says he\'s in: ' + await R.text('#fxCard'));

// ---------- a player already in can drop out and Reece's place stays his
await R.click('#tabs [data-tab="games"]'); await R.run(300);
eq([await R.visible('#gamesTrack .fxc [data-vote="wait"]'), await R.page.getAttribute('#gamesTrack .fxc [data-vote="in"]', 'aria-pressed')], [false, 'true'], 'he now has "I\'m in" lit, not the waitlist');

for (const P of [A, R]) P.errs.forEach((e) => check(false, 'page error: ' + e));
await w.close();
await done();
