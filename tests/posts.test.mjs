// Home, posts and the profile, like Instagram. Ethan's asks: a Home page on the bottom bar where people share their
// moments, with a + at the top to post a highlight from their own clips or reels; the settings moved into a profile
// section that shows their posts, name and so on, like Instagram's profile.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: Home, posts and the profile');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const tabs = (P) => P.page.$$eval('#tabs button', (b) => b.filter((x) => !x.hidden).map((x) => x.querySelector('span').textContent));

// ---------- the gaffer's team, a game Jake scores in, and Jake's clip and reel
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
eq(await tabs(A), ['Home', 'Team', 'Games', 'Chat', 'Profile'], 'the bar along the bottom: Home, Team, Games, Chat, Profile');
check(await A.visible('#mBoard') && /Team settings/.test(await A.text('#mOptions')), 'the tactics board and the team\'s settings are on the Team page');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(300);
let db = w.db(); const team = db.teams[0], game = db.games[0];
db.clips.push({ team_id: team.id, game_id: game.id, seq: 0, path: team.id + '/dog/01.mp4', store: 'r2', at: 1791660000000, dur: 14, pids: [2], label: '2\' Goal: Jake' });
db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword' }); db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id = 'u-jake';
db.profiles.push({ user_id: 'u-jake', username: 'Chappers', name: 'Jake Smith', private: false, pins: [] });
db.player_reels = [{ team_id: team.id, pid: 2, path: team.id + '/players/2/reel-1.mp4', store: 'r2', marks: [{ t: 0, label: 'Goal' }], made_at: Date.now() }];
w.setDb(db);

// ---------- Jake posts his goal from Home's +
const J = await w.phone({ db: true, label: 'jake' });
await J.click('#acctBtn'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500);
await J.click('#pplBtn'); await J.run(1000);
eq([await J.view(), await tabs(J)], ['feed', ['Home', 'Team', 'Profile']], 'Home is a feed; without a team open the bar has Home, Team and Profile');
check(/Nothing here yet/.test(await J.text('#fdBody')), 'with nothing in it yet, it says how to fill it');
await J.click('#fdNew'); await J.run(1000);
eq([await J.visible('#postPop'), await J.page.$$eval('#npList [data-np]', (x) => x.length)], [true, 1], 'the + opens a new post, with his clips to pick from');
await J.click('#npKind [data-k="reel"]'); await J.run(300);
check(/Your player reel · Sons of Pitches FC · 1 moment/.test(await J.text('#npList')), 'and his reels');
await J.click('#npKind [data-k="clip"]'); await J.run(300);
await J.page.fill('#npCap', 'Top bins'); await shot(J, 'new-post');
await J.click('#npPost'); await J.run(1500);
let posts = w.db().posts || [];
eq(posts.map((p) => [p.kind, p.caption, p.game_id === game.id, p.at]), [['clip', 'Top bins', true, 1791660000000]], 'he shares it with a caption');
eq([await J.view(), await J.page.$$eval('#fdBody .post', (x) => x.length)], ['feed', 1], 'and it\'s on his Home');
check(/Chappers Top bins/.test(await J.text('#fdBody .post .cap')) && (await J.page.$eval('#fdBody .post video', (v) => v.getAttribute('src'))).endsWith('/dog/01.mp4#t=0.1'), 'with his clip and caption');
await shot(J, 'home-feed');
await J.click('#fdNew'); await J.run(800); await J.click('#npKind [data-k="reel"]'); await J.run(300); await J.click('#npPost'); await J.run(1500);
eq((w.db().posts || []).map((p) => p.kind).sort(), ['clip', 'reel'], 'he can post his player reel too');

