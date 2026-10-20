// The app and the database have to agree: every function the app calls must exist with those argument names, and
// every row the app writes must fit the real tables. The other phone tests use a stand-in database written by hand,
// so this one takes what the app actually sent to the stand-in and puts it through the real schema.
import { world, suite, ROOT } from './lib.mjs';
import { database } from './pg.mjs';
import fs from 'fs';
import path from 'path';
const { check, eq, done } = suite('app and database agree');
const d = await database();
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------- functions: names, argument names, and who may call them
const procs = await d.admin(`select p.proname, p.proargnames, has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p where p.pronamespace = 'public'::regnamespace`);
const calls = {};
for (const m of src.matchAll(/sb\.rpc\('([a-z_]+)'(?:,\s*\{([\s\S]*?)\}\s*\))?/g)) {
  const keys = [...(m[2] || '').matchAll(/(?:^|[,{]\s*)(p_[a-z_]+)\s*:/g)].map((k) => k[1]);
  (calls[m[1]] = calls[m[1]] || []).push(keys);
}
check(Object.keys(calls).length >= 25, `found the app's database calls (${Object.keys(calls).length} functions)`);
for (const [name, uses] of Object.entries(calls)) {
  const defs = procs.filter((p) => p.proname === name);
  if (!check(defs.length > 0, `the database has the function the app calls: ${name}`)) continue;
  check(defs.some((p) => p.authed), `${name} can be called by a signed-in person`);
  for (const keys of uses) check(defs.some((p) => keys.every((k) => (p.proargnames || []).includes(k))), `${name} takes the arguments the app passes (${keys.join(', ') || 'none'})`);
}
for (const name of ['get_team', 'queue_goal', 'team_stream', 'username_status']) check(procs.filter((p) => p.proname === name).some((p) => p.anon), `${name} works without an account, as following a team does`);
for (const name of ['create_team', 'claim_player', 'chat_send', 'chat_list', 'vote_fixture', 'challenge_send', 'challenge_reply', 'challenge_result', 'set_home', 'register_push', 'delete_my_account', 'team_push', 'my_challenges', 'find_teams', 'set_profile', 'my_profile', 'find_people', 'get_profile', 'my_clips', 'set_pins', 'follow', 'unfollow', 'answer_follow', 'my_follows', 'my_feed', 'block_user', 'my_blocks', 'report_user', 'hide_clip', 'ad_ticket', 'ad_claim', 'ad_nofill', 'ad_watched', 'my_unlocks'])
  check(procs.filter((p) => p.proname === name).every((p) => !p.anon), `${name} cannot be called without signing in`);

// ---------- tables: every column the app writes exists
const cols = {}; for (const r of await d.admin(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)) (cols[r.table_name] = cols[r.table_name] || []).push(r.column_name);
const keysOf = (text) => [...text.matchAll(/(?:^|[,{]\s*)([a-z_][a-z0-9_]*)\s*:/g)].map((k) => k[1]);
const literal = (after, table) => { const i = src.indexOf(after); if (!check(i >= 0, `found where the app builds its ${table} rows`)) return []; return keysOf(src.slice(i, src.indexOf('};', i) >= 0 ? Math.min(src.indexOf('};', i), src.indexOf(');', i)) : i + 600)); };
const written = {
  fixtures: literal("var row = { opp: opp.slice(0, 60)", 'fixtures').filter((k) => !['half', 'sub', 'periods'].includes(k)).concat(['team_id', 'lineup', 'status']),
  clips: literal("rows.push({ team_id: teamId, game_id: r.id", 'clips'),
  live_matches: ['team_id', 'state', 'updated_by'], goal_queue: ['id', 'payload', 'team_id'],
};
for (const [table, keys] of Object.entries(written)) for (const k of keys) check((cols[table] || []).includes(k), `the ${table} table has the column the app writes: ${k}`);

// ---------- a real session against the stand-in, then the same rows through the real database
const w = await world();
const A = await w.phone({ db: true, native: true });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog & Bone');
// Kicked off from a watch whose clock reports fractions of a millisecond (an older watch app did exactly this, and the
// database then refused the finished game: its times must be whole numbers). Everything from the watch below is like that.
const gid = (await A.match()).gid, frac = async (back) => (await A.now()) - back + 0.375;
await A.fromWatch({ type: 'start', to: 'h1', id: 'frac-ko', gid, at: await frac(1500) }); await A.run(61000);
await A.click('#goalUs'); await A.click('#picker button[data-p]'); await A.click('#picker button[data-p]:not([data-p="x"])'); await A.run(9000);
await A.fromWatch({ type: 'goal', us: false, id: 'frac-goal', gid, at: await frac(700.7878) }); await A.fromWatch({ type: 'hl', id: 'frac-hl', gid, at: await frac(300.5) });
await A.page.evaluate(async ([code, ts]) => { const sb = window.supabase.createClient(); await sb.rpc('queue_goal', { p_code: code, p_payload: { us: true, ts, min: 2.6 } }); }, [(await A.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).active)), (await A.now()) + 20000.25]);
await A.run(21000); // a follower's goal with a fractional time too, folded in on the gaffer's next check
await A.click('#svBtn');
let m = await A.match(); const out = m.segs[0].on[0];
await A.click('#outBtn'); await A.click(`#outPicker button[data-o="${out}"]`); await A.click('#outPicker button.best');
await A.run(4 * 60000); if (await A.visible('#subPopDone')) await A.click('#subPopDone');
await A.run(2000);
const live = w.db().live_matches[0];
await A.fromWatch({ type: 'end', from: 'h1', id: 'frac-ht', gid, at: await frac(200.2) });
await A.fromWatch({ type: 'start', to: 'h2', id: 'frac-h2', gid, at: await frac(100.9) }); await A.run(3000);
await A.fromWatch({ type: 'end', from: 'h2', id: 'frac-ft', gid, at: await frac(50.123) });
eq((await A.match()).phase, 'ft', 'the game was run from the watch to full time');
await A.click('#finish'); await A.click('#finish'); await A.run(3000);
// a shirt number and a position on a player, as the squad screen saves them
const mock = w.db(), mt = mock.teams[0];
eq([mock.games.length, mock.game_players.length, mock.game_events.length], [1, 8, 5], 'the stand-in holds the finished game: 8 players and 5 events');
const g0 = mock.games[0], isWhole = (v) => v === null || Number.isInteger(v);
check([g0.ko_at, g0.ht_at, g0.h2_at, g0.ft_at, g0.finished_at].every((v) => Number.isInteger(v)) && mock.game_events.every((e) => isWhole(e.at) && isWhole(e.min) && isWhole(e.x) && isWhole(e.pid)),
  `every time and minute the app saved is a whole number, whatever the watch and followers sent (${[g0.ko_at, g0.ht_at, g0.h2_at, g0.ft_at]}; ${mock.game_events.map((e) => e.at)})`);

