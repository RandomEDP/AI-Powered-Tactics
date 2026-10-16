// The Highlights tab (Ethan, for 1.1): Chat moves onto the Team page and Highlights takes its place in the bar. The tab has
// "My teams" (a team's highlights, as before, with the teams on the phone to switch between) and "Just me" (every clip
// you're in, from every team), with friendlies left out unless "Include friendlies" is ticked.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: the Highlights tab');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const tabs = (P) => P.page.$$eval('#tabs button', (b) => b.filter((x) => !x.hidden).map((x) => x.querySelector('span').textContent.trim()));
const scope = (P) => P.page.$eval('#hlScope [aria-pressed="true"]', (b) => b.textContent);
const cards = (P) => P.page.$$eval('#hlList .hcard.mehl', (c) => c.map((x) => x.querySelector('h3').textContent.replace(/\s+/g, ' ').trim()));

const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- the bar and the Team page
eq(await tabs(A), ['Home', 'Team', 'Highlights', 'Games', 'Profile'], 'the bar: Home, Team, Highlights, Games, Profile (no Chat)');
check(await A.visible('#mChat'), 'Chat is a tile on the Team page');
await A.click('#mChat');
eq([await A.view(), await A.text('#v-chat .bar .back'), await A.page.$eval('#tabs [data-tab="home"]', (b) => b.getAttribute('aria-current'))], ['chat', 'Team', 'page'], 'it opens the squad chat, under the Team tab, with a way back');
await A.click('#chatBack'); eq(await A.view(), 'home', 'back to the Team page');

// ---------- Ethan plays for two teams, and has a friendly: clips of him in each
let db = w.db();
const me = db.users[0].id, sop = db.teams[0];
db.players.find((p) => p.team_id === sop.id && p.pid === 3).user_id = me;
const dog = { id: 'team-dog', code: 'DOGSQD', organiser_code: 'DOGSQUAD01', name: 'Dog Squad', short: 'DOG', color: '#225588', settings: {}, followers_can_score: true };
const fr = { id: 'team-fr', code: 'FRNDLY', organiser_code: 'FRIENDLY01', name: 'Ethan’s friendlies', short: 'Friendlies', color: '#5b2a86', settings: {}, personal: true, created_by: me };
db.teams.push(dog, fr); db.team_members.push({ team_id: fr.id, user_id: me });
db.players.push({ team_id: dog.id, pid: 1, name: 'Ethan', user_id: me }, { team_id: dog.id, pid: 2, name: 'Rex' }, { team_id: fr.id, pid: 1, name: 'Ethan', user_id: me });
const T = 1791660000000;
db.games.push({ id: 'g-sop', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 3, them: 1, finished_at: T - 7 * 864e5, friendly: false },
  { id: 'g-dog', team_id: dog.id, seq: 1, opp: 'Hamsters', us: 2, them: 2, finished_at: T - 2 * 864e5, friendly: false },
  { id: 'g-fr', team_id: fr.id, seq: 1, opp: 'Shirts', us: 4, them: 3, finished_at: T - 864e5, friendly: true, house: { a: 'Bibs', b: 'Shirts', fr: true, side: { 1: 'a' } } });
