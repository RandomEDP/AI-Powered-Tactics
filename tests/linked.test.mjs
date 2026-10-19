// Playing another team on Gaffer (Ethan: "type in another team's name when starting a new game and select them, so it
// loads all of their players, and either team can upload footage and they can both mark the score"). Two gaffers on
// their own phones, a follower of one team, and the watch: picking the opponent from Gaffer's teams, the other team
// accepting before anything of either team is shared, one score on every phone (a goal logged by both sides counting
// once), each side's scorers, both games keeping the other side's goals at full time (and putting them right after),
// and either team's clips in the game's highlights.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: linking a game with another team on Gaffer');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/linked.test.mjs <dir> to look at it
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const score = async (P) => [await P.text('#usN'), await P.text('#themN')].join('–');
const links = (P) => P.page.evaluate(async () => { const a = JSON.parse(localStorage.getItem('apt-app')); return (await window.supabase.createClient().rpc('team_links', { p_code: a.active })).data; });

const make = async (label, email, name, squad) => {
  const P = await w.phone({ db: true, native: true, label });
  await P.click('#createBtn'); await P.signUp(email);
  await P.page.fill('#tName', name); await P.page.fill('#tPlayers', squad.join('\n')); await P.click('#tCreate'); await P.run(600);
  const code = await P.text('#codeBig'); await P.click('#v-code [data-go="home"]'); await P.run(300);
  return [P, code];
};
const [A, sopCode] = await make('Ethan (SOP)', 'ethan@example.com', 'Sons of Pitches FC', ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac']);
const [B, dogCode] = await make('Dan (Dog Squad)', 'dan@example.com', 'Dog Squad', ['Rex', 'Fido', 'Spot', 'Lassie', 'Bones']);

// ---------- New game: the opponent's name finds Dog Squad on Gaffer
await A.click('#mNew');
await A.page.fill('#opp', 'Dog'); await A.run(800);
check(await A.visible('#oppFind'), 'typing the opponent\'s name lists teams on Gaffer with that name');
eq(await A.page.$$eval('#oppFind .who b', (b) => b.map((x) => x.textContent)), ['Dog Squad'], 'Dog Squad is there (and SOP isn\'t offered itself)');
await shot(A, 'linked-search');
await A.click('#oppFind button.plain[data-oteam]');
eq([await A.page.inputValue('#opp'), await A.visible('#oppFind'), await A.visible('#oppLink')], ['Dog Squad', false, true], 'picking them fills in the name and says the game will be linked');
check((await A.text('#oppLink')).includes('Linking with Dog Squad on Gaffer') && (await A.text('#oppLink')).includes('Their gaffer is asked to accept'), 'and that their gaffer is asked to accept first');
await A.page.fill('#opp', 'Dog Squad Reserves'); await A.run(300);
check(!(await A.visible('#oppLink')), 'changing the name unlinks it (it\'s a different team now)');
await A.page.fill('#opp', 'Dog'); await A.run(800); await A.click('#oppFind button.plain[data-oteam]');
await A.click('#startGame'); await A.click('#kick'); await A.run(1500);
let db = w.db(), m = await A.match();
eq([db.game_links.length, db.game_links[0].status, typeof m.link, m.linkTo ?? null, m.opp], [1, 'proposed', 'string', null, 'Dog Squad'], 'setting the game up asks Dog Squad to link it');
const pushed = (db.calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'link');
eq(pushed.map((c) => [c.body.code, c.body.link]), [[sopCode, m.link]], 'and their gaffers are sent a notification');
check((await A.text('#linkLine')).startsWith('Waiting for Dog Squad to accept the link. Until they do, log their goals with Goal against.'), `the game screen says it's waiting for them (${await A.text('#linkLine')})`);

// ---------- SOP kick off and score before Dog Squad answer
await A.click('#go'); await A.run(60000);
await A.click('#goalUs'); await A.click('#picker [data-p="2"]'); await A.click('#picker [data-p="3"]'); await A.run(9000);
eq(await score(A), '1–0', 'Jake scores for SOP');
eq((await links(B))[0].their ?? null, null, 'Dog Squad\'s gaffer sees the request, but none of SOP\'s game, until accepting');

// ---------- Dog Squad's gaffer opens Gaffer (from the notification) and accepts
await B.page.reload(); await B.run(1500);
check(await B.visible('#linkCard'), 'the request is on Dog Squad\'s Home');
check((await B.text('#linkCard')).includes('Sons of Pitches FC want to link a game with you'), 'saying who wants to link a game');
check(!/Jake|Chaplin|Spice/.test(await B.text('#v-home')), 'with none of SOP\'s players shown');
await shot(B, 'linked-request');
await B.click('#linkCard [data-lyes]'); await B.run(1500);
eq([await B.view(), await B.page.inputValue('#opp'), await B.visible('#oppLink')], ['setup', 'Sons of Pitches FC', true], 'accepting opens New game against SOP');
check((await B.text('#oppLink')).includes('Linked with Sons of Pitches FC on Gaffer') && (await B.text('#oppLink')).includes('They’ve accepted'), 'already linked');
eq(w.db().game_links[0].status, 'accepted', 'the link is accepted');
check((w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'link').length === 2, 'and SOP\'s gaffers are told');
await B.click('#startGame'); eq(await B.view(), 'mins', 'Dog Squad have five, so nobody\'s on the bench, and the game still sets up (this used to go back to Home)'); await B.click('#kick'); await B.run(500);
eq([(await B.match()).link, (await B.match()).opp], [m.link, 'Sons of Pitches FC'], 'Dog Squad\'s game is linked to the same game');
await B.run(1500);
eq(await score(B), '0–1', 'Dog Squad\'s phone shows Jake\'s goal straight away: Dog Squad 0–1 SOP');
check((await B.text('#events')).includes('Goal for Sons of Pitches FC: Jake') && (await B.text('#events')).includes('Logged by Sons of Pitches FC'), `with SOP's scorer, logged by SOP (${await B.text('#events')})`);
check((await B.text('#events')).includes('set up by Chaplin'), 'and who set it up');
await B.click('#go'); await w.run(21000);
check((await A.text('#linkLine')).includes('Linked with Dog Squad') && (await A.text('#linkLine')).includes('Their squad: Rex, Fido, Spot, Lassie, Bones.'), `SOP's phone now shows it's linked, with Dog Squad's squad (${await A.text('#linkLine')})`);
await shot(A, 'linked-game');

// ---------- Dog Squad score: logged on their phone, and SOP press Goal against for it too
await B.click('#goalUs'); await B.click('#picker [data-p="1"]'); await B.click('#picker [data-p="x"]'); await w.run(1500);
eq([await score(A), await score(B)], ['1–1', '1–1'], 'Rex scores for Dog Squad: both phones show 1–1 within a moment');
check((await A.text('#events')).includes('Goal for Dog Squad: Rex'), 'SOP\'s phone names Rex');
await A.run(20000);
await A.click('#goalThem'); await w.run(9000);
eq([await score(A), await score(B)], ['1–1', '1–1'], 'SOP logging the same goal as Goal against doesn\'t count it twice');
eq((await A.watch()).them, 1, 'and the watch has the same score');

// ---------- a follower of SOP sees the same score
const F = await w.phone({ db: true, label: 'SOP follower' });
await F.page.fill('#joinCode', sopCode); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(1500);
await F.click('#mResume'); await F.run(1000);
eq(await score(F), '1–1', 'someone following SOP sees 1–1 as well');

// ---------- Dog Squad score again, only on their phone; SOP finish first
await B.click('#goalUs'); await B.click('#picker [data-p="2"]'); await B.click('#picker [data-p="x"]'); await w.run(1500);
eq([await score(A), await score(B)], ['1–2', '2–1'], 'Fido scores: SOP 1–2 Dog Squad on both');
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000); await A.click('#go'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000);
await A.click('#finish'); await A.click('#finish'); await A.run(2500);
db = w.db();
let ga = db.games.find((g) => g.link === m.link && g.opp === 'Dog Squad');
check(!!ga, 'SOP\'s finished game keeps the link');
eq([ga.us, ga.them], [1, 2], 'and the score both phones showed, 1–2');
eq(db.game_events.filter((e) => e.game_id === ga.id && e.kind !== 'highlight').map((e) => [e.kind, e.pid ?? null, !!e.from_link]), [['goal', 2, false], ['against', null, false], ['against', null, true]],
  'Fido\'s goal, which only Dog Squad logged, is kept in SOP\'s game, marked as theirs');

