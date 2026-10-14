// Teammates, names and tags. Ethan's asks: tap someone's name pretty much anywhere it makes sense to go to their profile;
// everyone on your team is followed automatically; people can be tagged in posts.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: teammates, names and tags');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const fol = (a, b) => ((w.db().follows || []).find((f) => f.follower === a && f.followee === b) || {}).status || null;

// ---------- Ethan's team, a game Jake scores in
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(300);
let db = w.db(); const team = db.teams[0], game = db.games[0], ethanId = db.users[0].id;
db.clips.push({ team_id: team.id, game_id: game.id, seq: 0, path: team.id + '/dog/01.mp4', store: 'r2', at: 1791660000000, dur: 14, pids: [2], label: '2\' Goal: Jake' });
db.users.push({ id: 'u-sam', email: 'sam@example.com', password: 'longpassword' }); db.profiles.push({ user_id: 'u-sam', username: 'samwise', name: 'Sam Gamgee', private: false, pins: [] });
w.setDb(db);

// ---------- Jake joins the squad as himself: he and Ethan follow each other straight away
const J = await w.phone({ db: true, label: 'jake' });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'Chappers'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
db = w.db(); const jakeId = db.users.find((u) => u.email === 'jake@example.com').id;
eq(db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id, jakeId, 'Jake joins as himself');
eq([fol(jakeId, ethanId), fol(ethanId, jakeId)], ['accepted', 'accepted'], 'and he and his gaffer follow each other straight away, without asking');
eq(fol(jakeId, 'u-sam'), null, 'nobody off the team is followed for him');

// ---------- names open profiles: the squad, stats, insights, highlights and chat
await A.page.reload(); await A.run(2500); if (await A.view() !== 'home') { await A.click('#tabs [data-tab="home"]'); await A.run(800); }
const nameLink = (P, sel) => P.page.$$eval(sel + ' .plink', (b) => b.map((x) => x.textContent + '>' + x.getAttribute('data-plink')));
eq(await nameLink(A, '#squadList'), ['Jake>Chappers'], 'on the team page, a player with a profile has their name as a link (only Jake has one)');
await A.click('#squadList .plink'); await A.run(1200);
eq([await A.view(), await A.text('#prTitle')], ['profile', '@Chappers'], 'tapping it opens his profile');
await A.click('#prBack'); await A.run(400);
eq(await A.view(), 'home', 'and back goes back');
await A.click('#mStats'); await A.run(400);
eq(await nameLink(A, '#season'), ['Jake>Chappers'], 'the stats table');
await A.click('#season .plink'); await A.run(1000);
eq(await A.text('#prTitle'), '@Chappers', 'opens it too');
await A.click('#prBack'); await A.run(400); eq(await A.view(), 'stats', 'back to the stats');
await home(A); await A.run(300); await A.click('#mInsights'); await A.run(400);
check((await nameLink(A, '#v-insights')).every((x) => x === 'Jake>Chappers') && (await nameLink(A, '#v-insights')).length >= 2, 'insights: ratings, form and link-ups');
await home(A); await A.run(300); await A.click('#mHighlights'); await A.run(300); await A.click('#hlToggle [data-by="player"]'); await A.run(300);
eq(await nameLink(A, '#hlList .hcard h3'), ['Jake>Chappers'], 'highlights, by player');
await shot(A, 'names-highlights');
await J.click('#tabs [data-tab="chat"]'); await J.run(600); await J.page.fill('#chatText', 'Who\'s driving?'); await J.page.press('#chatText', 'Enter'); await J.run(800);
await home(A); await A.run(300); await A.click('#tabs [data-tab="chat"]'); await A.run(1200);
eq(await nameLink(A, '#chatBody'), ['Jake>Chappers'], 'and the chat');
await A.click('#chatBody .plink'); await A.run(1000);
eq(await A.text('#prTitle'), '@Chappers', 'where tapping a name opens their profile, not the message menu');
eq(await J.page.$$eval('#chatBody .plink', (b) => b.length), 0, 'your own messages say You, with no link');

// ---------- tagging people in a post
await J.click('#tabs [data-tab="feed"]'); await J.run(1000); await J.click('#fdNew'); await J.run(1200);
eq(await J.page.$$eval('#npTagList [data-tagu]', (b) => b.map((x) => x.getAttribute('data-tagu'))), ['gaffer_ethan'], 'a new post suggests people to tag: everyone he follows, his teammates among them');
await J.click('#npTagList [data-tagu="gaffer_ethan"]');
await J.page.fill('#npTagQ', 'sam'); await J.run(800);
eq(await J.page.$$eval('#npTagList [data-tagu]', (b) => b.map((x) => x.getAttribute('data-tagu'))), ['samwise'], 'anyone else can be found by name');
await J.click('#npTagList [data-tagu="samwise"]'); await J.run(200);
eq(await J.page.$$eval('#npTags [data-untag]', (b) => b.map((x) => x.textContent)), ['@gaffer_ethan ✕', '@samwise ✕'], 'the people tagged so far, each can be taken off');
await J.page.fill('#npCap', 'Top bins'); await shot(J, 'tag-people');
await J.click('#npPost'); await J.run(1500);
db = w.db(); const post = db.posts[0];
eq((db.post_tags || []).filter((g) => g.post_id === post.id).map((g) => g.user_id).sort(), [ethanId, 'u-sam'].sort(), 'Shared, with both tagged');
eq(await J.page.$$eval('#fdBody .post .ptags .plink', (b) => b.map((x) => x.textContent)), ['@gaffer_ethan', '@samwise'], 'the post says who\'s in it');
await shot(J, 'tagged-post');

// Ethan: his feed has it (he follows Jake), the tag opens his own profile, which has a Tagged tab
await A.click('#tabs [data-tab="feed"]'); await A.run(1200);
eq(await A.page.$$eval('#fdBody .post .ptags .plink', (b) => b.map((x) => x.textContent)), ['@gaffer_ethan', '@samwise'], 'Ethan sees the post, tagged');
await A.click('#fdBody .post .ptags .plink[data-plink="samwise"]'); await A.run(1000);
eq(await A.text('#prTitle'), '@samwise', 'tapping a tag opens that person\'s profile');
await A.click('#prBack'); await A.run(500);
await A.click('#tabs [data-tab="profile"]'); await A.run(1200);
await A.click('#prBody [data-ptab="tagged"]'); await A.run(300);
eq(await A.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 1, 'his profile\'s Tagged tab has the post he\'s tagged in');
await shot(A, 'tagged-tab');
await A.click('#prBody .ptile'); await A.run(400); await A.click('#pvBody [data-pmore]');
eq(await A.visible('#pvBody [data-puntag]'), true, 'someone tagged can take themselves off it');
await A.click('#pvBody [data-puntag]'); await A.run(1000);
eq([(w.db().post_tags || []).find((g) => g.user_id === ethanId).removed, await A.page.$$eval('#pvBody .ptags .plink', (b) => b.map((x) => x.textContent))], [true, ['@samwise']], 'which leaves the post, without him');
await A.click('#pvClose'); await A.run(300);
eq(await A.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 0, 'and off his Tagged tab');

await w.close();
await done(A, J);
