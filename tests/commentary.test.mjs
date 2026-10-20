// Your own commentary over your highlights (Ethan, October 2026: "a way to commentate over your own highlights"). In the
// reel maker, Commentary is None, AI voice or Your voice. With Your voice, once the reel is made it opens full screen:
// Record counts in 3, 2, 1, the reel plays while the microphone records, Stop (or the end of the reel) stops it, then
// Play it back, Record again as often as you like, or Use this take, which lays the voice over the reel on the phone with
// the game's sound turned down while you talk. The microphone and the mixing are the iPhone's (VoiceOverPlugin, stood in
// for here); when the talking is and how the game's sound dips is checked in tests/voice/main.swift.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: your own commentary');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

const db = w.db(), me = db.users[0].id, sop = db.teams[0], T = 1791660000000;
db.players.find((p) => p.team_id === sop.id && p.pid === 3).user_id = me;
db.games.push({ id: 'g-cat', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 3, them: 1, finished_at: T - 7 * 864e5, friendly: false });
db.clips.push({ team_id: sop.id, game_id: 'g-cat', seq: 0, path: sop.id + '/cat/01.mp4', store: 'r2', at: T - 7 * 864e5, dur: 14, pids: [3], label: '4\' Goal: Ethan' },
  { team_id: sop.id, game_id: 'g-cat', seq: 1, path: sop.id + '/cat/02.mp4', store: 'r2', at: T - 7 * 864e5 + 6e5, dur: 14, pids: [1], label: '14\' Goal: Spice' });
w.setDb(db);
await A.ctx.addInitScript(() => { // stand-ins for the iPhone's reel maker and microphone
  window.__rc = []; window.__vo = { perm: 'ask', dur: 20, calls: [], mixFail: false };
  const log = (k, o) => window.__vo.calls.push([k, o]);
  window.Capacitor.Plugins.ReelCutter = { addListener: () => ({ remove() {} }), cancel: async () => ({}), share: async (o) => { window.__rc.push(['share', o.path]); return {}; },
    joinReel: async (o) => { window.__rc.push(['join', o]); return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; } };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  window.Capacitor.Plugins.VoiceOver = {
    addListener: (n, f) => { window.__voCb = f; return { remove() {} }; },
    permission: async () => { log('permission'); return { state: window.__vo.perm === 'denied' ? 'denied' : window.__vo.perm === 'granted' ? 'granted' : 'ask' }; },
    prepare: async () => { log('prepare'); if (window.__vo.perm === 'denied') { const e = new Error('Gaffer isn’t allowed to use the microphone.'); e.code = 'denied'; throw e; } window.__vo.perm = 'granted'; return { ok: true }; },
    start: async () => { log('start'); return { at: Date.now() - 250 }; }, // (the recording began a moment before the reel plays)
    level: async () => ({ level: 0.6 }),
    stop: async () => { log('stop'); return { path: '/phone/take-' + window.__vo.calls.filter((c) => c[0] === 'stop').length + '.m4a', dur: window.__vo.dur, spans: [{ from: 1, to: 3 }] }; },
    discard: async () => { log('discard'); },
    mix: async (o) => { log('mix', o); if (window.__voCb) window.__voCb({ p: 0.5, job: o.job }); if (window.__vo.mixFail) throw new Error('the video didn’t finish.'); return { path: '/phone/vo/' + o.file, size: 1000 }; },
    settings: async () => { log('settings'); },
  };
});
await A.page.reload(); await A.run(1500);
const vo = () => A.page.evaluate(() => window.__vo.calls.map((c) => c[0]));
const voLast = (k) => A.page.evaluate((x) => (window.__vo.calls.filter((c) => c[0] === x).pop() || [])[1], k);
const rc = (k) => A.page.evaluate((x) => window.__rc.filter((c) => c[0] === x).map((c) => c[1]), k);
const pressed = (sel) => A.page.getAttribute(sel, 'aria-pressed');

// ---------- the choice: a game's reel offers None, AI voice and Your voice, one at a time
await A.click('#mHighlights'); await A.run(300);
await A.click('#hlList [data-hlm="make:0"]'); await A.click('#hlSheet [data-greel="0"]'); await A.run(300);
eq(await A.page.$$eval('#rbBody .rbcm .seg button', (b) => b.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : ''))), ['None*', 'AI voice', 'Your voice'],
  'Commentary: None, AI voice or Your voice, as one segmented choice (None to start)');
