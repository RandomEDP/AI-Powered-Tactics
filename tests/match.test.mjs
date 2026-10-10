// The phone running a game on its own: the clock, changes that wait to be confirmed, injuries, both whistles, the result.
import { world, suite, T0 } from './lib.mjs';
const { check, eq, done } = suite('phone: match');
const w = await world();
const names = (s) => s.split(' ').filter(Boolean).sort().join(' ');
const onNow = async (p) => names(await p.text('#pitchNow'));
const segOn = (m, i) => [m.segs[i].gk].concat(m.segs[i].on).filter((x) => x != null).sort((a, b) => a - b);

// ---------- 1. A full game, start to finish
{
  const p = await w.phone({ native: true });
  await p.localTeam(); await p.newGame();
  let m = await p.match();
  eq([m.phase, m.running, m.half, m.sub, m.segs.length], ['pre', false, 15, 5, 6], 'set up: before kick-off, two halves of 15 with a change every 5');
  check(typeof m.gid === 'string' && m.gid.length > 10, 'the game has an id of its own');
  let ws = await p.watch();
  eq([ws.live, ws.phase, ws.gid === m.gid, ws.due, ws.changes[0].h + '-' + ws.changes[0].from], [true, 'pre', true, false, '0-5'], 'the watch is told the game is set up');
  eq(ws.players.filter((x) => x.on).length, 5, 'five on the pitch');
  check(ws.players[ws.players.length - 1].gk === true && ws.players.filter((x) => x.gk).length === 1, 'the keeper is last in the list of scorers offered');

  const start = await onNow(p);
  await p.click('#go');
  m = await p.match(); const ko = m.t0;
  eq([m.phase, m.running, m.ok, m.koAt === m.t0], ['h1', true, 0, true], 'kick-off: first half running, first line-up confirmed');
  await p.run(4 * 60000 + 57000);
  check(!(await p.visible('#subPop')) && (await p.watch()).due === false, '4:58: no change asked for yet');
  await p.haptics();
  await p.run(4000);
  check(await p.visible('#subPop'), '5:00: the pop-up asks for the change');
  eq(await p.haptics(), ['WARNING'], 'one firm buzz, once');
  eq(await onNow(p), start, 'the line-up on screen has not moved');
  eq([(await p.match()).ok, (await p.watch()).due, await p.text('#countLabel')], [0, true, 'Change due: make the subs'], 'the change waits; the watch is told it is due');
  await p.run(20000);
  eq(await p.haptics(), [], 'it does not buzz again while waiting');

  // closing it, logging a goal, pausing: none of that makes the change
  await p.click('#subPopLater');
  check(!(await p.visible('#subPop')) && await p.visible('#subsDoneBtn'), 'closed with the x: the card still offers "Subs done"');
  await p.click('#goalUs'); await p.click('#picker button[data-p]'); await p.click('#picker button[data-p="x"]');
  m = await p.match();
  eq([m.events.length, m.events[0].us, m.events[0].min, m.events[0].on.slice().sort((a, b) => a - b)], [1, true, 6, segOn(m, 0)], 'a goal in the sixth minute, credited to the five still on the pitch');
  await p.click('#go'); eq([(await p.match()).running, await p.visible('#subPop')], [false, false], 'paused: clock stopped, pop-up stays closed');
  await p.run(60000);
  await p.click('#go'); eq([(await p.match()).running, await p.visible('#subPop'), (await p.match()).ok], [true, false, 0], 'resumed: still waiting, still not nagging');
  await p.click('#subsDoneBtn');
  m = await p.match();
  eq([m.ok, await onNow(p) !== start, (await p.watch()).due, (await p.watch()).changes[0].from], [1, true, false, 10], 'subs done: line-up changed, next change at 10:00');
  const played = Math.round((await p.now() - m.t0 + m.base) / 1000);
  check(played >= 320 && played <= 330, `the minute's pause is not counted as play (${played}s played)`);

  // the second change is left waiting all the way to the whistle
  await p.run((600 - played) * 1000 + 1000);
  check(await p.visible('#subPop'), '10:00: asked again');
  await p.click('#subPopLater');
  await p.haptics();
  await p.run(5 * 60000);
  eq(await p.haptics(), ['WARNING'], '15:00: the time-up buzz');
  await p.run(40000);
  eq([await p.text('#played'), await p.text('#countLabel')], ['15:41 played', 'Change due: make the subs'], 'the clock runs on past 15:00, still asking for the change');
  await p.click('#endHalf');
  m = await p.match();
  eq([m.phase, m.running, await p.visible('#subPop'), (await p.watch()).phase, (await p.watch()).due], ['ht', false, false, 'ht', false], 'half time: clock stopped, no change being asked for');
  eq((await p.watch()).changes[0].h, 1, 'the watch is shown the half-time change next');
  await p.run(5 * 60000);
  eq((await p.match()).phase, 'ht', 'nothing moves during the break');
  await p.click('#go');
  m = await p.match();
  eq([m.phase, m.ok, m.segs[m.ok].h, m.segs[m.ok].from, await p.visible('#subPop')], ['h2', 3, 1, 0, false], 'second half: starts on its own line-up with nothing to confirm');
  await p.run(5 * 60000 + 500); check(await p.visible('#subPop'), 'second half 5:00: asked');
  await p.click('#subPopDone'); eq((await p.match()).ok, 4, 'done from the pop-up');
  await p.click('#goalThem');
  await p.run(5 * 60000); check(await p.visible('#subPop'), 'second half 10:00: asked');
  await p.click('#subPopDone');
  await p.run(5 * 60000 + 10000);
  await p.click('#endHalf');
  m = await p.match();
  eq([m.phase, (await p.watch()).phase, m.ftAt > m.h2At && m.h2At > m.htAt && m.htAt > m.koAt, m.koAt === ko], ['ft', 'ft', true, true], 'full time, with all four whistles timed in order');
  check(await p.page.isDisabled('#go'), 'the clock button is finished with');
  await p.click('#finish'); await p.click('#finish');
  const t = await p.team(), r = t.results[0];
  eq([t.match, t.results.length, r.us, r.them, r.opp], [null, 1, 1, 1, 'Dog'], 'finished: 1–1 against Dog is in the results');
  const mins = Object.values(r.per).reduce((a, x) => a + x.mins, 0);
  eq(mins, 5 * 30, 'the minutes handed out add up to five players for thirty minutes');
  eq((await p.watch()).live, false, 'the watch is told the game is over');
  eq(await p.view(), 'stats', 'and the app moves to the stats');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 2. Two changes overdue, and a reset
{
  const p = await w.phone({ native: true });
  await p.localTeam(); await p.newGame(); await p.click('#go');
  await p.run(10 * 60000 + 30000);
  let m = await p.match();
  eq([m.ok, await p.visible('#subPop'), (await p.watch()).changes[0].from], [0, true, 5], '10:30 with nothing confirmed: still asking for the 5:00 change');
  await p.haptics();
  await p.click('#subPopDone');
  m = await p.match();
  eq([m.ok, await p.visible('#subPop'), (await p.watch()).due, (await p.watch()).changes[0].from], [1, true, true, 10], 'confirming it brings up the 10:00 change, already overdue');
  await p.click('#subPopDone');
  eq([(await p.match()).ok, await p.visible('#subPop'), (await p.watch()).due], [2, false, false], 'both made');
  await p.click('#reset'); await p.click('#reset');
  m = await p.match();
  eq([m.phase, m.running, m.ok === undefined, (await p.watch()).phase, (await p.watch()).changes[0].from], ['pre', false, true, 'pre', 5], 'reset: back to before kick-off, changes all to come again');
  await p.click('#go'); await p.run(5 * 60000 + 500);
  eq([(await p.match()).ok, await p.visible('#subPop')], [0, true], 'after kicking off again the 5:00 change is asked for again');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 3. A player goes off injured
{
  const p = await w.phone({ native: true });
  await p.localTeam(); await p.newGame(); await p.click('#go');
  await p.run(2 * 60000 + 20000);
  let m = await p.match(); const out = m.segs[0].on[0], before = segOn(m, 0);
  await p.click('#outBtn'); await p.click(`#outPicker button[data-o="${out}"]`);
  await p.click('#outPicker button.best');
  m = await p.match();
  eq([m.segs.length, m.segs[0].to, m.segs[1].from, m.gone], [7, 2, 2, [out]], 'injured at 2:20: the first stretch is cut at the second minute and the player is out');
  check(segOn(m, 1).indexOf(out) < 0 && segOn(m, 1).length === 5 && JSON.stringify(segOn(m, 1)) !== JSON.stringify(before), 'a replacement is on from that minute');
  eq([m.ok, await p.visible('#subPop'), (await p.watch()).due], [1, false, false], 'that swap is made there and then: nothing is left waiting to be confirmed');
  check((await p.text('#pitchNow')).indexOf((await p.team()).players.find((x) => x.id === out).name) < 0, 'the line-up on screen no longer shows the injured player');
  check(m.segs.slice(1).every((s) => s.on.indexOf(out) < 0 && s.bench.indexOf(out) < 0 && s.gk !== out), 'and they are in none of the later stretches');
  eq((await p.watch()).players.some((x) => x.id === out), false, 'the watch no longer offers them as a scorer');
  await p.run(2 * 60000 + 45000);
  eq([await p.visible('#subPop'), (await p.match()).ok], [true, 1], 'the 5:00 change still comes due as usual');
  // injured while a change is waiting
  m = await p.match(); const out2 = m.segs[m.ok].on.find((id) => m.segs[m.ok + 1].on.indexOf(id) >= 0);
  await p.click('#subPopLater');
  await p.click('#outBtn'); await p.click(`#outPicker button[data-o="${out2}"]`);
  if (await p.visible('#outPicker button.best')) await p.click('#outPicker button.best'); else if (await p.visible('#outPicker button[data-yes]')) await p.click('#outPicker button[data-yes]');
  m = await p.match();
  check(m.gone.indexOf(out2) >= 0 && m.segs.slice(m.ok + 1).every((s) => s.on.indexOf(out2) < 0), 'injured with a change waiting: they are taken out of the change that is due');
  eq([m.ok, (await p.watch()).due], [1, true], 'which is still waiting to be confirmed');
  await p.click('#subsDoneBtn');
  check((await p.match()).ok === 2 && !(await p.visible('#subPop')), 'and is confirmed as normal');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 4. Whistle with a change waiting, undo, and a goal after full time
{
  const p = await w.phone({ native: true });
  await p.localTeam(); await p.newGame(); await p.click('#go');
  await p.run(5 * 60000 + 2000);
  check(await p.visible('#subPop'), 'change due');
  await p.click('#subPopLater');
  await p.click('#endHalf'); await p.click('#endHalf'); // early: asks "End it early?" first
  eq([(await p.match()).phase, await p.visible('#subPop')], ['ht', false], 'half time blown early with the change never made');
  await p.click('#go');
  let m = await p.match();
  eq([m.phase, m.ok, await p.visible('#subPop'), (await p.watch()).due], ['h2', 3, false, false], 'the second half starts clean');
  await p.click('#goalThem'); await p.run(9000); await p.click('#goalThem');
  eq((await p.match()).events.length, 2, 'two goals nine seconds apart both count');
  check(await p.page.isDisabled('#goalThem') && await p.page.isDisabled('#goalUs'), 'a third inside the 8-second lock is not possible: both buttons are locked');
  await p.run(8000); check(!(await p.page.isDisabled('#goalThem')), 'and they unlock after 8 seconds');
  await p.click('#undo');
  eq([(await p.match()).events.length, await p.text('#themN'), (await p.watch()).them], [1, '1', 1], 'undo takes one off, on the watch as well');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 5. The app closed and reopened mid-game
{
  const p = await w.phone({ native: true });
  await p.localTeam(); await p.newGame(); await p.click('#go');
  await p.run(3 * 60000);
  const before = await p.match();
  await p.page.reload(); await p.run(800);
  let m = await p.match();
  eq([await p.view(), m.t0, m.gid, m.phase, m.running], ['game', before.t0, before.gid, 'h1', true], 'reopened on the game screen with the same clock');
  check(/^3:0/.test((await p.text('#played'))), `the clock reads three minutes (${await p.text('#played')})`);
  await p.sleep(2 * 60000 + 30000); // asleep in a pocket through 5:00
  eq([await p.visible('#subPop'), (await p.match()).ok, (await p.watch()).due], [true, 0, true], 'woken at 5:30: the change is asked for straight away');
  await p.sleep(11 * 60000);
  check(/^16:3/.test(await p.text('#played')), 'woken again in added time');
  await p.click('#subPopDone'); await p.click('#subPopDone');
  check(/^\+1:3/.test(await p.text('#count')) && /Added time/.test(await p.text('#countLabel')), `with the changes made the countdown shows added time (${await p.text('#count')})`);
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

await w.close();
await done();
