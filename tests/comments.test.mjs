// Comments on posts (Ethan, for 1.1: "Can we add commenting on other peoples posts"). The bubble under a post opens its
// comments; anyone who can see the post can comment; the post's author can take any comment down, anyone their own;
// someone else's can be reported or its writer blocked (Apple's 1.2). A playing video carries on while you comment.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: comments on posts');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

// ---------- Ethan's team; Jake has posted his player reel; Ethan and Sam follow him
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
let db = w.db(); const team = db.teams[0], ethan = db.users[0].id;
db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword' }, { id: 'u-sam', email: 'sam@example.com', password: 'longpassword' });
db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id = 'u-jake';
db.profiles.push({ user_id: 'u-jake', username: 'Chappers', name: 'Jake Smith', private: false, pins: [] }, { user_id: 'u-sam', username: 'samwise', name: 'Sam', private: false, pins: [] });
db.posts = [{ id: 'p-1', user_id: 'u-jake', team_id: team.id, kind: 'reel', game_id: null, at: null, path: team.id + '/players/2/reel-1.mp4', store: 'r2', caption: 'Top bins', created_at: Date.now(), removed_at: null }];
db.follows.push({ follower: ethan, followee: 'u-jake', status: 'accepted', at: Date.now() }, { follower: 'u-sam', followee: 'u-jake', status: 'accepted', at: Date.now() });
w.setDb(db);
const signIn = async (email) => { const P = await w.phone({ db: true, label: email }); await P.click('#acctBtn'); await P.page.fill('#aEmail', email); await P.page.fill('#aPass', 'longpassword'); await P.click('#aSignIn'); await P.run(1500);
  if (await P.visible('#tmAgree')) { await P.click('#tmAgree'); await P.run(300); } await P.click('#pplBtn'); await P.run(1200); return P; };

await A.click('#tabs [data-tab="feed"]'); await A.run(1200);
eq([await A.text('#fdBody .post .pbar [data-pcm] span'), await A.page.$$eval('#fdBody .pcm .pcmform', (x) => x.length)], ['0', 0], 'a post has a comment bubble with how many there are, and the comments are folded away');
await A.page.evaluate(() => { window.__vid = document.querySelector('#fdBody .post video'); });
await A.click('#fdBody .post .pbar [data-pcm]'); await A.run(600);
check(/No comments yet/.test(await A.text('#fdBody .pcm')) && await A.visible('#fdBody .pcmform input'), 'the bubble opens them, with a box to add one');
await A.page.fill('#fdBody .pcmform input', 'What a strike'); await A.click('#fdBody .pcmform button'); await A.run(800);
eq((w.db().post_comments || []).map((c) => [c.user_id === ethan, c.body]), [[true, 'What a strike']], 'Ethan comments on Jake\'s post');
eq([await A.text('#fdBody .pcmt p'), await A.text('#fdBody .post .pbar [data-pcm] span'), await A.page.$eval('#fdBody .pcmform input', (x) => x.value)], ['gaffer_ethan What a strike', '1', ''], 'it shows under the post with his name, the count goes up and the box empties');
check(await A.page.evaluate(() => window.__vid === document.querySelector('#fdBody .post video')), 'the video isn\'t redrawn, so a playing one carries on');
await A.page.fill('#fdBody .pcmform input', 'You absolute ' + 'phag'.replace(/[a-z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97))); await A.click('#fdBody .pcmform button'); await A.run(500);
check(/word Gaffer doesn’t allow/.test(await A.text('#fdBody .pcm')) && (w.db().post_comments || []).length === 1, 'the word filter stops a nasty comment before it\'s sent');
await A.page.fill('#fdBody .pcmform input', '');
await A.click('#fdBody .pcmt [data-cmore]'); await A.run(200);
check(/Delete this comment/.test(await A.text('#fdBody .pcm')) && !/Report this comment/.test(await A.text('#fdBody .pcm')), 'his own comment: ⋯ offers Delete, not Report');
await A.click('#fdBody .pcmt [data-cmore]'); await shot(A, 'comments');

