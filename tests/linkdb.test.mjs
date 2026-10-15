// Linked games in the database (0031): one team's gaffer links today's game to another team on Gaffer; nothing of
// either team is shared until the team asked accepts; then each side reads the other's goals (scorers by name), squad and
// clips for that game, from the live game while it's on and from the finished game after.
import { suite } from './lib.mjs';
import { database } from './pg.mjs';
const { check, eq, done } = suite('database: linked games');
const d = await database();
eq(d.applied.includes('0031_linked_games.sql'), true, 'the linked games migration applies on top of the others');

const ethan = await d.user('ethan@example.com'), dan = await d.user('dan@example.com'), jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com'), cara = await d.user('cara@example.com');
const squad = (names) => names.map((name, i) => ({ pid: i + 1, name }));
const team = (who, name, names) => d.rpc(who, 'create_team', { p_name: name, p_short: '', p_color: '#5629d7', p_crest: null, p_settings: {}, p_players: squad(names) });
const sop = await team(ethan, 'Sons of Pitches FC', ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac']);
const dog = await team(dan, 'Dog Squad', ['Rex', 'Fido', 'Spot', 'Lassie', 'Bones']);
const cat = await team(cara, 'Cat Squad', ['Tom', 'Felix']);
eq(await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: '', p_position: 'fwd' }), 'ok', '(Jake plays for SOP)');

// ---------- asking
const denied = (p) => d.fails(p).then((m) => /gaffer|permission denied|Sign in/i.test(m));
check(await denied(d.rpc(jake, 'link_game', { p_code: sop.code, p_to: dog.id })), 'a player can\'t link a game');
check(await denied(d.rpc(null, 'link_game', { p_code: sop.code, p_to: dog.id })), 'nor someone not signed in');
check(/can't be found/.test(await d.fails(d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: sop.id }))), 'a team can\'t link a game with itself');
await d.admin(`update public.teams set listed = false where id = '${cat.id}'`);
check(/can't be found/.test(await d.fails(d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: cat.id }))), 'nor with a team that has taken itself out of search');
await d.admin(`update public.teams set listed = true where id = '${cat.id}'`);
const link = await d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: dog.id });
check(/^[0-9a-f-]{36}$/.test(link), 'a gaffer links today\'s game to another team on Gaffer');

let mine = await d.rpc(ethan, 'team_links', { p_code: sop.code }), theirs = await d.rpc(dan, 'team_links', { p_code: dog.code });
eq([mine.length, mine[0].status, mine[0].sent, mine[0].other.name, mine[0].their ?? null], [1, 'proposed', true, 'Dog Squad', null], 'the team that asked sees it waiting, with nothing of the other team but its name');
eq([theirs.length, theirs[0].sent, theirs[0].other.name, theirs[0].their ?? null], [1, false, 'Sons of Pitches FC', null], 'the team asked sees the request, with nothing of the asking team either');
eq(await d.rpc(null, 'team_links', { p_code: dog.code }), [], 'someone following Dog Squad without being a gaffer doesn\'t see the request');
eq(await d.rpc(null, 'team_links', { p_code: 'ZZZZZZ' }), null, 'a wrong code shows nothing');
check(!JSON.stringify(theirs).includes(sop.code) && !JSON.stringify(theirs).includes(sop.organiser_code), 'and neither team\'s codes are ever in it');

// ---------- the asking team plays before anyone answers: nothing goes across
const liveState = (link, events, squadIds, phase = 'h1') => ({ phase, link, koAt: 1000, squad: squadIds, events });
await d.as(ethan, `insert into public.live_matches (team_id, state, updated_by) values ('${sop.id}', '${JSON.stringify(liveState(link, [{ us: true, p: 2, a: 3, at: 61000.4, min: 2 }, { hl: true, p: 1, at: 70000 }]))}'::jsonb, 'x')`);
theirs = await d.rpc(dan, 'team_links', { p_code: dog.code });
eq(theirs[0].their ?? null, null, 'until it\'s accepted, the team asked sees none of the other side\'s game');

// ---------- answering
eq(await d.rpc(ethan, 'link_answer', { p_code: sop.code, p_id: link, p_action: 'accept' }), 'not_yours', 'the team that asked can\'t accept for the other');
eq(await d.rpc(jake, 'link_answer', { p_code: sop.code, p_id: link, p_action: 'cancel' }), 'not_gaffer', 'a player can\'t answer or unlink');
eq(await d.rpc(cara, 'link_answer', { p_code: cat.code, p_id: link, p_action: 'accept' }), 'missing', 'a third team can\'t touch it');
eq(await d.rpc(dan, 'link_answer', { p_code: dog.code, p_id: link, p_action: 'accept' }), 'ok', 'the other team\'s gaffer accepts');
eq(await d.rpc(dan, 'link_answer', { p_code: dog.code, p_id: link, p_action: 'decline' }), 'closed', 'and it can\'t then be turned down');

// ---------- both sides playing: each reads the other's own goals, by name
await d.as(dan, `insert into public.live_matches (team_id, state, updated_by) values ('${dog.id}', '${JSON.stringify(liveState(link, [{ us: false, at: 62000, min: 2 }, { us: true, p: 1, a: null, at: 300000, min: 5 }, { us: true, lk: true, at: 400000 }], [1, 2, 3, 5]))}'::jsonb, 'x')`);
await d.as(ethan, `update public.live_matches set state = '${JSON.stringify(liveState(link, [{ us: true, p: 2, a: 3, at: 61000.4, min: 2 }, { hl: true, p: 1, at: 70000 }], [1, 2, 3, 4, 5]))}'::jsonb where team_id = '${sop.id}'`);
mine = await d.rpc(ethan, 'team_links', { p_code: sop.code }); theirs = await d.rpc(dan, 'team_links', { p_code: dog.code });
eq([mine[0].status, mine[0].their.phase, mine[0].their.goals.map((g) => [g.at, g.min, g.x ?? null, g.p, g.a ?? null]), mine[0].their.against.map((g) => g.at), mine[0].their.squad],
  ['accepted', 'h1', [[300000, 5, null, 'Rex', null]], [62000], ['Rex', 'Fido', 'Spot', 'Bones']],
  'SOP sees Dog Squad\'s goal with its scorer, the goal they logged against themselves, and their squad (not goals they only took from SOP)');
