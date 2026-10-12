// The phone's side of the Apple Watch link: presses arriving late, twice, out of order or for the wrong game,
// and what the phone tells the watch it has dealt with.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: watch link');
const w = await world();
let n = 0; const id = () => 'press-' + (++n);
const setup = async () => { const p = await w.phone({ native: true }); await p.localTeam(); await p.newGame(); return p; };
const finish = async (p) => { p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close(); };

// ---------- 1. Kick-off from the watch
{
  const p = await setup(); const gid = (await p.match()).gid, k = id();
  const at = await p.now() - 2000;
  await p.fromWatch({ type: 'start', to: 'h1', id: k, at, gid });
  let m = await p.match(), ws = await p.watch();
  eq([m.phase, m.running, m.t0, m.koAt, m.ok], ['h1', true, at, at, 0], 'kick-off pressed on the watch 2 s ago: the phone clock starts from that moment');
  eq([ws.phase, ws.t0, ws.acks.indexOf(k) >= 0], ['h1', at, true], 'the watch is told, and told that press is dealt with');
  await p.fromWatch({ type: 'start', to: 'h1', id: k, at, gid });
  await p.fromWatch({ type: 'start', to: 'h1', id: id(), at: at + 5000, gid });
  eq((await p.match()).t0, at, 'the same press again, or a second kick-off, changes nothing');
  eq((await p.watch()).acks.length, 2, 'but both are listed as dealt with, so the watch stops sending them');
  await finish(p);
}

// ---------- 2. Kick-off reaching the phone six minutes late
{
  const p = await setup(); const gid = (await p.match()).gid;
  const at = await p.now();
  await p.sleep(6 * 60000 + 10000);
  await p.haptics();
  await p.fromWatch({ type: 'start', to: 'h1', id: id(), at, gid });
  let m = await p.match();
  eq([m.phase, m.t0, m.ok], ['h1', at, 0], 'the game is started from when it really kicked off');
  check(/^6:1/.test(await p.text('#played')), `the clock reads 6:10 (${await p.text('#played')})`);
  eq([await p.visible('#subPop'), (await p.watch()).due, (await p.watch()).changes[0].from], [true, true, 5], 'and the 5:00 change, already past, is waiting to be confirmed rather than assumed made');
  eq(await p.haptics(), [], 'quietly: news this old gets no beep or buzz');
  await p.fromWatch({ type: 'subs', change: '0-5', id: id(), at: at + 305000, gid });
  eq([(await p.match()).ok, await p.visible('#subPop'), (await p.watch()).due], [1, false, false], '"Subs done" from the watch, arriving right behind it, makes the change');
  await finish(p);
}

// ---------- 3. Presses arriving in the wrong order
{
  const p = await setup(); const gid = (await p.match()).gid, t = await p.now();
  const end = id(), second = id(), first = id();
  await p.sleep(22 * 60000);
  await p.fromWatch({ type: 'start', to: 'h2', id: second, at: t + 20 * 60000, gid });
  await p.fromWatch({ type: 'end', from: 'h1', id: end, at: t + 16 * 60000, gid });
  let ws = await p.watch();
  eq([(await p.match()).phase, ws.acks.length], ['pre', 0], '"second half" and "half time" arrive before "kick-off": neither is acted on or written off');
  await p.fromWatch({ type: 'start', to: 'h1', id: first, at: t, gid });
  await p.run(6000);
  const m = await p.match(); ws = await p.watch();
  eq([m.phase, m.koAt, m.htAt, m.h2At, m.t0], ['h2', t, t + 16 * 60000, t + 20 * 60000, t + 20 * 60000], 'once kick-off arrives all three are applied in order, each at its own time');
  eq([first, end, second].every((x) => ws.acks.indexOf(x) >= 0), true, 'and all three are listed as dealt with');
  check(/^2:0/.test(await p.text('#played')), `second half two minutes old (${await p.text('#played')})`);
  eq([m.ok, m.segs[m.ok].h], [3, 1], 'on the second-half line-up');
  await finish(p);
}

