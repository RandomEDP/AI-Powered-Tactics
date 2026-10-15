// Goal of the Week on the phones (Ethan asked): gaffers put up one of their team's goals a week, anyone signed in on
// Gaffer watches them and votes (not for their own team), the winner is announced on Monday with a notification, and the
// winning team's gaffer makes the winner's reel on their iPhone, with the team's name (and a sponsor, when there is one)
// on its end card.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: Goal of the Week');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    upload: async (o) => { window.__rc.push(['upload', o]); const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': o.contentType || 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; },
    share: async (o) => { window.__rc.push(['share', o.path]); return {}; }, cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const calls = (P, kind) => P.page.evaluate((k) => window.__rc.filter((x) => x[0] === k).map((x) => x[1]), kind);
const signIn = async (P, email) => { await P.click('#acctBtn'); await P.page.fill('#aEmail', email); await P.page.fill('#aPass', 'longpassword'); await P.click('#aSignIn'); await P.run(1500); if (await P.visible('#tmAgree')) { await P.click('#tmAgree'); await P.run(300); } };

// ---------- Ethan's team plays Dog Squad; Jake scores; the goal is cut into a clip
const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#keeperSave').catch(() => {}); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
let db = w.db(); const sop = db.teams[0], game = db.games[0], goal = db.game_events.find((e) => e.kind === 'goal');
check(!!goal && typeof goal.at === 'number', 'the goal is in the database with its time');
db.clips.push({ team_id: sop.id, game_id: game.id, seq: 0, path: sop.id + '/dog/01.mp4', store: 'r2', at: goal.at, dur: 14, pids: [2], label: "1' Goal: Jake" });
db.clips.push({ team_id: sop.id, game_id: game.id, seq: 1, path: sop.id + '/dog/02.mp4', store: 'r2', at: goal.at + 50000, dur: 14, pids: [], label: 'Save' });
// Dog Squad, another team on Gaffer, with its own goal up already
const dogId = 'team-dog', dogGame = 'game-dog';
db.users.push({ id: 'u-dan', email: 'dan@example.com', password: 'longpassword' }, { id: 'u-sam', email: 'sam@example.com', password: 'longpassword' }, { id: 'u-jake', email: 'jake@example.com', password: 'longpassword' });
db.teams.push({ id: dogId, code: 'DOGSQD', organiser_code: 'DOGSQUAD10', name: 'Dog Squad', short: 'DOG', color: '#c0392b', settings: {} });
db.team_members.push({ team_id: dogId, user_id: 'u-dan' }); db.players.push({ team_id: dogId, pid: 1, name: 'Rex' });
db.games.push({ id: dogGame, team_id: dogId, seq: 0, opp: 'Cat Squad', us: 1, them: 0, ko_at: goal.at - 60000, finished_at: goal.at });
db.game_events.push({ game_id: dogGame, seq: 0, kind: 'goal', pid: 1, at: goal.at - 30000 });
db.clips.push({ team_id: dogId, game_id: dogGame, seq: 0, path: dogId + '/cat/01.mp4', store: 'r2', at: goal.at - 30000, dur: 14, pids: [1], label: "1' Goal: Rex" });
db.players.find((p) => p.team_id === sop.id && p.pid === 2).user_id = 'u-jake';
db.profiles.push({ user_id: 'u-sam', username: 'sam_watches', name: 'Sam', private: false, pins: [] }, { user_id: 'u-jake', username: 'Chappers', name: 'Jake', private: false, pins: [] });
w.setDb(db);
await A.page.reload(); await A.run(2500);

