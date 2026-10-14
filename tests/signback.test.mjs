// Signing back in (Ethan: "signing back in it prompted me to make a team but I already had one. This shouldn't come up
// straight away"). Signing out leaves no teams on the phone, so straight after signing in the welcome screen used to
// show "Join your team" and "Start a team" while the account's teams were still on their way, and then listed them
// underneath. Now it says it's getting them, and they come first.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: signing back in');
const w = await world();

const A = await w.phone({ db: true, label: 'ethan' });
// The account's teams can be held back on their way from the server, to see the screen in the meantime
await A.page.addInitScript(() => {
  let real;
  window.__holdTeams = false; window.__teamsWaiting = [];
  Object.defineProperty(window, 'supabase', { configurable: true, get: () => real, set: (v) => {
    const make = v.createClient;
    real = Object.assign({}, v, { createClient: (...a) => {
      const c = make(...a), rpc = c.rpc.bind(c);
      c.rpc = (name, args) => name === 'my_teams' && window.__holdTeams ? new Promise((ok) => window.__teamsWaiting.push(() => ok(rpc(name, args)))) : rpc(name, args);
      return c;
    } });
  } });
});
await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);
eq(await A.view(), 'home', 'Ethan has his team');

// ---------- sign out (Settings → Your account), then back in
await A.click('#mOptions'); await A.run(300); await A.click('#optSignOut'); await A.click('#optSignOut'); await A.run(1500); // (two taps)
const teamsOnPhone = () => A.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).teams.length);
eq([await A.view(), await teamsOnPhone()], ['welcome', 0], 'signed out: the welcome screen, and no teams left on the phone');
eq(await A.text('#wLead'), 'Join your team', 'signed out, it asks you to join a team');

await A.page.evaluate(() => { window.__holdTeams = true; });
await A.click('#acctBtn'); await A.run(300);
await A.page.fill('#aEmail', 'ethan@example.com'); await A.page.fill('#aPass', 'longpassword'); await A.click('#aSignIn'); await A.run(1500);
eq(await A.view(), 'welcome', 'signed back in, he\'s on the welcome screen');
eq([await A.text('#wLead'), await A.visible('#wLoad'), await A.visible('#wJoin'), await A.visible('#wStart')], ['Welcome back', true, false, false],
  'while his teams are on their way it says it\'s getting them, and doesn\'t ask him to join or make a team');

await A.page.evaluate(() => { window.__holdTeams = false; window.__teamsWaiting.splice(0).forEach((go) => go()); }); await A.run(800);
eq([await A.text('#wLead'), await A.visible('#wLoad'), await A.page.$$eval('#myTeams button[data-team]', (b) => b.length)], ['Your teams', false, 1], 'then his team is there');
check(/Sons of Pitches FC/.test(await A.text('#myTeams')) && await A.page.evaluate(() => {
  const t = document.getElementById('myTeamsSec').getBoundingClientRect(), j = document.getElementById('wJoin').getBoundingClientRect(), s = document.getElementById('wStart').getBoundingClientRect();
  return t.top < j.top && t.top < s.top;
}), 'first on the screen, above joining or starting another team');
await A.click('#myTeams button[data-team]'); await A.run(800);
eq([await A.view(), await A.text('#heroName')], ['home', 'Sons of Pitches FC'], 'one tap opens it, as the gaffer');

// ---------- an account with no team yet still gets the choices once it's checked
const N = await w.phone({ db: true, label: 'new' });
await N.click('#acctNew'); await N.page.fill('#aEmail', 'new@example.com'); await N.page.fill('#aPass', 'longpassword'); await N.page.fill('#aUser', 'newbie'); await N.check('#aTerms'); await N.click('#aSignUp'); await N.run(300); await N.click('#aSignIn'); await N.run(1500);
if (await N.visible('#unamePop')) { await N.page.evaluate(() => { const b = document.querySelector('#unamePop .link'); if (b) b.click(); }); await N.run(300); }
eq([await N.view(), await N.text('#wLead'), await N.visible('#wLoad'), await N.visible('#wJoin'), await N.visible('#wStart')], ['welcome', 'Join your team', false, true, true],
  'with no teams on the account, it asks them to join or start one');

await w.close();
await done(A, N);
