// Profiles and following. Ethan's asks: everyone gets a username (new accounts pick one when signing up, accounts made
// before get a pop-up the next time they open the app; EDP, Ethan, EthanDP and E_D_P_1 are kept for him); each person
// picks whether their profile is public or private; anyone public can be followed straight away, someone private has to
// accept; a profile shows their teams, results, stats and up to three clips they choose (never upcoming games); a feed of
// the people you follow that leaves out what you've already seen in your own teams; report and block; all free.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: profiles and following');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const msg = (P) => P.text('#aMsg');

// ---------- signing up asks for a username, and keeps Ethan's back
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#acctBtn');
await A.page.fill('#aEmail', 'ethan@example.com'); await A.page.fill('#aPass', 'longpassword');
await A.click('#aSignUp'); await A.run(300);
eq(await msg(A), 'Pick a username for your account.', 'creating an account needs a username');
await A.page.fill('#aUser', 'my name'); await A.click('#aSignUp'); await A.run(300);
eq(await msg(A), 'Usernames are 3 to 20 letters, numbers or _, with no spaces.', 'and says what a username can be');
for (const u of ['EDP', 'Ethan', 'ethandp', 'E_D_P_1']) {
  await A.page.fill('#aUser', u); await A.click('#aSignUp'); await A.run(300);
  eq(await msg(A), 'That username is kept back. Try another.', `${u} is kept back`);
}
eq((w.db().users || []).length, 0, 'and no account was made with any of those');
await A.page.fill('#aUser', 'gaffer_ethan'); await A.click('#aSignUp'); await A.run(300); await A.click('#aSignIn'); await A.run(1000);
eq(w.db().profiles.map((p) => [p.username, p.private]), [['gaffer_ethan', false]], 'a new account gets the username it picked, as soon as it signs in (public to start with)');
eq(await A.visible('#unamePop'), false, 'so it isn\'t asked again');

// the team, and a game Jake scores in
await A.click('#createBtn'); await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC');
await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(300);
let db = w.db(); const team = db.teams[0], game = db.games[0];
db.clips.push({ team_id: team.id, game_id: game.id, seq: 0, path: team.id + '/dog/01.mp4', store: 'r2', at: 1791660000000, dur: 14, pids: [2], label: '2\' Goal: Jake' });
// Jake made his account before profiles: no username yet
db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword' }); db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id = 'u-jake';
db.reserved_usernames = ['edp', 'ethan', 'ethandp', 'e_d_p_1', 'gaffer'].map((h) => ({ handle: h, user_id: h === 'gaffer' ? null : db.users[0].id })); // (live: set on the real database for Ethan's account)
w.setDb(db);

// ---------- an account from before profiles gets the pop-up next time
const J = await w.phone({ db: true, label: 'jake' });
await J.click('#acctBtn'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500);
eq([await J.visible('#unamePop'), await J.text('#unTitle')], [true, 'Pick a username'], 'an account without a username is asked for one when the app opens');
await shot(J, 'pick-username');
await J.page.fill('#unUser', 'edp'); await J.run(600);
eq(await J.text('#unCheck'), 'That username is kept back. Try another.', 'it says straight away if a name can\'t be had');
await J.page.fill('#unUser', 'Chappers'); await J.run(600);
eq(await J.text('#unCheck'), '@Chappers is free.', 'or that it\'s free');
await J.page.fill('#unName', 'Jake Smith'); await J.click('#unPriv [data-priv="1"]'); await J.click('#unSave'); await J.run(800);
const jp = w.db().profiles.find((p) => p.user_id === 'u-jake');
eq([await J.visible('#unamePop'), jp.username, jp.name, jp.private], [false, 'Chappers', 'Jake Smith', true], 'he picks one and goes private');
await J.page.reload(); await J.run(1500);
eq(await J.visible('#unamePop'), false, 'and isn\'t asked again');
const J2 = await w.phone({ db: true, label: 'jake, not now' }); // "Not now" puts it off till the next time the app opens
await J2.click('#acctBtn'); await J2.page.fill('#aEmail', 'jake@example.com'); await J2.page.fill('#aPass', 'longpassword'); await J2.click('#aSignIn'); await J2.run(1500);
eq(await J2.visible('#unamePop'), false, 'on another phone too, once he has one');
await J2.close();

// ---------- Ethan's names are his
await A.click('#mPeople'); await A.run(800);
check(/@gaffer_ethan · Public/.test(await A.text('#pplBody')), 'People shows your own card');
await A.click('#pplBody [data-pp="pick"]'); await A.page.fill('#unUser', 'EDP'); await A.click('#unSave'); await A.run(800);
eq(w.db().profiles.find((p) => p.user_id === db.users[0].id).username, 'EDP', 'Ethan can take one of the names kept for him');