// ---------- 4. Both whistles from the watch, and presses that don't belong
{
  const p = await setup(); const gid = (await p.match()).gid;
  await p.click('#go'); const ko = (await p.match()).t0;
  await p.fromWatch({ type: 'end', from: 'h2', id: id(), at: await p.now(), gid });
  eq((await p.match()).phase, 'h1', 'a full-time whistle while the phone is in the first half waits rather than ending anything');
  await p.run(15 * 60000 + 20000);
  const blown = await p.now() - 1500;
  await p.fromWatch({ type: 'end', from: 'h1', id: id(), at: blown, gid });
  let m = await p.match();
  eq([m.phase, m.running, m.htAt, (await p.watch()).phase], ['ht', false, blown, 'ht'], 'half time blown on the watch');
  await p.fromWatch({ type: 'end', from: 'h1', id: id(), at: blown + 100, gid });
  eq((await p.match()).phase, 'ht', 'a second half-time whistle does nothing');
  await p.fromWatch({ type: 'start', to: 'h1', id: id(), at: await p.now(), gid });
  eq((await p.match()).phase, 'ht', 'a stray "kick-off" at half time does not start the second half');
  await p.fromWatch({ type: 'start', to: 'h2', id: id(), at: await p.now(), gid: 'another-game' });
  eq((await p.match()).phase, 'ht', 'nor does a press that belongs to a different game');
  const h2 = await p.now();
  await p.fromWatch({ type: 'start', to: 'h2', id: id(), at: h2, gid });
  eq([(await p.match()).phase, (await p.match()).h2At], ['h2', h2], 'the real one does');
  await p.run(8000);
  m = await p.match();
  eq(m.phase, 'h2', 'and the full-time whistle from back in the first half, kept until now, is recognised as too old to end this half');
  await finish(p);
  eq(m.koAt, ko, 'kick-off time untouched throughout');
}

