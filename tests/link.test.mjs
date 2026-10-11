// Whole games played between the real phone app and the real watch logic (ios/App/Watch/MatchLogic.swift, compiled),
// joined by a stand-in for the link between them that behaves like the real one: the phone asleep in a pocket (its web
// app frozen, the phone itself still taking in and keeping what the watch sends), the watch out of reach, messages late
// or repeated, the phone app thrown out of memory, the watch app closed and reopened mid-game.
// Second by second it checks the watch still has the right time, phase and score, that every change buzzes once and
// on time, and at the end that the phone has recorded exactly the game that was played.
import { world, suite, ROOT } from './lib.mjs';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { check, eq, done } = suite('phone + watch: whole games');
let BIN = process.env.WATCHBRAIN;
if (!BIN) {
  BIN = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'watchbrain-')), 'watchbrain');
  execFileSync('swiftc', [path.join(ROOT, 'ios/App/Watch/MatchLogic.swift'), path.join(ROOT, 'tests/watch/cli/main.swift'), '-o', BIN], { stdio: 'inherit' });
}

class Brain {
  constructor() {
    this.proc = spawn(BIN); this.buf = ''; this.waiting = [];
    this.proc.stdout.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); this.waiting.shift()(JSON.parse(line)); } });
  }
  ask(cmd) { return new Promise((r) => { this.waiting.push(r); this.proc.stdin.write(JSON.stringify(cmd) + '\n'); }); }
  close() { this.proc.kill(); }
}
const rng = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (a, b) => a + Math.floor(f() * (b - a + 1)); return f; };
const w = await world();
/// The changes a game's plan asks for: [half, minute], in order. (The one at the very start of the second half is made by starting it.)
const changesOf = (m) => { const out = []; for (let i = 1; i < m.segs.length; i++) { const a = m.segs[i - 1], b = m.segs[i]; if (a.h !== b.h) continue; if (a.on.some((id) => b.bench.includes(id)) || b.on.some((id) => a.bench.includes(id))) out.push([b.h, b.from]); } return out; };

