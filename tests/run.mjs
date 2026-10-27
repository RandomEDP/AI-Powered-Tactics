// Runs everything:  node tests/run.mjs            (add --update to accept what the walk-throughs print now)
//   1. the watch's logic, on its own                      tests/watch/main.swift
//      and the phone's store of the watch's presses        tests/plugin/main.swift (the real plugin source, built off-phone)
//      and the App Clip's logic                            tests/clip/main.swift
//   2. the suites that check as they go                   tests/*.test.mjs  (link.test.mjs plays whole games between phone and watch)
//   3. the older walk-throughs, compared with what they printed last time   tests/golden/*.txt
// Needs: node, the `playwright` package with Chromium, and swiftc (any Swift 5.9+; without it the watch parts are skipped, loudly).
import { spawnSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const update = process.argv.includes('--update'), only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// The walk-throughs run in real time, so now and then one prints something a second out. On GitHub (WALKS=warn) that is
// reported but does not stop a build; the suites that check as they go use a clock the test controls, and always do.
const walksWarn = process.env.WALKS === 'warn';
const want = (name) => !only.length || only.some((o) => name.includes(o));
// --shard=2/4 runs a quarter of everything, so GitHub can run the four quarters on four machines at once. Each part goes to
// whichever shard has the least to do so far, longest first, using roughly how long each took on GitHub (seconds; anything
// not listed counts as 5). Every shard works this out the same way, so between them they run everything exactly once.
const shardArg = (process.argv.find((a) => a.startsWith('--shard=')) || '--shard=1/1').slice(8).split('/').map(Number);
const [shardK, shardN] = shardArg.length === 2 && shardArg[1] >= 1 && shardArg[0] >= 1 && shardArg[0] <= shardArg[1] ? shardArg : [1, 1];
const COST = { 'link.test.mjs': 172, 'teamsize.test.mjs': 40, 'walk:video': 100, 'walk:polls': 47, 'gotw.test.mjs': 38, 'watchlink.test.mjs': 37, 'livecam.test.mjs': 35, 'match.test.mjs': 35, 'sync.test.mjs': 35, 'nowswap.test.mjs': 30,
  'signin.test.mjs': 32, 'walk:chat': 31, 'walk:modes': 28, swift: 27, 'ads.test.mjs': 25, 'matchday.test.mjs': 23, 'reels.test.mjs': 22, 'walk:kickoff': 21, 'walk:rivals': 21,
  'friendly.test.mjs': 13, 'linked.test.mjs': 13, 'people.test.mjs': 13, 'voices.test.mjs': 13, 'walk:players': 13, 'live.test.mjs': 11, 'android.test.mjs': 10, 'beat.test.mjs': 10,
  'bigtext.test.mjs': 10, 'hltag.test.mjs': 10, 'house.test.mjs': 10, 'walk:board': 10, 'walk:push': 10, 'walk:games': 9, 'contract.test.mjs': 8, 'cuttiming.test.mjs': 8, 'posts.test.mjs': 8 };
const SUITES = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort();
const ALL_WALKS = ['board', 'chat', 'delete', 'games', 'kickoff', 'modes', 'native', 'players', 'polls', 'push', 'rivals', 'subs', 'track', 'video'];
const shardOf = {};
{
  // beat.test.mjs uses the Swift beat check built with the other Swift checks, so it goes wherever they go.
  const cost = (it) => (it === 'swift' ? COST.swift + COST['beat.test.mjs'] : COST[it] || 5);
  const load = Array(shardN).fill(0), items = ['swift', ...SUITES.filter((f) => f !== 'beat.test.mjs'), ...ALL_WALKS.map((w) => 'walk:' + w)];
  for (const it of items.map((n, i) => [n, i]).sort((a, b) => cost(b[0]) - cost(a[0]) || a[1] - b[1]).map((x) => x[0])) {
    const k = load.indexOf(Math.min(...load)); shardOf[it] = k + 1; load[k] += cost(it);
  }
  shardOf['beat.test.mjs'] = shardOf.swift;
}
const mine = (item) => shardOf[item] === shardK;
if (shardN > 1) console.log(`shard ${shardK} of ${shardN}`);
const results = [];
const note = (name, ok, detail, soft) => { results.push({ name, ok: ok || !!soft }); console.log(`${ok ? 'ok  ' : soft ? 'WARN' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok && soft && process.env.GITHUB_ACTIONS) console.log(`::warning::${name}: ${detail || 'failed'}`); };
const lastLine = (s) => (s.trim().split('\n').pop() || '').slice(0, 160);

// ---- 1. watch logic
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-tests-'));
const swift = spawnSync('swiftc', ['--version']).status === 0;
const env = Object.assign({}, process.env);
if (!swift) note('watch logic', !!process.env.ALLOW_NO_SWIFT, 'swiftc not found: the watch tests and the phone + watch games were NOT run');
else {
  const logic = path.join(ROOT, 'ios/App/Watch/MatchLogic.swift');
  const swiftHere = mine('swift'); // the Swift checks all run in one shard; every shard still builds the watch brain for link.test
  if (swiftHere && want('watch')) {
    const build = spawnSync('swiftc', [logic, path.join(HERE, 'watch/main.swift'), '-o', path.join(tmp, 'watchtests')], { encoding: 'utf8' });
    if (build.status !== 0) note('watch logic', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'watchtests'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('watch logic', r.status === 0, lastLine(r.stdout)); }
  }
  if (swiftHere && (want('plugin') || want('watch'))) {
    // The phone's side of the link is a Capacitor plugin. Its two imports and @objc markers are taken out so it builds here
    // against stand-ins for Capacitor and WatchConnectivity; everything else is the code that ships.
    const src = fs.readFileSync(path.join(ROOT, 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/WatchLinkPlugin.swift'), 'utf8')
      .replace(/^import (Capacitor|WatchConnectivity)\n/gm, '').replace(/^@objc\([A-Za-z]+\)\n/gm, '').replace(/@objc public func/g, 'public func');
    fs.writeFileSync(path.join(tmp, 'WatchLinkPlugin.swift'), src);
    const build = spawnSync('swiftc', [path.join(HERE, 'plugin/stubs.swift'), path.join(tmp, 'WatchLinkPlugin.swift'), path.join(ROOT, 'ios/App/App/PhoneHighlight.swift'), path.join(HERE, 'plugin/main.swift'), '-o', path.join(tmp, 'plugintests')], { encoding: 'utf8' });
    if (build.status !== 0) note("phone's watch plugin", false, 'does not compile\n' + build.stderr);
    else { fs.mkdirSync(path.join(tmp, 'home'), { recursive: true }); const r = spawnSync(path.join(tmp, 'plugintests'), { encoding: 'utf8', env: Object.assign({}, process.env, { HOME: path.join(tmp, 'home') }) }); if (r.status !== 0) console.log(r.stdout + r.stderr); note("phone's watch plugin", r.status === 0, lastLine(r.stdout)); }
  }
  if (swiftHere && (want('plugin') || want('quiet'))) {
    // The plugin that keeps an open team chat's notifications quiet, built the same way against stand-ins.
    const src = fs.readFileSync(path.join(ROOT, 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/ChatQuietPlugin.swift'), 'utf8')
      .replace(/^import (Capacitor|UserNotifications)\n/gm, '').replace(/^@objc\([A-Za-z]+\)\n/gm, '').replace(/@objc public func/g, 'public func');
    fs.writeFileSync(path.join(tmp, 'ChatQuietPlugin.swift'), src);
    const build = spawnSync('swiftc', [path.join(HERE, 'plugin/quiet/stubs.swift'), path.join(tmp, 'ChatQuietPlugin.swift'), path.join(HERE, 'plugin/quiet/main.swift'), '-o', path.join(tmp, 'quiettests')], { encoding: 'utf8' });
    if (build.status !== 0) note('quiet chat plugin', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'quiettests'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout + r.stderr); note('quiet chat plugin', r.status === 0, lastLine(r.stdout)); }
  }
  if (swiftHere && (want('beat'))) { // the beat edit's plan as the phone reads it; beat.test.mjs also hands it the web app's own plans
    const build = spawnSync('swiftc', [path.join(ROOT, 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/BeatEdit.swift'), path.join(HERE, 'beat/main.swift'), '-o', path.join(tmp, 'beatcheck')], { encoding: 'utf8' });
    if (build.status !== 0) note('beat edit plans', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'beatcheck'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('beat edit plans', r.status === 0, lastLine(r.stdout)); env.BEATCHECK = path.join(tmp, 'beatcheck'); }
  }
  if (swiftHere && (want('folders') || want('reels'))) { // each reel being joined on the phone gets its own folder, so one never deletes another's video
    const build = spawnSync('swiftc', [path.join(ROOT, 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/WorkFolders.swift'), path.join(HERE, 'folders/main.swift'), '-o', path.join(tmp, 'folders')], { encoding: 'utf8' });
    if (build.status !== 0) note('reel work folders', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'folders'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('reel work folders', r.status === 0, lastLine(r.stdout)); }
  }
  if (swiftHere && (want('voice') || want('reels'))) { // your own commentary over a reel: the game's sound dips while you talk, and your words land where you said them
    const build = spawnSync('swiftc', [path.join(ROOT, 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/VoiceSpans.swift'), path.join(HERE, 'voice/main.swift'), '-o', path.join(tmp, 'voicecheck')], { encoding: 'utf8' });
    if (build.status !== 0) note('your own commentary', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'voicecheck'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('your own commentary', r.status === 0, lastLine(r.stdout)); }
  }
  if (swiftHere && (want('clip'))) { // Gaffer's App Clip: how it reads a friendly's personal link, what it hands the full app, the call it makes
    const build = spawnSync('swiftc', [path.join(ROOT, 'ios/App/Clip/ClipLogic.swift'), path.join(HERE, 'clip/main.swift'), '-o', path.join(tmp, 'cliptests')], { encoding: 'utf8' });
    if (build.status !== 0) note('App Clip logic', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'cliptests'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('App Clip logic', r.status === 0, lastLine(r.stdout)); }
  }
  const cli = spawnSync('swiftc', [logic, path.join(HERE, 'watch/cli/main.swift'), '-o', path.join(tmp, 'watchbrain')], { encoding: 'utf8' });
  if (cli.status !== 0) note('watch logic for the whole-game tests', false, 'does not compile\n' + cli.stderr); else env.WATCHBRAIN = path.join(tmp, 'watchbrain');
}

// ---- 2. suites
const run = (file, args = []) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(HERE, file), ...args], { env, cwd: ROOT }); let out = '';
  const timer = setTimeout(() => { out += '\n(timed out after 15 minutes)'; p.kill('SIGKILL'); }, 15 * 60000);
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
});
for (const file of SUITES) {
  if (!want(file) || !mine(file)) continue;
  if (file === 'link.test.mjs' && !env.WATCHBRAIN) continue;
  const t0 = Date.now(), r = await run(file);
  if (r.code !== 0) console.log(r.out.split('\n').filter((l) => !l.startsWith('\u001b[2m')).join('\n'));
  note(file, r.code === 0, `${lastLine(r.out)}  (${Math.round((Date.now() - t0) / 1000)}s)`);
}

// ---- 3. walk-throughs against what they printed before
const WALKS = ALL_WALKS.filter((w) => want(w) && mine('walk:' + w));
const tidy = (s) => s.split('\n').filter((l) => !l.startsWith('\u001b[2m')).map((l) => l
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  .replace(/(FC|code: |code shown: )[A-HJ-NP-Z2-9]{6,10}\b/g, '$1<code>')
  .replace(/kick-off field: \d\d:\d\d/g, 'kick-off field: <mm:ss>').replace(/second half at \d\d:\d\d/g, 'second half at <mm:ss>').replace(/(\.mov",)\d+(,)/g, '$1<s>$2')
  .replace(/started \d\d:\d\d/g, 'started <hh:mm>').replace(/translate\([-\d. ]+\)/g, 'translate(<x y>)').replace(/voice@[\d.]+/g, 'voice@<t>').replace(/"dur":[\d.]+/g, '"dur":<s>')
  .replace(/^(\s*(?:talk|coin|captain|pens): ).*$/, '$1<varies>')).join('\n').trim() + '\n';
if (WALKS.length) {
  const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file));
  });
  const up = await new Promise((r) => { server.once('error', () => r(false)); server.listen(8766, '127.0.0.1', () => r(true)); }); // (if something is already serving the repo there, that is used)
  fs.mkdirSync(path.join(HERE, 'golden'), { recursive: true });
  for (const name of WALKS) {
    const file = path.join(HERE, 'golden', name + '.txt');
    let r = await run(name + '.mjs'), got = tidy(r.out);
    const was = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    for (let again = 0; again < 2 && !update && was !== null && (r.code !== 0 || got !== was); again++) { r = await run(name + '.mjs'); got = tidy(r.out); } // these run in real time: two more goes before calling it a failure
    if (r.code !== 0) { console.log(got); note('walk-through: ' + name, false, 'crashed', walksWarn); continue; }
    if (update || was === null) { fs.writeFileSync(file, got); note('walk-through: ' + name, true, was === null ? '(first run: saved)' : got === was ? '' : '(updated)'); continue; }
    if (got !== was) { const a = was.split('\n'), b = got.split('\n'); for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`  line ${i + 1}\n    was: ${(a[i] || '').slice(0, 600)}\n    now: ${(b[i] || '').slice(0, 600)}`); }
    note('walk-through: ' + name, got === was, got === was ? '' : 'prints something different from before (run with --update if that is intended)', walksWarn);
  }
  if (up) server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} FAILED: ${failed.map((r) => r.name).join(', ')}` : `\nall ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
