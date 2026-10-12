// Streaming a game live, on the phones: the gaffer's Go live sheet with the camera link for GoPro Quik, one "we're live"
// notification once the camera gets through, the Home card and the stream for followers with the score held back to match
// the picture (so it never gives a goal away), goal banners kept quiet while watching, and the stream ending with the game.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: streaming a game live');
const w = await world();
const calls = (kind) => (w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === kind);
const stream = () => (w.db().team_streams || [])[0] || null;
const setDb = (o) => w.setDb(Object.assign(w.db(), o));

// ---------- a gaffer with a team, and a follower
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const B = await w.phone({ db: true, native: true, label: 'follower' });
await B.page.fill('#joinCode', code); await B.click('#joinBtn'); await B.run(500); await B.click('#jFollow'); await B.run(800);
// Cloudflare's player, as far as these phones can reach it (stands in for the real thing; nothing leaves the test)
const cloudflare = (P) => P.ctx.route('https://customer-test.cloudflarestream.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>the stream</p>' }));
await cloudflare(B);
// this follower's browser can't play the stream's format itself (newer Chromes can: phone C below covers that way)
await B.page.evaluate(() => { HTMLMediaElement.prototype.canPlayType = function (t) { return /mpegurl/.test(t) ? '' : 'maybe'; }; });
await B.page.evaluate(() => { window.__quiet = []; window.Capacitor.Plugins.ChatQuiet = { quiet: async (o) => { window.__quiet.push(o); return {}; } }; });
const quiet = () => B.page.evaluate(() => window.__quiet.slice(-1)[0] || null);

await A.newGame('Dog'); await A.run(1000);
eq([await A.view(), await A.visible('#liveRow'), await A.visible('#streamBtn')], ['game', false, false], 'with the experimental switch off, the game screen has no streaming');
await A.click('#v-game .back'); await A.click('#tabs [data-tab="options"]'); await A.page.check('#expTrack'); await A.run(300); await A.click('#tabs [data-tab="home"]'); await A.click('#mResume');
eq([await A.visible('#streamBtn'), await A.text('#streamBtn'), await A.visible('#watchBtn')], [true, 'Stream this game', false], 'switched on: the gaffer can stream the game');
eq(await A.page.evaluate(() => /Stream your games live/.test(document.querySelector('#planPop .pro').textContent)), true, 'and it is listed in the Gaffer tier');

// ---------- the sheet and the camera link
await A.click('#streamBtn'); await A.run(500);
const link = await A.page.inputValue('#liveLink');
eq([await A.visible('#livePop'), await A.text('#liveTitle'), /^rtmps:\/\/live\.cloudflare\.com:443\/live\/key[0-9a-f]{8}$/.test(link), stream() && stream().started_at], [true, 'Stream this game', true, null], 'the sheet explains what to do in GoPro Quik and shows the camera link; nothing is live yet');
check(/GoPro Quik/.test(await A.text('#liveBody')) && /RTMP/.test(await A.text('#liveBody')), 'with the steps in GoPro Quik');
await A.click('#liveCopy'); await A.run(300);
eq([await A.text('#liveMsg'), await A.page.evaluate(() => navigator.clipboard.readText())], ['Copied. Paste it into GoPro Quik.', link], 'Copy puts the link on the clipboard');
check(!(await B.visible('#liveCard')), 'the follower sees nothing yet');

// ---------- going live
const gid = (await A.match()).gid;
await A.click('#liveGo'); await w.run(1500);
eq([stream().gid, typeof stream().started_at, await A.text('#liveTitle'), await A.visible('#liveEnd'), calls('live').length], [gid, 'number', 'Waiting for the camera', true, 0], 'Go live: the stream is on for this game, waiting for the camera; nobody is told yet');
eq([await B.visible('#liveCard'), /LIVE/.test(await B.text('#liveCard')), /SOP FC v Dog/.test(await B.text('#liveCard')), /about to start/.test(await B.text('#liveCard'))], [true, true, true, true], 'the follower\'s Home shows the stream is about to start, straight away');
setDb({ camera: true }); await w.run(6000);
let sent = calls('live');
eq([sent.length, sent[0] && sent[0].body.title, sent[0] && sent[0].body.body, await A.text('#liveTitle')], [1, 'SOP FC v Dog is live', 'Tap to watch the game.', 'You’re live'], 'the camera gets through: within 5 seconds the team is told, once');
await w.run(70000);
eq(calls('live').length, 1, 'and never again for this stream, however long the gaffer\'s phone keeps checking');
check(/being streamed now/.test(await B.text('#liveCard')), 'the follower\'s card says it is on now');
await A.click('#liveClose');
eq([await A.visible('#watchBtn'), await A.text('#streamBtn')], [true, 'Stream settings'], 'the gaffer\'s game screen can watch it too, and get back to the settings');