db.clips.push({ team_id: sop.id, game_id: 'g-sop', seq: 0, path: sop.id + '/cat/01.mp4', store: 'r2', at: T - 7 * 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' },
  { team_id: sop.id, game_id: 'g-sop', seq: 1, path: sop.id + '/cat/02.mp4', store: 'r2', at: T - 7 * 864e5 + 6e5, dur: 14, pids: [1], label: '14\' Goal: Spice' },
  { team_id: dog.id, game_id: 'g-dog', seq: 0, path: dog.id + '/ham/01.mp4', store: 'r2', at: T - 2 * 864e5, dur: 14, pids: [1, 2], label: '9\' Goal: Rex (Ethan)' },
  { team_id: fr.id, game_id: 'g-fr', seq: 0, path: fr.id + '/sh/01.mp4', store: 'r2', at: T - 864e5, dur: 14, pids: [1], label: '3\' Goal: Ethan' });
w.setDb(db);
await A.page.evaluate(() => { const a = JSON.parse(localStorage.getItem('apt-app')); a.teams.push({ code: 'DOGSQD', name: 'Dog Squad', org: false }, { code: 'FRNDLY', name: 'Ethan’s friendlies', org: true, fr: true }); localStorage.setItem('apt-app', JSON.stringify(a)); });
await A.page.reload(); await A.run(1500);

// ---------- My teams: the open team's highlights, and the other teams to switch to
await A.click('#tabs [data-tab="highlights"]'); await A.run(600);
eq([await A.view(), await scope(A), await A.visible('#hlToggle'), await A.page.$eval('#tabs [data-tab="highlights"]', (b) => b.getAttribute('aria-current'))], ['highlights', 'My teams', true, 'page'], 'the Highlights tab opens on My teams, with By game and By player');
check(!(await A.visible('#hlBack')), 'the tab is its own place: no back button');
eq(await A.page.$$eval('#hlTeams button', (b) => b.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : ''))), ['Sons of Pitches FC*', 'Dog Squad'], 'the teams on the phone to switch between (the friendlies team isn’t one of them)');
check(/Cat FC/.test(await A.text('#hlList')) && !/Hamsters/.test(await A.text('#hlList')), 'showing Sons of Pitches FC’s games');
await shot(A, 'hltab-teams');
await A.click('#hlTeams [data-hlteam="DOGSQD"]'); await A.run(1500);
eq([await A.view(), await A.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).active), await scope(A)], ['highlights', 'DOGSQD', 'My teams'], 'tapping Dog Squad opens its highlights');
check(/Hamsters/.test(await A.text('#hlList')), 'with its games');

// ---------- Just me: every clip of Ethan, from both teams, friendlies left out
await A.click('#hlScope [data-scope="me"]'); await A.run(800);
eq([await A.visible('#hlToggle'), await A.visible('#hlTeams'), await A.visible('#hlFrWrap'), await A.page.isChecked('#hlFr')], [false, false, true, false], 'Just me: no team to pick, and Include friendlies, off to start');
eq(await cards(A), ['DOG 2–2 Hamsters', 'SOP FC 3–1 Cat FC'], 'his games from both teams, newest first');
eq(await A.text('#hlMeSum'), '2 clips of you from 2 games. Friendlies are left out.', 'only the clips he’s in (not Spice’s goal)');
eq(await A.page.$$eval('#hlList .mehl .cliplist button', (b) => b.map((x) => x.textContent)), ['9\' Goal: Rex (Ethan)', '4\' Goal: Ethan'], 'each game’s clips to play');
await A.page.check('#hlFr'); await A.run(300);
eq(await cards(A), ['Bibs 4–3 ShirtsFriendly', 'DOG 2–2 Hamsters', 'SOP FC 3–1 Cat FC'], 'Include friendlies: the friendly comes in, marked as one');
await shot(A, 'hltab-me');

// ---------- the tab keeps the last choice; a team's own Highlights tile opens that team's
await A.click('#tabs [data-tab="home"]'); await A.click('#tabs [data-tab="highlights"]'); await A.run(300);
eq([await scope(A), await A.page.isChecked('#hlFr')], ['Just me', true], 'back on the tab: still Just me, friendlies still in');
await A.click('#tabs [data-tab="home"]'); await A.click('#mHighlights'); await A.run(300);
eq([await scope(A), await A.visible('#hlBack')], ['My teams', true], 'the Team page’s Highlights tile opens the team’s highlights, with a way back');
await A.page.reload(); await A.run(1200); await A.click('#tabs [data-tab="home"]'); await A.click('#tabs [data-tab="highlights"]'); await A.run(300);
eq(await scope(A), 'Just me', 'the tab’s own choice is kept on the phone');

check(!A.errs.length, 'no errors: ' + A.errs.join(' | '));
await w.close(); done();
