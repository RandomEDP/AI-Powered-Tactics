// Match-day asks from Ethan's first game with the redesign: "pop up the 3 players starting on the bench"; show the subs
// 30 seconds before each change, as the ref sometimes calls it early; Undo after the wrong goal button unlocks the score
// so the right one can go straight in; and a goal is timed from the tap on Goal (what the highlights are cut around),
// not from when the scorer has been picked.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: match-day timing');
const w = await world();
let n = 0; const id = () => 'md-press-' + (++n);
const setup = async () => { const p = await w.phone({ native: true }); await p.localTeam(); await p.newGame(); return p; };
const finish = async (p) => { p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close(); };
const names = (t) => t.replace(/\s+/g, ' ').trim();

// ---------- 1. The bench, before kick-off
{
  const p = await setup(); const m = await p.match();
  const bench = m.segs[0].bench.map((i) => m.squad.indexOf(i) >= 0 ? i : null);
  eq([await p.view(), await p.visible('#benchSheet'), bench.length], ['game', true, 3], 'before kick-off a sheet says who starts on the bench');
  const want = await p.page.evaluate((ids) => ids.map((i) => JSON.parse(localStorage.getItem('apt-team-' + JSON.parse(localStorage.getItem('apt-app')).active)).players.find((x) => x.id === i).name), m.segs[0].bench);
  eq(await p.page.$$eval('#benchNames .chip', (c) => c.map((x) => x.textContent)), want, `the three of them (${want.join(', ')})`);
  check(/starts in goal/.test(await p.text('#benchNote')) && /First change at 5:00/.test(await p.text('#benchNote')), 'with who\'s in goal and when the first change is');
  check(await p.page.evaluate(() => { const g = document.getElementById('go').getBoundingClientRect(), s = document.getElementById('benchSheet').getBoundingClientRect(); return g.bottom <= s.top; }), 'it leaves Kick off clear');
  await p.click('#benchOk');
  eq([await p.visible('#benchSheet'), (await p.match()).benchSeen], [false, true], 'Got it closes it');
  await p.page.reload(); await p.run(800);
  eq(await p.visible('#benchSheet'), false, 'and it stays closed (once a game)');
  await finish(p);
}
{
  const p = await setup();
  await p.click('#go'); await p.run(500);
  eq([await p.visible('#benchSheet'), (await p.match()).benchSeen], [false, true], 'kicking off closes it too');
  await finish(p);
}

