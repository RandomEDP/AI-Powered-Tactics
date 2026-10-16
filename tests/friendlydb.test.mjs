// Friendly games in the database (0039): each account's own hidden friendlies team, the people in a friendly (you,
// people on Gaffer, guests), personal links that hand a guest's player to their new account, and that none of it touches
// a real team, anyone's list of teams on their profile, or who follows whom.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: friendly games');
const d = await database();
eq(d.applied.includes('0040_friendly_games.sql'), true, 'the friendly games migration applies on top of the others');

const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), dan = await d.user('dan@example.com'), dave = await d.user('dave@example.com'), mo = await d.user('mo@example.com');
for (const [u, n, full] of [[ethan, 'ethan_fc', 'Ethan Smith'], [jake, 'jake_fc', 'Jake'], [dan, 'dan_dog', 'Dan'], [dave, 'dave_new', 'Dave'], [mo, 'mo_fc', 'Mo']]) await d.rpc(u, 'set_profile', { p_username: n, p_name: full, p_private: false });
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#5629d7', p_crest: null, p_settings: {}, p_players: [{ pid: 1, name: 'Ethan' }, { pid: 2, name: 'Jake' }] });
await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: '', p_position: 'fwd' });
const follows = async () => (await d.admin('select count(*)::int as n from public.follows'))[0].n;
const before = await follows();

// ---------- setting up a friendly
check(/Sign in|permission denied/.test(await d.fails(d.rpc(null, 'friendly_people', { p_people: [] }))), 'you have to be signed in');
const got = await d.rpc(ethan, 'friendly_people', { p_people: [{ k: 'me', self: true }, { k: 'j', u: 'jake_fc' }, { k: 'd', u: 'DAN_DOG' }, { k: 'g', n: '  Dave   Guest ' }, { k: 'x', u: 'nobody_here' }] });
check(/^[A-Z0-9]{6}$/.test(got.code), 'the first friendly makes your friendlies team');
eq(got.name, 'Ethan\'s friendlies', 'named after you');
eq(got.players.map((p) => [p.k, p.pid, p.name, p.linked]), [['me', 1, 'Ethan Smith', true], ['j', 2, 'Jake', true], ['d', 3, 'Dan', true], ['g', 4, 'Dave Guest', false], ['x', null, null, false]],
  'you, Jake (your team), Dan (another team, on Gaffer) and a guest are its players; a username that doesn\'t exist comes back empty');
const [t] = await d.admin(`select * from public.teams where code = '${got.code}'`);
eq([t.personal, t.listed, t.short], [true, false, 'Friendlies'], 'it\'s a personal team, never listed');
eq(await d.admin(`select user_id from public.team_members where team_id = '${t.id}'`), [{ user_id: ethan.id }], 'you run it, nobody else');
const again = await d.rpc(ethan, 'friendly_people', { p_people: [{ k: 'me', self: true }, { k: 'j', u: 'jake_fc' }, { k: 'g', n: 'dave guest' }, { k: 'm', u: 'mo_fc' }] });
eq([again.code, again.players.map((p) => p.pid)], [got.code, [1, 2, 4, 5]], 'the next friendly is in the same team: the same player for the same person (and the same guest name), new ones added');
eq(await follows(), before, 'nobody starts following anyone for being in a friendly');

await d.admin(`insert into public.blocks (blocker, blocked) values ('${mo.id}', '${dan.id}')`);
const dans = await d.rpc(dan, 'friendly_people', { p_people: [{ k: 'm', u: 'mo_fc' }, { k: 'j', u: 'jake_fc' }] });
check(dans.code !== got.code, 'Dan\'s friendlies are his own team');
eq(dans.players.map((p) => p.pid), [null, 1], 'someone who has blocked you can\'t be added');
check(/Up to 40/.test(await d.fails(d.rpc(ethan, 'friendly_people', { p_people: Array.from({ length: 41 }, (_, i) => ({ k: i, n: 'G' + i })) }))), 'at most 40 people');

// ---------- the game counts for each person, not for any team
const gid = '11111111-1111-4111-8111-111111111111';
await d.as(ethan, `insert into public.games (id, team_id, seq, opp, friendly, us, them, finished_at, house) values ('${gid}', '${t.id}', 0, 'Shirts', true, 3, 2, 1760000000000, '{"a":"Bibs","b":"Shirts","side":{"1":"a","2":"a","3":"b","4":"b"},"guests":[],"fr":true}'::jsonb)`);
await d.as(ethan, `insert into public.game_players (game_id, pid, mins, goals, assists) values ('${gid}', 1, 30, 1, 0), ('${gid}', 2, 30, 2, 1), ('${gid}', 3, 30, 1, 0), ('${gid}', 4, 30, 1, 0)`);
const jp = await d.rpc(ethan, 'get_profile', { p_username: 'jake_fc' });
eq([jp.stats.games, jp.stats.goals, jp.stats.wins], [1, 2, 1], 'the friendly is in Jake\'s own stats (and won on his side)');
eq(jp.teams.map((x) => x.name), ['Sons of Pitches FC'], 'but Ethan\'s friendlies isn\'t shown as one of his teams');
const dp = await d.rpc(ethan, 'get_profile', { p_username: 'dan_dog' });
eq([dp.stats.games, dp.stats.goals, dp.stats.wins], [1, 1, 0], 'Dan was on the losing side');
const sopTeam = await d.rpc(jake, 'get_team', { p_code: sop.code });
eq(sopTeam.games.length, 0, 'and SOP\'s own games and record are untouched');
const jt = await d.rpc(jake, 'my_teams');
eq(jt.map((x) => [x.name, x.personal]).sort(), [['Dan\'s friendlies', true], ['Ethan\'s friendlies', true], ['Sons of Pitches FC', false]], 'Jake\'s list of teams says which is someone\'s friendlies');

