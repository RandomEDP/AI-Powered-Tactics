// Friendly games (Ethan: "Just me" reworked into a game outside the team). Started from Home, not from a team: pick people
// from one of your teams, anyone else on Gaffer, and guests who aren't on it yet; play it on the phone (and the watch) as
// two sides; it counts in each player's own stats on their profile and never in a team's record; afterwards everyone is
// sent a personal link, and a guest who opens theirs and makes an account gets the game on their new profile.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: friendly games');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/friendly.test.mjs <dir> to look at it
const rpc = (P, name, args) => P.page.evaluate(async ([n, a]) => (await window.supabase.createClient().rpc(n, a)).data, [name, args]);
const notes = () => (w.db().calls || []).filter((c) => c.body && ['kickoff', 'goal'].includes(c.body.kind)).length;
const rows = (P) => P.page.$$eval('#frList .lrow', (rs) => rs.map((r) => r.querySelector('.who').firstChild.textContent.trim() + ':' + (r.querySelector('[aria-pressed="true"]') || {}).textContent));
const picks = (P) => P.page.$$eval('#picker [data-p]', (b) => b.map((x) => x.textContent.trim()).filter((x) => !/Own goal|No one/.test(x)));

// ---------- the people: Ethan runs SOP FC, Jake plays for it, Dan is on Gaffer with another team
const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.ctx.addInitScript(() => { window.__shared = []; const go = () => { if (window.Capacitor) window.Capacitor.Plugins.ReelCutter = { addListener: () => ({ remove() {} }), shareText: async (o) => { window.__shared.push(o); return { completed: true }; } }; }; go(); });
await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'ethan_fc');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nEthan'); await A.click('#tCreate'); await A.run(600);
const sop = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
const J = await w.phone({ db: true, label: 'jake' });
await J.click('#acctNew'); await J.signUp('jake@example.com', 'jake_fc');
eq(await rpc(J, 'claim_player', { p_code: sop, p_pid: 2, p_last_name: '', p_position: 'fwd' }), 'ok', '(Jake is Jake in SOP FC)');
const N = await w.phone({ db: true, label: 'dan' });
await N.click('#acctNew'); await N.signUp('dan@example.com', 'dan_dog');

// ---------- not in the team area any more
await A.click('#mNew'); await A.run(300);
eq([await A.page.$$eval('#gKind [data-kind]', (b) => b.map((x) => x.getAttribute('data-kind'))), await A.visible('#frFromSetup')], [['opp', 'house'], true], 'New game no longer has Just me; it points to friendly games instead');
await A.click('#v-setup .back'); await A.click('#tabs [data-tab="feed"]'); await A.run(500);
check(await A.visible('#fdFriendly'), 'Home has Play a friendly');
await A.click('#fdFriendly'); await A.run(300);
eq([await A.view(), await A.text('#frBack')], ['friendly', 'Home'], 'it opens the friendly screen, with Back to Home');
eq(await rows(A), ['ethan_fc (you):Bibs'], 'you\'re in to start with');

// ---------- adding people: from your team, from Gaffer, and a guest
await A.page.selectOption('#frTeam', sop); await A.run(800);
const squad = await A.page.$$eval('#frSquad .pick', (b) => b.map((x) => x.textContent.trim()));
eq(squad, ['+ Spice', '+ Jake @jake_fc', '+ Chaplin', '+ Ethan'], 'picking SOP FC lists its squad, and who\'s on Gaffer');
await A.click('#frSquad [data-frsq="1"]'); await A.click('#frSquad [data-frsq="0"]');
await A.page.fill('#frFind', 'dan'); await A.run(800);
eq(await A.page.$$eval('#frFound .pick', (b) => b.map((x) => x.textContent.trim())), ['+ dan_dog @dan_dog'], 'someone else on Gaffer is found by name');
await A.click('#frFound [data-frfd="0"]');
await A.page.fill('#frGuest', 'Dave'); await A.click('#frAddG');
eq(await rows(A), ['ethan_fc (you):Bibs', 'Jake:Shirts', 'Spice:Bibs', 'dan_dog:Shirts', 'Dave:Bibs'], 'each new player goes on the smaller side');
check((await A.text('#frList')).includes('@jake_fc, Sons of Pitches FC') && (await A.text('#frList')).includes('Guest, Sons of Pitches FC') && (await A.text('#frList')).includes('Guest · Remove'), 'it says where each one came from');
await A.click('#frList [data-frside="a"][data-i="1"]'); await A.click('#frList [data-frside="b"][data-i="2"]'); await A.click('#frList [data-frside="b"][data-i="4"]');
await A.page.fill('#frA', 'Us'); await A.page.fill('#frB', 'Them'); await A.page.fill('#frHalf', '10');
eq(await A.text('#frCount'), 'Us 2 v 3 Them.', 'two sides of any size');
await shot(A, 'friendly-setup');

