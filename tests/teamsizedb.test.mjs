// The database's side of any team size (0048): polls, results and challenges take any number a side from 2 to 99, a poll
// up to 98 outfield (99 with the keeper), a challenge's subs never take a team past 99, and a friendly takes up to 99 a side.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: any team size');
const d = await database();
const ethan = await d.user('ethan@example.com');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#1f6b4a', p_crest: null, p_settings: { half: 15 }, p_players: ['Spice', 'Jake'].map((name, i) => ({ pid: i + 1, name })) });
const ko = Date.now() + 7 * 86400000;
const poll = (side, out) => d.as(ethan, `insert into public.fixtures (team_id, opp, ko_at, location, max_outfield, side, kind, fmt) values ('${sop.id}', 'Dog', ${ko}, '', ${out}, ${side}, 'game', '{}'::jsonb)`);
const bad = (e) => /check constraint|violates/.test(e);

// ---------- polls
for (const [side, out] of [[5, 7], [7, 9], [11, 14], [2, 1], [50, 98], [99, 98]]) { await poll(side, out); }
eq((await d.admin(`select side, max_outfield from public.fixtures where team_id = '${sop.id}' order by side, max_outfield`)).map((r) => r.side + ':' + r.max_outfield), ['2:1', '5:7', '7:9', '11:14', '50:98', '99:98'], 'a poll takes any side from 2 to 99, with up to 98 outfield');
check(bad(await d.fails(poll(100, 20))), 'but not 100 a side');
check(bad(await d.fails(poll(1, 1))), 'nor 1 a side');
check(bad(await d.fails(poll(11, 99))), 'nor 99 outfield (100 with the keeper)');

// ---------- results
const game = (seq, side) => d.as(ethan, `insert into public.games (id, team_id, seq, opp, us, them, side) values ('00000000-0000-4000-8000-0000000000${String(seq).padStart(2, '0')}', '${sop.id}', ${seq}, 'Dog', 2, 1, ${side})`);
await game(1, 11); await game(2, 'null'); await game(3, 99);
eq((await d.admin(`select side from public.games where team_id = '${sop.id}' order by seq`)).map((r) => r.side), [11, null, 99], 'a result keeps its side, 11 or 99 as well as 5 and 7');
check(bad(await d.fails(game(4, 100))), 'and never more than 99');

// ---------- challenges
const terms = async (t) => (await d.admin(`select private.clean_terms('${JSON.stringify(Object.assign({ ko_at: ko, half: 20 }, t))}'::jsonb) as t`))[0].t;
eq([(await terms({ side: 11, subs: 5 })).side, (await terms({ side: 11, subs: 5 })).subs], [11, 5], 'a challenge can be 11-a-side with 5 subs');
eq([(await terms({ side: 90, subs: 20 })).side, (await terms({ side: 90, subs: 20 })).subs], [90, 9], 'subs are cut so a team is never more than 99 (90 a side, 9 subs)');
eq([(await terms({ side: 300 })).side, (await terms({ side: 1 })).side, (await terms({})).side], [99, 2, 5], 'a side out of range is brought back to 2 to 99, and none given is 5-a-side');

// ---------- friendlies
const people = (n) => Array.from({ length: n }, (_, i) => ({ k: 'g' + i, n: 'Guest ' + (i + 1) }));
const got = await d.rpc(ethan, 'friendly_people', { p_people: people(198) });
eq(got.players.filter((p) => p.pid).length, 198, 'a friendly takes 198 people (99 a side)');
check(/99 a side/.test(await d.fails(d.rpc(ethan, 'friendly_people', { p_people: people(199) }))), 'and says so past that');

await done();
