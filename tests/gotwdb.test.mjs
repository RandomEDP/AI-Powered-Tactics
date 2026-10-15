// Goal of the Week in the database (0032): gaffers nominate one of their team's goals a week, anyone signed in votes
// once a week (never for their own team), and the most votes wins once the week (Monday to Sunday, UK time) is over.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: Goal of the Week');
const d = await database();
eq(d.applied.includes('0032_goal_of_the_week.sql'), true, 'the Goal of the Week migration applies on top of the others');

const ethan = await d.user('ethan@example.com'), dan = await d.user('dan@example.com'), jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com'), cara = await d.user('cara@example.com'), ali = await d.user('ali@example.com');
const squad = (names) => names.map((name, i) => ({ pid: i + 1, name }));
const team = (who, name, names) => d.rpc(who, 'create_team', { p_name: name, p_short: name.slice(0, 3).toUpperCase(), p_color: '#5629d7', p_crest: null, p_settings: {}, p_players: squad(names) });
const sop = await team(ethan, 'Sons of Pitches FC', ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac']);
const dog = await team(dan, 'Dog Squad', ['Rex', 'Fido', 'Spot', 'Lassie', 'Bones']);
const cat = await team(cara, 'Cat Squad', ['Tom', 'Felix']);
eq(await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: '', p_position: 'fwd' }), 'ok', '(Jake plays for SOP)');

// A finished game for a team, with its events and clips, straight into the tables (as the gaffer's app writes them).
const now = Date.now(), DAY = 86400000;
const game = async (t, opp, at, events, clips, house = null) => {
  const id = (await d.admin(`select gen_random_uuid() as id`))[0].id;
  await d.admin(`insert into public.games (id, team_id, seq, opp, us, them, ko_at, finished_at, house) values ($1, $2, 0, $3, 1, 0, $4, $5, $6)`, [id, t.id, opp, at, at + 30 * 60000, house]);
  for (const [i, e] of events.entries()) await d.admin(`insert into public.game_events (game_id, seq, kind, pid, at) values ($1, $2, $3, $4, $5)`, [id, i, e.kind, e.pid ?? null, e.at]);
  for (const [i, c] of clips.entries()) await d.admin(`insert into public.clips (team_id, game_id, seq, path, label, at, dur, store) values ($1, $2, $3, $4, $5, $6, 14, 'r2')`, [t.id, id, i, `${t.id}/g/${i}.mp4`, c.label, c.at]);
  return id;
};
const t0 = now - 2 * DAY;
const sopGame = await game(sop, 'Dog Squad', t0, [{ kind: 'goal', pid: 2, at: t0 + 60000 }, { kind: 'highlight', pid: 3, at: t0 + 120000 }, { kind: 'goal', pid: 4, at: t0 + 300000 }],
  [{ label: "1' Goal: Jake", at: t0 + 60000 }, { label: "2' Highlight: Chaplin", at: t0 + 120000 }, { label: "5' Goal: Harrison", at: t0 + 300000 }]);
const oldGame = await game(sop, 'Old Boys', now - 20 * DAY, [{ kind: 'goal', pid: 2, at: now - 20 * DAY }], [{ label: 'Goal: Jake', at: now - 20 * DAY }]);
const dogGame = await game(dog, 'Cat Squad', t0, [{ kind: 'goal', pid: 1, at: t0 + 90000 }], [{ label: "1' Goal: Rex", at: t0 + 90000 }]);
const catGame = await game(cat, 'Bibs v Shirts', t0, [{ kind: 'against', pid: 2, at: t0 + 40000 }], [{ label: 'Goal: Felix for Shirts', at: t0 + 40000 }], { a: 'Bibs', b: 'Shirts', side: { 1: 'a', 2: 'b' }, guests: [{ id: 1001, name: 'Guesty McGuest' }] });

