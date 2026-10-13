// Reels for everyone, and commentary that plays. Ethan's asks after the first real cut: once a game's highlights are cut,
// anyone in the team can download the game's reel; anyone can make a player's own reel from Highlights, By player (untick
// clips, preview them, goals only); the AI voice is part of the highlight maker, not an experiment; and "Commentary on"
// works on an iPhone, which won't play a second sound over a video, so a clip cut with commentary is kept twice (with it
// and without it) and the switch swaps which copy plays.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: reels and commentary');
const w = await world();

const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = []; let cb = null;
  window.Capacitor.Plugins.ReelCutter = {
    addListener: (n, f) => { cb = f; return { remove() {} }; },
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { window.__rc.push(['cut', o]);
      return { clips: o.clips.map((c) => Object.assign({ file: c.file, path: '/phone/' + c.file }, c.voice ? { voiced: { file: c.file.replace('.mp4', 'v.mp4'), path: '/phone/' + c.file.replace('.mp4', 'v.mp4') } } : {})), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i ? i * 14.04 : 0) },
        ...(o.reelCleanFile && o.clips.some((c) => c.voice) ? { reelClean: { path: '/phone/' + o.reelCleanFile, marks: o.clips.map((c, i) => i ? i * 14.04 : 0) } } : {}) }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); if (cb) { cb({ stage: 'fetch', i: 0, n: o.items.length, p: 0 }); cb({ stage: 'reel', p: 0.5 }); } return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14.04) }; },
    share: async (o) => { window.__rc.push(['share', o.path]); return {}; }, cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const calls = (P, kind) => P.page.evaluate((k) => window.__rc.filter((x) => x[0] === k).map((x) => x[1]), kind);
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/reels.test.mjs <dir> to look at it
const tail = (u) => String(u || '').replace(/^.*\//, '');

// ---------- the gaffer: a game with two goals of ours (Jake and Chaplin set each other up) and one against
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(60000); await A.click('#go'); await A.run(50000);
await A.click('#goalUs'); await A.click('#picker button[data-p="3"]'); await A.click('#picker button[data-p="2"]'); await A.run(60000);
await A.click('#goalThem'); await A.run(20000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);

// ---------- cutting it, with commentary: the voice is in the highlight maker for the gaffer, no experimental switch needed
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
check(await A.page.evaluate(() => !JSON.parse(localStorage.getItem('apt-app')).exp || !JSON.parse(localStorage.getItem('apt-app')).exp.track), 'the experimental switch is off');
await shot(A, 'cut-voice');
eq(await A.visible('#cutVoice'), true, 'the highlight maker offers AI commentary');
check(/kept with and without/.test(await A.text('#cutBody')), 'and says the clips are kept with and without it');
await A.page.check('#cutVoice'); await A.run(300);
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cut = (await calls(A, 'cut')).pop();
eq(cut.clips.map((c) => !!c.voice), [true, true, true], 'each clip is cut with a commentary line');
const rows = () => (w.db().clips || []).slice().sort((a, b) => a.seq - b.seq);
eq(rows().map((c) => [tail(c.path), tail(c.vpath)]), [['01.mp4', '01v.mp4'], ['02.mp4', '02v.mp4'], ['03.mp4', '03v.mp4']], 'each clip is kept twice: without commentary (path) and with it (vpath)');
const files = () => (w.db().files || []).filter((f) => f.bucket === 'r2').length;
eq([files(), (w.db().files || []).filter((f) => f.bucket === 'clips').length, rows().map((c) => c.store)], [8, 0, ['r2', 'r2', 'r2']], 'both copies of each clip, and the whole reel twice (with and without commentary), go straight to Cloudflare R2 (none to the old storage)');
const lastCut = (await calls(A, 'cut')).pop();
eq([lastCut.reelFile, lastCut.reelCleanFile], ['reelv.mp4', 'reel.mp4'], 'with commentary the cut makes the reel twice: with it, and without it for Commentary off');
const g0 = w.db().games[0];
eq([tail(g0.reel && g0.reel.path), tail(g0.reel && g0.reel.vpath), g0.reel && g0.reel.store], ['reel.mp4', 'reelv.mp4', 'r2'], 'the game keeps its whole reel (without and with commentary)');
eq(rows().map((c) => c.reel_at), [0, 14.04, 28.08], 'and each clip keeps where it starts in the reel');
check((w.db().files || []).every((f) => f.type === 'video/mp4'), 'as videos, so they play in any browser');
check(/with commentary/.test(await A.text('#cutBody')), 'the done screen says the clips have commentary');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);