// ---------- Ethan follows him: Jake's posts show on Ethan's Home; likes
db = w.db(); db.follows.push({ follower: db.users[0].id, followee: 'u-jake', status: 'accepted', at: Date.now() }); w.setDb(db);
await A.click('#tabs [data-tab="feed"]'); await A.run(1200);
eq(await A.page.$$eval('#fdBody .post header b', (b) => b.map((x) => x.textContent)), ['Chappers', 'Chappers'], 'people Ethan follows show on his Home, newest first');
// videos, like Instagram: a first-frame thumbnail; the top one on screen plays (muted, looping) and the next takes over as you scroll
await A.page.evaluate(() => { window.__p = []; HTMLMediaElement.prototype.play = function () { window.__p.push(['play', this.closest('[data-post]').getAttribute('data-post'), this.muted]); this.dispatchEvent(new Event('play')); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () { window.__p.push(['pause', this.closest('[data-post]').getAttribute('data-post')]); this.dispatchEvent(new Event('pause')); }; });
await A.click('#tabs [data-tab="games"]').catch(() => {}); await A.click('#tabs [data-tab="feed"]'); await A.run(1500);
const ids = await A.page.$$eval('#fdBody .post', (x) => x.map((y) => y.getAttribute('data-post')));
const vattrs = await A.page.$$eval('#fdBody .post video', (v) => v.map((x) => [x.muted, x.loop, x.hasAttribute('playsinline'), /#t=0\.1$/.test(x.getAttribute('src')), x.hasAttribute('controls')]));
eq(vattrs, [[true, true, true, true, false], [true, true, true, true, false]], 'each post\'s video shows its first frame as a thumbnail, muted and looping, with no play button over it');
const playing = () => A.page.evaluate(() => { const on = {}; window.__p.forEach((x) => { on[x[1]] = x[0] === 'play'; }); return Object.keys(on).filter((k) => on[k]); });
eq(await playing(), [ids[0]], 'the top video on screen plays by itself');
await A.page.evaluate(() => { document.querySelector('#fdBody').style.paddingBottom = '900px'; const v = document.querySelectorAll('#fdBody .post video')[1]; window.scrollTo(0, v.getBoundingClientRect().top + window.scrollY - 80); });
await A.run(800);
eq(await playing(), [ids[1]], 'scrolling down: the next one plays and the one above stops');
check(await A.page.evaluate(() => window.__p.filter((x) => x[0] === 'play').every((x) => x[2] === true)), 'muted to start with');
await A.click('#fdBody .post:nth-of-type(2) [data-snd]'); await A.run(200);
eq([await A.text('#fdBody .post:nth-of-type(2) [data-snd]'), await A.page.$$eval('#fdBody .post video', (v) => v.map((x) => x.muted))], ['Sound on', [false, false]], 'a tap turns the sound on, for the ones after it too');
await A.page.evaluate(() => window.scrollTo(0, 0)); await A.run(600);
eq(await playing(), [ids[0]], 'scrolling back up plays the top one again');
await A.click('#fdBody .post:nth-of-type(1) video'); await A.run(800);
eq([await playing(), await A.page.$$eval('#fdBody .pvid.held', (x) => x.length)], [[], 1], 'one tap on the video that\'s playing pauses it, with a play sign over it');
await A.page.evaluate(() => window.scrollBy(0, 30)); await A.run(600);
eq(await playing(), [], 'and it stays paused while it\'s on screen');
await A.click('#fdBody .post:nth-of-type(2) video'); await A.run(600);
eq(await playing(), [ids[1]], 'a tap on the video below plays that one');
await A.click('#fdBody .post:nth-of-type(1) video'); await A.run(600);
eq([await playing(), await A.page.$$eval('#fdBody .pvid.held', (x) => x.length)], [[ids[0]], 0], 'and a tap back on the first stops the second and plays the first');
check(await A.page.$$eval('#fdBody .post video', (v) => v.every((x) => x.muted === false)), 'taps on the video don\'t change the sound (that\'s the Sound button)');
await A.click('#tabs [data-tab="profile"]'); await A.run(600);
eq(await playing(), [], 'and leaving Home stops it');
await A.click('#tabs [data-tab="feed"]'); await A.run(1200);
await A.page.evaluate(() => { document.querySelector('#fdBody').style.paddingBottom = ''; window.scrollTo(0, 0); });
await A.click('#fdBody .post:nth-of-type(2) [data-like]'); await A.run(800);
eq([(w.db().post_likes || []).filter((l) => l.liked).length, await A.text('#fdBody .post:nth-of-type(2) [data-like] span')], [1, '1'], 'a post can be liked');
await A.click('#fdBody .post:nth-of-type(2) [data-like]'); await A.run(800);
eq((w.db().post_likes || []).filter((l) => l.liked).length, 0, 'and unliked');
await A.click('#fdBody .post:nth-of-type(1) [data-pmore]'); await A.click('#fdBody [data-preport][data-why="Spam"]'); await A.run(800);
eq((w.db().post_reports || []).map((r) => r.reason), ['Spam'], 'someone else\'s post can be reported');
check(!(await A.page.$$eval('#fdBody [data-pdel]', (x) => x.length)), 'but not taken down');

// ---------- profiles: Instagram-style, with a grid of posts
await A.click('#fdBody .post header .who'); await A.run(1200);
eq([await A.view(), await A.text('#prTitle')], ['profile', '@Chappers'], 'tapping a post\'s name opens their profile');
eq(await A.page.$$eval('#prBody .igcounts b', (b) => b.map((x) => x.textContent)), ['2', '1', '0'], 'posts, followers and following counts');
eq(await A.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 2, 'and a grid of their posts');
await shot(A, 'profile-grid');
await A.click('#prBody .ptile:first-child'); await A.run(500);
eq([await A.visible('#postView'), await A.page.$$eval('#pvBody .post', (x) => x.length)], [true, 1], 'tapping one opens it');
await A.click('#pvClose');
await A.click('#tabs [data-tab="profile"]'); await A.run(1000);
eq([await A.text('#prTitle'), await A.visible('#prGear'), await A.visible('#prBack')], ['@gaffer_ethan', true, false], 'the Profile tab is your own, with Settings behind the gear');
check(/Share your first moment/.test(await A.text('#prBody')), 'with nothing posted, it offers to post');
await A.click('#prGear'); await A.run(500);
eq(await A.view(), 'options', 'Settings now lives behind your profile');
await A.click('#optBack'); await A.run(500);
eq(await A.view(), 'profile', 'and goes back there');

// ---------- Jake takes a post down
await J.click('#tabs [data-tab="profile"]'); await J.run(1200);
eq(await J.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 2, 'Jake\'s own grid');
await J.click('#prBody .ptile:first-child'); await J.run(500);
await J.click('#pvBody [data-pmore]'); await J.click('#pvBody [data-pdel]'); check(/Tap again/.test(await J.text('#pvBody')), 'deleting takes two taps');
await J.click('#pvBody [data-pdel]'); await J.run(1000);
eq([await J.visible('#postView'), await J.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), (w.db().posts || []).filter((p) => !p.removed_at).length], [false, 1, 1], 'his post is gone');

// ---------- any video stops when it goes off screen: another tab, or scrolled away
await A.page.reload(); await A.run(2500);
await A.page.evaluate(() => { window.__v = [];
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this.__on2; } });
  HTMLMediaElement.prototype.play = function () { this.__on2 = true; window.__v.push('play'); this.dispatchEvent(new Event('play')); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () { if (this.__on2) window.__v.push('pause'); this.__on2 = false; this.dispatchEvent(new Event('pause')); }; });
const anyOn = () => A.page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.hasAttribute('data-auto')).length);
await A.click('#tabs [data-tab="home"]'); await A.run(300); await A.click('#mHighlights'); await A.run(400);
await A.page.evaluate(() => document.querySelectorAll('#hlList details.allclips').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); }));
await A.page.evaluate(() => document.querySelector('#hlList .vplayer video').play()); await A.run(300);
eq(await anyOn(), 1, 'a highlight playing');
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]'); if (b) b.click(); }); await A.run(400);
eq(await anyOn(), 0, 'stops when you go to another screen');
await A.click('#mHighlights'); await A.run(400);
await A.page.evaluate(() => document.querySelectorAll('#hlList details.allclips').forEach((d) => { d.open = true; }));
await A.page.evaluate(() => document.querySelector('#hlList .vplayer video').play()); await A.run(300);
await A.page.evaluate(() => { document.querySelector('#hlList').style.paddingBottom = '2000px'; window.scrollTo(0, document.body.scrollHeight); }); await A.run(600); await A.page.waitForTimeout(400); await A.run(100); // (the screen watcher reports on the browser's real drawing cycle)
eq(await anyOn(), 0, 'and when it\'s scrolled off screen');
await A.page.evaluate(() => { document.querySelector('#hlList').style.paddingBottom = ''; window.scrollTo(0, 0); }); await A.run(300);
await A.click('#hlList .mhbtn'); await A.run(400);
eq([await A.visible('#mhPop'), await anyOn()], [true, 1], 'the whole match\'s highlights play full screen');
await A.page.evaluate(() => { const b = document.querySelector('#tabs [data-tab="feed"]'); b.click(); }); await A.run(500);
eq([await A.visible('#mhPop'), await anyOn()], [false, 0], 'and stop, and close, on going to another tab');

await w.close();
await done(A, J);
