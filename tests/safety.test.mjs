// Looking after what people share (Apple's guideline 1.2) and asking before anything goes to Google's AI (5.1.2).
// Making an account needs the Terms of use agreed (zero tolerance for abuse); a word filter keeps slurs, hate, sexual
// words and threats out everywhere, and the strongest swearing out of anything public (the squad's chat can still swear
// about the football), without blocking real names and places; anyone can be blocked from the chat; every report tells
// Gaffer straight away; and the AI commentary can be switched off again in Settings.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: terms, the word filter, blocking and reports');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const told = (what) => (w.db().calls || []).filter((c) => c.name === 'team-notify' && c.body.kind === 'report' && c.body.what === what).length;
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });

// ---------- making an account needs the Terms of use agreed
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn');
await A.page.fill('#aEmail', 'ethan@example.com'); await A.page.fill('#aPass', 'longpassword'); await A.page.fill('#aUser', 'gaffer_ethan');
await A.click('#aSignUp'); await A.run(300);
eq([await A.text('#aMsg'), (w.db().users || []).length], ['Tick the box to agree to the Terms of use first.', 0], 'an account can\'t be made without agreeing to the Terms of use');
check(/terms\.html$/.test(await A.page.getAttribute('#aOut [data-site="terms.html"]', 'href')), 'which are linked right next to the box');
await shot(A, 'terms-signup');
await A.check('#aTerms'); await A.click('#aSignUp'); await A.run(300);
eq((w.db().users[0].meta || {}).terms, 1, 'ticked: the account is made, with the agreement kept on it');
await A.click('#aSignIn'); await A.run(800);
eq(await A.visible('#termsPop'), false, 'so it isn\'t asked again when signing in');

// ---------- the word filter
const rude = (t, strict) => A.page.evaluate(([x, s]) => window.gafferRude(x, s), [t, !!strict]);
const blocked = async (list, strict) => { const r = []; for (const t of list) if (!(await rude(t, strict))) r.push(t); return r; };
const passed = async (list, strict) => { const r = []; for (const t of list) if (await rude(t, strict)) r.push(t); return r; };
eq(await blocked(['you n1gger', 'F A G G O T', 'what a faggggot', 'kill yourself mate', 'kys', 'paki', 'retarded', 'nonce rapist', 'send nudes porn'], false), [], 'slurs, hate, sexual words and threats are stopped everywhere, chat included, through l33t, spacing and stretched letters');
eq(await passed(['Fucking hell what a goal', 'shit pass', 'bollocks', 'what a twat that ref is'], false), [], 'the squad\'s chat can still swear about the football');
eq(await blocked(['fuck_the_ref', 'Cunts United', 'Wankers FC', 'motherfucker', 'fuuuuck'], true), [], 'but the strongest swearing stays out of anything public');
eq(await passed(['Scunthorpe', 'Cockney Rebels', 'Hancock', 'Nazir Ahmed', 'Greg Dyke', 'therapist', 'grape juice', 'Pakistan Utd', 'Dickens', 'Spicy Boys', 'Penistone Church', 'Middlesex'], true), [], 'without stopping real names and places that happen to have letters in common');

// usernames, captions, team names and player names
await A.page.fill('#tName', 'Fuck Off FC'); await A.click('#tCreate'); await A.run(300);
check(/word Gaffer doesn’t allow/.test(await A.text('#v-create')), 'a team name with a word that isn\'t allowed is refused');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nNazir\nPaki Pete\nEthan'); await A.click('#tCreate'); await A.run(300);
check(/player names has a word/.test(await A.text('#v-create')), 'so is a player name with one in');
await A.page.fill('#tPlayers', 'Spice\nJake\nNazir\nHarrison\nEthan'); await A.click('#tCreate'); await A.run(600);
eq(w.db().teams.map((t) => t.name), ['Sons of Pitches FC'], 'and with them changed it\'s made (Nazir is fine)');
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]'); await A.run(300);
await A.click('#mOptions'); await A.run(300);
await A.page.fill('#oName', 'Sons of Cunts'); await A.page.dispatchEvent('#oName', 'input'); await A.run(300);
eq([await A.visible('#oMsg'), (await A.team()).name], [true, 'Sons of Pitches FC'], 'renaming it in Settings to something that isn\'t allowed isn\'t saved, and says so');
await A.page.fill('#oName', 'Sons of Pitches FC'); await A.page.dispatchEvent('#oName', 'input'); await A.run(300);
eq(await A.visible('#oMsg'), false, 'put back, the message goes');

// ---------- Settings: AI commentary can be allowed or stopped there
eq([await A.visible('#optAI'), /Not allowed on this phone: nothing is sent to Google/.test(await A.text('#optAINote')), await A.text('#optAIBtn')], [true, true, 'Allow it'], 'Settings says whether AI commentary may be sent to Google (nothing is, to start with)');
await A.click('#optAIBtn'); await A.run(200);
eq([/Allowed on this phone/.test(await A.text('#optAINote')), await A.text('#optAIBtn'), await A.page.evaluate(() => localStorage.getItem('apt-ai'))], [true, 'Stop sending to Google', 'yes'], 'it can be allowed there');
await shot(A, 'ai-settings');
await A.click('#optAIBtn'); await A.run(200);
eq([await A.text('#optAIBtn'), await A.page.evaluate(() => localStorage.getItem('apt-ai'))], ['Allow it', null], 'and stopped again: consent can be withdrawn as easily as it was given');
await home(A); await A.run(300);