// ---------- Sam (no team in common) finds Jake and asks to follow
const S = await w.phone({ db: true, label: 'sam' });
await S.click('#acctBtn'); await S.signUp('sam@example.com', 'samwise'); await S.run(500);
await S.click('#pplBtn'); await S.run(800);
await S.page.fill('#pplQ', 'chap'); await S.click('#pplGo'); await S.run(500);
eq(await S.page.$$eval('#pplFound .prow .who', (b) => b.map((x) => x.textContent)), ['Jake Smith Private@Chappers'], 'people are found by name or username');
eq(await S.text('#pplBody [data-fol="Chappers"]'), 'Ask to follow', 'someone private is asked');
await S.click('#pplBody [data-fol="Chappers"]'); await S.run(800);
check(/Asked to follow @Chappers/.test(await S.text('#pplMsg')), 'which says so');
await S.click('#pplBody [data-prof="Chappers"]'); await S.run(800);
check(/Waiting for @Chappers to accept/.test(await S.text('#prBody')) && !/Results/.test(await S.text('#prBody')), 'his profile stays private while he hasn\'t accepted');
await shot(S, 'profile-private');

// ---------- Jake accepts
await J.page.reload(); await J.run(1500);
eq(await J.page.$eval('#pplBtn .pplBadge', (b) => b.hidden ? '' : b.textContent), '1', 'Jake sees a request waiting');
await J.click('#pplBtn'); await J.run(800);
check(/Asking to follow you/.test(await J.text('#pplBody')) && /@samwise/.test(await J.text('#pplBody')), 'with who it\'s from');
await J.click('#pplBody [data-acc="samwise"]'); await J.run(800);
eq(w.db().follows.map((f) => f.status), ['accepted'], 'he accepts');

// ---------- what Sam sees now
await S.page.reload(); await S.run(1500);
const prof = async (P, u) => { await P.page.evaluate((x) => { const b = document.createElement('button'); b.setAttribute('data-prof', x); document.getElementById('pplBody').appendChild(b); b.click(); }, u); await P.run(800); };
if (await S.view() !== 'profile') { await S.click('#pplBtn'); await S.run(500); await prof(S, 'Chappers'); } else { await S.page.evaluate(() => {}); }
await S.run(800);
const body = await S.text('#prBody');
check(/Sons of Pitches FC/.test(body) && /Games/.test(body) && /Goals/.test(body), `his teams and stats show (${body.slice(0, 160)})`);
eq(await S.page.$$eval('#prBody .prstats b', (b) => b.map((x) => +x.textContent)), [1, 1, 1, 0], 'one game, a win, a goal, no assists');
check(/SOP FC 1–0 Dog Squad/.test(body) && /1 goal/.test(body), 'and his results, with what he did');
check(/No clips picked yet/.test(body), 'no clips until he picks some');
check(!/Next game|Upcoming|Kick-off at/i.test(body), 'never upcoming games');
await shot(S, 'profile');

// ---------- Jake picks a clip for his profile
await J.click('#pplBody [data-prof="Chappers"]'); await J.run(800);
await J.click('#prBody [data-pr="pins"]'); await J.run(800);
eq(await J.page.$$eval('#prBody [data-pin]', (x) => x.length), 1, 'he chooses from his clips (from all his teams)');
await J.page.check('#prBody [data-pin]'); await J.click('#prBody [data-pr="pinsave"]'); await J.run(1000);
eq(w.db().profiles.find((p) => p.user_id === 'u-jake').pins, [{ g: game.id, at: 1791660000000 }], 'and it\'s saved');
await S.page.reload(); await S.run(1500); if (await S.view() !== 'profile') { await S.click('#pplBtn'); await S.run(500); await prof(S, 'Chappers'); }
await S.run(800);
eq(await S.page.$$eval('#prBody .vplayer [data-clip]', (b) => b.map((x) => x.textContent)), ['SOP FC 1–0 Dog Squad: 2\' Goal: Jake'], 'Sam can watch it on his profile');