// ---------- 5. Goals from the watch
{
  const p = await setup(); const gid = (await p.match()).gid;
  await p.click('#go'); const ko = (await p.match()).t0;
  const squad = (await p.match()).squad, scorer = squad[1], helper = squad[2];
  await p.sleep(9 * 60000);
  // two goals pressed a minute apart while the phone was asleep arrive together
  const g1 = id(), g2 = id();
  await p.page.evaluate(([a, b]) => { window.__t.watchCb({ event: JSON.stringify(a) }); window.__t.watchCb({ event: JSON.stringify(b) }); },
    [{ type: 'goal', us: true, p: scorer, a: helper, id: g1, at: ko + 3 * 60000 + 30000, gid }, { type: 'goal', us: false, id: g2, at: ko + 4 * 60000 + 40000, gid }]);
  await p.run(500);
  let m = await p.match(), ws = await p.watch();
  eq(m.events.map((e) => [e.us, e.p ?? null, e.a ?? null, e.min, e.at]), [[true, scorer, helper, 4, ko + 210000], [false, null, null, 5, ko + 280000]], 'both count, each in the minute it was really scored');
  eq([ws.us, ws.them, ws.acks.indexOf(g1) >= 0 && ws.acks.indexOf(g2) >= 0], [1, 1, true], 'the watch is told 1–1 and that both are dealt with');
  eq(m.events[0].on.slice().sort(), [m.segs[0].gk].concat(m.segs[0].on).sort(), 'credited to the line-up that was on at the time, not the one due on since');
  // the same goal already logged by someone else within a few seconds
  await p.run(9000);
  check(await p.visible('#subPop'), 'the 5:00 change is being asked for'); await p.click('#subPopLater');
  await p.click('#goalThem'); const logged = (await p.match()).events[2].at;
  await p.fromWatch({ type: 'goal', us: false, id: id(), at: logged - 3000, gid });
  eq((await p.match()).events.length, 3, 'a watch goal within 8 seconds of one already logged is the same goal: not counted twice');
  await p.run(9000);
  await p.fromWatch({ type: 'goal', us: true, p: 9999, a: scorer, id: id(), at: await p.now() + 60000, gid });
  await p.run(9000);
  await p.fromWatch({ type: 'goal', us: true, p: 9999, a: 'x', id: id(), at: await p.now(), gid });
  m = await p.match();
  eq([m.events.length, m.events[4].us, m.events[4].p ?? null, m.events[4].a ?? null], [5, true, null, null], 'a scorer the phone does not know is logged as a goal with no name; a time from the future is treated as now');
  // a goal that was queued while the watch was out of reach turns up after a later one
  await p.run(60000); const tA = await p.now() - 50000, tB = await p.now() - 20000;
  await p.fromWatch({ type: 'goal', us: false, id: id(), at: tB, gid });
  await p.fromWatch({ type: 'goal', us: true, p: scorer, id: id(), at: tA, gid });
  m = await p.match();
  eq([m.events.length, m.events.slice(-2).map((e) => e.at), m.events.slice(-2).map((e) => e.us)], [7, [tA, tB], [true, false]], 'goals arriving out of order are put in the order they were scored');
  await p.click('#undo'); await p.click('#undo'); await p.run(9000);
  // the phone's buttons are locked after a goal logged on it; a watch goal from a minute earlier must still get in
  await p.click('#goalThem'); check(await p.page.isDisabled('#goalUs'), 'phone locked after its own goal');
  await p.fromWatch({ type: 'goal', us: true, p: scorer, id: id(), at: await p.now() - 60000, gid });
  eq((await p.match()).events.length, 7, 'a late watch goal is counted even while the phone is in its 8-second lock');
  await p.click('#undo'); await p.click('#undo'); await p.run(9000);
  await p.fromWatch({ type: 'hl', id: id(), at: await p.now(), gid });
  eq((await p.match()).events[5].hl, true, 'a highlight from the watch is marked');
  // the Action button sends a highlight two ways at once (straight across and by the watch's queue): the second copy can
  // turn up after the first was dealt with, by either route (after a restart too: see "after another restart" below)
  const hlTwice = id(); await p.fromWatch({ type: 'hl', id: hlTwice, at: await p.now(), gid });
  const marked = (await p.match()).events.filter((e) => e.hl).length;
  await p.fromWatch({ type: 'hl', id: hlTwice, at: await p.now() - 300, gid }, { kept: false });
  await p.fromWatch({ type: 'hl', id: hlTwice, at: await p.now() - 600, gid });
  eq((await p.match()).events.filter((e) => e.hl).length, marked, 'one highlight sent two ways is marked once, however late the second copy arrives');
  await p.tap('#undo');
  // nonsense
  for (const bad of ['null', '[]', '{', '42', '"goal"', '{"type":"goal"}', '{"type":"nope","id":"zz"}', '{"type":"subs","change":"9-99","id":"yy"}', '']) await p.fromWatch(bad);
  await p.page.evaluate(() => { window.__t.watchCb(null); window.__t.watchCb({}); window.__t.watchCb({ event: 7 }); });
  await p.run(9000);
  eq((await p.match()).events.length, 6, 'nonsense from the watch is survived, and adds nothing');
  await p.click('#endHalf'); await p.click('#endHalf'); await p.click('#go'); await p.run(1000); await p.click('#endHalf'); await p.click('#endHalf');
  eq((await p.match()).phase, 'ft', 'full time');
  const late = id();
  await p.fromWatch({ type: 'goal', us: true, id: late, at: await p.now(), gid });
  eq([(await p.match()).events.length, (await p.watch()).acks.indexOf(late) >= 0], [6, true], 'a goal pressed after the final whistle is not counted, and the watch is told to stop sending it');
  await finish(p);
}

// ---------- 6. "Subs done" for the wrong change, and for one this phone hasn't reached yet
{
  const p = await setup(); const gid = (await p.match()).gid;
  await p.click('#go'); const ko = (await p.match()).t0;
  await p.run(4 * 60000 + 57000);
  const early = id();
  await p.fromWatch({ type: 'subs', change: '0-5', id: early, at: await p.now(), gid }); // the watch's clock is a few seconds ahead
  eq([(await p.match()).ok, (await p.watch()).acks.indexOf(early)], [0, -1], 'confirmed on the watch 3 s before this phone thinks it is due: kept, not thrown away');
  await p.run(9000);
  eq([(await p.match()).ok, (await p.watch()).acks.indexOf(early) >= 0, await p.visible('#subPop')], [1, true, false], 'and applied as soon as it comes due here, with no pop-up left behind');
  const old = id();
  await p.fromWatch({ type: 'subs', change: '0-5', id: old, at: await p.now(), gid });
  eq([(await p.match()).ok, (await p.watch()).acks.indexOf(old) >= 0], [1, true], 'a repeat for a change already made is written off');
  await p.run(5 * 60000);
  check(await p.visible('#subPop'), '10:00 change due');
  await p.fromWatch({ type: 'subs', change: '0-5', id: id(), at: await p.now(), gid });
  eq((await p.match()).ok, 1, 'a press about the 5:00 change does not confirm the 10:00 one');
  await p.fromWatch({ type: 'subs', id: id(), at: await p.now(), gid });
  eq((await p.match()).ok, 2, 'a press from an older watch app, naming no change, confirms whatever is due');
  eq((await p.match()).koAt, ko, 'clock untouched'); await finish(p);
}

