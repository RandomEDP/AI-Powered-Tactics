// Scorers for both sides in a friendly (Ethan: "When playing a friendly game you should be able to select who scored for
// both teams"). Before, Goal against in a friendly with another team just counted, a friendly's opponents who were only a
// name had no scorers, and the watch only ever asked who scored for your own side. Now: the other side's scorer is picked
// on the phone, a teammate's phone and the watch; a side with nobody from Gaffer on it gets its scorers typed in by name,
// kept with the game (never in anyone's stats); and a league game still logs Goal against straight away.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones and watch: scorers for both sides in a friendly');
const w = await world();
const picks = (P) => P.page.$$eval('#picker [data-p]', (b) => b.map((x) => x.textContent.trim()).filter((x) => !/Own goal|not sure|No assist/i.test(x)));
const goals = async (P) => (await P.match()).events.filter((e) => !e.hl).map((e) => [e.us, e.p ?? null, e.a ?? null]);
const type = async (P, name) => { await P.page.fill('#pkName', name); await P.click('#picker .pktype button[type="submit"]'); await P.run(200); };

// ---------- a friendly against a team that isn't on Gaffer
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const d0 = w.db(); d0.teams.forEach((t) => { t.followers_can_score = true; }); w.setDb(d0); // (everyone can log goals)
await A.click('#mNew'); await A.page.fill('#opp', 'Dog Squad');
await A.page.evaluate(() => { const c = document.getElementById('friendly'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
await A.click('#startGame'); await A.click('#kick'); await A.run(500);
if (await A.visible('#benchSheet')) await A.click('#benchOk');
eq([await A.view(), (await A.match()).friendly, await A.text('#goalThem')], ['game', true, 'Goal against'], 'a friendly against Dog Squad');
await A.click('#go'); await A.run(60000);

await A.click('#goalThem');
eq([await A.text('#picker strong'), await picks(A), await A.visible('#pkName')], ['Who scored for Dog Squad?', [], true], 'Goal against asks who scored for them, with a box for their name (nobody of theirs is on Gaffer)');
await A.click('#picker .pktype button[type="submit"]'); await A.run(200);
eq([await A.visible('#pkMsg'), await A.text('#pkMsg'), await A.text('#themN')], [true, 'Type their name first.', '0'], 'nothing typed: it says so and nothing goes in');
await type(A, 'Big Dave');
eq([await A.text('#picker strong'), await A.visible('#pkName')], ['Who set up Big Dave?', true], 'then who set it up, with the same box');
await A.click('#picker [data-p="x"]'); await A.run(9000);
eq([await A.text('#themN'), await goals(A)], ['1', [[false, 1001, null]]], 'their goal, with Big Dave as its scorer');
check((await A.text('#events')).includes('Big Dave for Dog Squad'), 'the game\'s list names him');
check(!(await A.match()).squad.includes(1001), 'he is a guest of the game, not in the squad');

await A.click('#goalThem');
eq(await picks(A), ['Big Dave'], 'next time he\'s there to pick');
await type(A, 'Kev'); await A.click('#picker [data-p="1001"]'); await A.run(9000);
eq(await goals(A), [[false, 1001, null], [false, 1002, 1001]], 'Kev scores, set up by Big Dave');
await A.click('#goalThem'); await type(A, 'big dave'); await A.click('#picker [data-p="x"]'); await A.run(9000);
eq([(await goals(A))[2], (await A.match()).guests.length], [[false, 1001, null], 2], 'the same name typed again is the same man');

// ---------- the watch asks for their scorer too
const m1 = await A.match(), ws = await A.watch();
eq(ws.oppPlayers.map((p) => p.name).sort(), ['Big Dave', 'Kev'], 'the watch is sent their names, to ask who scored');
await A.fromWatch({ id: 'fs-1', type: 'goal', us: false, p: 1002, a: 1001, gid: m1.gid, at: Date.now() }); await A.run(9000);
eq((await goals(A))[3], [false, 1002, 1001], 'their goal from the watch keeps its scorer and who set it up');
await A.fromWatch({ id: 'fs-2', type: 'goal', us: false, p: 3, gid: m1.gid, at: Date.now() }); await A.run(9000);
eq((await goals(A))[4], [false, null, null], 'one of our own can\'t be their scorer');

// ---------- a teammate's phone
const F = await w.phone({ db: true, native: true, label: 'teammate' });
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
await F.click('#mResume'); await F.run(300);
await F.click('#goalThem');
eq([await F.text('#picker strong'), (await picks(F)).sort()], ['Who scored for Dog Squad?', ['Big Dave', 'Kev']], 'a teammate\'s phone asks the same, with the names typed so far');
await type(F, 'Smithy'); await F.click('#picker [data-p="x"]'); await w.run(6000);
const m2 = await A.match(), smithy = m2.guests.find((g) => g.name === 'Smithy');
check(!!smithy && m2.events.some((e) => !e.hl && !e.us && e.p === smithy.id && e.by === 'team'), 'the gaffer\'s phone takes their goal, with Smithy as its scorer');
await A.run(9000);

// ---------- full time: kept with the game
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000); await A.click('#go'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000);
await A.click('#finish'); await A.click('#finish'); await A.run(2500);
const db = w.db(), g = db.games.find((x) => x.opp === 'Dog Squad');
eq((g.guests || []).map((x) => x.name), ['Big Dave', 'Kev', 'Smithy'], 'the database keeps their scorers\' names with the game');
eq(db.game_events.filter((e) => e.game_id === g.id && e.kind === 'against').map((e) => e.pid), [1001, 1002, 1001, 1002, null, smithy.id], 'and each goal against points at its scorer');
check(!db.game_players.some((x) => x.game_id === g.id && x.pid >= 1000), 'none of them is in anyone\'s stats');
const G = await w.phone({ db: true, native: true, label: 'another teammate' });
await G.page.fill('#joinCode', code); await G.click('#joinBtn'); await G.run(500); await G.click('#jFollow'); await G.run(800);
await G.click('#mHighlights'); await G.run(500);
const card = await G.text('#hlList');
check(card.includes('Goal: Big Dave for Dog Squad') && card.includes('Goal: Kev, set up by Big Dave for Dog Squad') && card.includes('Goal: Smithy for Dog Squad'), `another phone, from the database, has their scorers by name (${card.slice(0, 200)})`);

// ---------- a league game: Goal against still goes straight in
const L = await w.phone({ native: true, label: 'league' });
await L.localTeam(); await L.newGame(); if (await L.visible('#benchSheet')) await L.click('#benchOk');
await L.click('#go'); await L.run(60000);
await L.click('#goalThem'); await L.run(300);
eq([await L.text('#themN'), await L.text('#picker')], ['1', ''], 'not a friendly: Goal against counts at once, nothing asked');
eq((await L.watch()).oppPlayers, undefined, 'and the watch isn\'t sent anyone for them');

// ---------- a friendly outside any team, whose opponents are only a name
await A.page.evaluate(() => document.querySelector('#tabs [data-tab="feed"]').click()); await A.run(500); await A.click('#fdFriendly'); await A.run(300);
await A.page.fill('#frB', 'Dog Squad'); await A.click('#frKick'); await A.run(800);
let m = await A.match();
eq([await A.view(), m.house.fr, Object.values(m.house.side)], ['game', true, ['a']], 'a friendly with just you, against Dog Squad by name');
await A.click('#go'); await A.run(60000);
await A.click('#goalThem');
eq([await A.text('#picker strong'), await picks(A), await A.visible('#pkName')], ['Who scored for Dog Squad?', [], true], 'their goal asks who scored, with the box for a name');
await type(A, 'Number 9'); await A.click('#picker [data-p="x"]'); await A.run(9000);
m = await A.match(); const n9 = m.house.guests.find((x) => x.name === 'Number 9');
check(!!n9 && m.house.side[n9.id] === 'b' && m.events.some((e) => !e.hl && !e.us && e.p === n9.id), 'Number 9 is kept as a guest on their side, and scored');
eq((await A.watch()).oppPlayers.map((p) => p.name), ['Number 9'], 'the watch can pick him too');
await A.click('#goalUs');
eq([await A.visible('#pkName')], [false], 'your own side has you on it, so there\'s no box for a name there');

await w.close();
await done(A, F, G, L);
