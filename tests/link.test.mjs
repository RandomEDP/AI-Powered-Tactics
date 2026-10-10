// Whole games played between the real phone app and the real watch logic (ios/App/Watch/MatchLogic.swift, compiled),
// joined by a stand-in for the link between them that behaves like the real one: the phone asleep in a pocket, the
// watch out of reach, messages late or repeated, the watch app closed and reopened mid-game.
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

/// Plays one game. `o.asleep(k)` and `o.down(k)` say whether, at second k, the phone app is frozen and the watch is out of reach.
async function game(name, o) {
  const R = rng(o.seed || 1), skew = o.skew || 0;
  const p = await w.phone({ native: true }); await p.localTeam(); await p.newGame();
  const page = p.page, brain = new Brain(), fails = [];
  const bad = (what) => { if (fails.length < 6) fails.push(what); };
  const base = await p.now();
  let k = 0, pageT = base, wakeUntil = -1, latest = null, ctxSent = 0, wasDown = false;
  const native = [], userInfo = [], buzz = [], timeUp = [], goals = [];
  let end = 1e9;
  const truth = { phase: 'pre', start: 0, us: 0, them: 0, ko: 0, ht: 0, h2: 0, ft: 0 }; // by the watch's clock
  const now = () => base + k * 1000, wnow = () => now() + skew;
  const asleep = () => !!o.asleep && o.asleep(k) && k >= wakeUntil, down = () => !!o.down && o.down(k) && k < end - 45;
  let st = null; // the watch's view after its latest step

  const heard = async (a) => { st = a.state || st; if (a.due) buzz.push([truth.phase, Math.round((wnow() - truth.start) / 1000)]); if (a.timeUp) timeUp.push([truth.phase, Math.round((wnow() - truth.start) / 1000)]); for (const j of a.send || []) await fromWatch(j, false); };
  const toWatch = async (m) => heard(await brain.ask({ op: 'receive', json: m.state, sent: m.sent, now: wnow() }));
  const collect = async () => { // whatever the phone app has just pushed
    for (const m of await p.watchTake()) { latest = m; if (!down()) { ctxSent = m.sent; await toWatch(m); } }
  };
  const intoApp = async (json) => { await page.evaluate((e) => window.__t.watchCb({ event: e }), json); await collect(); };
  const wake = async () => { if (now() - pageT > 0) { await page.clock.fastForward(now() - pageT); pageT = now(); await page.clock.runFor(50); pageT += 50; } while (native.length) await intoApp(native.shift()); await collect(); };
  const atPhone = async (json) => { // a message has reached the iPhone
    if (asleep()) { if (o.wakeOnMessage) { wakeUntil = k + 3; await wake(); await intoApp(json); } else native.push(json); } else await intoApp(json);
  };
  async function fromWatch(json, first) { // MatchModel.deliver
    if (!down()) { if (latest) await toWatch(latest); await atPhone(json); } // a live message: answered at once with the last thing the phone said, even if the app is frozen
    else if (first) userInfo.push(json); // queued by watchOS, delivered in order when back in reach
  }
  const press = async (op, extra) => { const a = await brain.ask(Object.assign({ op, now: wnow() }, extra || {})); st = a.state || st; for (const j of a.send || []) await fromWatch(j, true); if (a.due) buzz.push([truth.phase, Math.round((wnow() - truth.start) / 1000)]); return a; };
  const onPhone = async (sel) => { wakeUntil = k + 4; await wake(); if (await page.isVisible(sel)) await page.click(sel); await page.clock.runFor(200); pageT += 200; await collect(); };

  // the gaffer's plan for the evening
  const half = 900, plan = { ko: 5, ht: 0, h2: 0, ft: 0 };
  plan.ht = plan.ko + half + R.int(4, 45); plan.h2 = plan.ht + R.int(50, 130); plan.ft = plan.h2 + half + R.int(4, 45); end = plan.ft + 60;
  const goalAt = new Set(); for (let g = 0, t = plan.ko + 20; g < 9; g++) { t += R.int(40, 260); if ((t > plan.ko && t < plan.ht - 2) || (t > plan.h2 && t < plan.ft - 2)) goalAt.add(t); }
  const relaunch = new Set(o.relaunch || []);
  let confirmAt = -1;

  await collect();
  for (k = 0; k <= end; k++) {
    if (k >= end - 45) wakeUntil = end + 1; // the gaffer picks the phone up at the end
    // 1. the phone app: running, or frozen and falling behind
    if (!asleep()) { const d = now() - pageT; if (d > 1500) await wake(); else if (d > 0) { await page.clock.runFor(d); pageT = now(); } await collect(); }
    // 2. the link coming back: queued presses arrive in order, and the phone's last word reaches the watch
    if (!down() && wasDown) { while (userInfo.length) await atPhone(userInfo.shift()); if (latest) await toWatch(latest); }
    wasDown = down();
    if (relaunch.has(k)) { await brain.ask({ op: 'relaunch' }); if (latest && !down()) await toWatch(latest); }
    // 3. the gaffer
    const whistle = async (op, sel) => { if (o.onPhone) await onPhone(sel); else await press(op); };
    if (k === plan.ko) { await whistle('start', '#go'); truth.phase = 'h1'; truth.start = truth.ko = o.onPhone ? now() : wnow(); }
    if (k === plan.ht) { if (o.onPhone) { await onPhone('#subPopLater'); await onPhone('#endHalf'); } else await press('end'); truth.phase = 'ht'; truth.ht = o.onPhone ? now() : wnow(); confirmAt = -1; }
    if (k === plan.h2) { await whistle('start', '#go'); truth.phase = 'h2'; truth.start = truth.h2 = o.onPhone ? now() : wnow(); }
    if (k === plan.ft) { if (o.onPhone) { await onPhone('#subPopLater'); await onPhone('#endHalf'); } else await press('end'); truth.phase = 'ft'; truth.ft = o.onPhone ? now() : wnow(); confirmAt = -1; }
    if (goalAt.has(k) && (truth.phase === 'h1' || truth.phase === 'h2') && (!goals.length || wnow() - goals[goals.length - 1].at >= 9000)) {
      const us = R() < 0.6, scorer = us && st && st.players.length ? st.players[R.int(0, st.players.length - 1)] : null;
      await press('goal', us ? { us: true, p: scorer } : { us: false });
      goals.push({ us, p: scorer, at: wnow(), min: (truth.phase === 'h2' ? 15 : 0) + Math.min(15, Math.floor((wnow() - truth.start) / 60000) + 1) }); truth[us ? 'us' : 'them']++;
    }
    if (k === confirmAt) { if (o.subsOnPhone && R() < 0.5) await onPhone('#subPopDone'); else await press('subs'); confirmAt = -1; }
    // 4. the watch's own second
    const before = buzz.length;
    await heard(await brain.ask({ op: 'tick', now: wnow() }));
    if (buzz.length > before || (st && st.due && confirmAt < 0 && (truth.phase === 'h1' || truth.phase === 'h2'))) { if (confirmAt < 0) confirmAt = k + R.int(3, 25); }
    // 5. is the watch right, this second?
    if (st && k > plan.ko) {
      const settle = o.onPhone ? 3 : 0; // a whistle blown on the phone takes a moment to reach the wrist
      const since = Math.min(...[plan.ko, plan.ht, plan.h2, plan.ft].map((x) => (k >= x ? k - x : 1e9)));
      if (since >= settle) {
        if (st.phase !== truth.phase) bad(`second ${k}: the watch says ${st.phase}, the game is in ${truth.phase}`);
        else if (st.phase === 'h1' || st.phase === 'h2') { const want = Math.floor((wnow() - truth.start) / 1000); if (Math.abs(st.seconds - want) > 1) bad(`second ${k}: the watch clock reads ${st.seconds}s, should read ${want}s`); }
        if (st.us !== truth.us || st.them !== truth.them) bad(`second ${k}: the watch shows ${st.us}–${st.them}, the score is ${truth.us}–${truth.them}`);
        if (!st.live) bad(`second ${k}: the watch has lost the game`);
      }
    }
  }
  // the phone has been in hand, in reach, for the last 45 seconds
  const m = await p.match(), last = await brain.ask({ op: 'tick', now: wnow() });
  for (const f of fails) check(false, `${name}: ${f}`);
  check(fails.length === 0, `${name}: the watch had the right phase, clock and score at every second of the game`);
  const tol = Math.abs(skew) + (o.onPhone ? 1500 : 0);
  eq(buzz.map((b) => b[0] + ' ' + Math.round(b[1] / 60) + ':00' + (Math.abs(b[1] % 60 > 30 ? b[1] % 60 - 60 : b[1] % 60) <= 1 + (o.onPhone ? 2 : 0) ? '' : ' late by ' + (b[1] % 60) + 's')), ['h1 5:00', 'h1 10:00', 'h2 5:00', 'h2 10:00'], `${name}: the wrist buzzed for each of the four changes, once, on the minute`);
  eq(timeUp.map((b) => b[0] + ' ' + (Math.abs(b[1] - 900) <= 1 + (o.onPhone ? 2 : 0) ? '15:00' : b[1] + 's')), ['h1 15:00', 'h2 15:00'], `${name}: and for time up in each half`);
  if (!check(!!m, `${name}: the phone still has the game`)) { brain.close(); await p.close(); return; }
  eq([m.phase, last.state.phase, last.pending], ['ft', 'ft', []], `${name}: both ended at full time with nothing left to send`);
  const near = (a, b) => Math.abs(a - b) <= tol;
  check(near(m.koAt, truth.ko - (o.onPhone ? 0 : skew) + (o.onPhone ? 0 : skew)) && near(m.htAt, truth.ht) && near(m.h2At, truth.h2) && near(m.ftAt, truth.ft), `${name}: the phone timed all four whistles as they were blown (${[m.koAt - truth.ko, m.htAt - truth.ht, m.h2At - truth.h2, m.ftAt - truth.ft]} ms out)`);
  const got = m.events.filter((e) => !e.hl);
  eq(got.map((e) => [e.us, e.p ?? null, e.at, e.min]), goals.map((g) => [g.us, g.p, g.at, g.min]), `${name}: the phone recorded every goal, in order, with scorer, time and minute`);
  eq([last.state.us, last.state.them], [truth.us, truth.them], `${name}: final score on the watch`);
  eq(m.ok, 5, `${name}: every change ended up confirmed on the phone`);
  await page.click('#finish'); await page.clock.runFor(100); await page.click('#finish'); await page.clock.runFor(1000); await collect();
  const t = await p.team();
  eq([t.results.length, t.results[0] && t.results[0].us, t.results[0] && t.results[0].them, st.live], [1, truth.us, truth.them, false], `${name}: the result is saved and the watch goes back to waiting`);
  for (const e of p.errs) check(false, `${name}: page error: ${e}`);
  brain.close(); await p.close();
}

