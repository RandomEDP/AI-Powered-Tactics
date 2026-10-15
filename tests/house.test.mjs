// A game among the squad. Ethan's ask: split whoever's turned up into two sides, any size (2 v 2 up to whatever), with no
// fixed keeper; add guests from outside the squad by name; a goal for one side only offers that side's players; and at the
// end, send the guests a link that opens the game's highlights, from where they can get the app, make an account and
// join or start a team. Also the graphics a cut game of this kind gets (both sides named, scorers on either side).
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: a game among the squad, with guests');
const w = await world();

const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile } }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file }),
    shareText: async (o) => { window.__rc.push(['shareText', o]); return { completed: true }; },
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/house.test.mjs <dir> to look at it
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const sides = (P) => P.page.$$eval('#hList .lrow', (rows) => rows.map((r) => r.querySelector('.who').firstChild.textContent.trim() + ':' + (r.querySelector('[aria-pressed="true"]') || {}).textContent));
const picks = (P) => P.page.$$eval('#picker [data-p]', (b) => b.map((x) => x.getAttribute('data-p')).filter((x) => x !== 'x').map(Number).sort((a, b) => a - b));

// ---------- the gaffer sets it up
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.click('#mNew');
eq([await A.visible('#gKind'), await A.visible('#oppSetup'), await A.visible('#houseBox')], [true, true, false], 'a new game is against another team to start with, with "Among ourselves" beside it');
await A.click('#gKind [data-kind="house"]');
eq([await A.visible('#oppSetup'), await A.visible('#houseBox')], [false, true], '"Among ourselves" swaps the opponent and line-up for two sides');
eq(await sides(A), ['Spice:Bibs', 'Jake:Shirts', 'Chaplin:Bibs', 'Harrison:Shirts', 'Puxley:Bibs', 'Issac:Shirts', 'Reece:Bibs', 'Ethan:Shirts'], 'everyone starts in, split between Bibs and Shirts');
eq(await A.text('#hMsg'), 'Bibs 4 v 4 Shirts.', 'and it says how the sides stand');

// ---------- guests, and moving people about
await A.page.fill('#hGuest', 'Dave'); await A.click('#hAddB');
await A.page.fill('#hGuest', 'Tom'); await A.page.press('#hGuest', 'Enter'); await A.run(300); // (Enter adds to the first side)
check((await sides(A)).slice(-2).join() === 'Dave:Shirts,Tom:Bibs' && (await A.text('#hList')).includes('Guest'), 'guests are added by name to either side, marked as guests');
await A.click('#hList [data-hside="out"][data-id="8"]');
eq(await A.text('#hMsg'), 'Bibs 5 v 4 Shirts.', 'someone not playing is set to Out');
for (const id of [2, 4, 6]) await A.click(`#hList [data-hside="out"][data-id="${id}"]`);
eq([await A.text('#hMsg'), await A.page.isDisabled('#hKick')], ['Each side needs at least 2 players (5 v 1 so far).', true], 'each side needs at least two');
for (const id of [2, 4, 6]) await A.click(`#hList [data-hside="b"][data-id="${id}"]`);
await A.page.fill('#hA', 'Bibs'); await A.page.fill('#hB', 'Non-bibs'); await A.run(300);
eq([await A.text('#hMsg'), await A.text('#hAddB')], ['Bibs 5 v 4 Non-bibs.', 'Add to Non-bibs'], 'the sides can be renamed');
await A.page.fill('#hB', 'Shirts'); await A.run(300);
await A.click('#hShuffle');
const shuffled = await sides(A), count = (s) => shuffled.filter((x) => x.endsWith(':' + s)).length;
eq([count('Bibs'), count('Shirts'), count('Out')], [5, 4, 1], 'Shuffle deals everyone playing into two even sides at random');
// put them back as they were, for the rest of the test
for (const [id, s] of [[1, 'a'], [3, 'a'], [5, 'a'], [7, 'a'], [2, 'b'], [4, 'b'], [6, 'b']]) await A.click(`#hList [data-hside="${s}"][data-id="${id}"]`);
await A.click('#hList [data-hside="b"][data-guest][data-id="1001"]'); await A.click('#hList [data-hside="a"][data-guest][data-id="1002"]');
await shot(A, 'house-setup');
eq(await A.text('#hMsg'), 'Bibs 5 v 4 Shirts.', 'back to Bibs: Spice, Chaplin, Puxley, Reece and Tom; Shirts: Jake, Harrison, Issac and Dave');

