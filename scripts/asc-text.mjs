// Puts Gaffer's App Store text (store/text/*.txt) into App Store Connect through Apple's API, so it can be changed
// from GitHub Actions without a Mac ("Update App Store text" in .github/workflows/store-text.yml).
//   node scripts/asc-text.mjs check          the text fits Apple's limits and Ethan's rules (no Apple account needed)
//   node scripts/asc-text.mjs show           what App Store Connect has now, and what would change
//   node scripts/asc-text.mjs send           send it
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 in the environment for show and send.
//
// Apple only takes the description, keywords, name and subtitle on a version that can still be edited (getting ready
// to send, or turned down); while one is waiting for review or live they're locked. The promotional text can be
// changed at any time, so on a locked version only that is sent, and the output says so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEXT_DIR = path.join(HERE, '..', 'store', 'text');
export const BUNDLE_ID = 'com.randomedp.aipoweredtactics';

// file → [App Store Connect field, Apple's limit in characters, where it lives]
export const FIELDS = {
  name: ['name', 30, 'info'],
  subtitle: ['subtitle', 30, 'info'],
  description: ['description', 4000, 'version'],
  keywords: ['keywords', 100, 'version'],
  promotional_text: ['promotionalText', 170, 'version'],
};

export function readText(dir = TEXT_DIR) {
  const out = {};
  for (const file of Object.keys(FIELDS)) {
    const p = path.join(dir, file + '.txt');
    if (fs.existsSync(p)) out[file] = fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
  }
  return out;
}

// Everything wrong with the text, in plain words. Empty when it's fine.
export function problems(text) {
  const bad = [];
  for (const [file, [, limit]] of Object.entries(FIELDS)) {
    const v = text[file];
    if (v == null) continue;
    if (!v.trim()) bad.push(`${file}.txt is empty`);
    const n = [...v].length;
    if (n > limit) bad.push(`${file}.txt is ${n} characters; Apple allows ${limit}`);
  }
  const all = Object.values(text).join('\n');
  if (/github/i.test(all)) bad.push('the text mentions GitHub; the repo and its pages are never shown outside the project');
  if (/gopro/i.test(all)) {
    for (const [file, v] of Object.entries(text)) {
      for (const line of v.split('\n')) if (/gopro/i.test(line) && !/iphone/i.test(line)) bad.push(`${file}.txt mentions GoPro without saying an iPhone works too: ${line.slice(0, 80)}`);
    }
  }
  for (const file of ['name', 'subtitle', 'description', 'promotional_text']) {
    if (text[file] && /5[- ]?a[- ]?side|five[- ]a[- ]side/i.test(text[file])) bad.push(`${file}.txt calls Gaffer a 5-a-side app; say small-sided football`);
  }
  if (text.keywords) {
    if (/,\s/.test(text.keywords)) bad.push('keywords.txt has spaces after commas, which waste characters');
    const words = text.keywords.split(',');
    if (new Set(words.map((w) => w.toLowerCase())).size !== words.length) bad.push('keywords.txt repeats a keyword');
  }
  return bad;
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token(env) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }) + '.' + b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head), { key: env.ASC_KEY_P8, dsaEncoding: 'ieee-p1363' });
  return head + '.' + sig.toString('base64url');
}

export function client(env = process.env, fetcher = fetch) {
  return async function api(p, method = 'GET', body) {
    const res = await fetcher('https://api.appstoreconnect.apple.com' + p, {
      method, headers: { Authorization: 'Bearer ' + token(env), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    if (!res.ok) { const e = new Error(method + ' ' + p + ' -> ' + res.status + ' ' + txt.slice(0, 400)); e.status = res.status; throw e; }
    return txt ? JSON.parse(txt) : null;
  };
}

// Works out what to change, and (when send is true) changes it. Returns lines saying what happened, for the log.
export async function run(api, text, { send = false } = {}) {
  const say = [];
  const apps = await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) throw new Error(`App Store Connect has no app with the bundle ID ${BUNDLE_ID}`);

  const groups = { info: [], version: [] };
  const infos = await api(`/v1/apps/${app.id}/appInfos`);
  for (const info of infos.data) {
    const locs = await api(`/v1/appInfos/${info.id}/appInfoLocalizations`);
    const state = info.attributes.state || info.attributes.appStoreState || 'unknown';
    for (const loc of locs.data) groups.info.push({ type: 'appInfoLocalizations', id: loc.id, where: `App information (${state}, ${loc.attributes.locale})`, now: loc.attributes });
  }
  const versions = await api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
  for (const v of versions.data) {
    const state = v.attributes.appVersionState || v.attributes.appStoreState || 'unknown';
    if (/REPLACED_WITH_NEW_VERSION|REMOVED_FROM_SALE/.test(state)) continue;
    const locs = await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
    for (const loc of locs.data) groups.version.push({ type: 'appStoreVersionLocalizations', id: loc.id, where: `Version ${v.attributes.versionString} (${state}, ${loc.attributes.locale})`, now: loc.attributes });
  }

  for (const [kind, rows] of Object.entries(groups)) {
    for (const row of rows) {
      const change = {};
      for (const [file, [field, , lives]] of Object.entries(FIELDS)) {
        if (lives === kind && text[file] != null && (row.now[field] || '') !== text[file]) change[field] = text[file];
      }
      const fields = Object.keys(change);
      if (!fields.length) { say.push(`${row.where}: already up to date`); continue; }
      if (!send) { say.push(`${row.where}: would change ${fields.join(', ')}`); continue; }
      try {
        await api(`/v1/${row.type}/${row.id}`, 'PATCH', { data: { type: row.type, id: row.id, attributes: change } });
        say.push(`${row.where}: changed ${fields.join(', ')}`);
      } catch (e) {
        if (e.status !== 409) throw e;
        // Locked (waiting for review, or live): the promotional text is the one thing Apple still takes.
        if (change.promotionalText) {
          try {
            await api(`/v1/${row.type}/${row.id}`, 'PATCH', { data: { type: row.type, id: row.id, attributes: { promotionalText: change.promotionalText } } });
            say.push(`${row.where}: locked by Apple, so only the promotional text was changed (${fields.filter((f) => f !== 'promotionalText').join(', ')} wait for the next version)`);
            continue;
          } catch (e2) { if (e2.status !== 409) throw e2; }
        }
        say.push(`${row.where}: locked by Apple, nothing changed (${fields.join(', ')} wait for a version that can be edited)`);
      }
    }
  }
  if (!groups.info.length && !groups.version.length) say.push('App Store Connect has nothing to change yet');
  return say;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const text = readText();
  const bad = problems(text);
  for (const [file, [, limit]] of Object.entries(FIELDS)) if (text[file] != null) console.log(`${file}: ${[...text[file]].length} of ${limit} characters`);
  if (bad.length) { for (const b of bad) console.error('::error::' + b); process.exit(1); }
  if (mode === 'check') { console.log('The App Store text is fine.'); process.exit(0); }
  if (mode !== 'show' && mode !== 'send') { console.error('Usage: asc-text.mjs check | show | send'); process.exit(2); }
  for (const v of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']) if (!process.env[v]) { console.error(`::error::The ${v} secret isn't set`); process.exit(1); }
  for (const line of await run(client(), text, { send: mode === 'send' })) console.log(line);
}