// ---------- watching, with the score held back to match the picture
await B.click('#liveCard [data-go="live"]'); await B.run(500);
const hls = stream().hls;
eq([await B.view(), await B.page.getAttribute('#lvFrame', 'src'), await B.visible('#lvOwn'), await B.text('#lvTitle')], ['live', hls.replace('/manifest/video.m3u8', '/iframe') + '?autoplay=true', false, 'v Dog'], 'Watch live plays the stream (in Cloudflare\'s player off the iPhone), with no settings for a follower');
eq(await quiet(), { live: code }, 'and asks the phone to keep this team\'s goal banners quiet while it is on screen');
eq(await B.text('#lvScore'), 'SOP FC 0–0 Dog Before kick-off', 'the score on the picture, before kick-off');
await A.click('#go'); await w.run(3000);
eq([await B.text('#lvScore'), await B.visible('#kickPop')], ['SOP FC 0–0 Dog Before kick-off', false], 'kick-off isn\'t shown before the picture shows it, and no "game started" pop-up covers the stream');
await w.run(15000);
check(/^SOP FC 0–0 Dog 1st half 0:0[2-4]$/.test(await B.text('#lvScore')), `then the clock runs, behind the gaffer's by the picture's delay (${await B.text('#lvScore')} / ${await A.text('#played')})`);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await w.run(3000);
eq([(await B.team()).match.events.length, await B.text('#lvEvents')], [1, ''], 'a goal reaches the follower\'s phone in seconds…');
check(/0–0/.test(await B.text('#lvScore')), '…but the score on the stream doesn\'t give it away before the picture does');
await w.run(14000);
check(/^SOP FC 1–0 Dog/.test(await B.text('#lvScore')) && /Jake/.test(await B.text('#lvEvents')), `once the picture has caught up it shows, with the scorer (${await B.text('#lvScore')})`);
check(/held back about 15 seconds/.test(await B.text('#lvNote')), 'and it says why the score is behind');
await B.click('#v-live .back'); await B.run(300);
eq([await B.view(), await B.page.getAttribute('#lvFrame', 'src'), await quiet()], ['home', null, {}], 'leaving the stream stops it playing (and using data), and goal banners show again');

// ---------- a follower on the game screen, and the stream ending
await B.click('#mResume');
eq([await B.visible('#watchBtn'), await B.visible('#streamBtn')], [true, false], 'a follower watching along can switch to the stream, but has no streaming settings');
await A.click('#streamBtn'); await A.click('#liveEnd');
eq([await A.text('#liveEnd'), typeof stream().started_at], ['Tap again to end it', 'number'], 'End stream needs a second tap');
await A.click('#liveEnd'); await w.run(2000);
eq([stream().started_at, await A.text('#liveTitle'), await A.text('#liveMsg'), await B.visible('#watchBtn'), await A.visible('#watchBtn')], [null, 'Stream this game', 'Stream ended. The recording is kept for 30 days.', false, false], 'ended: off on the database, and the follower\'s button goes within a couple of seconds');
await B.click('#v-game .back'); check(!(await B.visible('#liveCard')), 'and the Home card');

// ---------- a new link, a server that isn't ready, and the stream ending with the game
await A.click('#liveNew'); await A.click('#liveNew'); await A.run(500);
const link2 = await A.page.inputValue('#liveLink');
check(link2 !== link && /^rtmps:/.test(link2) && /old one no longer works/.test(await A.text('#liveMsg')), 'Make a new link: a different link, and the gaffer is told the old one stops working');
setDb({ streamOff: true }); await A.click('#liveGo'); await A.run(500);
eq([await A.text('#liveMsg'), stream().started_at], ["Live streaming isn't set up on Gaffer's server yet.", null], 'if the server isn\'t ready, the gaffer is told exactly that and nothing goes live');
setDb({ streamOff: false }); await A.click('#liveGo'); await w.run(1500);
check(typeof stream().started_at === 'number' && await B.visible('#liveCard'), 'live again');
await A.click('#liveClose'); await A.click('#finish'); await A.click('#finish'); await w.run(2000);
eq([stream().started_at, await B.visible('#liveCard')], [null, false], 'finishing the game ends its stream');

// ---------- the iPhone plays the stream itself, and keeps trying until the camera gets through
const C = await w.phone({ db: true, label: 'iPhone follower' });
await C.page.addInitScript(() => { HTMLMediaElement.prototype.canPlayType = function (t) { return /mpegurl/.test(t) ? 'maybe' : ''; }; });
await C.page.reload(); await C.run(500);
await C.page.fill('#joinCode', code); await C.click('#joinBtn'); await C.run(500); await C.click('#jFollow'); await C.run(800);
await cloudflare(C); setDb({ camera: false });
await A.click('#v-stats .back'); await A.newGame('Cat'); await A.click('#streamBtn'); await A.click('#liveGo'); await w.run(2000);
await C.click('#liveCard [data-go="live"]'); await C.run(300);
eq([await C.page.evaluate(() => document.querySelector('#lvVideo').src), await C.visible('#lvVideo'), await C.visible('#lvFrame')], [stream().hls, true, false], 'on an iPhone the stream plays in the app\'s own video player');
await C.run(2000);
check(/Waiting for the camera|Loading/.test(await C.text('#lvWait')), `until it plays, it says what it is waiting for (${await C.text('#lvWait')})`);
await C.click('#v-live .back');
eq(await C.page.evaluate(() => document.querySelector('#lvVideo').getAttribute('src')), null, 'and stops when left');

await w.close();
await done(A, B, C);