// ---------- Jake joins as himself: the join form needs the terms too, and his username is checked
const J = await w.phone({ db: true, label: 'jake' });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.click('#meCard [data-me="pick"]'); await J.run(300);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'fuck_u_ref'); await J.page.fill('#jPass', 'longpassword'); await J.click('#joinList [data-do="up"]'); await J.run(500);
eq(await J.text('#jMsg'), 'That username has a word Gaffer doesn’t allow. Pick another.', 'a username with a word that isn\'t allowed is refused');
await J.page.fill('#jUser', 'jake_s'); await J.click('#joinList [data-do="up"]'); await J.run(500);
eq([await J.text('#jMsg'), (w.db().users || []).length], ['Tick the box to agree to the Terms of use first.', 1], 'joining as yourself needs the Terms of use agreed too');
await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
const db = w.db(), jakeId = db.users.find((u) => u.email === 'jake@example.com').id;
eq([(db.users.find((u) => u.id === jakeId).meta || {}).terms, db.players.find((p) => p.pid === 2).user_id], [1, jakeId], 'ticked: he\'s in, with the agreement kept on his account');

// ---------- chat: the filter, and blocking someone from their message
if (await J.view() !== 'home') { await J.click('#tabs [data-tab="home"]'); await J.run(300); }
await J.click('#tabs [data-tab="chat"]'); await J.run(600);
await J.page.fill('#chatText', 'shut up you f4gg0t'); await J.page.press('#chatText', 'Enter'); await J.run(600);
eq([(w.db().messages || []).length, await J.page.inputValue('#chatText'), /wasn’t sent/.test(await J.text('#chatBody'))], [0, 'shut up you f4gg0t', true], 'a chat message with a slur isn\'t sent, and says why (the words stay to change)');
await J.page.fill('#chatText', 'Fucking hell, what a goal'); await J.page.press('#chatText', 'Enter'); await J.run(800);
eq((w.db().messages || []).map((m) => m.body), ['Fucking hell, what a goal'], 'swearing about the football goes through');
await home(A); await A.run(300); await A.click('#tabs [data-tab="chat"]'); await A.run(1200);
await A.click('.cmsg:not(.mine) .bubble'); await A.run(200);
check((await A.page.$$eval('.cmsg .cacts button', (b) => b.map((x) => x.textContent))).includes('Block Jake'), 'tapping someone\'s message offers Block (and Report)');
await A.click('[data-chrep]'); await A.run(600);
eq([await A.text('#chatBody .msg'), told('chat')], ['Reported. Thanks, Gaffer will look at it within 24 hours.', 1], 'reporting a message tells Gaffer straight away');
await A.click('.cmsg:not(.mine) .bubble'); await A.click('[data-chmute]'); await A.run(800);
eq([await A.page.$$eval('.cmsg', (x) => x.length), (w.db().blocks || []).some((b) => b.blocked === jakeId)], [0, true], 'Block Jake: his messages go, and with a profile he\'s blocked everywhere (posts and profile too)');
check(/Blocked Jake/.test(await A.text('#chatBody')), 'and it says so');
await shot(A, 'chat-block');
await A.click('[data-chunmute]'); await A.run(800);
eq([await A.page.$$eval('.cmsg', (x) => x.length), (w.db().blocks || []).some((b) => b.blocked === jakeId)], [1, false], 'Unblock brings him back');

// ---------- a post's caption, and reporting a post and a profile
db.clips = db.clips || []; const team = w.db().teams[0], game = { id: 'g-1' };
const d2 = w.db(); d2.games = d2.games || []; d2.games.push({ id: 'g-1', team_id: team.id, opp: 'Dog Squad', us: 1, them: 0, played_at: Date.now() - 86400000 });
d2.clips.push({ team_id: team.id, game_id: 'g-1', seq: 0, path: team.id + '/dog/01.mp4', store: 'r2', at: 1791660000000, dur: 14, pids: [2], label: '2\' Goal: Jake' }); w.setDb(d2);
await J.click('#tabs [data-tab="feed"]'); await J.run(1000); await J.click('#fdNew'); await J.run(1200);
await J.page.click('#npList [data-np]').catch(() => {}); await J.run(200);
await J.page.fill('#npCap', 'Top bins, suck my cock'); await J.click('#npPost'); await J.run(600);
eq([await J.text('#npMsg'), (w.db().posts || []).length], ['Your caption has a word Gaffer doesn’t allow. Please change it.', 0], 'a caption with a word that isn\'t allowed isn\'t posted');
await J.page.fill('#npCap', 'Top bins'); await J.click('#npPost'); await J.run(1500);
eq((w.db().posts || []).map((p) => p.caption), ['Top bins'], 'changed, it is');
// (blocking ended following both ways, and unblocking doesn't start it again: Ethan reports Jake's profile, then follows him)
await A.click('#tabs [data-tab="feed"]'); await A.run(800); await A.click('#fdFind'); await A.run(500);
await A.page.fill('#pplQ', 'jake_s'); await A.click('#pplGo'); await A.run(600);
await A.click('#pplBody [data-fol="jake_s"]'); await A.run(600);
await A.click('#pplFound .prow .who'); await A.run(1000);
await A.click('#prMore'); await A.click('#prBody [data-pr="report"]'); await A.page.click('#prBody [data-why]'); await A.run(800);
eq(told('profile'), 1, 'reporting a profile tells Gaffer straight away');
await A.page.reload(); await A.run(1500); await A.click('#tabs [data-tab="feed"]'); await A.run(1500);
await A.click('#fdBody .post [data-pmore]'); await A.run(200);
await A.page.click('#fdBody [data-why]'); await A.run(800);
eq(told('post'), 1, 'reporting a post tells Gaffer straight away');

await w.close();
await done(A, J);