// ---------- 2. Subs shown 30 seconds early, and made early
{
  const p = await setup(); await p.click('#go'); await p.run(500);
  await p.run(4 * 60000 + 20000); // 4:20 played
  eq([await p.text('#swapTitle'), await p.visible('#subsDoneBtn')], ['Next change at 5:00', false], 'at 4:20 the next change is just listed');
  await p.run(15000); // 4:35
  eq([await p.text('#swapTitle'), await p.visible('#subsDoneBtn'), await p.page.evaluate(() => document.getElementById('swapCard').classList.contains('soon')), await p.visible('#subPop')],
    ['Subs coming up at 5:00', true, true, false], 'from 4:30 it\'s picked out with Subs done, but no alarm yet');
  check((await p.haptics()).length >= 1, 'with a light tap on the phone');
  const before = names(await p.text('#pitchNow'));
  await p.click('#subsDoneBtn'); await p.run(300);
  let m = await p.match();
  eq(m.ok, 1, 'Subs done 25 seconds early makes the change');
  check(names(await p.text('#pitchNow')) !== before, `the line-up on screen changes now (${before} → ${names(await p.text('#pitchNow'))})`);
  eq((await p.watch()).changes[0].from, 10, 'and the watch is told the next change is at 10:00');
  await p.run(40000); // 5:15
  m = await p.match();
  eq([await p.visible('#subPop'), m.ok, (await p.watch()).due], [false, 1, false], 'at 5:00 nothing more is asked: the change was made');
  eq(await p.text('#swapTitle'), 'Next change at 10:00', 'the card has moved on to the next one');
  await finish(p);
}
{
  const p = await setup(); await p.click('#go'); await p.run(500);
  await p.run(4 * 60000 + 40000); // 4:40, and the watch says Subs done
  const gid = (await p.match()).gid;
  await p.fromWatch({ type: 'subs', change: '0-5', id: id(), at: await p.now(), gid });
  eq([(await p.match()).ok, (await p.watch()).changes[0].from], [1, 10], 'Subs done on the watch in the 30 seconds before is taken by the phone too');
  await p.run(30000);
  eq(await p.visible('#subPop'), false, 'and nothing is asked at 5:00');
  await finish(p);
}
{
  const p = await setup(); await p.click('#go'); await p.run(500);
  await p.run(4 * 60000); // 4:00, too early
  const gid = (await p.match()).gid;
  await p.fromWatch({ type: 'subs', change: '0-5', id: id(), at: await p.now(), gid });
  eq((await p.match()).ok, 0, 'a minute early is too early: nothing changes yet');
  await finish(p);
}
{ // the change made early stays made through an injury in those 30 seconds
  const p = await setup(); await p.click('#go'); await p.run(500);
  await p.run(4 * 60000 + 40000); await p.click('#subsDoneBtn'); await p.run(300);
  const m = await p.match(), out = m.segs[1].on.find((i) => i !== m.segs[1].gk);
  await p.click('#outBtn'); await p.click(`#outPicker button[data-o="${out}"]`);
  if (await p.visible('#outPicker button.best')) await p.click('#outPicker button.best'); else if (await p.visible('#outPicker button[data-yes]')) await p.click('#outPicker button[data-yes]');
  await p.run(30000);
  eq([(await p.match()).ok >= 1, await p.visible('#subPop')], [true, false], 'an injury in the 30 seconds after an early change doesn\'t undo it or ask for it again');
  await finish(p);
}

// ---------- 3. Undo after the wrong goal button unlocks the score
{
  const p = await setup(); await p.click('#go'); await p.run(60000);
  await p.click('#goalThem'); await p.run(300);
  eq([await p.text('#themN'), await p.page.isDisabled('#goalUs')], ['1', true], 'Goal against by mistake: the score locks for 8 seconds');
  await p.click('#undo'); await p.run(300);
  eq([await p.text('#themN'), await p.page.isDisabled('#goalUs'), await p.page.evaluate(() => document.getElementById('dock').classList.contains('locked'))], ['0', false, false], 'Undo takes it off and unlocks the score at once');
  await p.click('#goalUs'); await p.click('#picker button[data-p]'); await p.click('#picker button[data-p="x"]'); await p.run(300);
  eq([await p.text('#usN'), await p.text('#themN')], ['1', '0'], 'so the right goal goes straight in');
  await p.run(9000);
  await p.click('#hlBtn'); await p.run(300); await p.page.evaluate(() => { const b = document.querySelector('#picker [data-p="x"]'); if (b) b.click(); }); await p.run(300);
  await p.click('#goalThem'); await p.run(300); await p.run(9000); // (a highlight taken back doesn't touch the lock)
  eq(await p.text('#themN'), '1', 'a goal against after the lock is over counts as normal');
  await finish(p);
}

// ---------- 4. A goal is timed from the tap on Goal
{
  const p = await setup(); await p.click('#go'); await p.run(2 * 60000);
  const tap = await p.now();
  await p.click('#goalUs'); await p.run(6000); // six seconds working out who scored
  await p.click('#picker button[data-p]'); await p.run(3000);
  await p.click('#picker button[data-p="x"]'); await p.run(300);
  const g = (await p.match()).events.filter((e) => !e.hl).pop();
  check(Math.abs(g.at - tap) < 1000, `the goal's time is when Goal was tapped, not nine seconds later (${(g.at - tap) / 1000} s)`);
  eq(g.min, 3, 'in the minute it went in');
  await p.run(9000);
  const tap2 = await p.now(); await p.click('#goalThem'); await p.run(300);
  const g2 = (await p.match()).events.filter((e) => !e.hl).pop();
  check(Math.abs(g2.at - tap2) < 1000, 'goal against, straight away, as before');
  await finish(p);
}

await w.close();
await done();
