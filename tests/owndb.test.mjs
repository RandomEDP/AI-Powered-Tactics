// Your own short clips in the database (0049): a video you uploaded to your own folder becomes a post of kind 'own', with
// no team. Only a file in your own folder, 30 seconds at most, and once; it shows in Following, All and on your profile
// like any other post, and can be liked, commented on, tagged, reported and taken down.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: your own short clips');
const d = await database();
eq(d.applied.includes('0049_own_clips.sql'), true, 'the own clips migration applies on top of the others');

const jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com'), pri = await d.user('pri@example.com'), anon = await d.user('anon@example.com');
eq(await d.rpc(jake, 'set_profile', { p_username: 'Chappers', p_name: 'Jake' }), 'ok', '(Jake has a username)');
eq(await d.rpc(sam, 'set_profile', { p_username: 'samwise', p_name: 'Sam' }), 'ok', '(so does Sam, a stranger)');
eq(await d.rpc(pri, 'set_profile', { p_username: 'quiet_pri', p_name: 'Pri', p_private: true }), 'ok', '(and Pri, who is private)');
const mine = (who, name = 'abc123') => `users/${who.id}/${name}.mp4`;

// ---------- posting
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'create_own_post', { p_path: mine(jake), p_dur: 12 }))), 'nobody can post without signing in');
eq((await d.rpc(anon, 'create_own_post', { p_path: mine(anon), p_dur: 12 })).error, 'no_profile', 'you need a username to post');
eq((await d.rpc(jake, 'create_own_post', { p_path: mine(sam), p_dur: 12 })).error, 'not_yours', 'only a file in your own folder');
for (const bad of [`users/${jake.id}/../x.mp4`, `users/${jake.id}/a/b.mp4`, `users/${jake.id}/clip.mov`, `t-sop/players/1/reel.mp4`, ''])
  eq((await d.rpc(jake, 'create_own_post', { p_path: bad, p_dur: 12 })).error, 'not_yours', `and nothing else (${bad || 'nothing'})`);
eq((await d.rpc(jake, 'create_own_post', { p_path: mine(jake), p_dur: 45 })).error, 'too_long', 'over 30 seconds is turned down');
eq((await d.rpc(jake, 'create_own_post', { p_path: mine(jake), p_dur: 0 })).error, 'too_long', 'as is nothing at all');
const p1 = await d.rpc(jake, 'create_own_post', { p_path: mine(jake), p_dur: 29.6, p_caption: '  Rabona   in the cage ' });
check(typeof p1.id === 'string', 'a clip of 30 seconds or less posts');
eq((await d.rpc(jake, 'create_own_post', { p_path: mine(jake), p_dur: 12 })).error, 'not_yours', 'the same file can\'t be posted twice');
const row = (await d.admin(`select team_id, kind, store, dur, caption from public.posts where id = $1`, [p1.id]))[0];
eq([row.team_id, row.kind, row.store, Math.round(row.dur * 10) / 10, row.caption], [null, 'own', 'r2', 29.6, 'Rabona in the cage'], 'it\'s kept with no team, in R2, with its length and caption');

// ---------- seeing it
const shown = (await d.rpc(jake, 'get_feed'))[0];
eq([shown.kind, shown.team, shown.video.path, shown.video.store, shown.video.label, Math.round(shown.video.dur * 10) / 10, shown.mine], ['own', null, mine(jake), 'r2', 'Own clip', 29.6, true], 'it\'s on his own Home, with the video');
eq((await d.rpc(null, 'public_feed')).map((x) => x.caption), ['Rabona in the cage'], 'in All, even signed out');
eq((await d.rpc(sam, 'user_posts', { p_username: 'chappers' })).map((x) => x.kind), ['own'], 'and on his profile');
await d.rpc(sam, 'follow', { p_username: 'chappers' });
eq((await d.rpc(sam, 'get_feed')).map((x) => x.caption), ['Rabona in the cage'], 'in Following for people who follow him');
eq((await d.rpc(sam, 'like_post', { p_id: p1.id })).likes, 1, 'it can be liked');
eq(typeof (await d.rpc(sam, 'add_comment', { p_id: p1.id, p_body: 'Filth' })).comment.id, 'string', 'commented on');
eq(await d.rpc(jake, 'tag_post', { p_id: p1.id, p_tags: ['samwise'] }), 1, 'tagged');
eq(await d.rpc(sam, 'report_post', { p_id: p1.id, p_reason: 'Offensive' }), true, 'and reported to Gaffer');
const pp = await d.rpc(pri, 'create_own_post', { p_path: mine(pri), p_dur: 8 });
eq([(await d.rpc(null, 'public_feed')).length, await d.rpc(sam, 'user_posts', { p_username: 'quiet_pri' })], [1, null], 'a private profile\'s clip stays with the people they\'ve accepted');
check(typeof pp.id === 'string', '(Pri posted hers)');
await d.rpc(jake, 'block_user', { p_username: 'samwise' });
eq([await d.rpc(sam, 'get_feed'), await d.rpc(sam, 'like_post', { p_id: p1.id })], [[], null], 'blocked people never see it');
await d.rpc(jake, 'block_user', { p_username: 'samwise', p_block: false });

// ---------- taking it down
eq(await d.rpc(sam, 'remove_post', { p_id: p1.id }), false, 'nobody else can take it down');
eq([await d.rpc(jake, 'remove_post', { p_id: p1.id }), await d.rpc(jake, 'user_posts', { p_username: 'chappers' })], [true, []], 'but he can');
check(typeof (await d.rpc(jake, 'create_own_post', { p_path: mine(jake, 'again'), p_dur: 5 })).id === 'string', 'and post another');
for (let i = 0; i < 28; i++) await d.rpc(jake, 'create_own_post', { p_path: mine(jake, 'n' + i), p_dur: 5 });
eq((await d.rpc(jake, 'create_own_post', { p_path: mine(jake, 'one_more'), p_dur: 5 })).error, 'too_many', '30 posts a day at most, as before');

// ---------- the old kinds still need a team
check(/posts_team_check|violates/i.test(await d.fails(d.admin(`insert into public.posts (user_id, kind, caption) values ($1, 'reel', 'x')`, [jake.id]))), 'a clip or reel post still has to be in a team');
eq(await d.admin(`select count(*)::int as n from public.posts where kind = 'own'`).then((r) => r[0].n), 31, '(every own clip is kept as a post)');
done();