// ---------- Ethan puts Jake's goal up, from Highlights
await A.page.evaluate(() => { const b = document.querySelector('#mHighlights') || document.querySelector('[data-go="highlights"]'); if (b) b.click(); }); await A.run(800);
check(/Goal of the Week/.test(await A.text('#hlGw .gwstrip')), 'Highlights starts with Goal of the Week');
await A.click('#hlGw .gwstrip'); await A.run(1500);
eq(await A.view(), 'gotw', 'which opens it');
check(/Put up one of Sons of Pitches FC’s goals/.test(await A.text('#gwBody .gwput')), 'the gaffer is offered his team\'s goals to put up');
eq(await A.page.$$eval('#gwBody [data-gwnom]', (b) => b.map((x) => x.closest('li').querySelector('b').textContent)), ["1' Goal: Jake"], 'only goals (the save isn\'t one)');
await A.click('#gwBody [data-gwnom]'); await A.run(1500);
db = w.db();
eq(db.gotw_noms.filter((n) => !n.removed_at).map((n) => [n.team_id === sop.id, n.at === goal.at]), [[true, true]], 'Jake\'s goal is up for this week');
check(/It’s up for Goal of the Week/.test(await A.text('#gwMsg')) && /Up this week/.test(await A.text('#gwBody .gwput')), 'he\'s told it\'s up, and the list says so');
const ethanSees = await A.page.$$eval('#gwBody .gwentry', (x) => x.map((e) => [e.querySelector('h3').textContent, !!e.querySelector('[data-gwvote]'), !!e.querySelector('[data-gwoff]')]));
eq(ethanSees.find((x) => /Sons of Pitches/.test(x[0])), ['Sons of Pitches FCYour team', false, true], 'his own team\'s goal: no vote for him, and he can take it down');
await shot(A, 'gotw-gaffer');
db = w.db(); db.gotw_noms.push({ id: 'nom-dog', week: db.gotw_noms[0].week, team_id: dogId, game_id: dogGame, at: goal.at - 30000, nominated_by: 'u-dan', created_at: Date.now() + 1e6, removed_at: null, pulled: false }); w.setDb(db);

