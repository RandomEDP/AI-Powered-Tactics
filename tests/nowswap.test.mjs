// Changing who's on during a game (Ethan: "we should just be able to edit who's playing mid game really easily and then
// quickly recalculate mins down below, while also showing mins currently playing"), then (10 November 2026) "a clearer
// change team button which brings up like a list of buttons of who's playing and highlight the 4 on field (keeper
// different button)". Change team under Right now opens a sheet: the keeper on a button of their own, everyone else as a
// button with the ones on the pitch picked out (as many as the game has a side, not always 4). The change is made from
// that minute, the rest of the plan is reworked so minutes stay even, and the minutes table shows what everyone has
// played so far (ticking) and what they'll end on. The watch is told straight away.
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
const picked = async (p) => p.page.$$eval('#nowPick button[data-tp].sel', (b) => b.map((x) => +x.getAttribute('data-tp')).sort((a, b) => a - b));
// Change team: G in goal (if given), `off` taken off and `on` put on, then Make the change
const change = async (p, { off = [], on = [], gk } = {}) => {
  await p.click('#teamBtn');
  if (gk != null) { await p.click('#nowPick button[data-tgkopen]'); await p.click(`#nowPick button[data-tgk="${gk}"]`); }
  for (const id of off) await p.click(`#nowPick button[data-tp="${id}"]`);
  for (const id of on) await p.click(`#nowPick button[data-tp="${id}"]`);
  await p.click('#teamDone');
};

// ---------- 1. Mid-stretch: someone on the pitch comes off, someone from the bench goes on
{
  const p = await start(); await p.click('#go'); await p.run(2 * 60000 + 30000); // 2:30 played
  let m = await p.match(); const plan = mins(m), s0 = m.segs[0];
  const X = s0.on[0], Y = s0.bench[0], xn = await nameOf(p, X), yn = await nameOf(p, Y), kn = await nameOf(p, s0.gk);
  check(await p.visible('#teamBtn') && (await p.text('#teamBtn')) === 'Change team', 'the gaffer has a Change team button under Right now');
  eq(await p.page.$$eval('#pitchNow button, #benchNow button', (b) => b.length), 0, 'the names themselves are just names now');
  eq(await p.page.$$eval('#minsLive tbody tr', (r) => r.length), m.squad.length, 'the minutes table has everyone in it');
  eq((await row(p, xn)).slice(1), ['2:30', String(plan[X])], `${xn}: 2:30 played so far and ${plan[X]} planned by full time`);
  eq((await row(p, yn))[1], '0:00', `${yn} on the bench: nothing played yet`);

  await p.click('#teamBtn');
  check(await p.visible('#nowPick .picker'), 'Change team opens a sheet');
  eq(await p.text('#nowPick strong'), 'Change team', 'called Change team');
  const listed = await p.page.$$eval('#nowPick button[data-tp]', (b) => b.map((x) => +x.getAttribute('data-tp')).sort((a, b) => a - b));
  eq(listed, s0.on.concat(s0.bench).sort((a, b) => a - b), 'a button for everyone playing but the keeper');
  eq(await picked(p), s0.on.slice().sort((a, b) => a - b), `the ${s0.on.length} on the pitch are picked out`);
  check((await p.text('#nowPick button[data-tgkopen]')).includes(kn) && await p.page.$eval('#nowPick button[data-tgkopen]', (b) => b.classList.contains('gkp')), `${kn} the keeper has a button of their own`);
  check((await p.text(`#nowPick button[data-tp="${X}"]`)).includes('2:30'), 'with the minutes played next to each name');
  eq(await p.page.$eval('#teamDone', (b) => b.disabled), true, 'Make the change waits until something changes');
  await p.click(`#nowPick button[data-tp="${X}"]`);
  eq([await p.text('#teamCount'), await p.page.$eval('#teamDone', (b) => b.disabled)], ['Pick 1 more', true], `taking ${xn} off asks for one more`);
  await p.click(`#nowPick button[data-tp="${Y}"]`);
  eq([await p.text('#teamCount'), await p.page.$eval('#teamDone', (b) => b.disabled)], [`${s0.on.length} on the pitch`, false], `putting ${yn} on makes it up`);
  await p.click('#teamDone');
  check(!(await p.visible('#nowPick .picker')), 'the sheet closes');

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
  const ticked = [(await row(p, xn))[1], (await row(p, yn))[1]]; // (a second either way: the taps on the sheet take real time)
  check(ticked[0] === '2:00' && /^(0:59|1:00|1:01)$/.test(ticked[1]), `the minutes tick on for whoever is on, and stop for whoever came off (${ticked})`);
  await finish(p);
}