// ---------- nominating
const nom = (who, t, g, at) => d.rpc(who, 'gotw_nominate', { p_code: t.code, p_game: g, p_at: at });
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'gotw_board'))), 'nobody sees the board without signing in');
eq((await nom(jake, sop, sopGame, t0 + 60000)).error, 'not_gaffer', 'a player can\'t nominate their team\'s goal; only a gaffer can');
eq((await nom(dan, sop, sopGame, t0 + 60000)).error, 'not_gaffer', 'nor another team\'s gaffer');
eq((await nom(ethan, sop, sopGame, t0 + 120000)).error, 'not_a_goal', 'a highlight that isn\'t a goal can\'t go up');
eq((await nom(ethan, sop, oldGame, now - 20 * DAY)).error, 'too_old', 'nor a goal from more than two weeks ago');
eq((await nom(ethan, sop, dogGame, t0 + 90000)).error, 'no_clip', 'nor another team\'s clip');
const first = await nom(ethan, sop, sopGame, t0 + 60000);
check(first.ok && /^\d{4}-\d\d-\d\d$/.test(first.week), 'the gaffer puts Jake\'s goal up for this week');
eq(new Date(first.week + 'T12:00:00Z').getUTCDay(), 1, 'weeks start on a Monday');
eq((await nom(dan, dog, dogGame, t0 + 90000)).ok, true, 'Dog Squad\'s gaffer puts theirs up');
eq((await nom(cara, cat, catGame, t0 + 40000)).ok, true, 'a goal for side B in a game among the squad can go up too');

let b = await d.rpc(sam, 'gotw_board');
eq([b.entries.length, b.voted ?? null, b.votes, b.last ?? null], [3, null, 0, null], 'anyone signed in sees the week\'s three goals, nothing voted yet, no winner yet');
const byTeam = (board, name) => board.entries.find((e) => e.team === name);
const sopE = byTeam(b, 'Sons of Pitches FC'), dogE = byTeam(b, 'Dog Squad'), catE = byTeam(b, 'Cat Squad');
eq([sopE.video.path, sopE.video.label, sopE.opp, sopE.mine, sopE.gaffer], [`${sop.id}/g/0.mp4`, "1' Goal: Jake", 'Dog Squad', false, false], 'each with its clip, its game and its team');
const shown = JSON.stringify(b);
check(![sop.code, sop.organiser_code, dog.code, cat.code].some((c) => shown.includes(c)), 'never any team\'s code');
check(!shown.includes('Guesty') && !shown.includes('Spice') && !shown.includes('Chaplin'), 'nor anyone in the squads, or the guests, beyond who the clip\'s caption names');
check(!shown.includes('/g/1.mp4') && !shown.includes('/g/2.mp4'), 'and none of a team\'s clips that weren\'t nominated');
check(b.ends > Date.now() && b.ends - Date.now() <= 7 * DAY + 3600000, 'it says when voting closes (the end of Sunday, UK time)');
eq([byTeam(await d.rpc(jake, 'gotw_board'), 'Sons of Pitches FC').mine, byTeam(await d.rpc(ethan, 'gotw_board'), 'Sons of Pitches FC').gaffer], [true, true], 'Jake sees SOP\'s goal is his team\'s; Ethan that it\'s his to change');

