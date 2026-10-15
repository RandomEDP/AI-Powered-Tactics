// Ethan's rule for the words: wherever GoPro is mentioned, say an iPhone works too. Checked line by line in the app,
// the App Store picture text and the pages people read.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const { check, done } = suite('wording');
let lines = 0;
for (const file of ['index.html', 'privacy.html', 'support.html', 'README.md', 'store/compose.mjs']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  text.forEach((line, i) => {
    if (!/gopro/i.test(line)) return;
    lines++;
    check(/iphone/i.test(line), `${file}:${i + 1} mentions GoPro without saying an iPhone works too: ${line.trim().slice(0, 140)}`);
  });
}
check(lines >= 10, `found the places GoPro is mentioned (${lines})`);

// Ethan's rule for the brand (October 2026): Gaffer is for small-sided football, not only 5-a-side. "5-a-side" may still
// name the game format (the 5-a-side / 7-a-side choice, the tactics board, a pitch's size), never what the app is.
let formats = 0;
for (const file of ['index.html', 'privacy.html', 'support.html', 'terms.html', 'README.md', 'LICENSE', 'store/compose.mjs',
  'manifest.webmanifest', 'plugins/reel-cutter/ios/Sources/ReelCutterPlugin/ReelGraphics.swift']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  text.forEach((line, i) => {
    if (!/five[- ]a[- ]side|5[- ]a[- ]side/i.test(line)) return;
    formats++;
    check(/7[- ]a[- ]side|game formats|pitch is about/i.test(line) && !/team manager|built for/i.test(line),
      `${file}:${i + 1} calls Gaffer a 5-a-side app (say small-sided football): ${line.trim().slice(0, 140)}`);
  });
}
check(/var APP_NAME = 'Gaffer: Small-Sided Football'/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'the app\'s full name is set in one place');
check(formats >= 3, `found the game-format mentions (${formats})`);
await done();