// ---------- 7. The app opened cold by the watch, and old presses left over
{
  const p = await setup(); const gid = (await p.match()).gid;
  await p.click('#go');
  await p.run(60000);
  const g = id();
  await p.page.reload(); // the listener is attached again from scratch
  await p.run(600);
  await p.fromWatch({ type: 'goal', us: true, id: g, at: await p.now(), gid });
  eq((await p.match()).events.length, 1, 'a goal right after the app reopens counts');
  await p.page.reload(); await p.run(600);
  await p.fromWatch({ type: 'goal', us: true, id: g, at: await p.now(), gid });
  eq((await p.match()).events.length, 1, 'the same press after another restart is still recognised and not counted twice');
  check((await p.watch()).acks.indexOf(g) >= 0, 'and is still listed as dealt with');
  // finish, set up the next game: an unsent press from the last one turns up
  await p.click('#endHalf'); await p.click('#endHalf'); await p.click('#go'); await p.click('#endHalf'); await p.click('#endHalf'); await p.click('#finish'); await p.click('#finish');
  const stale = id();
  await p.fromWatch({ type: 'start', to: 'h1', id: stale, at: await p.now(), gid });
  await p.click('#v-stats .back'); await p.newGame('Cat');
  await p.run(6000);
  const m = await p.match();
  eq([m.phase, m.gid !== gid, m.opp], ['pre', true, 'Cat'], 'a kick-off press left over from the last game does not start the next one');
  await finish(p);
}