// ---------- voting
eq((await d.rpc(jake, 'gotw_vote', { p_nom: sopE.id })).error, 'own_team', 'a player can\'t vote for their own team\'s goal');
eq((await d.rpc(ethan, 'gotw_vote', { p_nom: sopE.id })).error, 'own_team', 'nor can its gaffer');
check(/Sign in|permission denied/i.test(await d.fails(d.rpc(null, 'gotw_vote', { p_nom: dogE.id }))), 'nor anyone not signed in');
eq((await d.rpc(jake, 'gotw_vote', { p_nom: dogE.id })).ok, true, 'Jake votes for Dog Squad\'s');
eq((await d.rpc(sam, 'gotw_vote', { p_nom: sopE.id })).ok, true, 'Sam votes for SOP\'s');
eq((await d.rpc(sam, 'gotw_vote', { p_nom: dogE.id })).ok, true, 'then changes his mind');
eq((await d.rpc(ali, 'gotw_vote', { p_nom: catE.id })).ok, true, 'Ali votes for Cat Squad\'s');
b = await d.rpc(sam, 'gotw_board');
eq([b.voted, b.votes], [dogE.id, 3], 'one vote a person: three votes in all, Sam\'s on Dog Squad');
check(b.entries.every((e) => !('votes' in e)), 'nobody sees how many votes each goal has until the week is over');
eq((await d.admin(`select count(*)::int as n from public.gotw_votes`))[0].n, 3, '(three rows)');

// ---------- the gaffer changes their mind, or takes it down
eq((await nom(ethan, sop, sopGame, t0 + 300000)).ok, true, 'Ethan swaps SOP\'s goal for Harrison\'s');
b = await d.rpc(cara, 'gotw_board');
eq(byTeam(b, 'Sons of Pitches FC').video.label, "5' Goal: Harrison", 'one goal a team a week: the new one replaces the old');
eq(b.entries.length, 3, '(still three goals up)');
const sop2 = byTeam(b, 'Sons of Pitches FC').id;
eq((await d.rpc(cara, 'gotw_vote', { p_nom: sop2 })).ok, true, 'Cara votes for it');
eq(await d.rpc(dan, 'gotw_withdraw', { p_code: sop.code }), false, 'another team\'s gaffer can\'t take it down');
eq(await d.rpc(cara, 'gotw_withdraw', { p_code: cat.code }), true, 'Cara takes Cat Squad\'s down');
b = await d.rpc(ali, 'gotw_board');
eq([b.entries.length, b.voted ?? null, b.votes], [2, null, 3], 'it\'s gone, and Ali\'s vote for it with it, so he can vote again');
eq((await d.rpc(ali, 'gotw_vote', { p_nom: catE.id })).error, 'missing', 'not for the one taken down');

// ---------- reporting
eq(await d.rpc(ali, 'gotw_report', { p_nom: dogE.id, p_reason: 'Not their goal' }), true, 'anyone can report a nominated goal');
eq(await d.rpc(ali, 'gotw_report', { p_nom: dogE.id, p_reason: 'Offensive' }), true, 'again updates the reason');
eq((await d.admin(`select reason from public.gotw_reports`)).map((r) => r.reason), ['Offensive'], '(one report a person)');

// ---------- nobody can go round the functions
for (const [who, label] of [[null, 'someone not signed in'], [sam, 'a signed-in stranger'], [ethan, 'a gaffer']]) {
  const seen = []; for (const table of ['gotw_noms', 'gotw_votes', 'gotw_winners', 'gotw_sponsors', 'gotw_reports']) { try { seen.push((await d.as(who, `select count(*)::int as n from public.${table}`))[0].n); } catch (e) { seen.push('denied'); } }
  check(seen.every((n) => n === 0 || n === 'denied'), `${label} reading the Goal of the Week tables directly sees nothing (${seen.join(',')})`);
}
await d.as(sam, `insert into public.gotw_votes (week, user_id, nom_id) values (current_date, '${sam.id}', '${dogE.id}')`).catch(() => {});
await d.as(sam, `update public.gotw_votes set nom_id = '${sop2}'`).catch(() => {});
eq((await d.admin(`select count(*)::int as n from public.gotw_votes where nom_id = '${sop2}'`))[0].n, 1, 'nor stuff the ballot');

