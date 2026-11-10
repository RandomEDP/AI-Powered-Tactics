// The sin bin (Ethan, November 2026: "We need to add a button for someone getting sin binned on our team. It's a 5 min sin
// bin where we only have 3 players"). Sin bin on the game screen (under Right now) picks one of ours on the pitch; they're off for five
// minutes of the game clock and nobody comes on for them, so the team plays one short. A countdown shows under the clock and
// on the watch; when the time's up the change bringing the team back to full strength is made with Subs done (straight away,
// even if the minute isn't up). Minutes stay right: nobody is counted for the time the team was short. It works from the
// watch too, and a sin bin late in the first half carries into the second.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone and watch: the sin bin');
const w = await world();
const finish = async (p) => { p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close(); };
const mins = (m) => { const r = {}; m.squad.forEach((id) => { r[id] = 0; }); m.segs.forEach((s) => { const d = s.to - s.from; [s.gk].concat(s.on).filter((x) => x != null).forEach((id) => { r[id] += d; }); }); return r; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const segAt = (m, h, t) => { let i = -1; m.segs.forEach((s, k) => { if (s.h === h && s.from <= t) i = k; }); return m.segs[i]; };
const onAt = (m, h, t) => { const s = segAt(m, h, t); return (s.gk != null ? [s.gk] : []).concat(s.on); };
const nameOf = async (p, id) => (await p.team()).players.find((x) => x.id === id).name;
const start = async () => { const p = await w.phone({ native: true }); await p.localTeam(); await p.newGame(); return p; };
const done2 = async (p) => { if (await p.visible('#subPopDone')) await p.click('#subPopDone'); else await p.click('#subsDoneBtn'); };

// ---------- 1. Sent off for five minutes: one short, the countdown, and back to full strength
{
  const p = await start(); await p.click('#go'); await p.run(2 * 60000 + 30000); // 2:30
  let m = await p.match(); const plan = mins(m), s0 = m.segs[0], full = onAt(m, 0, 2).length;
  check(await p.visible('#binBtn') && !(await p.page.isDisabled('#binBtn')), 'Sin bin is on the game screen during the game');
  await p.click('#binBtn');
  eq(await p.text('#binPick strong'), 'Who’s in the sin bin?', 'it asks who');
  const offered = await p.page.$$eval('#binPick button[data-bin]', (b) => b.map((x) => +x.getAttribute('data-bin')));
  eq(offered.slice().sort(), s0.on.slice().sort(), 'offering the outfield players on the pitch (not the keeper, not the bench)');
  const X = s0.on.find((id) => m.segs.find((s) => s.h === 0 && s.from === 5).bench.indexOf(id) < 0), xn = await nameOf(p, X); // (someone due to stay on at 5:00)
  await p.click(`#binPick button[data-bin="${X}"]`);
  m = await p.match();
  eq(m.bins.length, 1, 'the sin bin is kept with the game');
  const now = segAt(m, 0, 2);
  eq([now.from, onAt(m, 0, 2).length, now.on.includes(X), now.bench.includes(X)], [2, full - 1, false, false], `${xn} is off and nobody came on: ${full - 1} on the pitch`);
  eq(now.bench.slice().sort(), s0.bench.slice().sort(), 'the bench is just as it was');
  eq([onAt(m, 0, 5).length, onAt(m, 0, 7).length, onAt(m, 0, 8).length], [full - 1, full - 1, full], 'still one short at the 5:00 change, and back to full strength at 8:00');
  check(onAt(m, 0, 8).includes(X), `${xn} is back on at 8:00`);
  eq([m.ok, await p.visible('#subPop')], [m.segs.indexOf(now), false], 'it happens there and then: nothing waits for Subs done');
  eq(await p.text('#binLine'), `Sin bin: ${xn} back in 5:00`, 'the countdown shows under the clock');
  check((await p.text('#binNow')).startsWith(xn) && !(await p.text('#pitchNow')).includes(xn), 'Right now has them in the sin bin, not on the pitch');
  check(new RegExp(`^${xn} is in the sin bin for 5 minutes, so you play one short\\. Their 5 minutes are up at 7:30\\.`).test(await p.text('#noticeText')), `the notice says so: "${await p.text('#noticeText')}"`);
  let ws = await p.watch();
  eq([ws.bins && ws.bins[0].id, ws.bins && ws.bins[0].name, ws.bins && ws.bins[0].h, ws.bins && Math.abs(ws.bins[0].end - 450000) < 2000], [X, xn, 0, true], 'the watch gets the sin bin and when it ends (7:30)');
  check(!(ws.players.find((x) => x.id === X) || {}).on, 'and has them off the pitch');
  const back = ws.changes.find((c) => c.from === 8);
  check(back && back.on.includes(xn) && back.off.length === 0, `the watch's change at 8:00 brings ${xn} back on (${JSON.stringify(back)})`);
  const after = mins(m);
  eq(plan[X] - after[X], 6, `${xn} isn't counted for the time in the sin bin (from 2:00 to 8:00 in whole minutes)`);
  eq(sum(plan) - sum(after), 6, 'and nobody else is counted for it either: the team was one short');

  await p.run(2 * 60000 + 30000); // 5:00: the planned change goes on around the gap
  if (await p.visible('#subPopDone')) await p.click('#subPopDone');
  eq(await p.text('#binLine'), `Sin bin: ${xn} back in 2:30`, 'the countdown carries on');
  await p.run(2 * 60000 + 30000); // 7:30
  eq(await p.text('#binLine'), `Sin bin: ${xn}’s time is up`, 'at 7:30 their time is up');
  eq(await p.text('#swapTitle'), 'Sin bin over: back on now', 'and the change bringing them back is offered straight away');
  await p.click('#subsDoneBtn');
  m = await p.match();
  check(onAt(m, 0, 8).includes(X) && m.segs[m.ok].from === 8, `Subs done: ${xn} is back on`);
  check((await p.text('#pitchNow')).includes(xn) && !(await p.visible('#binLine')) && !(await p.visible('#binNow')), 'and the sin bin is gone from the screen');
  ws = await p.watch();
  check(!ws.bins && (ws.players.find((x) => x.id === X) || {}).on, 'and from the watch');
  await finish(p);
}

// ---------- 2. Sent off just before they were due a rest: whoever was coming on in their place waits
{
  const p = await start(); await p.click('#go'); await p.run(3 * 60000 + 10000); // 3:10
  let m = await p.match(); const s5 = m.segs.find((s) => s.h === 0 && s.from === 5), X = m.segs[0].on.find((id) => s5.bench.includes(id));
  const cameOn = s5.on.filter((id) => !m.segs[0].on.includes(id)), full = onAt(m, 0, 2).length;
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  m = await p.match();
  eq([onAt(m, 0, 5).length, onAt(m, 0, 8).length], [full - 1, full - 1], 'still one short after the 5:00 change');
  eq(segAt(m, 0, 5).bench.filter((id) => cameOn.includes(id)).length, 1, 'one of those due on at 5:00 waits on the bench');
  eq(onAt(m, 0, 9).length, full, 'and the team is back to full strength at 9:00');
  check(!onAt(m, 0, 9).includes(X), 'with the player still having the rest they were due');
  await finish(p);
}

// ---------- 3. Undo, and not while a change is waiting
{
  const p = await start(); await p.click('#go'); await p.run(60000 + 5000);
  let m = await p.match(); const before = JSON.stringify(m.segs), X = m.segs[0].on[0];
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  check(await p.visible('#noticeUndo'), 'the notice offers Undo');
  await p.click('#noticeUndo');
  m = await p.match();
  eq([JSON.stringify(m.segs), m.bins.length, await p.visible('#binLine')], [before, 0, false], 'Undo puts it all back');
  await p.click('#binBtn'); await p.click('#binPick button[data-cancel]');
  eq([await p.visible('#binPick .picker'), (await p.match()).bins.length], [false, 0], 'Cancel changes nothing');
  await p.run(4 * 60000);
  check(await p.visible('#subPop') && await p.page.isDisabled('#binBtn'), 'with a change waiting for Subs done, Sin bin waits too');
  await finish(p);
}

// ---------- 4. From the watch
{
  const p = await start(); await p.click('#go'); await p.run(90000);
  let m = await p.match(); const X = m.segs[0].on[1], at = await p.now() - 3000, xn = await nameOf(p, X);
  await p.fromWatch({ type: 'bin', p: X, id: 'bin-1', at, gid: m.gid });
  m = await p.match();
  eq([m.bins.length, segAt(m, 0, 0).on.includes(X), segAt(m, 0, 1).on.includes(X)], [1, true, false], 'a sin bin pressed on the watch is made on the phone');
  eq(Math.round(m.bins[0].em / 1000), 87 + 300, 'timed from the press on the watch, three seconds ago');
  const ws = await p.watch();
  check(ws.acks.includes('bin-1') && ws.bins[0].id === X, 'and the watch is told it was dealt with');
  await p.fromWatch({ type: 'bin', p: X, id: 'bin-1', at, gid: m.gid });
  await p.fromWatch({ type: 'bin', p: X, id: 'bin-2', at: at + 1000, gid: m.gid });
  eq((await p.match()).bins.length, 1, `the same press again, or a second one for ${xn}, changes nothing`);
  await p.fromWatch({ type: 'bin', p: 99, id: 'bin-3', at, gid: m.gid });
  eq((await p.match()).bins.length, 1, 'nor does a player who isn\'t in the game');
  await finish(p);
}

// ---------- 5. Thirteen minutes in: two minutes before half time, three after
{
  const p = await start(); await p.click('#go'); await p.run(13 * 60000);
  let m; while (await p.visible('#subPopDone')) await p.click('#subPopDone');
  m = await p.match(); const X = segAt(m, 0, 13).on[0], xn = await nameOf(p, X), full = onAt(m, 0, 13).length;
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  m = await p.match();
  const b = m.bins[0], left = Math.round(b.em / 1000); // (13:00 and a second or so for the taps)
  check(b.eh === 1 && left >= 180 && left <= 183 && b.h1 === 1 && b.f1 === Math.ceil(b.em / 60000), `what's left at half time goes into the second half (${JSON.stringify(b)})`);
  eq([onAt(m, 0, 14).length, onAt(m, 1, 0).length, onAt(m, 1, b.f1 - 1).length, onAt(m, 1, b.f1).length], [full - 1, full - 1, full - 1, full], 'one short to half time and for the first three minutes or so after it');
  check(/Their 5 minutes are up at 3:0\d in the second half/.test(await p.text('#noticeText')), 'the notice says so');
  await p.run(2 * 60000 + 5000); await p.click('#endHalf'); await p.run(300);
  const ht = await p.text('#binLine'); await p.run(20000);
  check(ht.startsWith(`Sin bin: ${xn} back in 3:0`) && (await p.text('#binLine')) === ht, `at half time the countdown stands still (${ht})`);
  check(!(await p.page.isDisabled('#binBtn')) === false, 'and nobody can be sent at half time');
  await p.click('#go'); await p.run(60000);
  check((await p.text('#binLine')).startsWith(`Sin bin: ${xn} back in 2:0`), 'and carries on in the second half');
  await finish(p);
}

// ---------- 6. Someone hurt while another is in the sin bin: their place is filled, the team stays one short
{
  const p = await start(); await p.click('#go'); await p.run(60000 + 10000);
  let m = await p.match(); const X = m.segs[0].on[0], Y = m.segs[0].on[1], full = onAt(m, 0, 1).length;
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  await p.click('#outBtn'); await p.click(`#outPicker button[data-o="${Y}"]`);
  if (await p.visible('#outPicker button.best')) await p.click('#outPicker button.best');
  m = await p.match();
  eq([onAt(m, 0, 2).length, onAt(m, 0, 4).length], [full - 1, full - 1], 'the injured player is replaced, but the sin bin still leaves them one short');
  eq(onAt(m, 0, 7).length, full, 'and full strength again once it\'s over');
  await finish(p);
}

// ---------- 7. A game among ourselves with no subs: they come back on by a change all the same
{
  const p = await w.phone({ native: true }); await p.localTeam();
  await p.click('#mNew'); await p.click('#gKind [data-kind="house"]'); await p.click('#hKick');
  if (await p.visible('#benchOk')) await p.click('#benchOk');
  await p.click('#go'); await p.run(60000);
  let m = await p.match(); const X = m.segs[0].on[0], xn = await nameOf(p, X), side = m.house.side[X];
  const sideOn = (mm, h, t) => segAt(mm, h, t).on.filter((id) => mm.house.side[id] === side).length, before = sideOn(m, 0, 1);
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  m = await p.match();
  eq([sideOn(m, 0, 1), sideOn(m, 0, m.bins[0].f1 - 1), sideOn(m, 0, m.bins[0].f1)], [before - 1, before - 1, before], `${xn}'s side is one short, then back to full`);
  await p.run(5 * 60000);
  check(await p.visible('#swapCard') && /Sin bin over/.test(await p.text('#swapTitle')), `the card to bring ${xn} back shows, even with no subs in this game ("${await p.text('#swapTitle')}")`);
  await done2(p);
  m = await p.match();
  check(segAt(m, 0, m.segs[m.ok].from).on.includes(X), `${xn} is back on`);
  await finish(p);
}

await w.close();
done();