/// Plays one game.
///   o.asleep(k), o.down(k)   at second k, is the phone's web app frozen / the watch out of reach of the phone
///   o.wakeOnMessage          a message from the watch wakes the frozen app for a few seconds (iOS sometimes does)
///   o.reloadOnWake           chance that, on waking, the app has been thrown out of memory and starts from cold
///   o.loseLive               chance that the app, though awake, is not told of a press there and then (it is still kept by the phone)
///   o.relaunch               seconds at which the watch app is closed and reopened
///   o.onPhone, o.subsOnPhone whistles (and some changes) made on the phone instead of the watch
///   o.busy                   the phone is used during the game: a stoppage, a goal logged on it, a player off injured
///   o.format, o.squad        another kind of game
///   o.db                     the gaffer is signed in, as in real life: the game is saved to the (stand-in) database as it goes
///   o.offline(k)             …and at second k the phone has no signal
///   o.second(k)              a second gaffer has the app too; at second k their phone is asleep (it wakes with an old copy of the game)
/// `carry` continues on the same phone and watch straight after another game.
async function game(name, o, carry) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return null;
  const R = rng(o.seed || 1), skew = o.skew || 0;
  const W = o.db ? await world() : w;
  const p = carry ? carry.p : await W.phone({ native: true, db: !!o.db, label: 'gaffer' });
  const brain = carry ? carry.brain : new Brain(), page = p.page, fails = [];
  const bad = (what) => { if (fails.length < 6) fails.push(what); };
  let C = null;
  if (o.db) {
    await p.click('#createBtn'); await p.signUp('ethan@example.com');
    await page.fill('#tName', 'Sons of Pitches FC'); await page.fill('#tPlayers', (o.squad || ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac', 'Reece', 'Ethan']).join('\n')); await p.click('#tCreate'); await p.run(600);
    await p.click('#v-code [data-go="home"]');
    if (o.second) {
      C = await W.phone({ native: true, db: true, label: 'second gaffer' });
      await C.click('#acctBtn'); await C.signUp('co@example.com'); await C.click('#acctBtn'); await C.page.fill('#aOrgCode', W.db().teams[0].organiser_code); await C.click('#aOrgJoin'); await p.run(1500);
      check(W.db().team_members.length === 2, `${name}: the second gaffer has joined`);
    }
  } else if (!carry) await p.localTeam(o.squad); else if (await p.view() !== 'home') await p.click('#v-stats .back');
  await p.click('#mNew'); await page.fill('#opp', o.opp || 'Dog');
  if (o.format) {
    if (o.format.side === 7) await p.click('#gFmt [data-side="7"]');
    if (o.format.half) await page.fill('#gHalf', String(o.format.half));
    if (o.format.sub) await page.fill('#gSub', String(o.format.sub));
    if (o.format.one) await page.uncheck('#gTwo');
  }
  await p.click('#startGame'); await p.click('#kick');
  if (o.db) await p.run(2000); // the game reaches the database, and the second gaffer's phone
  const m0 = await p.match();
  if (!check(!!m0 && m0.phase === 'pre', `${name}: the game is set up`)) { brain.close(); await p.close(); return null; }
  const half = m0.half * 60, one = m0.periods === 1, base = await p.now();
  let cT = base, wasOff = false;
  let k = 0, pageT = base, wakeUntil = -1, latest = carry ? carry.latest : null, wasDown = false, end = 0;
  const userInfo = [], buzz = [], timeUp = [], goals = [];
  let expected = changesOf(m0).map(([h, from]) => `${h ? 'h2' : 'h1'} ${from}:00`);
  const truth = { phase: 'pre', base: 0, t0: 0, running: false, us: 0, them: 0, ko: 0, ht: 0, h2: 0, ft: 0 }; // the game as the referee saw it
  const now = () => base + k * 1000, wnow = () => now() + skew;
  const clockNow = () => (o.onPhone || o.busy ? now() : wnow()); // whose clock the whistles were timed by
  const secs = () => Math.floor((truth.base + (truth.running ? clockNow() - truth.t0 : 0)) / 1000);
  const inPlay = () => truth.phase === 'h1' || truth.phase === 'h2';
  const asleep = () => !!o.asleep && o.asleep(k) && k >= wakeUntil && !(end && k >= end - 45), down = () => !!o.down && o.down(k) && !(end && k >= end - 45);
  const label = (sec) => { const near = Math.round(sec / 60), off = sec - near * 60; return `${truth.phase} ${near}:00` + (Math.abs(off) <= 1 + (o.onPhone || o.busy ? 2 : 0) ? '' : ` (${off > 0 ? '+' : ''}${off}s)`); };
  let st = null; // the watch's view after its latest step

  const heard = async (a) => { st = a.state || st; if (a.due) buzz.push(label(secs())); if (a.timeUp) timeUp.push(label(secs())); for (const j of a.send || []) await fromWatch(j, false); };
  const toWatch = async (msg) => heard(await brain.ask({ op: 'receive', json: msg.state, sent: msg.sent, now: wnow() }));
  const collect = async () => { for (const msg of await p.watchTake()) { latest = msg; if (!down()) await toWatch(msg); } }; // whatever the phone app has just pushed
  const native = async (json, live) => { await page.evaluate(([j, l]) => window.__nativeGot(j, l), [json, live]); await collect(); };
  const wake = async () => {
    if (now() - pageT > 0) {
      await page.clock.fastForward(now() - pageT); pageT = now();
      if (o.reloadOnWake && R() < o.reloadOnWake) await page.reload(); // thrown out of memory while it slept: starts from cold
      await page.clock.runFor(350); pageT += 350;
    }
    await collect();
  };
  const atPhone = async (json) => { // a press has reached the iPhone: the phone keeps it whatever the web app is doing
    if (asleep()) { if (o.wakeOnMessage) { wakeUntil = k + 3; await wake(); await native(json, true); } else await native(json, false); }
    else await native(json, !(o.loseLive && R() < o.loseLive));
  };
  async function fromWatch(json, first) { // MatchModel.deliver
    if (!down()) { if (latest) await toWatch(latest); await atPhone(json); } // a live message: answered at once with the last thing the phone said, even if the app is frozen
    else if (first) userInfo.push(json); // queued by watchOS, delivered in order when back in reach
  }
  const press = async (op, extra) => { const a = await brain.ask(Object.assign({ op, now: wnow() }, extra || {})); st = a.state || st; for (const j of a.send || []) await fromWatch(j, true); if (a.due) buzz.push(label(secs())); return a; };
  const onPhone = async (sel) => { wakeUntil = Math.max(wakeUntil, k + 4); await wake(); const there = await page.isVisible(sel); if (there) await page.click(sel); await page.clock.runFor(200); pageT += 200; await collect(); return there; };
  const startHalf = (phase) => { truth.phase = phase; truth.base = 0; truth.t0 = clockNow(); truth.running = true; truth[phase === 'h1' ? 'ko' : 'h2'] = clockNow(); };
  const stopHalf = () => { const last = truth.phase === 'h2' || one; truth[last ? 'ft' : 'ht'] = clockNow(); truth.phase = last ? 'ft' : 'ht'; truth.running = false; truth.base = 0; confirmAt = -1; if (last) end = k + 60; };

  const extra = [R.int(4, 45), R.int(4, 45)], breakFor = R.int(50, 130), relaunch = new Set(o.relaunch || []);
  let confirmAt = -1, lastGoal = 0, pausedAt = -1, did = {};
  const once = (key) => (did[key] ? false : (did[key] = true));

  await collect();
  for (k = 0; k < 6000 && !(end && k > end); k++) {
    if (end && k >= end - 45) wakeUntil = end + 1; // the gaffer picks the phone up at the end
    // 1. the phone app: running, or frozen and falling behind
    if (!asleep()) { const d = now() - pageT; if (d > 1500) await wake(); else if (d > 0) { await page.clock.runFor(d); pageT = now(); } await collect(); }
    if (o.db) { // signal, and the live connection that drops while a phone sleeps
      const off = !!o.offline && o.offline(k) && !(end && k >= end - 45);
      if (off !== wasOff) { await page.evaluate((x) => { window.__offline = x; if (!x) window.dispatchEvent(new Event('online')); }, off); wasOff = off; }
      p.deaf(asleep());
      if (C) {
        const out = o.second(k) && !(end && k >= end - 45); C.deaf(out);
        if (!out) { const d = now() - cT; if (d > 1500) { await C.page.clock.fastForward(d); await C.page.clock.runFor(300); cT = now() + 300; } else if (d > 0) { await C.page.clock.runFor(d); cT = now(); } }
      }
    }
    // 2. the link coming back: queued presses arrive in order, and the phone's last word reaches the watch
    if (!down() && wasDown) { while (userInfo.length) await atPhone(userInfo.shift()); if (latest) await toWatch(latest); }
    wasDown = down();
    if (relaunch.has(k)) { await brain.ask({ op: 'relaunch' }); if (latest && !down()) await toWatch(latest); }

    // 3. the gaffer
    const sec = secs();
    if (truth.phase === 'pre' && k === 5) { if (o.onPhone) await onPhone('#go'); else await press('start'); startHalf('h1'); }
    else if (inPlay() && truth.running && sec >= half + extra[truth.phase === 'h2' ? 1 : 0]) { if (o.onPhone) { await onPhone('#subPopLater'); await onPhone('#endHalf'); } else await press('end'); stopHalf(); }
    else if (truth.phase === 'ht' && clockNow() >= truth.ht + breakFor * 1000) { if (o.onPhone) await onPhone('#go'); else await press('start'); startHalf('h2'); }
    if (o.busy && inPlay()) { // someone is using the phone while the game goes on
      const stop = truth.phase === 'h1' ? 200 : 100;
      if (truth.running && sec >= stop && once('pause' + truth.phase)) { await onPhone('#subPopLater'); await onPhone('#go'); truth.base += now() - truth.t0; truth.running = false; pausedAt = k; }
      else if (!truth.running && pausedAt >= 0 && k >= pausedAt + 20) { if (truth.phase === 'h2') await press('resume'); else await onPhone('#go'); truth.t0 = now(); truth.running = true; pausedAt = -1; } // (restarted on the phone in the first half, from the wrist in the second)
      else if (truth.running && sec >= (truth.phase === 'h1' ? 120 : 300) && now() - lastGoal >= 9000 && once('goal' + truth.phase)) {
        await onPhone('#subPopLater'); if (await onPhone('#goalThem')) { lastGoal = now(); goals.push({ us: false, p: null, at: null, min: (truth.phase === 'h2' ? m0.half : 0) + Math.min(m0.half, Math.floor(sec / 60) + 1) }); truth.them++; }
      } else if (truth.running && truth.phase === 'h1' && sec >= 430 && once('injury')) { // a player goes off hurt at 7:10
        await onPhone('#subPopLater'); await onPhone('#outBtn'); const who = (await p.match()).order[1];
        await onPhone(`#outPicker button[data-o="${who}"]`); if (!(await onPhone('#outPicker button.best'))) await onPhone('#outPicker button[data-yes]');
        const m = await p.match(); check(m.gone.includes(who), `${name}: the injured player is out`);
        expected = buzz.slice().concat(changesOf(m).filter(([h, from]) => h === 1 || from * 60 > sec).map(([h, from]) => `${h ? 'h2' : 'h1'} ${from}:00`));
      }
    }
    if (inPlay() && truth.running && R() < 1 / 190 && wnow() - lastGoal >= 9000 && sec < half + extra[truth.phase === 'h2' ? 1 : 0] - 2 && st && st.live) {
      const us = R() < 0.6, scorer = us && st.players.length ? st.players[R.int(0, st.players.length - 1)] : null;
      const a = await press('goal', us ? { us: true, p: scorer } : { us: false });
      if (a.send.length) { lastGoal = wnow(); goals.push({ us, p: scorer, at: wnow(), min: (truth.phase === 'h2' ? m0.half : 0) + Math.min(m0.half, Math.floor(sec / 60) + 1) }); truth[us ? 'us' : 'them']++; }
    }
    if (k === confirmAt) { if (o.subsOnPhone && R() < 0.5) await onPhone('#subPopDone'); else await press('subs'); confirmAt = -1; }

    // 4. the watch's own second
    const before = buzz.length;
    await heard(await brain.ask({ op: 'tick', now: wnow() }));
    if ((buzz.length > before || (st && st.due)) && confirmAt < 0 && inPlay()) confirmAt = k + R.int(3, 25);

    // 5. is the watch right, this second?
    if (st && truth.phase !== 'pre') {
      const settle = o.onPhone || o.busy ? 3 : 0; // something done on the phone takes a moment to reach the wrist
      const since = Math.min(...[truth.ko, truth.ht, truth.h2, truth.ft].map((t) => (t ? (clockNow() - t) / 1000 : 1e9)), pausedAt >= 0 ? k - pausedAt : 1e9, o.busy && truth.running ? (now() - truth.t0) / 1000 : 1e9);
      if (since >= settle) {
        if (st.phase !== truth.phase) bad(`second ${k}: the watch says ${st.phase}, the game is in ${truth.phase}`);
        else if (inPlay() && Math.abs(st.seconds - (secs() + (o.onPhone || o.busy ? Math.round(skew / 1000) : 0))) > 1) bad(`second ${k}: the watch clock reads ${st.seconds}s, should read ${secs()}s`);
        if ((st.us !== truth.us || st.them !== truth.them) && now() - lastGoal >= settle * 1000) bad(`second ${k}: the watch shows ${st.us}–${st.them}, the score is ${truth.us}–${truth.them}`);
        if (!st.live) bad(`second ${k}: the watch has lost the game`);
      }
    }
  }

  // the phone has been in hand, in reach, for the last 45 seconds
  const m = await p.match(), last = await brain.ask({ op: 'tick', now: wnow() });
  for (const f of fails) check(false, `${name}: ${f}`);
  check(fails.length === 0, `${name}: the watch had the right phase, clock and score at every second of the game`);
  eq(buzz, expected, `${name}: the wrist buzzed for each change, once, on the minute`);
  eq(timeUp, one ? [`h1 ${m0.half}:00`] : [`h1 ${m0.half}:00`, `h2 ${m0.half}:00`], `${name}: and for time up in each half`);
  if (!check(!!m, `${name}: the phone still has the game`)) { brain.close(); await p.close(); return null; }
  eq([m.phase, last.state.phase, last.pending, await p.inbox()], ['ft', 'ft', [], []], `${name}: both ended at full time with nothing left to send and nothing left waiting on the phone`);
  const tol = Math.abs(skew) + (o.onPhone || o.busy ? 1500 : 0), near = (a, b) => Math.abs(a - b) <= tol;
  check(near(m.koAt, truth.ko) && near(m.ftAt, truth.ft) && (one || (near(m.htAt, truth.ht) && near(m.h2At, truth.h2))), `${name}: the phone timed every whistle as it was blown (${[m.koAt - truth.ko, m.htAt - truth.ht, m.h2At - truth.h2, m.ftAt - truth.ft]} ms out)`);
  const got = m.events.filter((e) => !e.hl);
  eq(got.map((e, i) => [e.us, e.p ?? null, goals[i] && goals[i].at === null ? null : e.at, e.min]), goals.map((g) => [g.us, g.p, g.at, g.min]), `${name}: the phone recorded every goal, in order, with scorer, time and minute`);
  eq([last.state.us, last.state.them], [truth.us, truth.them], `${name}: final score on the watch`);
  const plan = changesOf(m), lastHalf = one ? 0 : 1, firstOfLast = m.segs.findIndex((s) => s.h === lastHalf);
  let confirmed = firstOfLast; m.segs.forEach((s, i) => { if (i > firstOfLast && plan.some(([h, from]) => h === s.h && from === s.from)) confirmed = i; });
  eq(m.ok, confirmed, `${name}: every change ended up confirmed on the phone`);
  await page.click('#finish'); await page.clock.runFor(100); await page.click('#finish'); await page.clock.runFor(1000); await collect();
  const t = await p.team(), r = t.results[t.results.length - 1];
  eq([!!r && r.opp, r && r.us, r && r.them, st.live, t.match], [o.opp || 'Dog', truth.us, truth.them, false, null], `${name}: the result is saved and the watch goes back to waiting`);
  if (o.db) { // signed in: the finished game is in the database, and on the second gaffer's phone
    for (let i = 0; i < 20; i++) { await page.clock.runFor(250); if (C) await C.page.clock.runFor(250); }
    const d = W.db(), g = d.games[0];
    eq([d.games.length, g && g.us, g && g.them, d.live_matches.length, d.game_events.filter((e) => e.kind !== 'highlight' && e.kind !== 'save').length], [1, truth.us, truth.them, 0, goals.length], `${name}: the finished game is in the database with every goal`);
    if (C) { const tc = await C.team(); eq([tc.results.length, tc.results[0] && tc.results[0].us, tc.match], [1, truth.us, null], `${name}: and on the second gaffer's phone`); for (const e of C.errs.splice(0)) check(false, `${name}: page error: ${e}`); await C.close(); }
  }
  if (process.env.DEBUG) console.log(`DEBUG ${name}: half ${m0.half} periods ${m0.periods} pitch ${m0.pitch} squad ${m0.squad.length} | buzz ${JSON.stringify(buzz)} | timeUp ${JSON.stringify(timeUp)} | goals ${goals.length} (${truth.us}-${truth.them}) | did ${Object.keys(did)} | gone ${m.gone} | segs ${m.segs.length} ok ${m.ok} | seconds ${k}`);
  for (const e of p.errs.splice(0)) check(false, `${name}: page error: ${e}`);
  return { p, brain, latest, W: o.db ? W : null };
}
const over = async (g) => { if (g) { g.brain.close(); await g.p.close(); if (g.W) await g.W.close(); } };

const quick = process.argv.includes('--quick');
await over(await game('everything in reach', { seed: 11 }));
await over(await game('phone frozen from kick-off to the last minute', { seed: 12, asleep: () => true }));
await over(await game('phone frozen but nudged awake by each message', { seed: 13, asleep: () => true, wakeOnMessage: true }));
await over(await game('phone frozen all game, then found thrown out of memory', { seed: 21, asleep: () => true, reloadOnWake: 1 }));
await over(await game('watch out of reach of the phone all game', { seed: 14, down: (k) => k > 3 }));
await over(await game('whistles and some changes made on the phone', { seed: 15, onPhone: true, subsOnPhone: true }));
await over(await game('watch app closed and reopened six times', { seed: 16, asleep: (k) => k % 400 < 300, relaunch: [8, 200, 330, 960, 1100, 1700] }));
await over(await game('clocks two seconds apart', { seed: 17, skew: 2000, asleep: (k) => k % 120 < 90 }));
await over(await game('phone awake but a third of the presses not passed on there and then', { seed: 18, loseLive: 0.34 }));
await over(await game('phone in use during the game: a stoppage, a goal logged on it, a player off injured', { seed: 19, busy: true }));
await over(await game('one period of 20 minutes, a change every 4', { seed: 22, format: { half: 20, sub: 4, one: true }, asleep: (k) => k % 300 < 200 }));
await over(await game('7-a-side, 2 × 20, squad of ten', { seed: 23, format: { side: 7, half: 20, sub: 5 }, squad: ['Keeper', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], down: (k) => k > 3 && k % 500 < 250 }));
// signed in, as tomorrow: the game saved to the database as it goes, with patchy signal and a second gaffer's phone about
await over(await game('signed in, phone in a pocket all game, no signal for most of it', { seed: 41, db: true, asleep: () => true, offline: (k) => k > 60 && k < 1700 }));
await over(await game('signed in, phone awake on the bench, signal coming and going', { seed: 42, db: true, offline: (k) => k % 240 > 120, loseLive: 0.2 }));
await over(await game('signed in, a second gaffer watching on their own phone', { seed: 43, db: true, second: () => false, asleep: (k) => k % 300 < 200 }));
await over(await game('signed in, the second gaffer\'s phone waking now and then with an old copy', { seed: 44, db: true, second: (k) => k % 400 < 340, asleep: (k) => k % 500 < 250, wakeOnMessage: true }));
await over(await game('signed in, thrown out of memory in a pocket, second gaffer waking after time up', { seed: 45, db: true, second: (k) => k < 960 || (k > 1100 && k < 2050), asleep: () => true, reloadOnWake: 1 }));
await over(await game('signed in, phone in use during the game, second gaffer about', { seed: 46, db: true, busy: true, second: (k) => k % 200 < 100 }));
{ // a tournament evening: three short games in a row on the same phone and watch
  let g = await game('first game of the evening', { seed: 31, format: { half: 10, sub: 5, one: true }, opp: 'Dog', asleep: () => true });
  if (g) g = await game('second game, straight after', { seed: 32, format: { half: 10, sub: 5, one: true }, opp: 'Cat', down: (k) => k > 3 && k < 400 }, g);
  if (g) g = await game('third game, straight after', { seed: 33, format: { half: 10, sub: 5, one: true }, opp: 'Fox', asleep: (k) => k > 3 && k % 200 < 150, wakeOnMessage: true }, g);
  await over(g);
}
if (!quick) for (let seed = 100; seed < 100 + (+process.env.EVENINGS || 6); seed++) { // rough evenings
  const A = rng(seed * 7), chunks = Array.from({ length: 80 }, () => [A() < 0.6, A() < 0.4]);
  await over(await game(`rough evening ${seed}`, { seed, asleep: (k) => k > 3 && chunks[Math.floor(k / 30) % 80][0], down: (k) => k > 3 && chunks[Math.floor(k / 30) % 80][1], // (in reach while the game is set up, or there is nothing on the watch to press)
    wakeOnMessage: seed % 2 === 0, reloadOnWake: seed % 3 === 0 ? 0.3 : 0, loseLive: seed % 4 === 0 ? 0.3 : 0, relaunch: [A.int(10, 800), A.int(900, 1900)], skew: A.int(-1500, 1500), subsOnPhone: seed % 3 === 0,
    db: seed % 2 === 1, offline: (k) => chunks[(Math.floor(k / 30) + 7) % 80][1], second: seed % 4 === 1 ? (k) => chunks[(Math.floor(k / 30) + 13) % 80][0] : null }));
}

await w.close();
await done();