// ---------- the game
await A.click('#hKick');
eq([await A.view(), await A.text('#gameTitle'), await A.text('#usLbl'), await A.text('#themLbl'), await A.text('#goalUs'), await A.text('#goalThem')],
  ['game', 'Bibs v Shirts', 'Bibs', 'Shirts', 'Goal for Bibs', 'Goal for Shirts'], 'the game screen is Bibs v Shirts, with a goal button for each side');
eq([await A.visible('#svBtn'), await A.visible('#swapCard'), await A.visible('#rotaSec'), await A.text('#pitchTag'), await A.text('#benchTag')], [false, false, false, 'Bibs', 'Shirts'],
  'no keeper save and no subs: just the two sides');
const chipsOf = (sel) => A.page.$$eval(sel + ' .chip', (c) => c.map((x) => x.textContent).join(' '));
eq([await chipsOf('#pitchNow'), await chipsOf('#benchNow')], ['Spice Chaplin Puxley Reece Tom', 'Jake Harrison Issac Dave'], 'who is on which side');
const wst = await A.watch();
eq([wst.team, wst.opp, wst.players.map((p) => p.id).sort((a, b) => a - b), wst.changes, wst.due], ['Bibs', 'Shirts', [1, 3, 5, 7, 1002], [], false],
  'the watch shows Bibs v Shirts, offers Bibs\' players for a Bibs goal, and has no subs to buzz for');
await A.click('#go'); await A.run(60000);

await A.click('#goalUs');
eq(await picks(A), [1, 3, 5, 7, 1002], 'a goal for Bibs offers only Bibs\' players, guest included');
check((await A.text('#picker strong')) === 'Who scored for Bibs?', 'and asks who scored for Bibs');
await A.click('#picker [data-p="1002"]');
eq(await picks(A), [1, 3, 5, 7], 'the pass: the rest of Bibs');
await A.click('#picker [data-p="3"]'); await A.run(20000);
await A.click('#goalThem');
eq(await picks(A), [2, 4, 6, 1001], 'a goal for Shirts offers only Shirts\' players (Ethan is out)');
await A.click('#picker [data-p="1001"]'); await A.click('#picker [data-p="x"]'); await A.run(20000);
eq([await A.text('#usN'), await A.text('#themN')], ['1', '1'], '1–1');
await shot(A, 'house-game');
const evs = await A.text('#events');
check(evs.includes('Dave for Shirts') && evs.includes('Tom for Bibs (set up by Chaplin)'), `the events name the scorers and their sides (${evs})`);

// ---------- a teammate's phone logs a goal for Shirts
const F = await w.phone({ db: true, native: true, label: 'teammate' });
await F.ctx.addInitScript(cutter); await F.page.reload(); await F.run(500);
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
eq(await F.text('#mResumeSub'), 'Bibs v Shirts, 1–1', 'a teammate sees the game on now: Bibs v Shirts');
await F.click('#mResume');
await F.click('#goalThem');
eq(await picks(F), [2, 4, 6, 1001], 'their phone offers Shirts\' players for a Shirts goal too');
await F.click('#picker [data-p="2"]'); await F.click('#picker [data-p="x"]'); await w.run(6000);
eq([await A.text('#themN'), (await A.match()).events.filter((e) => !e.hl).map((e) => [e.us, e.p, e.a ?? null])], ['2', [[true, 1002, 3], [false, 1001, null], [false, 2, null]]],
  'the gaffer\'s phone takes Jake\'s goal for Shirts, scorer and all');

// ---------- full time
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000); await A.click('#go'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(1000);
await A.click('#finish'); await A.click('#finish'); await A.run(2500);
eq([await A.view(), await A.visible('#hlList .hcard.focus [data-guests]')], ['highlights', true], 'with guests, finishing goes to the game\'s highlights, with a button to send the guests a link');
await A.click('#hlList [data-guests]'); await A.run(500);
const sent = (await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'shareText'))).pop()[1];
const db = w.db(), g = db.games[0];
check(sent.text.startsWith('Thanks for playing, Dave and Tom! Watch the highlights from Bibs v Shirts with Sons of Pitches FC in Gaffer.'), `the message thanks the guests by name (${sent.text})`);
eq(sent.url, 'https://randomedp.github.io/AI-Powered-Tactics/?team=' + code + '&game=' + g.id, 'and links to this game on the team\'s page (the team code anyone can follow with, never the gaffer code)');

