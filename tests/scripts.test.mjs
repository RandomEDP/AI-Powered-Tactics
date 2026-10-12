// The scripts the app writes for making reels on a computer (reelScript, seasonScript in index.html). The part that finds
// each game's video is pulled out of the app's own source and run in bash against folders like the ones people make.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
const { check, eq, done } = suite('reel scripts');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\n');
const start = src.findIndex((l) => l.includes("L.push('src() {"));
const lines = [];
for (let i = start; i >= 0 && i < src.length; i++) {
  const m = src[i].match(/^\s*L\.push\(('(?:[^'\\]|\\.)*')\);/); if (!m) break;
  const line = new Function('return ' + m[1])(); lines.push(line); if (line === '}') break;
}
check(start >= 0 && lines[lines.length - 1] === '}', `found the season script's src() in the app (${lines.length} lines)`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-reels-'));
const game = (name, files) => { fs.mkdirSync(path.join(dir, name)); files.forEach((f) => fs.writeFileSync(path.join(dir, name, f), 'x')); };
game('iphone-game', ['IMG_4471.MOV']); game('gopro-game', ['GX010042.MP4']); game('lower-case', ['clip.mov']); game('empty', ['notes.txt']);
const find = (name) => { const r = spawnSync('bash', ['-c', `W=work; mkdir -p "$W"\n${lines.join('\n')}\nsrc "$1"`, 'x', name], { cwd: dir, encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; };
eq(find('iphone-game'), 'iphone-game/IMG_4471.MOV', 'a game filmed on an iPhone (.MOV) is found');
eq(find('gopro-game'), 'gopro-game/GX010042.MP4', 'a game filmed on a GoPro (.MP4) is found');
eq(find('lower-case'), 'lower-case/clip.mov', 'lower-case names too');
eq(find('empty'), null, 'a folder with no video is skipped');
fs.rmSync(dir, { recursive: true, force: true });
await done();