// ---------- Dog Squad score once more after SOP have finished; SOP's result follows
await B.run(20000); await B.click('#goalUs'); await B.click('#picker [data-p="3"]'); await B.click('#picker [data-p="x"]'); await w.run(1500);
eq(await score(B), '3–1', 'a late goal for Dog Squad on their phone');
await w.run(21000);
db = w.db(); ga = db.games.find((g) => g.id === ga.id);
eq([ga.us, ga.them, db.game_events.filter((e) => e.game_id === ga.id && e.from_link).length], [1, 3, 2], 'SOP\'s finished game is put right: 1–3, with both of the goals only Dog Squad logged');
await B.click('#endHalf'); await B.click('#endHalf'); await B.run(1000); await B.click('#go'); await B.run(30000);
await B.click('#endHalf'); await B.click('#endHalf'); await B.run(1000);
await B.click('#finish'); await B.click('#finish'); await B.run(2500);
db = w.db(); const gb = db.games.find((g) => g.link === m.link && g.team_id !== ga.team_id);
eq([gb.us, gb.them, db.game_events.filter((e) => e.game_id === gb.id && e.kind !== 'highlight').map((e) => [e.kind, e.pid ?? null, !!e.from_link])], [3, 1, [['against', null, true], ['goal', 1, false], ['goal', 2, false], ['goal', 3, false]]],
  'Dog Squad\'s game ends 3–1, with Jake\'s goal kept as SOP\'s');