// ---------- what's kept
eq([g.friendly, g.house && g.house.a, g.house && g.house.b, g.house && g.house.guests], [true, 'Bibs', 'Shirts', [{ id: 1001, name: 'Dave' }, { id: 1002, name: 'Tom' }]], 'the database keeps the sides and the guests with the game');
eq(db.game_events.filter((e) => e.game_id === g.id && e.kind !== 'highlight').map((e) => [e.kind, e.pid, e.assist]), [['goal', 1002, 3], ['against', 1001, null], ['against', 2, null]], 'and the scorers on both sides');
const gp = Object.fromEntries(db.game_players.filter((x) => x.game_id === g.id).map((x) => [x.pid, x]));
eq([Object.keys(gp).map(Number).sort((a, b) => a - b), gp[2].goals, gp[3].assists, [gp[3].scored_on, gp[3].conceded], [gp[2].scored_on, gp[2].conceded]], [[1, 2, 3, 4, 5, 6, 7], 1, 1, [1, 2], [2, 1]],
  'squad players get their goals, assists, and goals for and against by side; guests aren\'t squad players');
await home(A); await A.run(300); await A.click('#mStats'); await A.run(300);
check((await A.text('#v-stats')).includes('Bibs v Shirts') && (await A.text('#v-stats')).includes('Among ourselves'), 'the results list shows it as Bibs v Shirts, among ourselves');
check(!/[WDL]\b.*Bibs v Shirts/.test(await A.text('#results')), 'with no win, draw or loss for the team');

// ---------- the teammate's phone, from the database: guests' names and all
await home(F); await F.run(300); await F.click('#mHighlights'); await F.run(500);
const card = await F.text('#hlList .hcard');
check(card.startsWith('Bibs 1–2 Shirts') && card.includes('Among ourselves'), `the teammate's Highlights has it as Bibs 1–2 Shirts (${card.slice(0, 60)})`);
check(card.includes('Goal: Tom, set up by Chaplin for Bibs (1–0)') && card.includes('Goal: Dave for Shirts (1–1)') && card.includes('Goal: Jake for Shirts (1–2)'), 'each moment with its scorer and side, guests by name');

// ---------- a guest opens the link, on the web
const G = await w.phone({ db: true, label: 'guest' });
await G.page.goto(sent.url.replace('https://randomedp.github.io/AI-Powered-Tactics/', w.base)); await G.run(1500);
eq([await G.view(), await G.visible('#guestCard'), await G.page.evaluate(() => location.search)], ['highlights', true, ''], 'the link opens straight on the highlights, with a welcome (and tidies the address)');
await shot(G, 'house-guest');
check((await G.text('#guestCard')).includes('These are the highlights from Bibs v Shirts with Sons of Pitches FC.'), 'it says which game they\'re looking at');
check((await G.text('#guestCard')).includes('search for “Gaffer Small-Sided Football” on the App Store'), 'and how to get the app');
eq(await G.page.$eval('#hlList .hcard.focus h3', (h) => h.textContent), 'Bibs 1–2 ShirtsAmong ourselves', 'their game is picked out');
await G.click('#guestCard [data-guest="welcome"]');
eq(await G.view(), 'welcome', 'Join or start a team goes to where team codes go, and teams are started');
await G.page.reload(); await G.run(800);
eq(await G.visible('#guestCard'), false, 'the welcome is for that visit only');

// ---------- cutting it: the graphics name both sides
await A.click('#v-stats .back'); await A.run(300); await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 100, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
check((await A.text('#lkClip')).includes('BIBS') && (await A.text('#lkClip')).includes('SHIRTS'), 'the preview of the clips shows Bibs v Shirts');
await A.page.evaluate(() => { window.__r2Fail = true; }); // (and this time Cloudflare R2 refuses the uploads)
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = (await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'cut'))).pop()[1];
eq([cut.look.home, cut.look.away], ['BIBS', 'SHIRTS'], 'the score box says BIBS v SHIRTS');
eq(cut.clips.map((c) => [c.lower.title, c.lower.sub.replace(/^\d+’ · /, '')]), [['Tom', 'Set up by Chaplin · for Bibs'], ['Dave', 'for Shirts'], ['Jake', 'for Shirts']], 'each goal names its scorer and side, guests too');
eq([cut.outro.title, cut.outro.crest], ['Bibs 1–2 Shirts', null], 'the full-time card has the sides\' names (and not the team\'s crest)');
const kept = w.db().files.filter((f) => f.path.includes('bibs-v-shirts'));
eq([kept.map((f) => f.bucket), w.db().clips.map((c) => c.store || null), (w.db().clips || []).length], [['clips', 'clips', 'clips'], [null, null, null], 3], 'R2 refusing the uploads doesn\'t stop the cut: the clips go to the old storage');
check((await A.text('#cutBody')).includes('The new clip storage didn’t take them (it answered 500), so they were saved to the old storage.'), 'and the done screen says so');

await w.close();
await done(A, F, G);
