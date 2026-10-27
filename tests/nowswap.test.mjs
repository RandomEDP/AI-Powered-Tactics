// Changing who's on during a game (Ethan: "we should just be able to edit who's playing mid game really easily and then
// quickly recalculate mins down below, while also showing mins currently playing"). Tap a name under Right now: someone
// on the pitch (who comes on for them?), someone on the bench (who comes off?) or the keeper (who goes in goal?). The
// change is made from that minute, the rest of the plan is reworked so minutes stay even, and the minutes table shows
// what everyone has played so far (ticking) and what they'll end on. The watch is told straight away.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: change who\'s on now');
const w = await world();
const finish = async (p) => { p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close(); };
const mins = (m) => { const r = {}; m.squad.forEach((id) => { r[id] = 0; }); m.segs.forEach((s) => { const d = s.to - s.from; [s.gk].concat(s.on).filter((x) => x != null).forEach((id) => { r[id] += d; }); }); return r; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const segAt = (m, h, t) => { let i = -1; m.segs.forEach((s, k) => { if (s.h === h && s.from <= t) i = k; }); return m.segs[i]; };
const nameOf = async (p, id) => (await p.team()).players.find((x) => x.id === id).name;
const row = async (p, name) => p.page.$$eval('#minsLive tbody tr', (rs, n) => { const r = rs.find((x) => x.querySelector('.who').textContent.replace(' (GK)', '') === n); return r ? [...r.querySelectorAll('td')].map((td) => td.textContent) : null; }, name);
const start = async () => { const p = await w.phone({ native: true }); await p.localTeam(); await p.newGame(); return p; };

// ---------- 1. Mid-stretch: someone on the pitch comes off, someone from the bench goes on
{
  const p = await start(); await p.click('#go'); await p.run(2 * 60000 + 30000); // 2:30 played
  let m = await p.match(); const plan = mins(m), s0 = m.segs[0];
  const X = s0.on[0], Y = s0.bench[0], xn = await nameOf(p, X), yn = await nameOf(p, Y);
  check(await p.visible('#nowHint') && /Tap a name to change who’s on now/.test(await p.text('#nowHint')), 'the gaffer is told they can tap a name');
  eq(await p.page.$$eval('#minsLive tbody tr', (r) => r.length), m.squad.length, 'the minutes table has everyone in it');
  eq((await row(p, xn)).slice(1), ['2:30', String(plan[X])], `${xn}: 2:30 played so far and ${plan[X]} planned by full time`);
  eq((await row(p, yn))[1], '0:00', `${yn} on the bench: nothing played yet`);

  await p.click(`#pitchNow button[data-now="${X}"]`);
  check(await p.visible('#nowPick .picker'), 'tapping someone on the pitch opens a sheet');
  eq(await p.text('#nowPick strong'), `Who comes on for ${xn}?`, 'asking who comes on for them');
  const offered = await p.page.$$eval('#nowPick button[data-np]', (b) => b.map((x) => +x.getAttribute('data-np')));
  eq(offered.slice().sort(), s0.bench.slice().sort(), 'offering everyone on the bench');
  check(await p.visible('#nowPick button.best'), 'with the one with the fewest minutes picked out');
  await p.click(`#nowPick button[data-np="${Y}"]`);

  m = await p.match(); const now = segAt(m, 0, 2);
  eq([m.segs[0].to, now.from, now.on.includes(Y), now.bench.includes(X)], [2, 2, true, true], `${yn} is on for ${xn} from the second minute`);
  const ci = m.segs.indexOf(now);
  eq([m.ok, await p.visible('#subPop'), (await p.watch()).due], [ci, false, false], 'the change is made there and then: nothing waits for Subs done');
  check((await p.text('#pitchNow')).includes(yn) && !(await p.text('#pitchNow')).includes(xn), 'the line-up on screen shows it');
  check(/is on for .* now\. The plan below is worked out again/.test(await p.text('#noticeText')), `the notice says so: "${await p.text('#noticeText')}"`);
  const after = mins(m);
  eq(sum(after), sum(plan), 'the minutes still add up to the whole game');
  check(Object.keys(plan).every((id) => Math.abs(after[id] - plan[id]) <= 3), `nobody ends more than 3 minutes off their plan (${Object.keys(plan).map((id) => after[id] - plan[id]).join(', ')})`);
  const ws = await p.watch();
  check(ws.players.find((x) => x.id === Y).on && !ws.players.find((x) => x.id === X).on, 'the watch is told who is on now');
  check(ws.changes.length && ws.changes[0].from >= 5, 'and its next change is still to come');
  const back = ws.changes[0];
  check(!(back.on.includes(xn) && back.off.includes(yn)), `${xn} doesn't come straight back on for ${yn} at the next change`);

  await p.run(30000); // 3:00
  eq([(await row(p, xn))[1], (await row(p, yn))[1]], ['2:00', '1:00'], 'the minutes tick on for whoever is on, and stop for whoever came off');
  await finish(p);
}

// ---------- 2. Tapping someone on the bench: who comes off for them? Most minutes first. Then Undo.
{
  const p = await start(); await p.click('#go'); await p.run(60000 + 10000);
  let m = await p.match(); const segsBefore = JSON.stringify(m.segs), Y = m.segs[0].bench[1], yn = await nameOf(p, Y);
  await p.click(`#benchNow button[data-now="${Y}"]`);
  eq(await p.text('#nowPick strong'), `Who comes off for ${yn}?`, 'tapping someone on the bench asks who comes off');
  const offered = await p.page.$$eval('#nowPick button[data-np]', (b) => b.map((x) => +x.getAttribute('data-np')));
  eq(offered.slice().sort(), m.segs[0].on.slice().sort(), 'offering the outfield players on the pitch (never the keeper)');
  await p.click('#nowPick button.best');
  m = await p.match();
  check(segAt(m, 0, 1).on.includes(Y), `${yn} is on`);
  check(await p.visible('#noticeUndo'), 'the notice offers Undo');
  await p.click('#noticeUndo');
  m = await p.match();
  eq([JSON.stringify(m.segs), m.ok, await p.visible('#notice')], [segsBefore, 0, false], 'Undo puts the plan back exactly as it was');
  // Cancel and a pull down close the sheet without changing anything
  await p.click(`#benchNow button[data-now="${Y}"]`); await p.click('#nowPick button[data-cancel]');
  eq([await p.visible('#nowPick .picker'), JSON.stringify((await p.match()).segs)], [false, segsBefore], 'Cancel changes nothing');
  await finish(p);
}

// ---------- 3. A new keeper for the rest of the game
{
  const p = await start(); await p.click('#go'); await p.run(6 * 60000);
  await p.click('#subPopDone');
  let m = await p.match(); const K = m.segs[m.ok].gk, G = m.segs[m.ok].on[1], kn = await nameOf(p, K), gn = await nameOf(p, G);
  await p.click(`#pitchNow button[data-now="${K}"]`);
  eq(await p.text('#nowPick strong'), `Who goes in goal instead of ${kn}?`, 'tapping the keeper asks who goes in goal');
  await p.click(`#nowPick button[data-np="${G}"]`);
  m = await p.match(); const now = segAt(m, 0, 6), from = m.segs.indexOf(now);
  check(m.segs.slice(from).every((s) => s.gk === G), `${gn} is in goal from the sixth minute to the end`);
  check(now.on.includes(K), `${kn} takes ${gn}'s place on the pitch`);
  check(m.segs.slice(0, from).every((s) => s.gk === K), 'the minutes already played in goal stay with ' + kn);
  eq(m.keeper, G, 'the game\'s keeper is now ' + gn);
  check((await p.watch()).players.find((x) => x.id === G).gk, 'the watch knows the new keeper');
  check((await p.text('#pitchNow')).includes(gn + ' (GK)'), 'and so does the screen');
  eq(sum(mins(m)), m.segs.reduce((a, s) => a + (s.to - s.from) * (1 + s.on.length), 0), 'minutes still add up');
  await finish(p);
}

// ---------- 4. Before kick-off it changes who starts; while a change is due it waits for Subs done
{
  const p = await start(); await p.click('#benchOk');
  let m = await p.match(); const n = m.segs.length, X = m.segs[0].on[0], Y = m.segs[0].bench[0], yn = await nameOf(p, Y), xn = await nameOf(p, X);
  await p.click(`#pitchNow button[data-now="${X}"]`); await p.click(`#nowPick button[data-np="${Y}"]`);
  m = await p.match();
  eq([m.segs.length, m.segs[0].on.includes(Y), m.segs[0].bench.includes(X), m.phase], [n, true, true, 'pre'], `${yn} starts instead of ${xn}`);
  check((await p.text('#noticeText')).startsWith(`${yn} starts instead of ${xn}.`), 'the notice says so');
  check(!(await p.watch()).players.find((x) => x.id === X).on, 'the watch has the new line-up');
  await p.click('#go'); await p.run(5 * 60000 + 2000);
  eq(await p.page.$$eval('#pitchNow button[data-now]', (b) => b.length), 0, 'with a change due, the names can\'t be tapped');
  check(/A change is due\. Tap Subs done first/.test(await p.text('#nowHint')), 'and it says to tap Subs done first');
  await p.click('#subPopDone');
  check(await p.page.$$eval('#pitchNow button[data-now]', (b) => b.length) > 0, 'once it\'s made they can be tapped again');
  await finish(p);
}

// ---------- 5. Full time: the minutes played are the minutes saved
{
  const p = await start(); await p.click('#go'); await p.run(3 * 60000 + 15000);
  let m = await p.match(); const X = m.segs[0].on[2], Y = m.segs[0].bench[2];
  await p.click(`#pitchNow button[data-now="${X}"]`); await p.click(`#nowPick button[data-np="${Y}"]`);
  m = await p.match(); const plan = mins(m);
  await p.run(2 * 60000); if (await p.visible('#subPopDone')) await p.click('#subPopDone');
  const shown = await p.page.$$eval('#minsLive tbody tr', (rs) => rs.map((r) => r.querySelectorAll('td')[1].textContent));
  eq(shown.length, m.squad.length, 'everyone is in the table');
  const total = shown.reduce((a, t) => { const [mm, ss] = t.split(':').map(Number); return a + mm * 60 + ss; }, 0);
  const [pm, ps] = (await p.text('#played')).split(' ')[0].split(':').map(Number), clock = pm * 60 + ps;
  check(Math.abs(total - clock * 5) <= 5, `five on the pitch all along: ${total} seconds played between them in ${clock} seconds`);
  eq(Object.values(plan).reduce((a, b) => a + b, 0), 30 * 5, 'the plan still fills every place for 30 minutes');
  await finish(p);
}

// ---------- 6. A swap reaches a teammate following the game, who sees the minutes but can't change anything
{
  const A = await w.phone({ db: true, native: true, label: 'gaffer' });
  await A.click('#createBtn'); await A.signUp('gaffer@example.com');
  await A.page.fill('#tName', 'Sunday Strikers'); await A.page.fill('#tPlayers', 'Keeper\nAce\nBen\nCal\nDan\nEd\nFin\nGus'); await A.click('#tCreate'); await A.run(600);
  const code = await A.text('#codeBig');
  await A.click('#v-code [data-go="home"]'); await A.newGame(); await A.run(1500);
  await A.click('#go'); await A.run(60000 + 20000);
  const B = await w.phone({ db: true, label: 'follower' });
  await B.page.fill('#joinCode', code.toLowerCase()); await B.click('#joinBtn'); await B.run(500); await B.click('#jFollow'); await B.run(800);
  await B.click('#mResume'); await B.run(500);
  let m = await A.match(); const X = m.segs[0].on[0], Y = m.segs[0].bench[0], yn = await nameOf(A, Y);
  await A.click(`#pitchNow button[data-now="${X}"]`); await A.click(`#nowPick button[data-np="${Y}"]`); await A.run(1500);
  check(segAt(w.db().live_matches[0].state, 0, 1).on.includes(Y), 'the change goes up with the live game');
  await B.run(21000);
  check((await B.text('#pitchNow')).includes(yn), `the follower's phone shows ${yn} on`);
  eq([await B.page.$$eval('#pitchNow button[data-now], #benchNow button[data-now]', (b) => b.length), await B.visible('#nowHint')], [0, false], 'but its names can\'t be tapped');
  eq(await B.page.$$eval('#minsLive tbody tr', (r) => r.length), 8, 'and it sees everyone\'s minutes');
  await finish(B); await finish(A);
}

// ---------- 7. Lots of changes through a whole game: the plan always stays a proper plan
{
  const p = await start(); await p.click('#go');
  let seed = 7; const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); };
  let bad = [], made = 0;
  for (let k = 0; k < 24; k++) {
    await p.run(40000 + rnd(50000));
    if (await p.visible('#subPopDone')) await p.click('#subPopDone');
    let m = await p.match();
    if (m.phase === 'ht') { await p.click('#go'); m = await p.match(); }
    if (m.phase !== 'h1' && m.phase !== 'h2') break;
    const btns = await p.page.$$eval('#pitchNow button[data-now], #benchNow button[data-now]', (b) => b.map((x) => +x.getAttribute('data-now')));
    if (!btns.length) continue;
    await p.click(`button[data-now="${btns[rnd(btns.length)]}"]`);
    const c = await p.page.$$eval('#nowPick button[data-np]', (b) => b.map((x) => +x.getAttribute('data-np')));
    if (!c.length) { await p.click('#nowPick button[data-cancel]'); continue; }
    await p.click(`#nowPick button[data-np="${c[rnd(c.length)]}"]`); made++;
    m = await p.match();
    m.segs.forEach((s, i) => {
      const all = [s.gk].concat(s.on, s.bench).filter((x) => x != null);
      if (new Set(all).size !== all.length || all.length !== m.squad.length - m.gone.length) bad.push(`stretch ${i}: someone twice or missing`);
      if (s.on.length + (s.gk != null ? 1 : 0) !== m.pitch) bad.push(`stretch ${i}: ${s.on.length} outfield`);
      if (s.from > s.to || (m.segs[i + 1] && m.segs[i + 1].h === s.h && m.segs[i + 1].from !== s.to)) bad.push(`stretch ${i}: times don't join up`);
    });
    const ws = await p.watch(), on = ws.players.filter((x) => x.on).map((x) => x.id).sort();
    const now = m.segs[m.ok]; const want = [now.gk].concat(now.on).filter((x) => x != null).sort();
    if (JSON.stringify(on) !== JSON.stringify(want)) bad.push(`change ${made}: the watch has a different line-up`);
    if (await p.visible('#subPop')) bad.push(`change ${made}: a change was left waiting`);
  }
  check(made >= 12, `${made} changes made through the game`);
  eq(bad, [], 'every stretch has everyone once, the right number on, the times joined up, and the watch agrees each time');
  await finish(p);
}

await w.close();
done();