// ---------- 2. Two changed at once, then Undo
{
  const p = await start(); await p.click('#go'); await p.run(60000 + 10000);
  let m = await p.match(); const segsBefore = JSON.stringify(m.segs), s0 = m.segs[0];
  const [X1, X2] = s0.on, [Y1, Y2] = s0.bench, names = {};
  for (const id of [X1, X2, Y1, Y2]) names[id] = await nameOf(p, id);
  await change(p, { off: [X1, X2], on: [Y1, Y2] });
  m = await p.match(); const now = segAt(m, 0, 1);
  check(now.on.includes(Y1) && now.on.includes(Y2) && now.bench.includes(X1) && now.bench.includes(X2), 'both changes are made from this minute');
  check(/ are on for .* now\./.test(await p.text('#noticeText')), `the notice says who's on for who: "${await p.text('#noticeText')}"`);
  eq(sum(mins(m)), sum(mins(JSON.parse(JSON.stringify({ ...m, segs: JSON.parse(segsBefore) })))), 'the minutes still add up');
  check(await p.visible('#noticeUndo'), 'the notice offers Undo');
  await p.click('#noticeUndo');
  m = await p.match();
  eq([JSON.stringify(m.segs), m.ok, await p.visible('#notice')], [segsBefore, 0, false], 'Undo puts the plan back exactly as it was');
  // Cancel closes the sheet without changing anything, even with names tapped
  await p.click('#teamBtn'); await p.click(`#nowPick button[data-tp="${Y1}"]`); await p.click('#nowPick button[data-cancel]');
  eq([await p.visible('#nowPick .picker'), JSON.stringify((await p.match()).segs)], [false, segsBefore], 'Cancel changes nothing');
  await finish(p);
}

// ---------- 3. A new keeper for the rest of the game
{
  const p = await start(); await p.click('#go'); await p.run(6 * 60000);
  await p.click('#subPopDone');
  let m = await p.match(); const K = m.segs[m.ok].gk, G = m.segs[m.ok].on[1], kn = await nameOf(p, K), gn = await nameOf(p, G);
  await p.click('#teamBtn'); await p.click('#nowPick button[data-tgkopen]');
  eq(await p.text('#nowPick strong'), 'Who goes in goal?', 'the keeper\'s button asks who goes in goal');
  await p.click(`#nowPick button[data-tgk="${G}"]`);
  check((await p.text('#nowPick button[data-tgkopen]')).includes(gn), `${gn} is on the keeper's button`);
  check((await picked(p)).includes(K) && !(await picked(p)).includes(G), `and ${kn} takes ${gn}'s place on the pitch in the list`);
  await p.click('#teamDone');
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
  await change(p, { off: [X], on: [Y] });
  m = await p.match();
  eq([m.segs.length, m.segs[0].on.includes(Y), m.segs[0].bench.includes(X), m.phase], [n, true, true, 'pre'], `${yn} starts instead of ${xn}`);
  check((await p.text('#noticeText')).startsWith(`${yn} starts instead of ${xn}.`), 'the notice says so');
  check(!(await p.watch()).players.find((x) => x.id === X).on, 'the watch has the new line-up');
  await p.click('#go'); await p.run(5 * 60000 + 2000);
  eq(await p.page.$eval('#teamBtn', (b) => b.disabled), true, 'with a change due, Change team waits');
  check(/A change is due\. Tap Subs done first/.test(await p.text('#nowHint')), 'and it says to tap Subs done first');
  await p.click('#subPopDone');
  eq([await p.page.$eval('#teamBtn', (b) => b.disabled), await p.visible('#nowHint')], [false, false], 'once it\'s made it can be used again');
  await finish(p);
}