// ---------- the game
await A.click('#frKick'); await A.run(800);
let m = await A.match(), t = await A.team();
eq([await A.view(), m.friendly, m.house.fr, m.house.a, m.house.b, m.half, m.periods], ['game', true, true, 'Us', 'Them', 10, 2], 'Go to kick-off starts a friendly: Us v Them, 2 × 10');
const fcode = await A.page.evaluate(() => JSON.parse(localStorage.getItem('apt-app')).active);
check(fcode !== sop && /friendlies/.test(t.name), `it's played in your own friendlies, not SOP FC (${t.name})`);
const P = Object.fromEntries(t.players.map((p) => [p.name, p.id]));
eq(Object.keys(P).sort(), ['Dave', 'Jake', 'Spice', 'dan_dog', 'ethan_fc'], 'everyone is a player there (by the name their profile or team has)');
eq([m.house.side[P.ethan_fc], m.house.side[P.Jake], m.house.side[P.Spice], m.house.side[P.dan_dog], m.house.side[P.Dave]], ['a', 'a', 'b', 'b', 'b'], 'on the sides they were put on');
check(/\(friendly\)/.test(await A.text('#gameTitle')), 'the game says it\'s a friendly');
const ws = await A.watch();
eq([ws.live, ws.players.map((p) => p.name).sort()], [true, ['Jake', 'ethan_fc']], 'the watch gets the game, with our side to pick scorers from');
await A.click('#go'); await A.run(60000);
await A.click('#goalUs'); await A.run(300);
eq((await picks(A)).sort(), ['Jake', 'ethan_fc'], 'a goal for Us offers only our side');
await A.click(`#picker [data-p="${P.Jake}"]`); await A.click(`#picker [data-p="${P.ethan_fc}"]`); await A.run(9000);
await A.click('#goalThem'); await A.run(300);
eq(await picks(A), ['Spice', 'dan_dog', 'Dave'], 'and one for Them only theirs');
await A.click(`#picker [data-p="${P.Dave}"]`); await A.click('#picker [data-p="x"]'); await A.run(9000);
await A.click('#goalUs'); await A.click(`#picker [data-p="${P.Jake}"]`); await A.click('#picker [data-p="x"]'); await A.run(2000);
eq([await A.text('#usN'), await A.text('#themN')], ['2', '1'], 'Us 2–1 Them');
eq(notes(), 0, 'nobody is sent a kick-off or goal notification');
check((await A.text('#finNote')).includes('each player’s own stats'), 'Finish says where it goes');
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000); await A.click('#go'); await A.run(20000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000);
await A.click('#finish'); await A.click('#finish'); await A.run(2500);
eq([await A.view(), await A.visible('#hlList .hcard.focus .frlinks')], ['highlights', true], 'finishing goes to the game\'s highlights, with Send everyone their link');
check((await A.text('#hlList .hcard.focus h3')).includes('Friendly'), 'marked as a friendly');

// ---------- what counts where
let db = w.db();
const team = (code) => db.teams.find((x) => x.code === code), g = db.games.find((x) => x.team_id === team(fcode).id);
eq([g.friendly, g.us, g.them, db.games.filter((x) => x.team_id === team(sop).id).length], [true, 2, 1, 0], 'the game is kept with your friendlies; SOP FC has no new game');
const jp = await rpc(A, 'get_profile', { p_username: 'jake_fc' });
eq([jp.stats.games, jp.stats.goals, jp.stats.wins, jp.teams.map((x) => x.name)], [1, 2, 1, ['Sons of Pitches FC']], 'it\'s in Jake\'s own stats (2 goals, a win), and your friendlies aren\'t listed as one of his teams');
const dp = await rpc(A, 'get_profile', { p_username: 'dan_dog' });
eq([dp.stats.games, dp.stats.wins], [1, 0], 'Dan has it too, on the losing side');
eq(db.follows.filter((f) => [f.follower, f.followee].includes(db.profiles.find((p) => p.username === 'dan_dog').user_id)).length, 0, 'and nobody started following anyone');

