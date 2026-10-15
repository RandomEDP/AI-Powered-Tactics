// Puts Gaffer's App Store pictures (store/6 iPhone (6.9 inch), made by store/compose.mjs) into App Store Connect through
// Apple's API, from GitHub Actions ("Update App Store text", with "Pictures too" ticked).
//   node scripts/asc-shots.mjs check         the pictures are there and the right size (no Apple account needed)
//   node scripts/asc-shots.mjs show          what App Store Connect has now, and what would change
//   node scripts/asc-shots.mjs send          send them: each set's old pictures are replaced by the new ones, in order
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 in the environment for show and send.
//
// Only the 6.9" iPhone set is sent: it's the one Apple requires, and Apple scales it down for every smaller iPhone.
// Apple only lets the pictures change on a version that can still be edited (getting ready to send, or turned down);
// a version waiting for review or live is left exactly as it is, and the output says so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ID, client } from './asc-text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STORE = path.join(HERE, '..', 'store');
// folder in store/ → [App Store Connect display type, width, height]
export const SETS = { '6 iPhone (6.9 inch)': ['APP_IPHONE_67', 1320, 2868] };
export const EDITABLE = /^(PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED|METADATA_REJECTED|INVALID_BINARY)$/;

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
// The pictures in each folder, in the order they're numbered (iphone69-1-…, iphone69-2-…).
export function readSets(dir = STORE) {
  const out = {};
  for (const [folder, [type, w, h]] of Object.entries(SETS)) {
    const p = path.join(dir, folder);
    const files = fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith('.png')).sort((a, b) => (+a.match(/-(\d+)-/)?.[1] || 0) - (+b.match(/-(\d+)-/)?.[1] || 0)) : [];
    out[type] = { folder, w, h, files: files.map((f) => ({ name: f, buf: fs.readFileSync(path.join(p, f)) })) };
  }
  return out;
}

// Everything wrong with the pictures, in plain words. Empty when they're fine.
export function problems(sets) {
  const bad = [];
  for (const [type, s] of Object.entries(sets)) {
    if (!s.files.length) bad.push(`store/${s.folder} has no pictures`);
    if (s.files.length > 10) bad.push(`store/${s.folder} has ${s.files.length} pictures; Apple allows 10`);
    for (const f of s.files) { const [w, h] = pngSize(f.buf); if (w !== s.w || h !== s.h) bad.push(`${f.name} is ${w} × ${h}; ${type} needs ${s.w} × ${s.h}`); }
  }
  return bad;
}

// Works out what to change, and (when send is true) changes it. Returns lines saying what happened, for the log.
export async function run(api, sets, { send = false, put = fetch } = {}) {
  const say = [];
  const app = (await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) throw new Error(`App Store Connect has no app with the bundle ID ${BUNDLE_ID}`);
  const versions = await api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
  let editable = 0, locked = 0;
  for (const v of versions.data) {
    const state = v.attributes.appVersionState || v.attributes.appStoreState || 'unknown';
    if (/REPLACED_WITH_NEW_VERSION|REMOVED_FROM_SALE/.test(state)) continue;
    const locs = await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
    for (const loc of locs.data) {
      const where = `Version ${v.attributes.versionString} (${state}, ${loc.attributes.locale})`;
      const have = (await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
      for (const [type, s] of Object.entries(sets)) {
        const set = have.find((x) => x.attributes.screenshotDisplayType === type);
        const old = set ? (await api(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data : [];
        const same = old.length === s.files.length && old.every((o, i) => o.attributes.sourceFileChecksum === md5(s.files[i].buf));
        if (same) { say.push(`${where}, ${type}: already up to date (${old.length} pictures)`); continue; }
        if (!EDITABLE.test(state)) { locked++; say.push(`${where}, ${type}: locked by Apple, nothing changed (it has ${old.length} pictures; the new ${s.files.length} wait for a version that can be edited)`); continue; }
        editable++;
        if (!send) { say.push(`${where}, ${type}: would replace ${old.length} pictures with ${s.files.length} (${s.files.map((f) => f.name).join(', ')})`); continue; }
        const setId = set ? set.id : (await api('/v1/appScreenshotSets', 'POST', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type },
          relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } })).data.id;
        // Upload the new ones first, so a failure part-way leaves the old ones in place.
        const made = [];
        for (const f of s.files) made.push(await upload(api, put, setId, f));
        for (const o of old) await api(`/v1/appScreenshots/${o.id}`, 'DELETE');
        await api(`/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, 'PATCH', { data: made.map((id) => ({ type: 'appScreenshots', id })) });
        say.push(`${where}, ${type}: replaced ${old.length} pictures with ${s.files.length}`);
      }
    }
  }
  if (locked && !editable) say.push('No version can take new pictures right now. They go on when there is one getting ready to send (for example after the next build is added to a new version).');
  return say;
}

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
// Apple's three steps: reserve the picture, put its bytes where Apple says, then say it's uploaded.
async function upload(api, put, setId, f) {
  const r = (await api('/v1/appScreenshots', 'POST', { data: { type: 'appScreenshots', attributes: { fileName: f.name, fileSize: f.buf.length },
    relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } } } })).data;
  for (const op of r.attributes.uploadOperations || []) {
    const res = await put(op.url, { method: op.method, headers: Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value])), body: f.buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`Uploading ${f.name} to Apple failed (${res.status})`);
  }
  await api(`/v1/appScreenshots/${r.id}`, 'PATCH', { data: { type: 'appScreenshots', id: r.id, attributes: { uploaded: true, sourceFileChecksum: md5(f.buf) } } });
  return r.id;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const sets = readSets();
  for (const s of Object.values(sets)) console.log(`store/${s.folder}: ${s.files.length} pictures`);
  const bad = problems(sets);
  if (bad.length) { for (const b of bad) console.error('::error::' + b); process.exit(1); }
  if (mode === 'check') { console.log('The App Store pictures are fine.'); process.exit(0); }
  if (mode !== 'show' && mode !== 'send') { console.error('Usage: asc-shots.mjs check | show | send'); process.exit(2); }
  for (const v of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']) if (!process.env[v]) { console.error(`::error::The ${v} secret isn't set`); process.exit(1); }
  for (const line of await run(client(), sets, { send: mode === 'send' })) console.log(line);
}