// ---------- Sam, on Gaffer with no team, watches and votes from Home
const S = await w.phone({ db: true, label: 'sam' });
await signIn(S, 'sam@example.com');
await S.click('#pplBtn'); await S.run(1500);
check(/Goal of the Week/.test(await S.text('#fdBody .gwstrip')) && /2 goals are up this week/.test(await S.text('#fdBody .gwstrip')), 'Home starts with Goal of the Week: two goals up');
await S.click('#fdBody .gwstrip'); await S.run(1500);
const entries = () => S.page.$$eval('#gwBody .gwentry', (x) => x.map((e) => ({ team: e.querySelector('h3').textContent, src: (e.querySelector('video') || {}).getAttribute ? e.querySelector('video').getAttribute('src') : null, vote: (e.querySelector('[data-gwvote]') || {}).textContent || null, id: e.getAttribute('data-gwid') })));
let es = await entries();
eq(es.map((e) => e.team).sort(), ['Dog Squad', 'Sons of Pitches FC'], 'Sam sees both teams\' goals');
check(es.every((e) => /\/(dog|cat)\/01\.mp4#t=0\.1$/.test(e.src)) && es.every((e) => e.vote === 'Vote for this goal'), 'each with its clip and a vote button');
check(/Voting closes at midnight on Sunday 11 Oct/.test(await S.text('#gwBody .gwhead')), 'it says when voting closes');
const sopNom = es.find((e) => /Sons/.test(e.team)).id;
await S.click(`#gwBody [data-gwvote="${sopNom}"]`); await S.run(1500);
eq([w.db().gotw_votes.map((v) => [v.user_id, v.nom_id === sopNom]), await S.text(`#gwBody [data-gwvote="${sopNom}"]`)], [[['u-sam', true]], 'Your vote'], 'he votes for SOP\'s goal');
await S.click('#gwBody [data-gwvote="nom-dog"]'); await S.run(1500);
eq(w.db().gotw_votes.map((v) => [v.user_id, v.nom_id]), [['u-sam', 'nom-dog']], 'changing his mind moves his one vote');
check(/Vote changed/.test(await S.text('#gwMsg')) && /1 vote so far/.test(await S.text('#gwBody .gwhead')), 'he\'s told, and only the total so far is shown');
await S.click(`#gwBody [data-gwvote="${sopNom}"]`); await S.run(1500);
await shot(S, 'gotw-voter');
// reporting
await S.click('#gwBody [data-gwrep="nom-dog"]'); await S.click('#gwBody [data-gwwhy="Not their goal"]'); await S.run(800);
db = w.db();
eq([db.gotw_reports.map((r) => [r.nom_id, r.reason]), (db.calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'report').map((c) => c.body.what)], [[['nom-dog', 'Not their goal']], ['gotw']], 'anyone can report a goal, and Gaffer\'s moderators are told');

// ---------- Jake, who plays for SOP, can't vote for his own team's goal
const J = await w.phone({ db: true, label: 'jake' });
await signIn(J, 'jake@example.com');
await J.click('#pplBtn'); await J.run(1500); await J.click('#fdBody .gwstrip'); await J.run(1500);
const jk = await J.page.$$eval('#gwBody .gwentry', (x) => x.map((e) => [e.querySelector('h3').textContent, !!e.querySelector('[data-gwvote]')]).sort());
eq(jk, [['Dog Squad', true], ['Sons of Pitches FCYour team', false]], 'Jake gets no vote on his own team\'s goal');
await J.click('#gwBody [data-gwvote="nom-dog"]'); await J.run(1200);
eq(w.db().gotw_votes.length, 2, 'he votes for Dog Squad\'s');

// ---------- the week ends: SOP win 2–1 (another vote came in); a sponsor that week
const prev = (wk) => { const dt = new Date(wk + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 7); return dt.toISOString().slice(0, 10); };
db = w.db(); const wk = prev(db.gotw_noms[0].week);
db.gotw_votes.push({ week: db.gotw_noms[0].week, user_id: 'u-other', nom_id: sopNom });
db.gotw_noms.forEach((n) => { n.week = wk; }); db.gotw_votes.forEach((v) => { v.week = wk; });
db.gotw_sponsors = [{ week: wk, name: 'Boot Co' }]; w.setDb(db);
await S.click('#gwBack'); await S.run(300); await S.click('#fdBody .gwstrip'); await S.run(2000);
db = w.db();
eq(db.gotw_winners.map((x) => [x.week, x.team_id === sop.id, x.votes, x.sponsor]), [[wk, true, 2, 'Boot Co']], 'the first look after Sunday decides it: SOP\'s goal, with 2 votes, presented by Boot Co');
eq([db.gotw_winners[0].notified_at > 0, db.gotwPushes], [true, 1], 'and the teams and the voters are told, once');
check(/Winner, week of .* presented by Boot Co/.test(await S.text('#gwBody .gwwin')) && /Won with 2 votes/.test(await S.text('#gwBody .gwwin')), 'Sam sees last week\'s winner, and its sponsor');
eq([await S.page.$$eval('#gwBody .gwentry', (x) => x.length), await S.page.$$eval('#gwBody .gwwin [data-gwmake]', (x) => x.length)], [0, 0], 'nothing is up for the new week yet, and only the winning team can make the reel');
await J.page.evaluate(() => window.gafferGotw.load()); await J.run(1200);
eq(w.db().gotwPushes, 1, 'another phone looking doesn\'t tell anyone again');

// ---------- Ethan makes the winner's reel on his iPhone
await A.click('#gwBack'); await A.run(300); await A.page.evaluate(() => window.gafferGotw.open('highlights')); await A.run(2000);
check(/You won! Make the winner’s reel/.test(await A.text('#gwBody .gwwin')), 'Ethan is told his team won, and offered the winner\'s reel');
await A.click('#gwBody [data-gwmake]'); await A.run(3000);
const join = (await calls(A, 'join')).filter((o) => /goal-of-the-week/.test(o.file))[0] || { outro: {}, items: [] }; // (Highlights also made the game's one video by itself)
eq([join.items.map((i) => i.url.replace(/^.*\/(dog\/\d+\.mp4)$/, '$1')), join.outro.kicker, join.outro.sponsor, join.outro.title, join.shrink], [['dog/01.mp4'], 'Goal of the Week', 'Boot Co', 'Sons of Pitches FC', true],
  'the reel is Jake\'s goal, then a Goal of the Week card with the team\'s name, presented by the week\'s sponsor');
check(/Goal: Jake · Week of .* · Won with 2 votes/.test(join.outro.sub), `the card says whose goal, which week and the votes (${join.outro.sub})`);
db = w.db();
const reel = (db.gotw_winners[0] || {}).reel || {};
check(reel.store === 'r2' && new RegExp('^' + sop.id + '/gotw/' + wk + '-\\d+\\.mp4$').test(reel.path) && (db.files || []).some((f) => f.path === reel.path), `it\'s uploaded to the team\'s folder and kept for everyone (${reel.path})`);
eq((await calls(A, 'share')).filter((p) => /goal-of-the-week/.test(p)).length, 1, 'and the share sheet opens');
check(/The winner’s reel is up for everyone to watch/.test(await A.text('#gwMk')), 'he\'s told it\'s up');
await S.page.evaluate(() => window.gafferGotw.load()); await S.run(1200);
check((await S.page.$eval('#gwBody .gwwin video', (v) => v.getAttribute('src'))).endsWith(reel.path), 'Sam now watches the winner\'s reel');
await shot(S, 'gotw-winner');

// ---------- signing out forgets it
await S.page.evaluate(() => window.gafferGotw.signOut()); await S.run(800);
eq(await S.page.evaluate(() => window.gafferGotw.board()), null, 'signing out forgets the board (another account\'s vote isn\'t shown)');

await done(A, S, J);
