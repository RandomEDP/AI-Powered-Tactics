// Home's two feeds (Ethan, October 2026): Following (people you follow, newest first) and All (everyone whose profile is
// public, most liked first, with a line once you've seen everything new). A phone that's just downloaded Gaffer and isn't
// in a team opens on All, signed out.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: Home, Following and All');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const order = (P) => P.page.$$eval('#fdBody > .post, #fdBody > .fdcaught', (x) => x.map((y) => y.classList.contains('fdcaught') ? '|' : y.querySelector('.cap').textContent.replace(/^\S+ /, '')));
const pressed = (P) => P.page.$$eval('#fdTabs button', (b) => b.map((x) => x.textContent + ':' + x.getAttribute('aria-pressed')));

// ---------- a team, and four people's posts: three public profiles, one private
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
let db = w.db(); const team = db.teams[0], now = Date.now();
db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword' }, { id: 'u-sam', email: 'sam@example.com', password: 'longpassword' }, { id: 'u-pri', email: 'pri@example.com', password: 'longpassword' });
db.profiles.push({ user_id: 'u-jake', username: 'Chappers', name: 'Jake', private: false, pins: [] }, { user_id: 'u-sam', username: 'samwise', name: 'Sam', private: false, pins: [] }, { user_id: 'u-pri', username: 'quiet1', name: 'Pri', private: true, pins: [] });
const post = (id, user, caption, ago, likes) => { db.posts = db.posts || []; db.post_likes = db.post_likes || [];
  db.posts.push({ id, user_id: user, team_id: team.id, kind: 'reel', path: team.id + '/players/' + id + '.mp4', store: 'r2', caption, created_at: now - ago * 60000 });
  for (let i = 0; i < likes; i++) db.post_likes.push({ post_id: id, user_id: 'liker' + i, liked: true }); };
post('p-jake1', 'u-jake', 'Jake old', 300, 2); post('p-sam1', 'u-sam', 'Sam top', 200, 5); post('p-pri', 'u-pri', 'Private one', 100, 9); post('p-jake2', 'u-jake', 'Jake new', 10, 0);
w.setDb(db);

// ---------- a new phone: the swipe-through, then straight onto All, signed out
const N = await w.phone({ db: true, label: 'new' });
await N.page.evaluate(() => { const a = JSON.parse(localStorage.getItem('apt-app')); a.introSeen = false; localStorage.setItem('apt-app', JSON.stringify(a)); }); await N.page.reload(); await N.run(800);
check(await N.visible('#v-intro'), 'a new phone starts with the swipe-through');
await N.click('#introSkip'); await N.run(1200);
eq([await N.view(), await pressed(N)], ['feed', ['Following:false', 'All:true']], 'then opens on Home, on All, not the team-code screen');
eq(await order(N), ['Sam top', 'Jake old', 'Jake new'], 'everyone\'s public posts, most liked first; never a private profile\'s');
check(/Welcome to Gaffer/.test(await N.text('#fdBody')) && await N.visible('#fdBody [data-fd="signin"]') && await N.visible('#fdBody [data-fd="teams"]'), 'with a welcome to sign in or put in a team code');
await shot(N, 'all-signed-out');
await N.click('#fdBody [data-like="p-sam1"]'); await N.run(400);
eq([await N.view(), await N.text('#v-account .back')], ['account', 'Home'], 'liking needs an account: it asks them to sign in');
await N.click('#v-account .back'); await N.run(400);
eq(await N.view(), 'feed', 'and back goes back to Home');
await N.click('#fdTabs [data-fdtab="following"]'); await N.run(300);
check(/Sign in to follow people/.test(await N.text('#fdBody')) && !(await N.page.$('#fdBody .post')), 'Following, signed out, asks them to sign in');
await N.click('#fdTabs [data-fdtab="all"]'); await N.run(300);

// ---------- what's been seen goes below "You're all caught up"
await N.page.setViewportSize({ width: 390, height: 300 }); await N.page.evaluate(() => { localStorage.removeItem('apt-feed-all-seen'); document.querySelector('#fdBody').style.paddingBottom = '900px'; window.scrollTo(0, 0); }); await N.run(300);
for (const id of ['p-sam1', 'p-jake1']) { await N.page.evaluate((i) => document.querySelector('[data-post="' + i + '"]').scrollIntoView(), id); await N.run(400); await N.page.waitForTimeout(150); }
eq(await N.page.evaluate(() => JSON.parse(localStorage.getItem('apt-feed-all-seen')).sort()), ['p-jake1', 'p-sam1'], 'posts are marked seen once they\'ve been on screen');
eq(await order(N), ['Sam top', 'Jake old', 'Jake new'], 'and nothing moves while they\'re looking');
db = w.db(); db.posts.push({ id: 'p-sam2', user_id: 'u-sam', team_id: team.id, kind: 'reel', path: team.id + '/players/s2.mp4', store: 'r2', caption: 'Sam fresh', created_at: Date.now() }); db.post_likes.push({ post_id: 'p-sam2', user_id: 'x', liked: true }); w.setDb(db);
await N.page.reload(); await N.run(1200);
eq(await N.view(), 'feed', 'opened again with no team, it\'s still Home');
eq(await order(N), ['Sam fresh', 'Jake new', '|', 'Sam top', 'Jake old'], 'new ones first (most liked first), then the line, then the ones already seen');
check(/You’re all caught up/.test(await N.text('#fdCaught')), 'the line says they\'re all caught up');
await N.page.setViewportSize({ width: 390, height: 844 }); await N.page.evaluate(() => window.scrollTo(0, 0)); await N.run(300);
await shot(N, 'all-caught-up');
await N.page.evaluate(() => localStorage.setItem('apt-feed-all-seen', JSON.stringify(['p-sam1', 'p-jake1', 'p-jake2', 'p-sam2']))); await N.page.reload(); await N.run(1200);
eq((await order(N))[0], '|', 'seen everything: the line comes first');
check(/Nothing new since you last looked/.test(await N.text('#fdCaught')), 'and says there\'s nothing new');

// ---------- someone in a team, signed in: Following first, which is people they follow, newest first
db = w.db(); db.follows.push({ follower: db.users[0].id, followee: 'u-jake', status: 'accepted', at: Date.now() }); w.setDb(db);
await A.click('#tabs [data-tab="feed"]'); await A.run(1200);
eq(await pressed(A), ['Following:true', 'All:false'], 'a gaffer with a team starts on Following');
eq(await order(A), ['Jake new', 'Jake old'], 'Following is only people they follow, newest first');
await A.click('#fdTabs [data-fdtab="all"]'); await A.run(1000);
eq((await order(A)).filter((x) => x !== '|'), ['Sam top', 'Jake old', 'Sam fresh', 'Jake new'], 'All is everyone public, most liked first');
await A.click('#fdBody [data-like="p-jake2"]'); await A.run(600);
eq(w.db().post_likes.filter((l) => l.post_id === 'p-jake2' && l.liked).length, 1, 'and liking works from All');
await A.page.reload(); await A.run(1500);
await A.click('#tabs [data-tab="feed"]'); await A.run(1000);
eq((await pressed(A))[1], 'All:true', 'the phone remembers which one they were on');

await w.close();
await done(A, N);