// ---------- the week ends: the most votes wins, once
const lastWeek = (await d.admin(`select (private.gotw_week() - 7)::text as w`))[0].w;
await d.admin(`insert into public.gotw_sponsors (week, name) values ('${lastWeek}', 'Boot Co')`);
await d.admin(`update public.gotw_noms set week = week - 7`); await d.admin(`update public.gotw_votes set week = week - 7`); // (as if it were next week now)
b = await d.rpc(cara, 'gotw_board');
eq([b.entries.length, b.voted ?? null, b.votes], [0, null, 0], 'a new week starts with nothing up');
eq([b.last.week, b.last.entry.team, b.last.votes, b.last.sponsor, b.last.notified, b.last.reel ?? null], [lastWeek, 'Dog Squad', 2, 'Boot Co', false, null], 'last week\'s winner: Dog Squad\'s goal, with 2 votes, presented by the week\'s sponsor');
eq(b.last.entry.video.label, "1' Goal: Rex", 'with its clip');
await d.rpc(sam, 'gotw_board');
eq((await d.admin(`select count(*)::int as n from public.gotw_winners`))[0].n, 1, 'decided once, however many people look');
eq((await d.rpc(sam, 'gotw_vote', { p_nom: sop2 })).error, 'closed', 'last week\'s voting is closed');
eq((await nom(ethan, sop, sopGame, t0 + 300000)).error, 'used', 'a goal that\'s been up before can\'t go up again');
eq((await nom(ethan, sop, sopGame, t0 + 60000)).ok, true, 'one taken down before the week ended can');

// ---------- the winner's reel
const reelPath = `${dog.id}/gotw/${lastWeek}-1.mp4`;
eq((await d.rpc(ethan, 'gotw_save_reel', { p_week: lastWeek, p_path: `${sop.id}/gotw/x.mp4`, p_store: 'r2' })).error, 'not_yours', 'only the winning team\'s gaffer keeps the winner\'s reel');
eq((await d.rpc(dan, 'gotw_save_reel', { p_week: lastWeek, p_path: `${sop.id}/gotw/x.mp4`, p_store: 'r2' })).error, 'bad_path', 'in their own team\'s folder');
eq((await d.rpc(dan, 'gotw_save_reel', { p_week: lastWeek, p_path: `${dog.id}/gotw/../x.mp4`, p_store: 'r2' })).error, 'bad_path', '(no way out of it)');
eq(await d.rpc(dan, 'gotw_save_reel', { p_week: lastWeek, p_path: reelPath, p_store: 'r2' }), { ok: true, old: null }, 'Dan keeps it');
eq((await d.rpc(sam, 'gotw_board')).last.reel.path, reelPath, 'and everyone can watch it');
eq((await d.rpc(dan, 'gotw_save_reel', { p_week: lastWeek, p_path: `${dog.id}/gotw/${lastWeek}-2.mp4`, p_store: 'r2' })).old, reelPath, 'making it again gives back the old file, to remove');

// ---------- a week nobody voted in has no winner, and the last winner stays
await d.admin(`update public.gotw_noms set week = week - 14 where week = private.gotw_week()`);
b = await d.rpc(sam, 'gotw_board');
eq([(await d.admin(`select count(*)::int as n from public.gotw_winners where nom_id is null`))[0].n, b.last.entry.team], [1, 'Dog Squad'], 'a week where nobody voted has no winner; the last winner is still shown');

// ---------- a moderator takes a winner down
await d.admin(`update public.gotw_noms set pulled = true, removed_at = now() where id = '${dogE.id}'`);
eq((await d.rpc(sam, 'gotw_board')).last.entry ?? null, null, 'a goal a moderator took down isn\'t shown, even as a winner');

// ---------- deleting an account
await d.admin(`delete from auth.users where id = '${sam.id}'`);
eq((await d.admin(`select count(*)::int as n from public.gotw_votes where user_id = '${sam.id}'`))[0].n, 0, 'deleting an account takes its votes with it');
await d.admin(`delete from auth.users where id = '${ethan.id}'`);
eq((await d.admin(`select count(*)::int as n from public.gotw_noms where nominated_by is null`))[0].n > 0, true, 'and leaves its nominations without a name');

await done();
