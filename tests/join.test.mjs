// Asking to join a team when your name isn't in its squad: the request, the gaffer's card with Let in / Turn down,
// and what each side sees afterwards.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: asking to join');
const w = await world();
const calls = (kind) => (w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === kind).length;

// ---------- a gaffer with a team of six
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
check(!(await A.visible('#askCard')), 'with nobody asking, the gaffer sees no requests card');

// ---------- someone whose name isn't in the squad
const W = await w.phone({ db: true, label: 'Woody' });
await W.page.fill('#joinCode', code); await W.click('#joinBtn'); await W.run(500);
eq([await W.view(), await W.visible('#joinList [data-ask]')], ['join', true], 'the list of players ends with "My name isn\'t here"');
await W.click('#joinList [data-ask]');
check(await W.visible('#jFirst') && await W.visible('#jEmail'), 'which opens the usual details, plus a first name and an account');
await W.click('#joinList [data-do="up"]'); eq(await W.text('#jMsg'), 'Enter your first name.', 'a first name is needed');
await W.page.fill('#jFirst', '  Woody '); await W.click('#joinList [data-do="up"]'); eq(await W.text('#jMsg'), 'Pick where you play.', 'and a position');
await W.page.fill('#jLast', 'Wood'); await W.page.fill('#jNum', '14'); await W.click('#joinList [data-pos="def"]');
await W.click('#joinList [data-mode="in"]'); eq([await W.page.inputValue('#jFirst'), await W.page.inputValue('#jNum')], ['  Woody ', '14'], 'switching between new account and existing account keeps what was typed');
await W.click('#joinList [data-mode="up"]'); await W.click('#joinList [data-pos="def"]');
await W.page.fill('#jEmail', 'woody@example.com'); await W.page.fill('#jPass', 'longpassword'); await W.click('#joinList [data-do="up"]'); await W.run(800);
eq([await W.view(), await W.visible('#pendCard'), await W.text('#pendTitle'), w.db().join_requests.length], ['home', true, 'Confirm your email to ask to join', 0], 'account made: they follow the team, and the request waits for the email to be confirmed');
await W.click('#pendCard [data-go="account"]'); await W.page.fill('#aEmail', 'woody@example.com'); await W.page.fill('#aPass', 'longpassword'); await W.click('#aSignIn'); await W.run(1500);
let reqs = w.db().join_requests;
eq([reqs.length, reqs[0].name, reqs[0].last_name, reqs[0].position, reqs[0].shirt_number, reqs[0].status], [1, 'Woody', 'Wood', 'def', 14, 'pending'], 'signed in: the request goes to the team with their details');
eq([await W.view(), /asked to join/.test(await W.text('#meCard')), await W.visible('#pendCard'), calls('join')], ['home', true, false, 1], 'they see it is waiting, and the gaffers are sent one notification');
eq(await W.page.evaluate(() => document.body.className.includes('ro')), true, 'meanwhile they are a follower, nothing more');

// ---------- the gaffer answers
await w.run(1500);
eq([await A.visible('#askCard'), /Someone wants to join/.test(await A.text('#askCard')), /Woody Wood/.test(await A.text('#askCard')), /Defender, number 14/i.test(await A.text('#askCard'))], [true, true, true, true], 'the gaffer\'s home screen shows who is asking, with no need for the notification');
await A.page.reload(); await A.run(1500);
check(await A.visible('#askCard [data-askyes]'), 'it is still there after the app is closed and reopened');
// the gaffer is adding a player by hand at the same moment
await A.click('#askCard [data-askyes]'); await w.run(2500);
let d = w.db(), wp = d.players.find((p) => p.name === 'Woody');
eq([d.players.length, !!wp && wp.pid, wp && wp.position, wp && wp.shirt_number, wp && wp.last_name, !!(wp && wp.user_id), d.join_requests[0].status], [7, 7, 'def', 14, 'Wood', true, 'approved'], 'Let in: Woody is the seventh player, with position, number and account already attached');
eq([await A.visible('#askCard [data-askyes]'), /Woody is in the squad/.test(await A.text('#askCard')), (await A.team()).players.length, /Woody/.test(await A.text('#squadList'))], [false, true, 7, true], 'the gaffer\'s card clears and the squad list has them');
eq([/Your stats/.test(await W.text('#meCard')), /Woody Wood, defender/i.test(await W.text('#meCard')), (await W.team()).players.length], [true, true, 7], 'Woody\'s phone turns into a player\'s, with their own card, without them doing anything');
// the gaffer's phone keeps the new player when it next saves, and numbers its own next player after them
await A.click('#tabs [data-tab="options"]');
check(await A.visible('#v-options'), 'gaffer opens settings');
await w.run(500);
const t2 = await A.team(); eq([t2.nextId, t2.players.some((p) => p.id === 7 && p.name === 'Woody')], [8, true], 'the gaffer\'s phone has Woody as player 7 and will number its next player 8');

// ---------- someone the gaffer turns down
const X = await w.phone({ db: true, label: 'stranger' });
await X.page.fill('#joinCode', code); await X.click('#joinBtn'); await X.run(500);
await X.click('#joinList [data-ask]'); await X.page.fill('#jFirst', 'Ringer'); await X.click('#joinList [data-pos="fwd"]');
await X.click('#joinList [data-mode="in"]'); await X.page.fill('#jFirst', 'Ringer'); await X.click('#joinList [data-pos="fwd"]');
await X.page.evaluate(async () => { const sb = window.supabase.createClient(); await sb.auth.signUp({ email: 'ringer@example.com', password: 'longpassword' }); }); // (an account made earlier)
await X.page.fill('#jEmail', 'ringer@example.com'); await X.page.fill('#jPass', 'longpassword'); await X.click('#joinList [data-do="in"]'); await w.run(2500);
eq([await X.view(), /asked to join/.test(await X.text('#meCard')), w.db().join_requests.filter((r) => r.status === 'pending').length, calls('join')], ['home', true, 1, 2], 'someone with an account already signs in and asks in one go');
await A.click('#tabs [data-tab="home"]'); await w.run(1500);
check(/Ringer/.test(await A.text('#askCard')), 'the gaffer sees the new request arrive while the app is open');
await A.click('#askCard [data-askno]'); await w.run(2500);
eq([w.db().players.length, w.db().join_requests.find((r) => r.name === 'Ringer').status, /turned down/.test(await A.text('#askCard')), await A.visible('#askCard [data-askno]')], [7, 'denied', true, false], 'Turn down: nobody is added');
eq([/turned down your request/.test(await X.text('#meCard')), await X.visible('#meCard [data-me="pick"]')], [true, true], 'and they are told, with the way to pick a name if the gaffer adds them');
await X.click('#meCard [data-me="pick"]'); await X.run(500); await X.click('#joinList [data-ask]'); await X.page.fill('#jFirst', 'Ringer'); await X.click('#joinList [data-pos="fwd"]'); await X.click('#joinList [data-do="claim"]'); await w.run(2000);
eq([w.db().join_requests.filter((r) => r.status === 'pending').length, /turned down a request/.test(await X.text('#meCard')), calls('join')], [0, true, 2], 'asking again straight away is refused, and the gaffers are not notified again');

// ---------- a second gaffer answering the same request, and a player's view
await w.run(7000);
check(!(await A.visible('#askCard')), 'with nothing waiting the gaffer\'s card goes away');
eq([await W.visible('#askCard'), await X.visible('#askCard')], [false, false], 'players and followers never see the requests card');

await w.close();
await done(A, W, X);