// ---------- personal links
check(/own friendlies/.test(await d.fails(d.rpc(jake, 'friendly_invite', { p_code: got.code, p_pid: 4 }))), 'only you can make links for your friendlies');
check(/own friendlies/.test(await d.fails(d.rpc(ethan, 'friendly_invite', { p_code: sop.code, p_pid: 2 }))), 'and only for friendlies, not a real team');
const tok = await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: 4 });
check(/^[0-9a-f-]{36}$/.test(tok), 'a personal link for the guest');
eq(await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: 4 }), tok, 'asking again gives the same link');
eq(await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: 99 }), null, 'nothing for a player who isn\'t there');
check(/Sign in|permission denied/.test(await d.fails(d.rpc(null, 'friendly_claim', { p_token: tok }))), 'the guest has to sign in to take it');
eq((await d.rpc(dave, 'friendly_claim', { p_token: '22222222-2222-4222-8222-222222222222' })).status, 'missing', 'a made-up link does nothing');
const c1 = await d.rpc(dave, 'friendly_claim', { p_token: tok });
eq([c1.status, c1.code, c1.name, c1.player], ['ok', got.code, 'Ethan\'s friendlies', 'Dave Guest'], 'Dave signs up and opens his link: the player is his');
const vp = await d.rpc(ethan, 'get_profile', { p_username: 'dave_new' });
eq([vp.stats.games, vp.stats.goals], [1, 1], 'and his goal and the game are on his new profile');
eq((await d.rpc(dave, 'friendly_claim', { p_token: tok })).status, 'ok', 'opening it again is fine');
eq((await d.rpc(mo, 'friendly_claim', { p_token: tok })).status, 'taken', 'someone else with the same link can\'t take it');
const tok2 = await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: 4 });
check(tok2 !== tok, 'a used link isn\'t handed out again');
const g2 = await d.rpc(ethan, 'friendly_people', { p_people: [{ k: 'z', n: 'Zed' }] }), tz = await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: g2.players[0].pid });
eq((await d.rpc(jake, 'friendly_claim', { p_token: tz })).status, 'already', 'someone already in those friendlies can\'t take a second player');
eq(await follows(), before, 'still nobody follows anyone because of it');
eq((await d.rpc(dave, 'my_teams')).map((x) => [x.name, x.org, x.personal]), [['Ethan\'s friendlies', false, true]], 'Dave\'s teams list it as friendlies he played in');

// ---------- the App Clip: one player's highlights by their link, with no account (0041)
eq(d.applied.includes('0041_friendly_preview.sql'), true, 'the App Clip\'s migration applies');
await d.as(ethan, `insert into public.clips (team_id, game_id, seq, path, label, at, dur, pids, store) values
  ('${t.id}', '${gid}', 0, '${t.id}/g/00.mp4', 'GOAL Jake', 1759999000000, 14, '{2}', 'r2'),
  ('${t.id}', '${gid}', 1, '${t.id}/g/01.mp4', 'GOAL Dave Guest', 1759999100000, 14, '{4,3}', 'r2'),
  ('${t.id}', '${gid}', 2, '${t.id}/g/02.mp4', 'Highlight Dave Guest', 1759999200000, 14, '{4}', null)`);
const tz2 = await d.rpc(ethan, 'friendly_invite', { p_code: got.code, p_pid: 3 });
const pv = await d.rpc(null, 'friendly_preview', { p_token: tz2 });
eq([pv.status, pv.player, pv.team, pv.claimed], ['ok', 'Dan', 'Ethan\'s friendlies', true], 'anyone with the link can open it in the App Clip, with no account');
eq(pv.games.map((g) => [g.for, g.mine, g.against, g.theirs, g.goals]), [['Shirts', 2, 'Bibs', 3, 1]], 'the game, scored from his side (Dan was on Shirts and lost 3–2)');
eq(pv.clips.map((c) => [c.path.split('/').pop(), c.store]), [['01.mp4', 'r2']], 'only the clips he\'s in');
const pd = await d.rpc(null, 'friendly_preview', { p_token: tok });
eq([pd.player, pd.clips.map((c) => c.label)], ['Dave Guest', ['GOAL Dave Guest', 'Highlight Dave Guest']], 'Dave\'s link shows his two');
await d.admin(`insert into public.clip_hides (team_id, game_id, at, pid) values ('${t.id}', '${gid}', 1759999200000, 4)`);
eq((await d.rpc(null, 'friendly_preview', { p_token: tok })).clips.length, 1, 'a clip he took out from under his name stays out');
check(!JSON.stringify(pv).includes(got.code) && !JSON.stringify(pv).includes(t.organiser_code) && !/jake|ethan smith/i.test(JSON.stringify(pv.games)), 'it never gives away the team\'s codes or anyone else');
eq((await d.rpc(null, 'friendly_preview', { p_token: '33333333-3333-4333-8333-333333333333' })).status, 'missing', 'a made-up link shows nothing');

await done();
