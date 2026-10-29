// The database's side of a poll's waitlist (0051): once the outfield spots are all taken a player can join the waitlist,
// and whenever a spot comes free the first one waiting moves up by themselves, in the order they joined.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: poll waitlist');
const d = await database();
const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), josh = await d.user('josh@example.com'), reece = await d.user('reece@example.com'), sam = await d.user('sam@example.com');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#1f6b4a', p_crest: null, p_settings: { half: 15 }, p_players: ['Spice', 'Jake', 'Josh', 'Reece', 'Sam'].map((name, i) => ({ pid: i + 1, name })) });
for (const [who, pid] of [[jake, 2], [josh, 3], [reece, 4], [sam, 5]]) eq(await d.rpc(who, 'claim_player', { p_code: sop.code, p_pid: pid, p_last_name: '', p_position: 'mix' }), 'ok', 'player ' + pid + ' claims their place');
const fx = '00000000-0000-4000-8000-000000000051';
await d.as(ethan, `insert into public.fixtures (id, team_id, opp, ko_at, max_outfield) values ('${fx}', '${sop.id}', 'Dog Squad', ${Date.now() + 7 * 86400000}, 2)`);
const vote = (who, choice, pid) => d.rpc(who, 'vote_fixture', Object.assign({ p_fixture: fx, p_choice: choice }, pid ? { p_pid: pid } : {}));
const seen = async () => (await d.rpc(null, 'get_team', { p_code: sop.code })).fixtures[0].votes.map((v) => v.pid + ':' + v.choice);

eq(await vote(jake, 'in'), 'ok', 'Jake is in');
eq(await vote(josh, 'wait'), 'ok', 'asking for the waitlist with a spot free just puts you in');
eq(await vote(reece, 'in'), 'full', 'once it\'s full, "I\'m in" is still "full" (what older apps understand)');
eq(await vote(reece, 'wait'), 'waiting', 'but the waitlist takes Reece');
eq(await vote(sam, 'wait'), 'waiting', 'and Sam after him');
eq(await seen(), ['2:in', '3:in', '4:wait', '5:wait'], 'everyone sees who is waiting, in the order they joined');

eq(await vote(josh, 'no'), 'ok', 'Josh drops out');
eq(await seen(), ['2:in', '5:wait', '3:no', '4:in'], 'Reece, first on the waitlist, moves up by himself (to the end of who\'s in); Sam stays waiting');
eq((await d.admin(`select pid from public.fixture_votes where fixture_id = '${fx}' and moved_at is not null and told_at is null`)).map((r) => r.pid), [4], 'Reece is marked as moved up, ready to be told');

eq(await vote(josh, 'in'), 'full', 'Josh changing his mind back finds it full');
eq(await vote(josh, 'wait'), 'waiting', 'so he joins the waitlist, behind Sam');
eq(await vote(jake, 'gk'), 'ok', 'Jake goes in goal instead');
eq((await seen()).filter((v) => /in|wait|gk/.test(v)).sort(), ['2:gk', '3:wait', '4:in', '5:in'], 'which frees his outfield spot for Sam, not Josh');

eq(await vote(sam, 'wait'), 'ok', 'someone already in asking for the waitlist stays in');
eq((await seen()).includes('5:in'), true, '(Sam is still in)');

await d.as(ethan, `update public.fixtures set max_outfield = 3 where id = '${fx}'`);
eq((await seen()).includes('3:in'), true, 'the gaffer allowing one more outfield player moves Josh up');

eq(await vote(josh, 'no'), 'ok', 'Josh out again');
eq(await vote(jake, 'wait'), 'ok', 'Jake (in goal) asking for the waitlist with a spot free and nobody waiting is simply in');
eq(await vote(ethan, 'wait', 3), 'waiting', 'the gaffer can put a player on the waitlist');
eq(await vote(ethan, 'wait', 1), 'waiting', 'Spice waits behind Josh');
await d.as(ethan, `update public.fixture_votes set choice = 'no' where fixture_id = '${fx}' and pid = 2`);
eq((await seen()).filter((v) => /^[13]:/.test(v)).sort(), ['1:wait', '3:in'], 'the gaffer changing an answer straight in the table (as the dashboard would) moves the first waiting up too');
check(/check constraint|violates/.test(await d.fails(d.as(ethan, `update public.fixture_votes set choice = 'maybe' where fixture_id = '${fx}' and pid = 1`))), 'only in, in goal, waiting or out');

await d.as(ethan, `update public.fixtures set status = 'done' where id = '${fx}'`);
eq(await vote(josh, 'wait'), 'closed', 'no waitlist once the game is done');
await done();
