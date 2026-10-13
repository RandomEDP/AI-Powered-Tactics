// Turning notifications on from Settings. Josh had joined the squad as himself but had no way to turn notifications on:
// iOS only lists an app under Settings, Notifications once the app has asked, and the only way to be asked was the
// pop-up, which waits a week after "Not now" and never shows during a game. Settings now always has a Notifications
// section saying where things stand, with a button that asks iOS there and then (or how to switch them back on in iOS
// Settings if they were turned off), and a plain word for anyone who can't have them yet.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: turning notifications on');
const w = await world();
const push = () => { // the iPhone's notifications, as the web app sees them
  window.__p = []; let perm = sessionStorage.getItem('__perm') || 'prompt'; const L = {};
  window.__setPerm = (v) => { perm = v; sessionStorage.setItem('__perm', v); };
  window.Capacitor.Plugins.PushNotifications = { addListener: (n, cb) => { L[n] = cb; return { remove() {} }; }, checkPermissions: async () => ({ receive: perm }),
    requestPermissions: async () => { window.__p.push('ios asked'); perm = 'granted'; sessionStorage.setItem('__perm', perm); return { receive: perm }; },
    register: async () => { window.__p.push('register'); if (L.registration) L.registration({ value: 'b'.repeat(64) }); } };
};
const tokens = () => (w.db().push || []).length;

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJosh\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');

// ---------- Josh, on the iPhone app, joins the squad as himself and says "Not now" to the pop-up
const J = await w.phone({ db: true, native: true, label: 'Josh' });
await J.ctx.addInitScript(push); await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.page.evaluate(() => { const b = document.querySelector('[data-go="options"]'); if (b) b.click(); }); await J.run(300);
eq([await J.visible('#ntfSec'), await J.text('#ntfNote'), await J.visible('#ntfOn')], [true, 'Sign in and join the squad as yourself to be told about game polls, kick-off, goals, highlights and the squad chat.', false],
  'before signing in, Settings says what it takes to get notifications');
await J.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await J.run(300);
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'josh@example.com'); await J.page.fill('#jUser', 'josh_j'); await J.page.fill('#jPass', 'longpassword'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'josh@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500); // (the email confirmed)
if (await J.visible('#pushPop')) await J.click('#pushNo');
await J.run(300);
eq([tokens(), await J.page.evaluate(() => window.__p.length)], [0, 0], 'joined as Josh, said "Not now": iOS hasn\'t asked, so iOS Settings has nothing for Gaffer (how Josh was)');

// ---------- Settings has a way to turn them on, there and then
await J.page.evaluate(() => { const b = document.querySelector('[data-go="options"]'); if (b) b.click(); }); await J.run(400);
eq([await J.view(), await J.text('#ntfNote'), await J.visible('#ntfOn')], ['options', 'Not on yet. Game polls, kick-off, goals, highlights and the squad chat can come to this iPhone.', true], 'Settings says they aren\'t on yet, with a button to turn them on');
await J.click('#ntfOn'); await J.run(800);
eq([await J.page.evaluate(() => window.__p), tokens(), await J.visible('#pushPop')], [['ios asked', 'register'], 1, false], 'the button has iOS ask straight away; allowed, the phone is saved for the team\'s notifications (and the pop-up doesn\'t ask too)');
eq([await J.text('#ntfNote'), await J.visible('#ntfOn')], ['On. This iPhone is told about game polls, kick-off, goals, highlights and the squad chat.', false], 'and Settings says they\'re on');

// ---------- switched off in the iPhone's Settings: how to switch them back on
await J.page.evaluate(() => window.__setPerm('denied')); await J.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await J.run(300);
await J.page.evaluate(() => { const b = document.querySelector('[data-go="options"]'); if (b) b.click(); }); await J.run(400);
eq([await J.text('#ntfNote'), await J.visible('#ntfOn')], ['Off. Notifications were turned off for Gaffer, so your iPhone won’t ask again. To turn them on: open the Settings app, scroll down to Gaffer, tap Notifications, and switch on Allow Notifications.', false],
  'turned off in the iPhone\'s Settings: it says exactly where to turn them back on');

// ---------- the web app, with no notifications to offer
const Web = await w.phone({ db: true, label: 'web' });
await Web.page.fill('#joinCode', code); await Web.click('#joinBtn'); await Web.run(500); await Web.click('#jFollow'); await Web.run(800);
await Web.page.evaluate(() => { const b = document.querySelector('[data-go="options"]'); if (b) b.click(); }); await Web.run(300);
check(!(await Web.visible('#ntfSec')), 'on the web there is no notifications section');

for (const P of [A, J, Web]) for (const e of P.errs) check(false, 'page error: ' + e);
await w.close();
done();
