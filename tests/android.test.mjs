// The Android app (Ethan: "ignore anything gaffer related, just have it have the chat feature, respond to polls, watch
// highlights"). It's the same web app in Capacitor's Android shell, which has none of the iPhone's plugins. A player joins
// the team, says they're in for the next game, chats with the squad and watches the highlights; nothing a gaffer does is
// on offer, and a gaffer's own account on Android only ever follows the team, so it can never change it.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('android: the players\' app');
const w = await world();

const cutter = () => { // the iPhone's ReelCutter, so the gaffer can cut some highlights
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => ({ clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14.04) } }),
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14.04) }),
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const back = async (P) => { const r = await P.page.evaluate(() => window.gafferBack()); await P.run(300); return r; }; // the Android back button
const tabs = (P) => P.page.$$eval('#tabs button', (b) => b.filter((x) => x.offsetParent !== null).map((x) => x.querySelector('span').textContent.trim()));
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/android-${name}.png`, fullPage: true }); }; // node tests/android.test.mjs <dir> to look at it
const go = async (P, v) => { await P.page.evaluate(() => {}); await P.page.evaluate((x) => { const b = document.createElement('button'); b.setAttribute('data-go', x); document.body.appendChild(b); b.click(); b.remove(); }, v); await P.run(300); };

// ---------- the gaffer, on the iPhone: a game with Jake's goal, its highlights cut, a poll for the next one, a chat message
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.click('#meCard [data-me="pick"]'); await A.run(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await A.run(600);
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);
check((w.db().clips || []).length >= 1, 'the gaffer has cut the game\'s highlights on the iPhone');
await home(A); await A.run(300);
await A.click('#tabs [data-tab="games"]'); await A.click('#gamesNew'); await A.page.fill('#pOpp', 'Rovers'); await A.page.fill('#pDate', '2026-10-14'); await A.page.fill('#pTime', '19:30'); await A.click('#pSave'); await A.run(800);
check((w.db().fixtures || []).length === 1, 'and put up a poll for Wednesday\'s game');
await A.click('#tabs [data-tab="home"]'); await A.click('#mChat'); await A.run(400);
await A.page.fill('#chatText', 'Who is driving Wednesday?'); await A.page.press('#chatText', 'Enter'); await A.run(600);

// ---------- Jake, on an Android phone
const J = await w.phone({ db: true, android: true, label: 'jake (android)' });
await J.page.evaluate(() => { const a = JSON.parse(localStorage.getItem('apt-app')); a.introSeen = false; localStorage.setItem('apt-app', JSON.stringify(a)); }); await J.page.reload(); await J.run(800);
eq([await J.view(), await J.page.evaluate(() => document.documentElement.classList.contains('droid'))], ['welcome', true], 'it opens on joining a team, not the iPhone\'s swipe-through of the gaffer\'s tools');
await shot(J, 'welcome');
eq([await J.visible('#wJoin'), await J.visible('#wStart'), await J.visible('#pplBtn'), await J.visible('#introOpen')], [true, false, false, false], 'the welcome screen offers a team code; no starting a team, no feed and no tour of the gaffer\'s features');
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500);
eq(await J.view(), 'join', 'the team code finds the team');
await shot(J, 'join');
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
eq((w.db().users.find((u) => u.email === 'jake@example.com') || {}).redirect, 'https://randomedp.github.io/AI-Powered-Tactics/', 'the confirmation email links to the website, not the app\'s own https://localhost (which only exists inside the phone)');
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
if (await J.view() !== 'home') { await J.click('#tabs [data-tab="home"]'); await J.run(500); }
const team = w.db().teams[0], jakeId = w.db().users.find((u) => u.email === 'jake@example.com').id;
eq(w.db().players.find((p) => p.team_id === team.id && p.pid === 2).user_id, jakeId, 'Jake is in the squad as himself');
eq([await J.visible('#unamePop'), await J.visible('#termsPop')], [false, false], 'no pop-ups about profiles (there are none on Android)');

// the team page and the bar along the bottom
eq(await tabs(J), ['Team', 'Highlights', 'Games', 'Chat', 'Account'], 'the bar: Team, Highlights, Games, Chat and Account');
eq(await Promise.all(['#mOptions', '#mNew', '#mResume', '#mStats', '#mInsights', '#mBoard', '#soonPill', '#askCard', '#liveCard', '#squadSec'].map((s) => J.visible(s))), Array(10).fill(false),
  'the team page has none of the gaffer\'s tools: no settings, new game, stats, insights, tactics board, streams or requests');
eq([await J.visible('#heroName'), await J.text('#heroName'), await J.visible('#fxCard'), /Rovers/.test(await J.text('#fxCard'))], [true, 'Sons of Pitches FC', true, true], 'it has the team, and the next game to say if you\'re in');

await shot(J, 'team');
// ---------- the poll
await J.click('#tabs [data-tab="games"]'); await J.run(300);
eq([await J.view(), await J.visible('#gamesNew'), await J.visible('#rivalsOpen'), await J.visible('#tabBadge')], ['games', false, false, true], 'Games lists the poll (marked as waiting for an answer), with no scheduling or challenging other teams');
await J.page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
await J.click('#gamesTrack [data-vote="in"]'); await J.run(1500);
const votes = () => (w.db().fixture_votes || []).filter((v) => v.pid === 2);
eq([votes().length, await J.visible('#tabBadge')], [1, false], 'Jake says he\'s in: it goes to the team and the badge clears');
eq([await J.visible('#askPop'), await J.text('#askYes')], [true, 'Add to calendar'], 'and is offered to put it in his calendar');
await J.click('#askYes'); await J.run(300);
const calUrl = (await J.page.evaluate(() => window.__opened))[0] || '';
check(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Sons%20of%20Pitches%20FC%20vs%20Rovers&dates=20261014T183000Z\/20261014T193000Z/.test(calUrl), 'which opens Google Calendar with the game filled in (Android\'s web view can\'t save a calendar file): ' + calUrl);
await w.run(2000); await A.click('#tabs [data-tab="home"]'); await A.click('#tabs [data-tab="games"]'); await A.run(800);
check(/Jake/.test(await A.text('#gamesTrack')), 'the gaffer\'s iPhone has Jake down for it');

await shot(J, 'games');
// ---------- the chat
await J.click('#tabs [data-tab="chat"]'); await J.run(1200);
eq([await J.view(), await J.visible('#chatForm'), /Who is driving Wednesday\?/.test(await J.text('#chatBody'))], ['chat', true, true], 'the chat has the gaffer\'s message, and a box to reply');
check(!(await J.page.$('#chatBody .plink')), 'names in the chat aren\'t links to profiles (there are none on Android)');
await J.page.fill('#chatText', 'I can drive'); await J.page.press('#chatText', 'Enter'); await J.run(800);
check((w.db().messages || []).some((m) => m.body === 'I can drive'), 'Jake\'s reply goes to the team');
await w.run(2000); await A.click('#tabs [data-tab="home"]'); await A.click('#mChat'); await A.run(1500);
check(/I can drive/.test(await A.text('#chatBody')), 'and the gaffer sees it on the iPhone');
await J.click('#chatBody .cmsg:not(.mine) [data-chmsg]'); await J.run(300);
eq([await J.visible('#chatBody [data-chrep]'), await J.visible('#chatBody [data-chmute]')], [true, true], 'someone else\'s message can be reported or blocked (Google\'s rules for people talking to each other)');

await shot(J, 'chat');
// ---------- the highlights
await J.click('#tabs [data-tab="highlights"]'); await J.run(1500);
eq([await J.view(), await J.visible('#v-highlights .bar .back')], ['highlights', false], 'Highlights is a tab of its own (no Back)');
check(/Dog Squad/.test(await J.text('#hlList')), 'with the game against Dog Squad');
eq([await J.visible('#hlList [data-cut]'), await J.visible('#hlList [data-dl]'), await J.visible('#hlList [data-preel]')], [false, false, false], 'and nothing that needs the iPhone: no cutting, downloading or making reels');
await J.click('#hlList .mhbtn'); await J.run(800);
const src = await J.page.getAttribute('#mhVideo', 'src'); await shot(J, 'player');
eq([await J.visible('#mhPop'), /reel\.mp4$|\.mp4$/.test(src || '')], [true, true], 'Watch the whole match highlights plays the game\'s video: ' + src);
eq([await back(J), await J.visible('#mhPop'), await J.view()], [true, false, 'highlights'], 'the back button closes the player and stays on Highlights');
await J.click('#hlToggle [data-by="player"]'); await J.run(400);
check(/Jake/.test(await J.text('#hlList')), 'By player has Jake\'s goal');

await shot(J, 'highlights');
// ---------- the back button
eq([await back(J), await J.view()], [true, 'home'], 'back from a tab goes to the team page');
eq([await back(J), await J.view()], [false, 'home'], 'and back on the team page lets Android put the app away');

// ---------- the account: signing out and deleting it are a tap away
await J.click('#tabs [data-tab="profile"]'); await J.run(400);
eq([await J.view(), await J.visible('#aDelete'), await J.visible('#aSignOut'), await J.visible('#aOrgSec')], ['account', true, true, false], 'Account has Sign out and Delete my account, and no joining as a gaffer');
eq([await J.visible('#ntfSec'), await J.page.evaluate(() => window.__t.push.calls.length)], [false, 0], 'a build without the team\'s Firebase file offers no notifications, and never asks Firebase for anything (it would crash)');

await shot(J, 'account');
// ---------- nothing else can be reached, even by a link
for (const v of ['feed', 'profile', 'people', 'options', 'board', 'setup', 'poll', 'stats', 'insights', 'rivals', 'live', 'cut', 'create', 'intro', 'soon']) {
  await go(J, v); check(['home', 'welcome'].includes(await J.view()), 'the ' + v + ' screen isn\'t on Android: ' + await J.view());
}

// ---------- the gaffer's own account on an Android phone only follows the team
const G = await w.phone({ db: true, android: true, label: 'gaffer (android)' });
await G.click('#acctBtn'); await G.page.fill('#aEmail', 'ethan@example.com'); await G.page.fill('#aPass', 'longpassword'); await G.click('#aSignIn'); await G.run(2500);
if (await G.view() === 'welcome') { await G.click('#myTeams button'); await G.run(1500); }
const before = JSON.stringify([w.db().teams, w.db().players, w.db().games, w.db().fixtures]);
eq([await G.view(), await G.page.evaluate(() => document.body.classList.contains('ro')), await G.visible('#mNew'), await G.visible('#mOptions')], ['home', true, false, false], 'signed in as the gaffer, it\'s a follower: no new game, no settings');
await G.click('#tabs [data-tab="games"]'); await G.run(400);
eq([await G.visible('#gamesNew'), await G.visible('#gamesTrack [data-fx="edit"]'), await G.visible('#gamesTrack [data-fx="start"]')], [false, false, false], 'the poll can be answered but not edited or started');
await G.run(5000);
eq(JSON.stringify([w.db().teams, w.db().players, w.db().games, w.db().fixtures]), before, 'and it never writes the team, its players, games or polls');
check(!(await G.page.$('#termsPop:not([hidden])')), 'no pop-ups');

// ---------- notifications, in a build with the team's Firebase file: Chaplin on another Android phone
const C = await w.phone({ db: true, android: true, firebase: true, label: 'chaplin (android)' });
await C.page.fill('#joinCode', code); await C.click('#joinBtn'); await C.run(500);
await C.click('#joinList [data-pid="3"]'); await C.page.fill('#jLast', 'Chaplin'); await C.page.fill('#jNum', '9'); await C.click('#joinList [data-pos="def"]');
await C.page.fill('#jEmail', 'chaplin@example.com'); await C.page.fill('#jUser', 'chaplin_c'); await C.page.fill('#jPass', 'longpassword'); await C.check('#jTerms'); await C.click('#joinList [data-do="up"]'); await C.run(800);
await C.click('#pendCard [data-go="account"]'); await C.page.fill('#aEmail', 'chaplin@example.com'); await C.page.fill('#aPass', 'longpassword'); await C.click('#aSignIn'); await C.run(2500);
const chans = await C.page.evaluate(() => window.__t.push.channels);
eq(chans.map((c) => [c.id, c.sound || null, c.importance]), [['game', 'whistle.wav', 4], ['chat', null, 4]], 'the app makes Android\'s two channels: games with the referee\'s whistle, the chat with the phone\'s usual sound');
eq([await C.visible('#pushPop'), await C.text('#pushNext')], [true, 'Your phone will ask next. You can change this any time on the Account tab.'], 'once Chaplin is in the squad, Gaffer says what the notifications are for before Android asks');
check(!(await C.page.evaluate(() => window.__t.push.calls.includes('register'))), 'nothing is registered before he says yes');
await C.click('#pushYes'); await C.run(800);
const os = () => (w.db().pushOs || {})[w.db().users.find((u) => u.email === 'chaplin@example.com').id];
eq([await C.page.evaluate(() => window.__t.push.calls.filter((x) => x === 'ask' || x === 'register')), os()], [['ask', 'register'], 'android'], 'Yes: Android asks, and the phone is saved as an Android one (so the server sends it through Google)');
await C.click('#tabs [data-tab="profile"]'); await C.run(400);
eq([await C.visible('#ntfSec'), await C.text('#ntfNote'), await C.visible('#ntfOn')], [true, 'On. This phone is told about game polls, kick-off, goals, highlights and the squad chat.', false], 'the Account tab says notifications are on');
await shot(C, 'notifications');
// the gaffer's squad list stops saying Chaplin's notifications are off (Jake's phone, without them, still says so)
await A.page.reload(); await A.run(2500); await A.click('#tabs [data-tab="home"]'); await A.run(500);
const rowOf = async (n) => (await A.page.$$eval('#squadList .prow', (r) => r.map((x) => x.textContent))).find((x) => x.startsWith(n)) || '';
eq([/Notifications off/.test(await rowOf('Chaplin')), /Notifications off/.test(await rowOf('Jake'))], [false, true], 'the gaffer\'s squad list: Chaplin\'s notifications are on, Jake\'s (no Firebase in his build) are off');
// tapping one
await C.page.evaluate((c) => window.__tap({ code: c, kind: 'chat' }), code); await C.run(800);
eq(await C.view(), 'chat', 'tapping a chat notification opens the chat');
await C.page.evaluate((c) => window.__tap({ code: c, kind: 'nudge' }), code); await C.run(800);
eq(await C.view(), 'games', 'a nudge opens Games, to say if he\'s in');
await C.page.evaluate((c) => window.__tap({ code: c, kind: 'highlights' }), code); await C.run(800);
eq(await C.view(), 'highlights', 'highlights open Highlights');
await C.page.evaluate((c) => window.__tap({ code: c, kind: 'goal' }), code); await C.run(1500);
eq(await C.view(), 'home', 'a goal opens the team page (there\'s no game screen on Android)');
// switched off in Android's settings: the phone is taken off, so the gaffer's list and nudge count stay honest
await C.page.evaluate(() => { window.__t.push.perm = 'denied'; document.dispatchEvent(new Event('visibilitychange')); }); await C.run(1500);
check(!(w.db().push || []).includes(w.db().users.find((u) => u.email === 'chaplin@example.com').id), 'notifications switched off in Android\'s settings: the phone is taken off the list');
await C.click('#tabs [data-tab="home"]'); await C.click('#tabs [data-tab="profile"]'); await C.run(600);
eq(await C.text('#ntfNote'), 'Off. Notifications were turned off for Gaffer. To turn them on: open your phone’s Settings, tap Apps, then Gaffer, then Notifications, and switch them on.', 'and the Account tab says exactly where to switch them back on');

// ---------- none of the iPhone's plugins are asked for (Android hasn't got them)
for (const P of [J, G, C]) eq(await P.page.evaluate(() => window.__t.asked), [], P.label + ': no iPhone-only plugin was used');
for (const P of [A, J, G, C]) eq(P.errs, [], P.label + ': no errors');
await w.close();
done();