// ---------- personal links
await A.page.evaluate(() => { document.querySelector('#hlList .hcard.focus .frlinks').open = true; });
eq(await A.page.$$eval('#hlList .hcard.focus [data-frsend]', (b) => b.map((x) => x.textContent.trim())), ['JakeOn Gaffer', 'SpiceNot on Gaffer yet', 'dan_dogOn Gaffer', 'DaveNot on Gaffer yet'], 'a link for each of the others, saying who\'s on Gaffer');
await A.click(`#hlList .hcard.focus [data-frsend$=":${P.Dave}"]`); await A.run(800);
const sent = (await A.page.evaluate(() => window.__shared)).pop();
check(sent && sent.text.startsWith('Dave, here are your highlights from our friendly, Us v Them (2–1), in Gaffer.'), `Dave's message (${sent && sent.text})`);
check(sent && /\?team=[A-Z0-9]{6}&game=[0-9a-f-]{36}&me=[0-9a-f-]{36}$/.test(sent.url) && !sent.url.includes(team(fcode).organiser_code), 'with his own link (never the gaffer code)');
eq(await A.text('#frlMsg'), 'Sent to Dave.', 'and it says so');

// ---------- Dave opens his link and makes an account
const G = await w.phone({ db: true, label: 'dave' });
await G.page.goto(sent.url.replace('https://randomedp.github.io/AI-Powered-Tactics/', w.base)); await G.run(1500);
eq([await G.view(), await G.visible('#guestCard')], ['highlights', true], 'the link opens the game\'s highlights');
check((await G.text('#guestCard')).includes('Us v Them, your friendly') && (await G.text('#guestCard')).includes('Make an account or sign in, and this game goes on your profile'), 'saying the game goes on his profile once he has an account');
await shot(G, 'friendly-guest');
await G.click('#guestCard [data-guest="account"]'); await G.run(300);
await G.run(300); await G.signUp('dave@example.com', 'dave_new'); await G.run(1500);
db = w.db();
const dave = db.players.find((p) => p.team_id === team(fcode).id && p.pid === P.Dave);
check(dave && dave.user_id && dave.user_id === db.profiles.find((p) => p.username === 'dave_new').user_id, 'signing in with the link makes Dave\'s player his');
const vp = await rpc(A, 'get_profile', { p_username: 'dave_new' });
eq([vp.stats.games, vp.stats.goals], [1, 1], 'and the game and his goal are on his new profile');

// ---------- the App Clip: an iPhone on the website is offered it; getting Gaffer from it hands the link over
await A.page.evaluate(() => { const d = document.querySelector('#hlList .hcard.focus .frlinks'); if (d) d.open = true; });
await A.click(`#hlList .hcard.focus [data-frsend$=":${P.Spice}"]`); await A.run(800);
const spiceUrl = (await A.page.evaluate(() => window.__shared)).pop().url, spiceMe = spiceUrl.split('&me=')[1];
const CLIP = 'https://appclip.apple.com/id?p=com.randomedp.aipoweredtactics.Clip';
const S1 = await w.phone({ db: true, label: 'spice-safari' });
await S1.ctx.addInitScript((clip) => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1' });
  let c; Object.defineProperty(window, 'APT_CONFIG', { configurable: true, get: () => c, set: (v) => { c = Object.assign({}, v, { appClip: clip }); } });
}, CLIP);
await S1.page.goto(spiceUrl.replace('https://randomedp.github.io/AI-Powered-Tactics/', w.base)); await S1.run(1500);
const clipHref = await S1.page.getAttribute('#guestClip', 'href').catch(() => null);
check(clipHref && clipHref.startsWith(CLIP + '&team=') && clipHref.endsWith('&me=' + spiceMe) && clipHref.includes('&game='), `on an iPhone's browser the guest is offered the App Clip with their own link (${clipHref})`);
eq(await S1.text('#guestClip'), 'Get Gaffer with your highlights', 'worded for them');
const S2 = await w.phone({ db: true, label: 'spice-web' });
await S2.page.goto(spiceUrl.replace('https://randomedp.github.io/AI-Powered-Tactics/', w.base)); await S2.run(1500);
eq([await S2.visible('#guestCard'), await S2.visible('#guestClip')], [true, false], 'until the App Clip is live (config.js appClip), or on anything but an iPhone, it isn\'t offered');