// ---------- 5. Full time: the minutes played are the minutes saved
{
  const p = await start(); await p.click('#go'); await p.run(3 * 60000 + 15000);
  let m = await p.match(); const X = m.segs[0].on[2], Y = m.segs[0].bench[2];
  await change(p, { off: [X], on: [Y] });
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
  await change(A, { off: [X], on: [Y] }); await A.run(1500);
  check(segAt(w.db().live_matches[0].state, 0, 1).on.includes(Y), 'the change goes up with the live game');
  await B.run(21000);
  check((await B.text('#pitchNow')).includes(yn), `the follower's phone shows ${yn} on`);
  eq([await B.visible('#teamBtn'), await B.visible('#nowHint')], [false, false], 'but it has no Change team');
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
    if (await p.page.$eval('#teamBtn', (b) => b.disabled)) continue;
    await p.click('#teamBtn');
    if (rnd(4) === 0) { // a new keeper now and then
      await p.click('#nowPick button[data-tgkopen]');
      const g = await p.page.$$eval('#nowPick button[data-tgk]:not(.sel)', (b) => b.map((x) => +x.getAttribute('data-tgk')));
      await p.click(`#nowPick button[data-tgk="${g[rnd(g.length)]}"]`);
    }
    // one to three swaps: tap some picked out, then as many not picked out
    const pk = await picked(p), off = await p.page.$$eval('#nowPick button[data-tp]:not(.sel)', (b) => b.map((x) => +x.getAttribute('data-tp')));
    const k = Math.min(1 + rnd(3), pk.length, off.length);
    for (let i = 0; i < k; i++) { await p.click(`#nowPick button[data-tp="${pk.splice(rnd(pk.length), 1)[0]}"]`); await p.click(`#nowPick button[data-tp="${off.splice(rnd(off.length), 1)[0]}"]`); }
    if (await p.page.$eval('#teamDone', (b) => b.disabled)) { await p.click('#nowPick button[data-cancel]'); continue; }
    await p.click('#teamDone'); made++;
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

// ---------- 8. In the sin bin: one fewer to pick, and the player in it isn't offered
{
  const p = await start(); await p.click('#go'); await p.run(60000 + 5000);
  let m = await p.match(); const X = m.segs[0].on[0];
  await p.click('#binBtn'); await p.click(`#binPick button[data-bin="${X}"]`);
  m = await p.match(); const s = m.segs[m.ok];
  await p.click('#teamBtn');
  eq((await picked(p)).length, s.on.length, `${s.on.length} picked out while one is in the sin bin`);
  eq(await p.page.$$eval(`#nowPick button[data-tp="${X}"], #nowPick button[data-tgk="${X}"]`, (b) => b.length), 0, 'the player in the sin bin isn\'t on the list');
  await p.click('#nowPick button[data-cancel]');
  await finish(p);
}

// ---------- 9. Seven a side: six picked out (the side less the keeper), not four
{
  const p = await w.phone({ native: true }); await p.localTeam(Array.from({ length: 10 }, (_, i) => 'Player ' + (i + 1)));
  await p.click('#mNew'); await p.page.fill('#opp', 'Dog Squad'); await p.click('#gFmt [data-side="7"]');
  await p.click('#startGame'); await p.click('#kick'); await p.click('#benchOk');
  const m = await p.match(); eq(m.pitch, 7, 'a 7-a-side game');
  await p.click('#teamBtn');
  eq([(await picked(p)).length, await p.page.$$eval('#nowPick button[data-tgkopen]', (b) => b.length)], [6, 1], 'six outfield players picked out, with the keeper on a button of their own');
  await p.click('#nowPick button[data-cancel]');
  await finish(p);
}

await w.close();
done();
