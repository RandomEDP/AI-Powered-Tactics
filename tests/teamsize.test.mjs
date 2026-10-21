// Any number a side, from 2 to 99, and at most 99 from one team in a game (Ethan, October 2026: "scale up any game for
// any amount of players, cap at 99 per team"). A squad of 30 plays 11-a-side with everyone in, the minutes and the watch
// work as for 5-a-side, the result keeps its side; a bigger squad can't put a 100th player in; the watch's message stays
// small enough to send whatever the squad.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: any team size');
const w = await world();
const squad = (n) => Array.from({ length: n }, (_, i) => 'Player ' + (i + 1));
const states = (p) => p.page.$$eval('#lineup .lrow', (rows) => rows.map((r) => (r.querySelector('.seg .is') || {}).textContent || 'GK'));
const count = (s) => ({ playing: s.filter((x) => x !== 'Out').length, out: s.filter((x) => x === 'Out').length });

// ---------- 1. A squad of 30, 11-a-side, everyone playing
{
  const p = await w.phone({ native: true }); await p.localTeam(squad(30));
  await p.click('#mNew'); await p.page.fill('#opp', 'Dog Squad');
  eq(await p.page.$$eval('#gFmt [data-side]', (b) => b.map((x) => x.textContent)), ['5-a-side', '7-a-side', '11-a-side'], 'the format has 5, 7 and 11-a-side to tap');
  eq([await p.page.inputValue('#gSide'), count(await states(p)).playing], ['5', 8], 'a new game is still 5-a-side with 8 picked, as before');
  await p.click('#gFmt [data-side="11"]');
  eq([await p.page.inputValue('#gSide'), count(await states(p)).playing], ['11', 14], '11-a-side picks 14 (the side and 3 subs)');
  check(/11-a-side, .*10 outfield and a keeper on the pitch\. Up to 99 in the squad for a game\./.test(await p.text('#gFmtNote')), 'and says so: ' + await p.text('#gFmtNote'));
  await p.page.fill('#gSide', '8'); await p.run(300);
  eq([await p.page.inputValue('#gSide'), count(await states(p)).playing, await p.page.$$eval('#gFmt [aria-pressed="true"]', (b) => b.length)], ['8', 11, 0], 'any number can be typed: 8-a-side picks 11 and no quick button is lit');
  await p.page.fill('#gSide', '11'); await p.run(300);
  for (let i = 0; i < 30; i++) { const st = await states(p); if (st[i] === 'Out') await p.click(`#lineup .lrow:nth-child(${i + 1}) [data-set="start"]`); }
  eq(count(await states(p)), { playing: 30, out: 0 }, 'all 30 can be put in');
  check(/30 playing: 11 on the pitch, 19 on the bench\./.test(await p.text('#lineMsg')), 'with 19 on the bench: ' + await p.text('#lineMsg'));
  check(!(await p.page.isDisabled('#startGame')), 'and the game can be set up');
  await p.click('#startGame');
  eq([await p.view(), /All the outfield minutes are handed out/.test(await p.text('#minsMsg'))], ['mins', true], 'the minutes plan works it out for everyone');
  await p.click('#kick');
  const m = await p.match();
  eq([m.pitch, m.squad.length, m.segs[0].on.length + (m.segs[0].gk != null ? 1 : 0), m.segs[0].bench.length], [11, 30, 11, 19], 'the game: 11 on, 30 in it, 19 on the bench');
  const got = new Set(); m.segs.forEach((s) => s.on.forEach((id) => { if (id !== m.keeper) got.add(id); }));
  eq(m.order.filter((id) => !got.has(id)), [], 'every outfield player gets on at some point (' + m.order.length + ' of them)');
  const wst = await p.watch();
  eq([wst.players.length, wst.players.filter((x) => x.on).length], [30, 11], 'the watch has all 30, with 11 on the pitch');
  check(JSON.stringify(wst).length < 48000, 'and its message is small enough to send (' + JSON.stringify(wst).length + ' characters)');
  await p.tap('#benchOk'); await p.tap('#go'); await p.run(15 * 60000); await p.tap('#endHalf'); await p.tap('#endHalf'); await p.run(500);
  await p.tap('#go'); await p.run(15 * 60000); await p.tap('#endHalf'); await p.tap('#endHalf'); await p.run(500);
  await p.tap('#finish'); await p.tap('#finish'); await p.run(1500);
  const t = await p.team(), r = t.results[t.results.length - 1];
  eq([!!t.match, r && r.side, r && Object.keys(r.per || {}).length], [false, 11, 30], 'finished: the result is kept as 11-a-side with all 30 in it');
  await p.tap('#mNew');
  eq(await p.page.inputValue('#gSide'), '11', 'and the next game starts as 11-a-side');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 2. 99 is the most from one team in a game
{
  const p = await w.phone({ native: true }); await p.localTeam(squad(101));
  await p.click('#mNew'); await p.page.fill('#opp', 'Everyone FC');
  await p.page.fill('#gSide', '60'); await p.run(300);
  eq(count(await states(p)).playing, 63, '60-a-side picks 63 to start');
  for (let i = 0; i < 99; i++) { const st = await states(p); if (st[i] === 'Out') await p.tap(`#lineup .lrow:nth-child(${i + 1}) [data-set="bench"]`); }
  eq(count(await states(p)).playing, 99, '99 can be put in');
  await p.tap('#lineup .lrow:nth-child(100) [data-set="start"]');
  eq(count(await states(p)).playing, 99, 'but not a 100th');
  check(/99 players is the most from one team in a game/.test(await p.text('#lineMsg')), 'and it says why: ' + await p.text('#lineMsg'));
  await p.page.fill('#gSide', '150'); await p.page.locator('#gSide').blur(); await p.run(300);
  eq(await p.page.inputValue('#gSide'), '99', 'a side over 99 comes back to 99');
  await p.page.fill('#gSide', '1'); await p.page.locator('#gSide').blur(); await p.run(300);
  eq(await p.page.inputValue('#gSide'), '2', 'and under 2 goes up to 2');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 3. The watch's message with the biggest game
{
  const p = await w.phone({ native: true }); await p.localTeam(squad(99).map((n) => n + ' Longsurname-Doublebarrel'));
  await p.click('#mNew'); await p.page.fill('#opp', 'Huge');
  await p.page.fill('#gSide', '50'); await p.run(300);
  for (let i = 0; i < 99; i++) { const st = await states(p); if (st[i] === 'Out') await p.tap(`#lineup .lrow:nth-child(${i + 1}) [data-set="bench"]`); }
  await p.tap('#lineup .lrow:nth-child(1) [data-gk]');
  await p.page.fill('#gSub', '1'); await p.run(300);
  await p.tap('#startGame'); await p.tap('#kick');
  const m = await p.match(), wst = await p.watch();
  eq([m.pitch, m.squad.length], [50, 99], '50-a-side with 99 in it');
  check(JSON.stringify(wst).length <= 48000, 'the watch\'s message stays under the limit (' + JSON.stringify(wst).length + ' characters)');
  check(wst.changes.length >= 3 && wst.changes[0].on.length > 0, 'and still has the next changes (' + wst.changes.length + ' of them)');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

// ---------- 4. A poll for 11-a-side, with more in it than fit on the pitch drawing
{
  const p = await w.phone({ db: true, native: true, label: 'gaffer' });
  await p.click('#createBtn'); await p.signUp('gaffer@example.com', 'gaffer_fc');
  await p.page.fill('#tName', 'Sons of Pitches FC'); await p.page.fill('#tPlayers', squad(20).join('\n')); await p.click('#tCreate'); await p.click('#v-code [data-go="home"]');
  await p.click('#fxCard [data-fx="new"]');
  eq([await p.page.inputValue('#pMax'), await p.page.getAttribute('#pMax', 'min'), await p.page.getAttribute('#pMax', 'max')], ['7', '4', '7'], 'a 5-a-side poll is as before: 7 outfield, from 4 to 7');
  await p.click('#pFmt [data-side="11"]');
  eq([await p.page.inputValue('#pMax'), await p.page.getAttribute('#pMax', 'min')], ['13', '10'], '11-a-side: 13 outfield to start (2 subs), at least 10');
  for (let i = 0; i < 5; i++) await p.click('#pMore');
  eq([await p.page.inputValue('#pMax'), await p.text('#pMaxN')], ['18', '18'], '+ goes on past the slider\'s end');
  check(/19 in the squad: one keeper and 18 outfield, so 8 subs\./.test(await p.text('#pMaxNote')), 'and says what that makes: ' + await p.text('#pMaxNote'));
  await p.page.fill('#pSide', '15'); await p.run(300);
  eq([await p.page.inputValue('#pMax'), await p.page.getAttribute('#pMax', 'min')], ['17', '14'], 'any side can be typed: 15-a-side, 17 outfield to start');
  await p.click('#pMore'); await p.click('#pMore');
  await p.page.fill('#pOpp', 'Dog Squad'); await p.page.fill('#pDate', '2026-10-20'); await p.page.fill('#pTime', '19:30'); await p.click('#pSave'); await p.run(800);
  let d = await p.db(); const f = d.fixtures[d.fixtures.length - 1];
  eq([f.side, f.max_outfield], [15, 19], 'the poll is saved as 15-a-side with 19 outfield');
  d.fixture_votes = squad(20).map((_, i) => ({ fixture_id: f.id, pid: i + 1, choice: i === 0 ? 'gk' : 'in', user_id: null })); w.setDb(d);
  await p.page.reload(); await p.run(3000); await p.tap('#tabs [data-tab="games"]'); await p.run(500);
  const card = await p.text('#gamesTrack .fxc');
  eq([await p.page.$$eval('#gamesTrack .fxc .pitchmap', (x) => x.length), await p.page.$$eval('#gamesTrack .fxc .chip.on', (x) => x.length)], [0, 15], 'with 15 starting it\'s a list of the 15 (keeper included), no pitch drawing');
  check(/Bench/.test(card), 'and the rest on the bench');
  await p.click('#gamesTrack .fxc [data-bench="2"]'); await p.run(500);
  eq(await p.page.$$eval('#gamesTrack .fxc .chip.on', (x) => x.length), 14, 'the gaffer taps a starter to send them to the bench');
  p.errs.forEach((e) => check(false, 'page error: ' + e)); await p.close();
}

await done();
