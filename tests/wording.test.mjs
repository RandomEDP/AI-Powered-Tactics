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
await done();