eq([theirs[0].their.goals.map((g) => [g.at, g.p, g.a]), theirs[0].their.against, theirs[0].their.squad], [[[61000, 'Jake', 'Chaplin']], [], ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley']], 'and Dog Squad sees SOP\'s, highlights left out');
eq((await d.rpc(null, 'team_links', { p_code: sop.code }))[0].their.goals.length, 1, 'anyone following SOP sees the other side\'s goals too, for the score');
eq(await d.rpc(cara, 'team_links', { p_code: cat.code }), [], 'a third team sees none of it');
check(!JSON.stringify(mine).includes(dog.code) && !JSON.stringify(theirs).includes(sop.code), 'still no codes');

// ---------- finished: from the games and clips, and the link kept with the game
const gid = '11111111-1111-4111-8111-111111111111';
await d.as(dan, `delete from public.live_matches where team_id = '${dog.id}'`);
await d.as(dan, `insert into public.games (id, team_id, seq, opp, us, them, ko_at, ft_at, half, link) values ('${gid}', '${dog.id}', 0, 'Sons of Pitches FC', 2, 1, 1000, 1801000, 15, '${link}')`);
await d.as(dan, `insert into public.game_players (game_id, pid, mins, goals) values ('${gid}', 1, 30, 1), ('${gid}', 2, 30, 0)`);
await d.as(dan, `insert into public.game_events (game_id, seq, kind, pid, assist, min, at, from_link) values ('${gid}', 0, 'against', null, null, 2, 62000, false), ('${gid}', 1, 'goal', 1, 2, 5, 300000, false), ('${gid}', 2, 'goal', null, null, 7, 400000, true)`);
await d.admin(`insert into public.clips (team_id, game_id, seq, path, label, at, dur, store) values ('${dog.id}', '${gid}', 1, '${dog.id}/g/01.mp4', 'Goal: Rex', 300000, 14, 'r2')`);
mine = await d.rpc(ethan, 'team_links', { p_code: sop.code });
eq([mine[0].their.phase, mine[0].their.goals.map((g) => [g.at, g.p, g.a]), mine[0].their.against.map((g) => g.at), mine[0].their.squad, mine[0].their.ft_at],
  ['ft', [[300000, 'Rex', 'Fido']], [62000], ['Rex', 'Fido'], 1801000], 'once Dog Squad finish, SOP reads their goals from the finished game (still not the ones taken from SOP)');
eq(mine[0].their.clips.map((c) => [c.path, c.label, c.store]), [[`${dog.id}/g/01.mp4`, 'Goal: Rex', 'r2']], 'with the clips Dog Squad cut, for the shared highlights');
const g = (await d.rpc(dan, 'get_team', { p_code: dog.code })).games[0];
eq([g.link, g.events.map((e) => e.from_link)], [link, [false, false, true]], 'get_team keeps the link with the game, and which goals came from the other side');

// ---------- unlinking stops the sharing
eq(await d.rpc(ethan, 'link_answer', { p_code: sop.code, p_id: link, p_action: 'cancel' }), 'ok', 'either side can unlink it');
eq((await d.rpc(dan, 'team_links', { p_code: dog.code })).length, 0, 'then the other team no longer sees anything of it');
eq((await d.rpc(ethan, 'team_links', { p_code: sop.code })).map((x) => [x.status, x.their ?? null]), [['cancelled', null]], 'and the side that unlinked sees it\'s off, with nothing shared');

// ---------- turning one down, and only ten a day
const l2 = await d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: cat.id });
eq(await d.rpc(cara, 'link_answer', { p_code: cat.code, p_id: l2, p_action: 'decline' }), 'ok', 'a team can turn a link down');
eq((await d.rpc(ethan, 'team_links', { p_code: sop.code })).filter((x) => x.id === l2).map((x) => [x.status, x.their ?? null]), [['declined', null]], 'and the asking team sees it was turned down');
for (let i = 0; i < 8; i++) await d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: cat.id });
check(/ten teams today/.test(await d.fails(d.rpc(ethan, 'link_game', { p_code: sop.code, p_to: cat.id }))), 'a gaffer can ask at most ten a day');

// ---------- nobody reads the table directly
for (const who of [null, sam, jake, dan]) { let n; try { n = (await d.as(who, 'select count(*)::int as n from public.game_links'))[0].n; } catch (e) { n = 'denied'; } check(n === 0 || n === 'denied', `nobody reads game_links directly (${n})`); }
check(/row-level security|permission denied/.test(await d.fails(d.as(sam, `insert into public.game_links (from_team, to_team, status) values ('${sop.id}', '${dog.id}', 'accepted')`))), 'nor makes an accepted link behind the other team\'s back');
eq((await d.admin(`select has_function_privilege('anon', 'public.link_game(text, uuid)', 'execute') as a, has_function_privilege('anon', 'public.link_answer(text, uuid, text)', 'execute') as b, has_function_privilege('anon', 'public.team_links(text)', 'execute') as c`))[0],
  { a: false, b: false, c: true }, 'linking and answering need an account; reading works with the team code, as get_team does');

await d.close();
await done();
