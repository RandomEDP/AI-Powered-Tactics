// Deleting your account. Apple turned the app down because it couldn't find how to: the only Delete button was on the
// Account page, which you could only reach from the welcome screen, so anyone with a team open had no way there. Settings
// (the gear on your profile, or Team settings) now has Your account, with Sign out and Delete my account.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: deleting your account');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const teamsOnPhone = (P) => P.page.evaluate(() => (JSON.parse(localStorage.getItem('apt-app') || '{}').teams || []).length);

// ---------- Ethan runs the team on his own; Jake joins the squad as himself
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const J = await w.phone({ db: true, label: 'jake' });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
let db = w.db(); const team = db.teams[0], jakeId = db.users.find((u) => u.email === 'jake@example.com').id;
eq(db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id, jakeId, 'Jake is in the squad as himself, with the team open');

// ---------- the way a reviewer would look: Profile, then the gear
if (await J.view() !== 'home') { await J.click('#tabs [data-tab="home"]'); await J.run(500); }
await J.click('#tabs [data-tab="profile"]'); await J.run(1000);
await J.click('#prGear'); await J.run(400);
eq([await J.view(), await J.visible('#optAccount'), /jake@example\.com/.test(await J.text('#optSignedAs')), await J.visible('#oDelete')], ['options', true, true, true],
  'Profile, then the gear: Settings has Your account, who you\'re signed in as, and Delete my account');
check(/Deletes your account for good/.test(await J.text('#optAccount')), 'and says what deleting it does');
await shot(J, 'account-settings');
await J.click('#oDelete'); await J.run(200);
eq([await J.text('#oDelete'), w.db().users.length], ['Tap again to delete it for good', 2], 'one tap asks you to be sure, and deletes nothing yet');
await J.run(3500);
eq(await J.text('#oDelete'), 'Delete my account', 'and if you don\'t, it goes back');
await J.click('#oDelete'); await J.click('#oDelete'); await J.run(1500);
db = w.db();
eq([db.users.some((u) => u.id === jakeId), (db.profiles || []).some((p) => p.user_id === jakeId), (db.follows || []).some((f) => f.follower === jakeId || f.followee === jakeId)], [false, false, false],
  'two taps delete the account: his sign-in, profile and follows are gone');
eq([db.teams.length, db.players.find((p) => p.team_id === team.id && p.pid === 2).user_id], [1, null], 'the team carries on, with his player unclaimed (its stats stay with the team)');
eq([await J.view(), await J.text('#aMsg'), await J.visible('#aSignIn'), await teamsOnPhone(J)], ['account', 'Your account has been deleted.', true, 0],
  'his phone says so, is signed out and keeps nothing of the account');
await shot(J, 'account-deleted');

// ---------- a gaffer from Team settings; the team he runs on his own goes with him
await A.page.reload(); await A.run(2000); if (await A.view() !== 'home') { await A.click('#tabs [data-tab="home"]'); await A.run(500); }
await A.click('#mOptions'); await A.run(400);
eq([await A.visible('#optAccount'), /ethan@example\.com/.test(await A.text('#optSignedAs')), await A.visible('#oDelete')], [true, true, true], 'Team settings has it too');
await A.click('#oDelete'); await A.click('#oDelete'); await A.run(1500);
db = w.db();
eq([db.users.length, db.teams.length, db.players.length], [0, 0, 0], 'his account goes, and the team he ran on his own with it');
eq([await A.view(), await A.text('#aMsg'), await teamsOnPhone(A)], ['account', 'Your account has been deleted.', 0], 'and his phone says so');

// ---------- signed in with no team open: the gear on your profile goes straight to the Account page, which has it
const S = await w.phone({ db: true, label: 'sam' });
await S.click('#acctNew'); await S.page.fill('#aEmail', 'sam@example.com'); await S.page.fill('#aPass', 'longpassword'); await S.page.fill('#aUser', 'samwise'); await S.check('#aTerms'); await S.click('#aSignUp'); await S.run(300); await S.click('#aSignIn'); await S.run(1500);
if (await S.visible('#unamePop')) { await S.page.evaluate(() => { const b = document.querySelector('#unamePop [data-un="later"]') || document.querySelector('#unamePop .link'); if (b) b.click(); }); await S.run(300); }
eq([await S.view(), await S.visible('#acctBtn')], ['welcome', true], 'signed in with no team: the welcome screen has the Account card');
await S.click('#acctBtn'); await S.run(300);
eq([await S.view(), await S.visible('#aDelete')], ['account', true], 'which has Delete my account');
await S.click('#v-account .back'); await S.run(300); await S.click('#pplBtn'); await S.run(800);
await S.click('#tabs [data-tab="profile"]'); await S.run(800); await S.click('#prGear'); await S.run(400);
eq([await S.view(), await S.visible('#aDelete')], ['account', true], 'and so does the gear on your profile (through Your feed)');

await w.close();
await done(A, J, S);
