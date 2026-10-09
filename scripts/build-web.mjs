// Copies the web app into www/, which Capacitor bundles into the iOS app.
// The repo root stays the source of truth (it is also what GitHub Pages serves).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const out = 'www';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ['index.html', 'privacy.html', 'config.js', 'manifest.webmanifest', 'sw.js', 'icons', 'vendor']) cpSync(f, `${out}/${f}`, { recursive: true });
console.log('Web app copied to www/');
