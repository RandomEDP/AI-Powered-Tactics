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
      return { clips: o.clips.map((c) => Object.assign({ file: c.file, path: '/phone/' + c.file }, c.voice ? { voiced: { file: c.file.replace('.mp4', 'v.mp4'), path: '/phone/' + c.file.replace('.mp4', 'v.mp4') } } : {})), reel: { path: '/phone/' + o.reelFile } }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); if (cb) { cb({ stage: 'fetch', i: 0, n: o.items.length, p: 0 }); cb({ stage: 'reel', p: 0.5 }); } return { path: '/phone/' + o.file, size: 1000 }; },
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
const files = () => (w.db().files || []).filter((f) => f.bucket === 'clips').length;
eq(files(), 6, 'both copies are uploaded');
check(/with commentary/.test(await A.text('#cutBody')), 'the done screen says the clips have commentary');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);

// ---------- Commentary on / off swaps which copy plays (one sound at a time, as an iPhone needs)
const srcs = () => A.page.$$eval('#hlList .hcard:first-child [data-clip]', (x) => x.map((y) => y.getAttribute('data-src').replace(/^.*\//, '')));
const vsrc = () => A.page.$eval('#hlList .hcard:first-child video', (v) => v.getAttribute('src').replace(/^.*\//, ''));
eq([await A.text('#hlList [data-say]'), await srcs(), await vsrc()], ['Commentary on', ['01v.mp4', '02v.mp4', '03v.mp4'], '01v.mp4'], 'commentary on: the copies with commentary play');
await A.click('#hlList [data-say]');
eq([await A.text('#hlList [data-say]'), await srcs(), await vsrc()], ['Commentary off', ['01.mp4', '02.mp4', '03.mp4'], '01.mp4'], 'commentary off: the clean copies play instead, with no voice to clash with');
check(await A.page.evaluate(() => localStorage.getItem('apt-say') === '0'), 'the choice is remembered on this phone');
await A.click('#hlList [data-say]');
check(await A.page.evaluate(() => !document.querySelector('#hlList .say') && !document.querySelector('[data-line]')), 'no spoken-by-the-phone commentary is left to talk over the video');

// ---------- a follower downloads the game's reel
const F = await w.phone({ db: true, native: true, label: 'follower' });
await F.ctx.addInitScript(cutter); await F.page.reload(); await F.run(500);
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
await F.click('#mHighlights'); await F.run(300);
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
check(said.body.lines.every((l) => !/\d–\d/.test(l)), 'scores are written out to be spoken');
eq([!!join.introVoice, !!join.outroVoice, join.items.map((x) => !!x.voice), join.items.map((x) => tail(x.url))], [true, true, [true, true], ['01.mp4', '02.mp4']],
  'the voice goes over the clean copies (never on top of another commentary)');
check(join.items.every((x) => x.voiceAt >= 0.5), 'each line comes just after the moment');
await A.click('#rbClose');

// ---------- deleting the game's highlights takes both copies
await A.click('#hlToggle [data-by="game"]');
await A.click('#hlList [data-hldel]'); await A.click('#hlList [data-hldel]'); await A.run(1500);
eq([rows().length, files()], [0, 0], 'deleting a game\'s highlights removes the copies with commentary too');

await w.close();
await done(A, F);