// ---------- 8. The phone asleep in a bag for the whole game: everything the watch sent is waiting in the phone's own store
{
  const p = await setup(); const gid = (await p.match()).gid, squad = (await p.match()).squad, scorer = squad[1], helper = squad[2];
  const KO = (await p.now()) + 5000, min = 60000;
  const presses = [
    { type: 'start', to: 'h1', at: KO },
    { type: 'goal', us: true, p: scorer, a: helper, at: KO + 3 * min + 10000 },   // 4th minute
    { type: 'goal', us: false, at: KO + 5 * min + 5000 },                         // 6th minute, after the change came due but before it was made
    { type: 'subs', change: '0-5', at: KO + 5 * min + 12000 },
    { type: 'goal', us: true, p: scorer, at: KO + 7 * min },                      // 8th minute, new line-up
    { type: 'subs', change: '0-10', at: KO + 10 * min + 20000 },
    { type: 'hl', at: KO + 12 * min },
    { type: 'end', from: 'h1', at: KO + 15 * min + 30000 },
    { type: 'start', to: 'h2', at: KO + 20 * min },
    { type: 'subs', change: '1-5', at: KO + 25 * min + 8000 },
    { type: 'goal', us: false, at: KO + 28 * min },                               // 9th minute of the second half
    { type: 'subs', change: '1-10', at: KO + 30 * min + 15000 },
    { type: 'goal', us: true, at: KO + 35 * min + 20000 },                        // 15:20 of the second half: added time
    { type: 'end', from: 'h2', at: KO + 35 * min + 40000 },
  ].map((e, i) => Object.assign({ id: 'bag-' + i, gid }, e));
  // they reach the phone in a jumbled order (two different routes from the watch), one of them twice
  for (const i of [8, 0, 3, 1, 2, 5, 4, 7, 6, 9, 13, 10, 12, 11, 4]) await p.toInbox(presses[i]);
  eq([(await p.match()).phase, (await p.inbox()).length], ['pre', 14], 'with the app asleep nothing has happened yet, and all fourteen presses are being kept');
  await p.haptics();
  await p.sleep(41 * min); // the gaffer gets the phone out after the game
  await p.run(1000);
  let m = await p.match(), ws = await p.watch();
  eq([m.phase, m.koAt, m.htAt, m.h2At, m.ftAt], ['ft', KO, KO + 15 * min + 30000, KO + 20 * min, KO + 35 * min + 40000], 'on waking, the whole game is there: all four whistles at the times they were blown');
  eq(m.events.map((e) => [e.hl ? 'hl' : e.us ? 'us' : 'them', e.min, e.x ?? 0, e.at - KO]),
    [['us', 4, 0, 190000], ['them', 6, 0, 305000], ['us', 8, 0, 420000], ['hl', 13, 0, 720000], ['them', 24, 0, 28 * min], ['us', 30, 1, 35 * min + 20000]], 'every goal and the highlight, in order, each in its own minute');
  const lineup = (i) => [m.segs[i].gk].concat(m.segs[i].on).sort((a, b) => a - b), on = (i) => m.events[i].on.slice().sort((a, b) => a - b);
  eq([on(0), on(1), on(2), on(4), on(5)], [lineup(0), lineup(0), lineup(1), lineup(4), lineup(5)], 'each goal credited to the five who were really on: the one scored while a change was waiting goes to the old line-up');
  eq([m.events[0].p, m.events[0].a, m.ok, await p.visible('#subPop')], [scorer, helper, 5, false], 'scorer and assist kept, every change confirmed, nothing left asking');
  eq([ws.phase, ws.us, ws.them, presses.every((x) => ws.acks.indexOf(x.id) >= 0), await p.inbox()], ['ft', 3, 2, true, []], 'the watch is told 3–2 at full time and that all fourteen are dealt with, and the phone\'s store is emptied');
  eq(await p.haptics(), [], 'all of it taken in without a single beep');
  // one more turns up late: a goal from just before the final whistle that took another route
  await p.fromWatch({ type: 'goal', us: false, id: 'bag-late', gid, at: KO + 35 * min + 30000 });
  await p.fromWatch({ type: 'goal', us: true, id: 'bag-after', gid, at: KO + 36 * min });
  m = await p.match();
  eq([m.events.length, m.events[6].us, m.events[6].min, m.events[6].x, m.events[6].on.slice().sort((a, b) => a - b)], [7, false, 30, 1, lineup(5)], 'a goal from before the final whistle that arrives after it still counts, in its minute; one pressed after the whistle does not');
  await p.click('#finish'); await p.click('#finish');
  const r = (await p.team()).results[0];
  eq([r.us, r.them, r.ev.length], [3, 3, 7], 'and the result saved is the game that was played');
  await finish(p);
}

// ---------- 9. The app thrown out of memory in the bag: it starts from cold and still has everything
{
  const p = await setup(); const gid = (await p.match()).gid;
  const KO = await p.now();
  await p.toInbox({ type: 'goal', us: true, id: 'cold-2', gid, at: KO + 100000 });
  await p.toInbox({ type: 'start', to: 'h1', id: 'cold-1', gid, at: KO });
  await p.page.clock.fastForward(4 * 60000);
  await p.page.reload(); await p.run(1500);
  let m = await p.match();
  eq([m.phase, m.t0, m.events.length, m.events[0] && m.events[0].min, await p.inbox()], ['h1', KO, 1, 2, []], 'reloaded from cold: kick-off and the goal are taken in from the phone\'s store, in the right order');
  // the same press also arrives live, twice: still one goal
  await p.fromWatch({ type: 'goal', us: true, id: 'cold-2', gid, at: KO + 100000 });
  await p.fromWatch({ type: 'goal', us: true, id: 'cold-2', gid, at: KO + 100000 }, { kept: false });
  eq([(await p.match()).events.length, await p.inbox()], [1, []], 'the watch repeating a press already dealt with adds nothing and leaves nothing behind');
  // a phone whose store isn't there (an older build): the live message alone still works
  await p.fromWatch({ type: 'goal', us: false, id: 'cold-3', gid, at: await p.now() }, { kept: false });
  eq((await p.match()).events.length, 2, 'a press that only arrives live is dealt with just the same');
  await finish(p);
}