eq([db.game_players.filter((p) => p.game_id === gb.id && p.goals).map((p) => [p.pid, p.goals]).sort()], [[[1, 1], [2, 1], [3, 1]]], 'each team\'s stats are its own players\'');

// ---------- footage from either side goes in the game's highlights
const d2 = w.db(); d2.clips.push({ team_id: gb.team_id, game_id: gb.id, seq: 1, path: gb.team_id + '/dog/01.mp4', label: 'Goal: Rex', at: 1, dur: 14, store: 'r2', pids: [1] }); w.setDb(d2);
await A.page.reload(); await A.run(1500); await home(A); await A.run(300); await A.click('#mHighlights'); await A.run(500);
const card = await A.text('#hlList .hcard');
check(card.includes('From Dog Squad’s video') && card.includes('Goal: Rex'), `SOP's Highlights has the clip Dog Squad cut (${card.slice(0, 160)})`);
check(card.includes('1–3') || card.includes('1 3'), 'with the game at 1–3');

// ---------- the link can't be accepted by the team that asked, and declining / scrapping is quiet
await home(A); await A.run(300);
await A.click('#mNew'); await A.page.fill('#opp', 'Dog'); await A.run(800); await A.click('#oppFind button.plain[data-oteam]');
await A.click('#startGame'); await A.click('#kick'); await A.run(1500);
const l2 = (await A.match()).link;
check(!!l2 && w.db().game_links.find((l) => l.id === l2).status === 'proposed', 'a second game against them asks again');
await home(A); await A.run(300); await A.page.evaluate(() => document.getElementById('mNew').click()); await A.run(300); await A.click('#abandonYes'); await A.run(1500); // (New game with one going: abandon it first)
eq(w.db().game_links.find((l) => l.id === l2).status, 'cancelled', 'scrapping that game takes the unanswered request back');
await B.page.reload(); await B.run(1500); await home(B); await B.run(300);
check(!(await B.visible('#linkCard')), 'so Dog Squad aren\'t left with a request for a game that isn\'t happening');

await w.close();
await done(A, B, F);