await A.click('#rbVoice'); await A.run(100);
eq([await pressed('#rbVoice'), await pressed('#rbOwn'), await A.visible('#rbVoiceName')], ['true', 'false', true], 'AI voice: the voices to pick from');
await A.click('#rbOwn'); await A.run(100);
eq([await pressed('#rbVoice'), await pressed('#rbOwn'), await A.visible('#rbVoiceName'), await A.visible('#rbOwnNote')], ['false', 'true', false, true], 'Your voice: says what happens (you talk over it, as often as you like, the game turned down under you)');
check((await A.page.$$eval('#rbBody .rbcm .seg button', (b) => b.map((x) => x.getBoundingClientRect().height))).every((h) => h >= 44), 'each choice is at least 44 points tall');
await shot(A, 'commentary-choice');

// ---------- Make the reel: it's made, then the recorder opens over it
await A.click('#rbMake'); await A.run(600);
const join = (await rc('join')).pop();
eq([!!join, join && join.items.some((x) => x.voice), await A.visible('#micPop'), await A.visible('#micGo')], [true, false, true, true], 'the reel is made without any AI voice, then Your commentary opens with the Record button');
check(/Tap Record\. After 3, 2, 1 your reel plays/.test(await A.text('#micSay')) && /muted while you record/.test(await A.text('#micSay')), 'saying what will happen before anything does');
eq(await A.page.$eval('#micVid', (v) => v.getAttribute('src').replace(/^.*_capacitor_file_/, '')), '/phone/' + join.file + '#t=0.1', 'the reel just made is on screen, its first frame showing');
check(!(await vo()).includes('prepare'), 'the microphone isn’t asked for until Record is tapped (Apple: ask in context)');
await shot(A, 'commentary-ready');

await A.click('#micGo'); await A.run(100);
eq([await A.text('#micCount'), await A.visible('#micStop'), await A.visible('#micRec')], ['3', true, false], 'Record: the microphone is asked for, then 3, 2, 1 over the picture (Stop can still call it off)');
await A.run(1000); eq(await A.text('#micCount'), '2', '2…');
await A.run(2400);
eq([await A.text('#micCount'), await A.visible('#micRec'), await A.visible('#micStop'), (await vo()).filter((x) => x === 'prepare' || x === 'start')], ['', true, true, ['prepare', 'start']], 'then it records: the red dot and the time, and Stop');
eq(await A.page.$eval('#micVid', (v) => v.muted), true, 'the reel plays muted while you talk, so the speaker isn’t recorded');
await A.run(500);
check(await A.page.$eval('#micLevel', (b) => b.classList.contains('live') && [...b.children].some((i) => parseInt(i.style.height, 10) > 20)), 'the level bars move with your voice, so you can see it’s hearing you');
await shot(A, 'commentary-recording');

await A.click('#micStop'); await A.run(300);
eq([await A.visible('#micUse'), await A.visible('#micPlay'), await A.visible('#micAgain'), await A.visible('#micRec')], [true, true, true, false], 'Stop: Use this take, Play it back and Record again');
check(/Your take is 0:19 long/.test(await A.text('#micSay')), 'saying how long it is (' + await A.text('#micSay') + ')');
await shot(A, 'commentary-review');

await A.click('#micPlay'); await A.run(100);
eq([await A.text('#micPlay'), await A.page.$eval('#micAud', (a) => a.getAttribute('src').replace(/^.*_capacitor_file_/, '')), await A.page.$eval('#micVid', (v) => v.muted)], ['Stop playing', '/phone/take-1.m4a', true],
  'Play it back plays your voice with the picture');
await A.click('#micPlay'); eq(await A.text('#micPlay'), 'Play it back', 'and can be stopped');

// ---------- Record again, as often as you like
await A.click('#micAgain'); await A.run(3600); await A.click('#micStop'); await A.run(300);
eq([(await vo()).filter((x) => x === 'start').length, await A.visible('#micUse')], [2, true], 'Record again: another 3, 2, 1 and a new take');

// ---------- a take isn't thrown away on one tap
await A.click('#micCancel');
eq([await A.text('#micCancel'), await A.visible('#micPop')], ['Tap again to discard it', true], 'Cancel with a take asks for a second tap');
await A.run(4500); eq(await A.text('#micCancel'), 'Cancel', 'and goes back to Cancel if it isn’t tapped again');

