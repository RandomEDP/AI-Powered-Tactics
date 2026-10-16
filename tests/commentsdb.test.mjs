// Comments on posts in the database (0039): anyone who can see a post comments on it; whoever wrote a comment, or the
// post's author, can take it down; comments can be reported; blocked people never see each other's comments.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: comments on posts');
const d = await database();
eq(d.applied.includes('0039_post_comments.sql'), true, 'the comments migration applies on top of the others');

const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com'), pri = await d.user('pri@example.com'), anon = await d.user('anon@example.com');
eq(await d.rpc(ethan, 'set_profile', { p_username: 'gaffer_ethan', p_name: 'Ethan' }), 'ok', '(Ethan has a username)');
eq(await d.rpc(jake, 'set_profile', { p_username: 'Chappers', p_name: 'Jake' }), 'ok', '(so does Jake)');
eq(await d.rpc(sam, 'set_profile', { p_username: 'samwise', p_name: 'Sam' }), 'ok', '(and Sam, a stranger)');
eq(await d.rpc(pri, 'set_profile', { p_username: 'quiet_pri', p_name: 'Pri', p_private: true }), 'ok', '(and Pri, who is private)');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#5629d7', p_crest: null, p_settings: {}, p_players: [{ pid: 1, name: 'Jake' }] });
const post = async (who) => (await d.admin(`insert into public.posts (user_id, team_id, kind, caption) values ($1, $2, 'reel', 'Top bins') returning id`, [who.id, sop.id]))[0].id;
const jp = await post(jake), pp = await post(pri);

// ---------- commenting
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'add_comment', { p_id: jp, p_body: 'Hi' }))), 'nobody can comment without signing in');
eq((await d.rpc(anon, 'add_comment', { p_id: jp, p_body: 'Hi' })).error, 'no_profile', 'you need a username to comment');
eq((await d.rpc(sam, 'add_comment', { p_id: jp, p_body: '   ' })).error, 'empty', 'an empty comment isn\'t sent');
const c1 = (await d.rpc(sam, 'add_comment', { p_id: jp, p_body: '  What   a strike  ' })).comment;
eq([c1.body, c1.username, c1.mine, c1.can_remove], ['What a strike', 'samwise', true, true], 'anyone who can see a public post comments on it');
const c2 = (await d.rpc(ethan, 'add_comment', { p_id: jp, p_body: 'x'.repeat(400) })).comment;
eq(c2.body.length, 300, 'a comment is kept to 300 characters');
eq((await d.rpc(sam, 'add_comment', { p_id: pp, p_body: 'Hi' })).error, 'missing', 'a private account\'s post can\'t be commented on by someone they haven\'t accepted');
eq(await d.rpc(sam, 'post_comments', { p_id: pp }), null, 'nor its comments read');

let list = await d.rpc(jake, 'post_comments', { p_id: jp });
eq(list.map((c) => [c.username, c.mine, c.can_remove]), [['samwise', false, true], ['gaffer_ethan', false, true]], 'the post\'s author sees every comment, oldest first, and can take any of them down');
list = await d.rpc(ethan, 'post_comments', { p_id: jp });
eq(list.map((c) => [c.username, c.mine, c.can_remove]), [['samwise', false, false], ['gaffer_ethan', true, true]], 'someone else can only take their own down');
eq((await d.rpc(ethan, 'user_posts', { p_username: 'Chappers' }))[0].comments, 2, 'a post says how many comments it has');

// ---------- taking them down
eq(await d.rpc(ethan, 'remove_comment', { p_id: c1.id }), false, 'nobody can take down someone else\'s comment on someone else\'s post');
eq(await d.rpc(ethan, 'remove_comment', { p_id: c2.id }), true, 'their own, they can');
eq(await d.rpc(jake, 'remove_comment', { p_id: c1.id }), true, 'and the post\'s author can take down anyone\'s');
eq([await d.rpc(jake, 'post_comments', { p_id: jp }), (await d.rpc(jake, 'user_posts', { p_username: 'Chappers' }))[0].comments], [[], 0], 'they\'re gone, and the count follows');

// ---------- reporting and blocking
const c3 = (await d.rpc(sam, 'add_comment', { p_id: jp, p_body: 'Offside' })).comment;
eq(await d.rpc(jake, 'report_comment', { p_id: c3.id, p_reason: 'Offensive' }), true, 'a comment can be reported');
eq((await d.admin(`select reason from public.comment_reports`)).map((r) => r.reason), ['Offensive'], 'and the report is kept for Gaffer to read');
await d.rpc(jake, 'block_user', { p_username: 'samwise' });
eq(await d.rpc(sam, 'post_comments', { p_id: jp }), null, 'once blocked, Sam can\'t read the post\'s comments');
eq((await d.rpc(sam, 'add_comment', { p_id: jp, p_body: 'Hello?' })).error, 'missing', 'nor comment on it');
await d.rpc(jake, 'block_user', { p_username: 'samwise', p_block: false });
await d.rpc(ethan, 'block_user', { p_username: 'samwise' });
eq([(await d.rpc(ethan, 'post_comments', { p_id: jp })).length, (await d.rpc(jake, 'post_comments', { p_id: jp })).length], [0, 1], 'someone who blocked a commenter doesn\'t see their comments; everyone else still does');
eq((await d.rpc(ethan, 'user_posts', { p_username: 'Chappers' }))[0].comments, 0, 'nor count them');
await d.admin(`update public.posts set removed_at = now() where id = $1`, [jp]);
eq((await d.rpc(jake, 'add_comment', { p_id: jp, p_body: 'Hi' })).error, 'missing', 'a post that\'s been taken down takes no more comments');

for (const t of ['post_comments', 'comment_reports']) eq((await d.as(sam, `select count(*)::int as n from public.${t}`).catch(() => [{ n: 'denied' }]))[0].n === 'denied' || (await d.as(sam, `select count(*)::int as n from public.${t}`))[0].n === 0, true, `nobody reads ${t} directly`);
done();
