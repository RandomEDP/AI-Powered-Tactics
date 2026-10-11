// Runs everything:  node tests/run.mjs            (add --update to accept what the walk-throughs print now)
//   1. the watch's logic, on its own                      tests/watch/main.swift
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
  if (want('watch')) {
    const build = spawnSync('swiftc', [logic, path.join(HERE, 'watch/main.swift'), '-o', path.join(tmp, 'watchtests')], { encoding: 'utf8' });
    if (build.status !== 0) note('watch logic', false, 'does not compile\n' + build.stderr);
    else { const r = spawnSync(path.join(tmp, 'watchtests'), { encoding: 'utf8' }); if (r.status !== 0) console.log(r.stdout); note('watch logic', r.status === 0, lastLine(r.stdout)); }
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
for (const file of fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort()) {
  if (!want(file)) continue;
  if (file === 'link.test.mjs' && !env.WATCHBRAIN) continue;
  const r = await run(file);
  if (r.code !== 0) console.log(r.out.split('\n').filter((l) => !l.startsWith('\u001b[2m')).join('\n'));
  note(file, r.code === 0, lastLine(r.out));
}

// ---- 3. walk-throughs against what they printed before
const WALKS = ['board', 'chat', 'delete', 'games', 'kickoff', 'modes', 'native', 'players', 'polls', 'push', 'rivals', 'subs', 'track', 'video'].filter(want);
const tidy = (s) => s.split('\n').filter((l) => !l.startsWith('\u001b[2m')).map((l) => l
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  .replace(/(FC|code: |code shown: )[A-HJ-NP-Z2-9]{6,10}\b/g, '$1<code>')
  .replace(/kick-off field: \d\d:\d\d/g, 'kick-off field: <mm:ss>').replace(/second half at \d\d:\d\d/g, 'second half at <mm:ss>').replace(/(\.mov",)\d+(,)/g, '$1<s>$2')
  .replace(/translate\([-\d. ]+\)/g, 'translate(<x y>)').replace(/voice@[\d.]+/g, 'voice@<t>').replace(/"dur":[\d.]+/g, '"dur":<s>')
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