const ethan = await d.user('ethan@example.com');
const made = await d.rpc(ethan, 'create_team', { p_name: mt.name, p_short: mt.short, p_color: mt.color, p_crest: null, p_settings: mt.settings, p_players: mock.players.map((p) => ({ pid: p.pid, name: p.name })) });
const fit = async (table, row, how) => {
  const r = Object.assign({}, row); if ('team_id' in r) r.team_id = made.id;
  const unknown = Object.keys(r).filter((k) => !(cols[table] || []).includes(k));
  if (!check(unknown.length === 0, `every field the app writes to ${table} is a real column (${unknown.join(', ') || 'all fine'})`)) unknown.forEach((k) => delete r[k]);
  const json = JSON.stringify(r).replace(/'/g, "''"), names = Object.keys(r).join(', ');
  const sql = how === 'update' ? `update public.${table} t set (${names}) = (select ${names} from jsonb_populate_record(null::public.${table}, '${json}'::jsonb)) where t.id = '${made.id}'`
    : `insert into public.${table} (${names}) select ${names} from jsonb_populate_record(null::public.${table}, '${json}'::jsonb)`;
  const err = await d.fails(d.as(ethan, sql));
  check(err === '', `the real database accepts the app's ${table} row${err ? ': ' + err : ''}`);
};
const teamRow = Object.assign({}, mt); ['id', 'code', 'organiser_code', 'crest'].forEach((k) => delete teamRow[k]);
await fit('teams', teamRow, 'update');
await d.as(ethan, `delete from public.players where team_id = '${made.id}'`);
for (const p of mock.players) { const r = Object.assign({}, p); delete r.user_id; delete r.last_name; await fit('players', r); }
await fit('live_matches', live);
for (const g of mock.games) await fit('games', g);
for (const p of mock.game_players) await fit('game_players', p);
for (const e of mock.game_events) await fit('game_events', e);

// ---------- and what the real get_team sends back has everything the app reads from the stand-in's
const real = await d.rpc(ethan, 'get_team', { p_code: made.code });
const pretend = await A.page.evaluate(async (code) => { const sb = window.supabase.createClient(); return (await sb.rpc('get_team', { p_code: code })).data; }, mt.code);
if (check(real.games.length === 1 && pretend.games.length === 1, 'the finished game is in the real database')) {
const missing = (a, b, where) => Object.keys(a || {}).filter((k) => !(k in (b || {}))).map((k) => where + '.' + k);
const gaps = [].concat(missing(pretend, real, 'team data'), missing(pretend.team, real.team, 'team'), missing(pretend.players[0], real.players[0], 'player'), missing(pretend.games[0], real.games[0], 'game'),
  missing(pretend.games[0].players[0], real.games[0].players[0], 'game player'), missing(pretend.games[0].events[0], real.games[0].events[0], 'game event'));
eq(gaps.filter((g) => !['game.team_id', 'team.id_', 'game event.game_id', 'game event.seq', 'game.created_at'].includes(g)), [], 'the real get_team returns every field the stand-in does (so the app reads the same things from both)');
eq([real.games[0].us, real.games[0].them, real.games[0].players.length, real.games[0].events.length, real.live.phase, real.players.length], [2, 1, 8, 5, live.state.phase, 8], 'and the game read back from the real database is the one that was played');
const ev = real.games[0].events.find((e) => e.kind === 'goal');
check(Array.isArray(ev.on_pitch) && ev.on_pitch.length === 5 && typeof ev.at === 'number' && ev.pid != null && ev.assist != null, 'with the goal\'s scorer, assist, time and who was on the pitch');
check(Array.isArray(real.games[0].lineups) && real.games[0].lineups.length >= 6, 'and the line-ups, stretch by stretch');

}
await w.close(); await d.close();
await done(A);