// ---------- Sam comments too; Jake, whose post it is, takes Sam's down and reports and blocks him
const S = await signIn('sam@example.com');
await S.click('#fdBody .post .pbar [data-pcm]'); await S.run(600);
eq(await S.text('#fdBody .pcmt p'), 'gaffer_ethan What a strike', 'Sam sees Ethan\'s comment');
await S.click('#fdBody .pcmt [data-cmore]'); await S.run(200);
check(!(await S.page.$$eval('#fdBody [data-cdel]', (x) => x.length)) && /Report this comment/.test(await S.text('#fdBody .pcm')) && /Block @gaffer_ethan/.test(await S.text('#fdBody .pcm')), 'someone else\'s comment on someone else\'s post: Report and Block, no Delete');
await S.click('#fdBody .pcmt [data-cmore]');
await S.page.fill('#fdBody .pcmform input', 'Offside'); await S.page.press('#fdBody .pcmform input', 'Enter'); await S.run(800);
eq((w.db().post_comments || []).length, 2, 'Sam comments (Enter sends it)');

const J = await signIn('jake@example.com');
eq(await J.text('#fdBody .post .pcm .link'), 'View all 2 comments', 'Jake sees there are two comments on his post');
await J.click('#fdBody .post .pcm .link'); await J.run(600);
eq(await J.page.$$eval('#fdBody .pcmt p', (x) => x.map((y) => y.textContent)), ['gaffer_ethan What a strike', 'samwise Offside'], 'oldest first');
await J.click('#fdBody .pcmt:nth-of-type(2) [data-cmore]'); await J.run(200);
check(/Delete this comment/.test(await J.text('#fdBody .pcm')) && /Report this comment/.test(await J.text('#fdBody .pcm')), 'on his own post he can delete anyone\'s comment, and still report it');
await J.click('#fdBody [data-crep][data-why="Bullying"]'); await J.run(600);
eq((w.db().comment_reports || []).map((r) => [r.user_id, r.reason]), [['u-jake', 'Bullying']], 'he reports it');
check(/within 24 hours/.test(await J.text('#fdBody .pcm')), 'and is told Gaffer will look at it within a day');
await J.click('#fdBody .pcmt:nth-of-type(2) [data-cmore]'); await J.click('#fdBody [data-cdel]'); await J.run(100);
check(/Tap again/.test(await J.text('#fdBody .pcm')), 'deleting takes two taps');
await J.click('#fdBody [data-cdel]'); await J.run(600);
eq([(w.db().post_comments || []).filter((c) => !c.removed_at).map((c) => c.body), await J.text('#fdBody .post .pbar [data-pcm] span')], [['What a strike'], '1'], 'Sam\'s comment is gone');

// Sam comments again; Jake blocks him from the comment
await S.page.fill('#fdBody .pcmform input', 'Still offside'); await S.click('#fdBody .pcmform button'); await S.run(800);
await J.click('#fdBody .post .pbar [data-pcm]'); await J.click('#fdBody .post .pbar [data-pcm]'); await J.run(600);
await J.click('#fdBody .pcmt:nth-of-type(2) [data-cmore]'); await J.click('#fdBody [data-cblock]'); await J.run(600);
eq([(w.db().blocks || []).map((b) => [b.blocker, b.blocked]), await J.page.$$eval('#fdBody .pcmt', (x) => x.length)], [[['u-jake', 'u-sam']], 1], 'blocking Sam from his comment: they\'re blocked, and his comments go from Jake\'s screen');
await S.click('#fdBody .post .pbar [data-pcm]'); await S.click('#fdBody .post .pbar [data-pcm]'); await S.run(600);
check(/isn’t there any more/.test(await S.text('#fdBody .pcm')), 'and Sam can\'t read Jake\'s post\'s comments any more');
done();