// ---------- the feed
await S.tap('#v-profile .back'); await S.run(1200);
eq(await S.page.$$eval('#pplBody .feedcard h3', (h) => h.map((x) => x.textContent.replace('New', '').trim())), ['SOP FC 1–0 Dog Squad'], 'Sam\'s feed has the game Jake played');
check(/1 goal/.test(await S.text('#pplBody .feedcard')) && await S.page.$$eval('#pplBody .feedcard [data-clip]', (b) => b.length) === 1, 'with his goal and his clip');
await shot(S, 'feed');
db = w.db(); db.follows.push({ follower: db.users[0].id, followee: 'u-jake', status: 'accepted' }); w.setDb(db);
await A.page.reload(); await A.run(1500); if (await A.view() !== 'people') { await home(A); await A.run(300); await A.click('#mPeople'); } await A.run(1200);
eq(await A.page.$$eval('#pplBody .feedcard', (c) => c.length), 0, 'but Ethan, in Jake\'s team, doesn\'t get his own team\'s game again');
const F = await w.phone({ db: true, label: 'follower of the team' }); // someone who follows SOP on this phone and follows Jake
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
await home(F); await F.run(300); await F.page.evaluate(() => { document.querySelector('[data-go="welcome"], #mSwitch') && document.querySelector('#mSwitch').click(); }); await F.run(300);
await F.click('#acctBtn'); await F.signUp('fan@example.com', 'sop_fan'); await F.run(500);
db = w.db(); const fan = db.users.find((u) => u.email === 'fan@example.com'); db.follows.push({ follower: fan.id, followee: 'u-jake', status: 'accepted' }); w.setDb(db);
await F.click('#pplBtn'); await F.run(1200);
eq(await F.page.$$eval('#pplBody .feedcard', (c) => c.length), 0, 'nor does someone who follows the team on their phone: they\'ve seen it there');

// ---------- report and block
await S.click('#pplBody [data-prof="Chappers"]'); await S.run(800);
await S.click('#prBody [data-pr="report"]'); await S.click('#prBody [data-why="Spam or a fake account"]'); await S.run(800);
eq(w.db().profile_reports.map((r) => [r.reporter === 'u-jake', r.reason]), [[false, 'Spam or a fake account']], 'anyone can be reported, with a reason');
check(/Gaffer will look at @Chappers/.test(await S.text('#prMsg')), 'which says what happens next');
await S.click('#prBody [data-pr="block"]'); eq(/Tap again to block/.test(await S.text('#prBody')), true, 'blocking takes two taps');
await S.click('#prBody [data-pr="block"]'); await S.run(1200);
eq([await S.view(), w.db().blocks.length, w.db().follows.filter((f) => f.followee === 'u-jake' && f.follower !== 'u-jake').length], ['people', 1, 2], 'blocked: back to People, and Sam no longer follows him');
check(/Blocked @Chappers/.test(await S.text('#pplMsg')) && /Blocked \(1\)/.test(await S.text('#pplBody')), 'with an Unblock list');
if (await J.view() !== 'people') { await J.tap('#v-profile .back'); await J.run(1000); }
await J.page.fill('#pplQ', 'sam'); await J.click('#pplGo'); await J.run(500);
eq(await J.page.$$eval('#pplFound .prow .who', (b) => b.length), 0, 'and Jake can\'t find Sam either');
await S.click('#pplBody details:last-of-type summary'); await S.click('#pplBody [data-unblock="Chappers"]'); await S.run(1000);
eq(w.db().blocks.length, 0, 'unblocking puts things back (without following again)');

// ---------- going public accepts anyone waiting; public profiles are followed straight away
db = w.db(); db.follows.push({ follower: fan.id, followee: 'u-jake', status: 'pending' }); db.follows = db.follows.filter((f, i, all) => all.findIndex((x) => x.follower === f.follower && x.followee === f.followee) === i); w.setDb(db);
await J.click('#pplBody [data-pp="pick"]'); await J.click('#unPriv [data-priv="0"]'); await J.click('#unSave'); await J.run(800);
check(w.db().follows.filter((f) => f.followee === 'u-jake').every((f) => f.status === 'accepted'), 'going public accepts every request waiting');
await S.page.fill('#pplQ', 'chap'); await S.click('#pplGo'); await S.run(500);
eq(await S.text('#pplBody [data-fol="Chappers"]'), 'Follow', 'someone public just has Follow');
await S.click('#pplBody [data-fol="Chappers"]'); await S.run(800);
eq(w.db().follows.find((f) => f.follower !== 'u-jake' && f.followee === 'u-jake' && w.db().users.find((u) => u.id === f.follower).email === 'sam@example.com').status, 'accepted', 'and is followed straight away');

// ---------- signed out, People asks you to sign in
const N = await w.phone({ db: true, label: 'nobody' });
await N.click('#pplBtn'); await N.run(300);
check(/Sign in to pick a username/.test(await N.text('#pplBody')), 'without an account, People says what it\'s for and asks you to sign in');

await w.close();
await done(A, J, S, F, N);