// ---------- the game's whole reel plays at the top of the game, and tapping a moment skips to it
eq(await A.page.$$eval('#hlList .hcard:first-child .mhbtn', (b) => b.map((x) => x.textContent)), ['▶Watch the whole match highlights3 moments · 0:42'], 'a big button to watch the whole match\'s highlights, with how many moments and how long');
await A.page.evaluate(() => { HTMLMediaElement.prototype.play = function () { this.__played = (this.__played || 0) + 1; return Promise.resolve(); }; });
await A.click('#hlList .hcard:first-child .mhbtn'); await A.run(300);
eq([await A.visible('#mhPop'), await A.page.$eval('#mhVideo', (v) => v.getAttribute('src').replace(/^.*\//, '')), await A.page.$$eval('#mhList [data-mht]', (b) => b.length), await A.page.$eval('#mhVideo', (v) => v.__played || 0)],
  [true, 'reelv.mp4', 3, 1], 'it opens full screen and plays the reel, with every moment to skip to');
check(/^Moment 1 of 3 · 0:42 in all$/.test(await A.text('#mhNow')), `saying where it's up to (${await A.text('#mhNow')})`);
await A.page.evaluate(() => { const v = document.getElementById('mhVideo'); let t = 0; Object.defineProperty(v, 'currentTime', { configurable: true, get: () => t, set: (x) => { t = x; } }); });
await A.click('#mhList [data-mhi="1"]');
eq([await A.page.$eval('#mhVideo', (v) => Math.round(v.currentTime * 100) / 100), await A.text('#mhNow')], [14.09, 'Moment 2 of 3 · 0:42 in all'], 'tapping a moment skips the reel to it');
await shot(A, 'match-highlights');
await A.click('#mhClose'); await A.run(200);
eq(await A.visible('#mhPop'), false, 'Close goes back');
await A.page.evaluate(() => document.querySelectorAll('#hlList details.allclips').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); }));
eq([await A.page.$$eval('#hlList .hcard:first-child .reelp video', (v) => v.length), await A.page.$$eval('#hlList .hcard:first-child [data-seek]', (b) => b.length)], [1, 3], 'By game shows the whole reel, with its moments underneath');
eq(await A.page.$eval('#hlList .hcard:first-child .reelp video', (v) => v.getAttribute('src').replace(/^.*\//, '')), 'reelv.mp4', 'with commentary, as this phone has it on');
await A.page.evaluate(() => { const v = document.querySelector('#hlList .reelp video'); let t = 0; Object.defineProperty(v, 'currentTime', { configurable: true, get: () => t, set: (x) => { t = x; } }); v.play = () => Promise.resolve(); });
await A.click('#hlList .hcard:first-child [data-seek="14.04"]');
eq([await A.page.$eval('#hlList .reelp video', (v) => Math.round(v.currentTime * 100) / 100), await A.page.$eval('#hlList [data-seek="14.04"]', (b) => b.getAttribute('aria-pressed'))], [14.09, 'true'], 'tapping a moment skips the reel straight to it');
await shot(A, 'reel-in-highlights');
await A.click('#hlList [data-say]');
eq(await A.page.$eval('#hlList .hcard:first-child .reelp video', (v) => v.getAttribute('src').replace(/^.*\//, '')), 'reel.mp4', 'Commentary off plays the reel without it');
await A.click('#hlList [data-say]');
// a game whose reel didn't upload (cut before reels were kept): its clips one by one inline
const savedReel = w.db().games[0].reel; let dbx = w.db(); dbx.games[0].reel = null; dbx.clips.forEach((c) => { c.reel_at = null; }); w.setDb(dbx); await A.page.reload(); await A.run(1500);
if (await A.view() !== 'highlights') { await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(300); await A.click('#mHighlights'); }
await A.run(500);
await A.page.evaluate(() => document.querySelectorAll('#hlList details.allclips').forEach((d) => { d.open = true; d.dispatchEvent(new Event('toggle')); }));
eq([await A.page.$$eval('#hlList .reelp', (x) => x.length), await A.page.$$eval('#hlList .hcard:first-child [data-clip]', (b) => b.length)], [0, 3], 'without a reel, the clips play one by one as before');

// ---------- Commentary on / off swaps which copy of each clip plays (one sound at a time, as an iPhone needs)
const srcs = () => A.page.$$eval('#hlList .hcard:first-child [data-clip]', (x) => x.map((y) => y.getAttribute('data-src').replace(/^.*\//, '')));
const vsrc = () => A.page.$eval('#hlList .hcard:first-child video', (v) => v.getAttribute('src').replace(/^.*\//, ''));
eq([await A.text('#hlList [data-say]'), await srcs(), await vsrc()], ['Commentary on', ['01v.mp4', '02v.mp4', '03v.mp4'], '01v.mp4'], 'commentary on: the copies with commentary play');
await A.click('#hlList [data-say]');
eq([await A.text('#hlList [data-say]'), await srcs(), await vsrc()], ['Commentary off', ['01.mp4', '02.mp4', '03.mp4'], '01.mp4'], 'commentary off: the clean copies play instead, with no voice to clash with');
check(await A.page.evaluate(() => localStorage.getItem('apt-say') === '0'), 'the choice is remembered on this phone');
await A.click('#hlList [data-say]');
check(await A.page.evaluate(() => !document.querySelector('#hlList .say') && !document.querySelector('[data-line]')), 'no spoken-by-the-phone commentary is left to talk over the video');

// ---------- the gaffer opens the whole match's highlights on such a game: their phone makes it one video, for everyone
await A.page.evaluate(() => { HTMLMediaElement.prototype.play = function () { this.__played = (this.__played || 0) + 1; return Promise.resolve(); }; });
const mhsrc = (P) => P.page.$eval('#mhVideo', (v) => v.getAttribute('src').replace(/^.*\//, ''));
const joinsBefore = (await calls(A, 'join')).length;
await A.click('#hlList .hcard:first-child .mhbtn'); await A.run(3000);
const mk = (await calls(A, 'join')).slice(joinsBefore);
eq(mk.map((o) => [o.items.map((x) => tail(x.url)), o.shrink, !!o.outro, /reelv?\.mp4$/.test(o.file)]), [[['01.mp4', '02.mp4', '03.mp4'], true, true, true], [['01v.mp4', '02v.mp4', '03v.mp4'], true, true, true]],
  'the gaffer\'s phone joins the clips into one video (shrunk, with the full-time card), without commentary and with it');
const g1 = w.db().games[0];
eq([tail(g1.reel && g1.reel.path), tail(g1.reel && g1.reel.vpath), g1.reel && g1.reel.store, w.db().clips.slice().sort((a, b) => a.seq - b.seq).map((c) => c.reel_at)], ['reel.mp4', 'reelv.mp4', 'r2', [0, 14.04, 28.08]],
  'uploads it and keeps it as the game\'s video, with where each moment starts');
eq([await mhsrc(A), await A.text('#mhMsg')], ['reelv.mp4', 'It’s one video now, for everyone in the team.'], 'and the player switches to the one video');
await shot(A, 'match-one-video');
// Save or share: the one video, fetched to the phone, then the share sheet
await A.click('#mhTools [data-mhsave]'); await A.run(1000);
const ex = (await calls(A, 'join')).pop();
eq([ex.items.map((x) => tail(x.url)), !!ex.outro, (await calls(A, 'share')).pop()], [['reelv.mp4'], false, '/phone/' + ex.file], 'Save or share gets the one video onto the phone and opens the share sheet');
const jn = (await calls(A, 'join')).length, sh = (await calls(A, 'share')).length;
await A.click('#mhTools [data-mhsave]'); await A.run(300);
eq([(await calls(A, 'join')).length - jn, (await calls(A, 'share')).length - sh], [0, 1], 'a second tap shares the same file again, without fetching it twice');
await A.click('#mhClose'); await A.run(200);
dbx = w.db(); dbx.games[0].reel = savedReel; w.setDb(dbx); await A.page.reload(); await A.run(1500); // (the reel the cut made back for the rest)

// ---------- a follower downloads the game's reel
const F = await w.phone({ db: true, native: true, label: 'follower' });
await F.ctx.addInitScript(cutter); await F.page.reload(); await F.run(500);
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
await F.click('#mHighlights'); await F.run(300);
// without one video (and on a phone that can't make it: not a gaffer's), the whole match's clips play back to back
dbx = w.db(); const keepReel = dbx.games[0].reel; dbx.games[0].reel = null; w.setDb(dbx); await F.page.reload(); await F.run(1500);
if (await F.view() !== 'highlights') { await home(F); await F.run(300); await F.click('#mHighlights'); await F.run(300); }
await F.page.evaluate(() => { HTMLMediaElement.prototype.play = function () { this.__played = (this.__played || 0) + 1; return Promise.resolve(); }; });
const fjoins = (await calls(F, 'join')).length;
await F.click('#hlList .hcard:first-child .mhbtn'); await F.run(300);
eq([await mhsrc(F), await F.text('#mhNow'), (await calls(F, 'join')).length - fjoins], ['01v.mp4', 'Moment 1 of 3 · 0:42 in all', 0], 'a follower without one video gets the clips back to back (only a gaffer\'s phone makes it)');
check(/gaffer’s phone makes them one video/.test(await F.text('#mhMsg')), 'and is told why');
await F.page.evaluate(() => document.getElementById('mhVideo').dispatchEvent(new Event('ended'))); await F.run(100);
eq([await mhsrc(F), await F.text('#mhNow'), await F.page.$eval('#mhVideo', (v) => v.__played || 0)], ['02v.mp4', 'Moment 2 of 3 · 0:42 in all', 2], 'each one straight after the last');
await F.click('#mhList [data-mhi="2"]');
eq(await mhsrc(F), '03v.mp4', 'and any moment can be picked');
await F.page.evaluate(() => document.getElementById('mhVideo').dispatchEvent(new Event('ended'))); await F.run(100);
eq(await mhsrc(F), '03v.mp4', 'stopping after the last');
await F.click('#mhClose'); await F.run(200);
dbx = w.db(); dbx.games[0].reel = keepReel; w.setDb(dbx); await F.page.reload(); await F.run(1500);
if (await F.view() !== 'highlights') { await home(F); await F.run(300); await F.click('#mHighlights'); await F.run(300); }
eq([await F.visible('#hlList [data-dl]'), await F.visible('#hlList [data-cut]'), await F.visible('#hlList [data-hldel]')], [true, false, false], 'anyone in the team can download the reel (only gaffers cut or delete)');
await F.click('#hlList [data-dl]'); await F.run(1000);
let join = (await calls(F, 'join')).pop();
eq(join && join.items.map((x) => tail(x.url)), ['01v.mp4', '02v.mp4', '03v.mp4'], 'the reel is joined from the clips already made, with commentary (the phone\'s choice)');
check(/dog-squad.*-highlights\.mp4$/i.test(join.file) && join.outro.title === 'Sons of Pitches FC 2–1 Dog Squad', `named after the game (${join.file}), with the score on the outro card (${join.outro.title})`);
eq([await F.text('#dlMsg'), (await calls(F, 'share')).pop()], ['The reel is ready, with commentary.', '/phone/' + join.file], 'the share sheet opens to save it to Photos or send it on');
check(await F.visible('#hlList [data-dlshare]'), 'and Share or save it opens it again');
await shot(F, 'reel-download');
await F.page.evaluate(() => localStorage.setItem('apt-say', '0')); await F.page.reload(); await F.run(500); if (await F.view() !== 'highlights') { await home(F); await F.run(300); await F.click('#mHighlights'); await F.run(300); }
await F.click('#hlList [data-dl]'); await F.run(1000);
eq((await calls(F, 'join')).pop().items.map((x) => tail(x.url)), ['01.mp4', '02.mp4', '03.mp4'], 'with commentary off on that phone, the reel has none');

// ---------- a follower makes Jake's reel: every clip of his, untick some, preview, goals only
await F.click('#hlToggle [data-by="player"]');
const jake = '#hlList [data-preel="2"]';
eq(await F.visible(jake), true, 'each player with clips has Make a reel');
await F.click(jake);
const rb = () => F.page.$$eval('#rbBody .rblist li', (li) => li.map((x) => ({ text: x.querySelector('label span').textContent, on: x.querySelector('input').checked, key: x.querySelector('input').getAttribute('data-rbpick') })));
let list = await rb();
eq([await F.visible('#reelPop'), await F.text('#rbTitle'), list.length, list.map((x) => (/Goal|Assist/.exec(x.text) || [''])[0]), list.every((x) => x.on)],
  [true, 'Reel for Jake', 2, ['Goal', 'Assist'], true], 'it lists all Jake\'s clips, each saying what it is for him, all ticked');
check(/2 clips/.test(await F.text('#rbCount')), 'and counts them');
await shot(F, 'reel-player');
eq(await F.visible('#rbVoice'), false, 'the AI voice is for the team\'s gaffers and players, not followers');
const pv = () => F.page.$eval('#rbPrev', (v) => v.getAttribute('src').replace(/^.*\//, ''));
eq(await pv(), '01.mp4', 'the first clip is ready to preview');
await F.click(`#rbBody [data-rbprev="${list[1].key}"]`); eq(await pv(), '02.mp4', 'Preview plays the clip picked');
await F.page.uncheck(`#rbBody [data-rbpick="${list[1].key}"]`); await F.run(300);
check(/1 clip,/.test(await F.text('#rbCount')), 'unticking one leaves it out');
await F.page.check(`#rbBody [data-rbpick="${list[1].key}"]`); await F.page.check('#rbGoals'); await F.run(300);
list = await rb();
eq(list.map((x) => (/Goal|Assist/.exec(x.text) || [''])[0]), ['Goal'], 'Goals only leaves out his assist');
await F.click('#rbMake'); await F.run(1000);
join = (await calls(F, 'join')).pop();
eq([join.items.map((x) => tail(x.url)), join.items.some((x) => x.voice), join.outro.title, join.file], [['01.mp4'], false, 'Jake’s highlights', 'jake-highlights.mp4'], 'the reel is his goal only, no commentary, his name on the outro');
eq([await F.text('#rbMsg'), (await calls(F, 'share')).pop(), await F.visible('#rbShare')], ['The reel is ready.', '/phone/jake-highlights.mp4', true], 'then the share sheet, and Share or save it');
await F.click('#rbClose'); eq(await F.visible('#reelPop'), false, 'Close puts it away');
eq((w.db().player_reels || []).length, 0, 'someone just following the team can share a player\'s reel, but it isn\'t put on his card (only he or a gaffer can)');

// ---------- the gaffer makes Chaplin's reel with a commentator
await A.click('#hlToggle [data-by="player"]'); await A.click('#hlList [data-preel="3"]');
eq(await A.visible('#rbVoice'), true, 'gaffers can add AI commentary to a player\'s reel');
await A.page.check('#rbVoice'); await A.run(300);
eq([await A.visible('#rbVoiceName'), await A.visible('#rbVoiceStyle')], [true, true], 'with a choice of voice and delivery');
await shot(A, 'reel-player-voice');
await A.click('#rbMake'); await A.run(1500);
const said = (w.db().calls || []).filter((x) => x.name === 'reel-voice').pop();
join = (await calls(A, 'join')).pop();
eq([said.body.lines.length, said.body.lines[0], said.body.lines[said.body.lines.length - 1]], [4, 'Chaplin’s highlights, for Sons of Pitches FC.', 'That’s Chaplin. What a player.'], 'a line for each clip, with an intro and a sign-off');

// ---------- Sweary (18+): the same reel, called by a pub commentator who can't believe what he's watching
eq(await A.page.$$eval('#rbVoiceStyle option', (o) => o.map((x) => x.textContent)), ['Live commentator', 'Read it straight', 'Sweary, 18+ (swears like a pub commentator)'], 'there are three deliveries, Sweary (18+) among them');
await A.page.selectOption('#rbVoiceStyle', 'sweary'); await A.run(300);
await A.click('#rbMake'); await A.run(1500);
const sw = (w.db().calls || []).filter((x) => x.name === 'reel-voice').pop().body;
eq([sw.style, sw.lines[0], sw.lines[sw.lines.length - 1]], ['sweary', 'Chaplin’s highlights. Brace yourselves, this is absolute filth.', 'That’s Chaplin. What a fucking player.'], 'it asks for the sweary performance, with a sweary intro and sign-off');
check(sw.lines.slice(1, -1).every((l) => /fuck|shit|bollocks|bastard|filth|hell/i.test(l)), `and every clip's line swears (${sw.lines.slice(1, -1).join(' | ')})`);
check(sw.lines.slice(1, -1).every((l) => !/\d–\d/.test(l)), 'scores still written out to be spoken');
await A.page.selectOption('#rbVoiceStyle', 'hype'); await A.run(300);
check(said.body.lines.every((l) => !/\d–\d/.test(l)), 'scores are written out to be spoken');
eq([!!join.introVoice, !!join.outroVoice, join.items.map((x) => !!x.voice), join.items.map((x) => tail(x.url))], [true, true, [true, true], ['01.mp4', '02.mp4']],
  'the voice goes over the clean copies (never on top of another commentary)');
check(join.items.every((x) => x.voiceAt >= 0.5), 'each line comes just after the moment');
const kept = (w.db().player_reels || []).find((x) => x.pid === 3);
check(!!kept && kept.path.startsWith(w.db().teams[0].id + '/players/3/reel-') && kept.store === 'r2', `a gaffer's reel of Chaplin goes on to his card, kept in his own folder (${kept && kept.path})`);
eq([kept.marks.map((m) => m.t), kept.marks.every((m) => /Dog Squad/.test(m.label))], [[0, 14.04], true], 'with where each of his moments is in it');
check((w.db().files || []).some((f) => f.bucket === 'r2' && f.path === kept.path), 'the reel itself is uploaded');
await A.click('#rbClose'); await A.run(800);
const card = '#hlList .hcard:has([data-preel="3"])';
eq([await A.page.$$eval(card + ' .reelp video', (v) => v.length), await A.page.$$eval(card + ' [data-seek]', (b) => b.map((x) => x.getAttribute('data-seek')))], [1, ['0', '14.04']], 'his card plays the reel, with his moments underneath');
check(/All 2 clips, one by one/.test(await A.text(card)), 'and his clips one by one are still there, folded away');
await shot(A, 'player-reel-card');
await A.page.evaluate((c) => { const v = document.querySelector(c + ' .reelp video'); let t = 0; Object.defineProperty(v, 'currentTime', { configurable: true, get: () => t, set: (x) => { t = x; } }); v.play = () => Promise.resolve(); }, card);
await A.click(card + ' [data-seek="14.04"]');
eq(await A.page.$eval(card + ' .reelp video', (v) => Math.round(v.currentTime * 100) / 100), 14.09, 'tapping a moment skips to it');
await A.click('#hlList [data-preel="3"]'); await A.click('#rbMake'); await A.run(1500);
check(/on Chaplin’s card in Highlights/.test(await A.text('#rbMsg')), 'the reel maker says it\'s on his card');
await A.click('#rbClose'); await A.run(800);
const again = (w.db().player_reels || []).find((x) => x.pid === 3);
check(again.path !== kept.path && !(w.db().files || []).some((f) => f.path === kept.path), 'a new reel replaces the old one, and the old file goes');
await A.click(card + ' [data-preeloff="3"]'); await A.run(1000);
eq([(w.db().player_reels || []).find((x) => x.pid === 3).path, (w.db().files || []).some((f) => f.path === again.path), await A.page.$$eval(card + ' .reelp', (v) => v.length)], [null, false, 0], 'and a reel can be taken off the card (the file goes too)');

// ---------- deleting the game's highlights takes both copies
await A.click('#hlToggle [data-by="game"]');
await A.click('#hlList [data-hldel]'); await A.click('#hlList [data-hldel]'); await A.run(1500);
eq([rows().length, files()], [0, 0], 'deleting a game\'s highlights removes the copies with commentary too');

await w.close();
await done(A, F);