// ---------- the phone can't put it on: say so, keep the take
await A.page.evaluate(() => { window.__vo.mixFail = true; });
await A.click('#micUse'); await A.run(300);
eq([await A.visible('#micPop'), await A.visible('#micUse')], [true, true], 'if the voice can’t be put on, the take is still there to try again');
check(/couldn’t be added: the video didn’t finish\. Try Use this take again\./.test(await A.text('#micSay')), 'saying exactly why (' + await A.text('#micSay') + ')');
await A.page.evaluate(() => { window.__vo.mixFail = false; });

await A.click('#micUse'); await A.run(600);
const mix = await voLast('mix');
eq([mix.path, mix.voice, mix.file, mix.spans], ['/phone/' + join.file, '/phone/take-2.m4a', join.file.replace('-highlights.mp4', '-commentary.mp4'), [{ from: 1, to: 3 }]],
  'Use this take: the latest take goes over the reel, with when the talking is (for the game’s sound to dip)');
check(mix.lead >= 0.2 && mix.lead < 1, 'lined up with the reel: the recording started a moment before the reel played (' + mix.lead + ' s)');
eq([await A.visible('#micPop'), await A.text('#rbMsg'), (await rc('share')).pop()], [false, 'The reel is ready, with your commentary.', '/phone/vo/' + mix.file], 'then the reel with your commentary goes to the share sheet');
await A.click('#rbShare'); eq((await rc('share')).pop(), '/phone/vo/' + mix.file, 'and Share or save it shares that one');

// ---------- Cancel with nothing recorded: the reel without it
await A.click('#rbClose'); await A.click('#hlList [data-hlm="make:0"]'); await A.click('#hlSheet [data-greel="0"]'); await A.click('#rbOwn'); await A.click('#rbMake'); await A.run(600);
await A.click('#micCancel'); await A.run(300);
eq([await A.visible('#micPop'), await A.text('#rbMsg'), (await rc('share')).pop()], [false, 'The reel is ready, without your commentary.', '/phone/' + join.file], 'Cancel before recording: the reel without commentary');

// ---------- Cancel mid-take throws it away
await A.click('#rbClose'); await A.click('#hlList [data-hlm="make:0"]'); await A.click('#hlSheet [data-greel="0"]'); await A.click('#rbOwn'); await A.click('#rbMake'); await A.run(600);
await A.click('#micGo'); await A.run(3600);
await A.click('#micCancel'); await A.run(300);
eq([await A.visible('#micPop'), (await vo()).pop()], [false, 'discard'], 'Cancel while recording stops the microphone and keeps nothing');
await A.click('#rbClose'); await A.run(200);

// ---------- the microphone turned off for Gaffer: where to turn it on
await A.page.evaluate(() => { window.__vo.perm = 'denied'; });
await A.click('#hlList [data-hlm="make:0"]'); await A.click('#hlSheet [data-greel="0"]'); await A.run(300);
eq(await pressed('#rbOwn'), 'false', 'a new reel starts with no commentary');
await A.click('#rbOwn'); await A.click('#rbMake'); await A.run(600);
eq([await A.visible('#micSettings'), await A.visible('#micGo')], [true, true], 'microphone refused: Open Settings and Try again');
check(/Turn on Microphone for Gaffer in the Settings app/.test(await A.text('#micSay')), 'saying exactly where');
await shot(A, 'commentary-denied');
await A.click('#micSettings'); eq((await vo()).pop(), 'settings', 'Open Settings goes to Gaffer’s page in Settings');
await A.page.evaluate(() => { window.__vo.perm = 'ask'; });
await A.click('#micGo'); await A.run(100);
eq(await A.text('#micCount'), '3', 'turned on: Try again records');
await A.click('#micStop'); await A.run(200);
eq([await A.visible('#micGo'), await A.text('#micCount')], [true, ''], 'Stop during the count-in calls it off');
await A.click('#micCancel'); await A.run(300); await A.click('#rbClose'); await A.run(200);

// ---------- Just me: your voice is there, the AI voice isn't (that belongs to one team)
await A.click('#hlScope [data-scope="me"]'); await A.run(800);
await A.click('#hlMeMake [data-mereel]'); await A.run(300);
eq([await A.visible('#rbVoice'), await A.visible('#rbOwn')], [false, true], 'your own reel from every team: Your voice, not the AI voice');

check(!A.errs.length, 'no errors: ' + A.errs.join(' | '));
await w.close(); done();