const S3 = await w.phone({ db: true, native: true, label: 'spice-app' });
await S3.ctx.addInitScript((url) => {
  const put = () => { if (!window.Capacitor) return; let kept = url; window.__taken = 0; window.Capacitor.Plugins.ClipHandoff = { take: async () => { window.__taken++; const u = kept; kept = null; return u ? { url: u } : {}; } }; };
  put();
}, 'https://gaffer.invalid/?' + spiceUrl.split('?')[1]);
await S3.page.reload(); await S3.run(1500);
eq([await S3.view(), await S3.visible('#guestCard')], ['highlights', true], 'Gaffer opened for the first time after the App Clip goes straight to the game\'s highlights');
check((await S3.text('#guestCard')).includes('your friendly'), 'as their friendly');
await S3.click('#guestCard [data-guest="account"]'); await S3.run(300); await S3.signUp('spice@example.com', 'spice_fc'); await S3.run(1500);
db = w.db();
const spice = db.players.find((p) => p.team_id === team(fcode).id && p.pid === P.Spice);
check(spice && spice.user_id && spice.user_id === db.profiles.find((p) => p.username === 'spice_fc').user_id, 'and once Spice has made an account, the player is theirs');
await S3.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await S3.run(300);
check(await S3.page.evaluate(() => window.__taken >= 2), 'Gaffer looks for a handed-over link each time it comes back (an App Clip link opening the installed app)');

// ---------- your friendlies, kept apart from your teams
await A.click('#v-highlights .back'); await A.click('#tabs [data-tab="feed"]'); await A.click('#fdFriendly'); await A.run(300);
check((await A.text('#frBody')).includes('Your friendlies'), 'the friendly screen has your friendlies');
eq((await rows(A)).length, 5, 'the same people are still in for next time');
await A.click('#frList [data-frrm="4"]');
eq(await A.page.$$eval('#frPastBox .pick', (b) => b.map((x) => x.textContent.trim())), ['+ Dave'], 'and anyone taken out is a tap away under Played with before');
await A.click('#frBody [data-frteam]'); await A.run(500);
eq([await A.view(), await A.page.evaluate(() => document.documentElement.classList.contains('frteam'))], ['highlights', true], 'Your friendlies opens their highlights');
await A.click('#v-highlights .back'); await A.run(300);
eq([await A.text('#homeRecord'), await A.text('#mNew'), await A.visible('#mBoard'), await A.visible('#mOptions'), await A.visible('#tabs [data-tab="chat"]')], ['1 friendly played', 'New friendly', false, false, false], 'its page is just friendlies: no tactics board, team settings or chat');
await A.click('#mNew'); await A.run(300);
eq(await A.view(), 'friendly', 'and New friendly goes back to the friendly screen');
await A.click('#frKick'); await A.run(800);
eq([await A.view(), (await A.match() || {}).house && (await A.match()).house.b], ['game', 'Them'], 'a second friendly starts the same way');
await A.page.evaluate(() => document.getElementById('fdFriendly').click()); await A.run(300);
check(await A.visible('#frBody [data-frview="game"]'), 'the friendly screen says that one is on');
await A.click('#frKick'); await A.run(300);
eq([await A.view(), await A.text('#frMsg')], ['friendly', 'Your last friendly hasn’t finished. Go to it (Your friendly is on, below) and finish it first.'], 'and won\'t start another over the top of it');
await A.click('#frBody [data-frview="game"]'); await A.run(300);
eq(await A.view(), 'game', 'Your friendly is on goes back to it');
await A.page.evaluate(() => document.getElementById('mSwitch').click()); await A.run(500);
eq(await A.page.$$eval('#myTeams button', (b) => b.map((x) => x.firstChild.textContent)), ['Sons of Pitches FC'], 'and Your teams lists only real teams');

await w.close();
await done(A, J, N, G);