// ---------- 10. Goals that arrive ahead of the whistle they follow, or long after their half
{
  const p = await setup(); const gid = (await p.match()).gid, t = await p.now();
  await p.fromWatch({ type: 'goal', us: true, id: 'early-1', gid, at: t + 1000 });
  eq([(await p.match()).events.length, (await p.watch()).acks.indexOf('early-1')], [0, -1], 'a goal that arrives before the kick-off it followed is held, not counted at minute nought');
  await p.run(60000);
  await p.fromWatch({ type: 'start', to: 'h1', id: 'early-0', gid, at: t });
  await p.run(6000);
  let m = await p.match();
  eq([m.phase, m.events.length, m.events[0].min, (await p.watch()).us], ['h1', 1, 1, 1], 'once kick-off arrives the goal goes in, in the first minute');
  await p.run(15 * 60000);
  if (await p.visible('#subPop')) await p.click('#subPopLater');
  const ht = await p.now();
  await p.click('#endHalf');
  // a second-half goal before "second half" has arrived; and a first-half goal that took the slow route
  await p.run(5 * 60000);
  await p.fromWatch({ type: 'goal', us: false, id: 'h2-goal', gid, at: (await p.now()) - 20000 });
  eq((await p.match()).events.length, 1, 'a goal from after half time, with the second half not yet started here, waits');
  await p.fromWatch({ type: 'goal', us: true, id: 'h1-slow', gid, at: t + 12 * 60000 + 30000 });
  m = await p.match();
  const first = (i) => [m.segs[i].gk].concat(m.segs[i].on).sort((a, b) => a - b);
  eq([m.events.length, m.events[1].min, m.events[1].on.slice().sort((a, b) => a - b)], [2, 13, first(2)], 'a first-half goal arriving at half time goes into the 13th minute, with the line-up of that stretch');
  await p.fromWatch({ type: 'start', to: 'h2', id: 'h2-start', gid, at: (await p.now()) - 40000 });
  await p.run(6000);
  m = await p.match();
  eq([m.phase, m.events.length, m.events[2].us, m.events[2].min], ['h2', 3, false, 16], 'and when the second half arrives, the goal that was waiting goes into its first minute');
  await p.fromWatch({ type: 'goal', us: true, id: 'h1-slower', gid, at: t + 2 * 60000 });
  m = await p.match();
  eq([m.events.length, m.events[1].min, m.events[1].at - t, m.events.map((e) => e.min)], [4, 3, 120000, [1, 3, 13, 16]], 'a first-half goal arriving in the second half still lands in the first half, in order');
  check(ht > 0, 'half time was blown');
  await finish(p);
}

// ---------- 11. The clock stopped on the phone and restarted from the wrist
{
  const p = await setup(); const gid = (await p.match()).gid;
  await p.click('#go'); await p.run(3 * 60000);
  await p.fromWatch({ type: 'resume', id: 'res-0', gid, at: await p.now() });
  eq((await p.match()).running, true, 'a restart while the clock is running changes nothing');
  await p.click('#go');
  let m = await p.match(); const stoppedAt = m.base;
  eq([m.running, (await p.watch()).running, Math.round(stoppedAt / 1000) >= 180], [false, false, true], 'stopped on the phone: the watch is told');
  await p.run(40000);
  const at = (await p.now()) - 5000;
  await p.fromWatch({ type: 'resume', id: 'res-1', gid, at });
  m = await p.match();
  eq([m.running, m.base, m.t0, (await p.watch()).running, (await p.watch()).acks.indexOf('res-1') >= 0], [true, stoppedAt, at, true, true], 'restarted from the wrist: the phone clock runs on from where it stopped, from the moment the watch was pressed');
  await p.run(2 * 60000);
  check(await p.visible('#subPop'), 'and the 5:00 change still comes due at 5:00 of play');
  await p.click('#subPopDone'); await p.click('#endHalf'); await p.click('#endHalf');
  await p.fromWatch({ type: 'resume', id: 'res-2', gid, at: await p.now() });
  eq([(await p.match()).phase, (await p.match()).running], ['ht', false], 'a restart arriving at half time does not start anything');
  await finish(p);
}

await w.close();
await done();