const quick = process.argv.includes('--quick');
await game('everything in reach', { seed: 11 });
await game('phone frozen from kick-off to the last minute', { seed: 12, asleep: () => true });
await game('phone frozen but nudged awake by each message', { seed: 13, asleep: () => true, wakeOnMessage: true });
await game('watch out of reach of the phone all game', { seed: 14, down: (k) => k > 3 && k < 1900 });
await game('whistles and some changes made on the phone', { seed: 15, onPhone: true, subsOnPhone: true });
await game('watch app closed and reopened six times', { seed: 16, asleep: (k) => k % 400 < 300, relaunch: [8, 200, 330, 960, 1100, 1700] });
await game('clocks two seconds apart', { seed: 17, skew: 2000, asleep: (k) => k % 120 < 90 });
if (!quick) for (let seed = 100; seed < 100 + (+process.env.EVENINGS || 6); seed++) { // rough evenings
  const A = rng(seed * 7), chunks = Array.from({ length: 80 }, () => [A() < 0.6, A() < 0.4]);
  await game(`rough evening ${seed}`, { seed, asleep: (k) => k > 3 && chunks[Math.floor(k / 30) % 80][0], down: (k) => k > 3 && chunks[Math.floor(k / 30) % 80][1], // (in reach while the game is set up, or there is nothing on the watch to press) wakeOnMessage: seed % 2 === 0,
    relaunch: [A.int(10, 800), A.int(900, 1900)], skew: A.int(-1500, 1500), subsOnPhone: seed % 3 === 0 });
}

await w.close();
await done();
