// Puts the product page header and the search results picture (store/4 Header and Search Results) on every language of
// the App Store version being got ready, through Apple's App Asset Library API, from GitHub Actions ("Update App Store
// text", with "Header and search pictures" ticked). Apple won't send a version for review while any language has no
// header ("English (U.K.) - Header Image - This field is required", Ethan, November 2026).
//   node scripts/asc-header.mjs check     the pictures are there, the right size and with no see-through layer
//   node scripts/asc-header.mjs show      what each language has now, and what would change
//   node scripts/asc-header.mjs send      upload the pictures once and place them on every language missing one
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 in the environment for show and send.
//
// Apple's steps: the app's asset library (GET /v1/apps/{id}/assetLibrary), reserve each picture
// (POST /v1/appAssetLibraryImages), put its bytes where Apple says, say it's uploaded (PATCH uploaded: true), wait for
// Apple to process it, then place it on a language (POST /v1/appAssetLibraryPlacements with placementType
// PRODUCT_PAGE_HEADER_ASSET or APP_STORE_SEARCH_RESULTS_ASSET). A placement can't be changed, only deleted and made again.
// Only a version that can still be edited is touched; one waiting for review or live is left as it is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ID, client } from './asc-text.mjs';
import { EDITABLE, STORE } from './asc-shots.mjs';

export const FOLDER = '4 Header and Search Results';
// placement → the file, and the sizes Apple takes (header exactly 3840 × 1646; search 3:2 from 1920 × 1280 to 3840 × 2560)
export const PICS = {
  PRODUCT_PAGE_HEADER_ASSET: { file: 'header-3840x1646.png', name: 'Header', ok: (w, h) => w === 3840 && h === 1646, want: '3840 × 1646' },
  APP_STORE_SEARCH_RESULTS_ASSET: { file: 'search-1920x1280.png', name: 'Search results', ok: (w, h) => w * 2 === h * 3 && w >= 1920 && w <= 3840, want: '3:2, 1920 × 1280 to 3840 × 2560' },
};
const DONE = /^(PREPARE_FOR_SUBMISSION|READY_FOR_REVIEW|WAITING_FOR_REVIEW|IN_REVIEW|ACCEPTED|APPROVED)$/;
const BUSY = /^(AWAITING_UPLOAD|UPLOAD_COMPLETE|ASSET_PROCESSING|PROCESSING)$/;

// PNG: width, height and colour type (4 and 6 carry an alpha channel, which Apple refuses).
const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: buf[25] === 4 || buf[25] === 6 });

export function readPics(dir = STORE) {
  const out = {};
  for (const [type, p] of Object.entries(PICS)) {
    const f = path.join(dir, FOLDER, p.file);
    out[type] = { ...p, buf: fs.existsSync(f) ? fs.readFileSync(f) : null };
  }
  return out;
}

export function problems(pics) {
  const bad = [];
  for (const p of Object.values(pics)) {
    if (!p.buf) { bad.push(`store/${FOLDER}/${p.file} is missing`); continue; }
    const { w, h, alpha } = png(p.buf);
    if (!p.ok(w, h)) bad.push(`${p.file} is ${w} × ${h}; Apple's ${p.name.toLowerCase()} picture needs ${p.want}`);
    if (alpha) bad.push(`${p.file} has a see-through (alpha) layer, which Apple refuses`);
  }
  return bad;
}

export async function run(api, pics, { send = false, put = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const say = [];
  const app = (await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) throw new Error(`App Store Connect has no app with the bundle ID ${BUNDLE_ID}`);
  const versions = await api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
  const todo = []; // { loc, where, type }
  for (const v of versions.data) {
    const state = v.attributes.appVersionState || v.attributes.appStoreState || 'unknown';
    if (/REPLACED_WITH_NEW_VERSION|REMOVED_FROM_SALE/.test(state)) continue;
    const locs = await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
    for (const loc of locs.data) {
      const where = `Version ${v.attributes.versionString} (${state}, ${loc.attributes.locale})`;
      const have = (await api(`/v1/appStoreVersionLocalizations/${loc.id}/placements?limit=50`)).data || [];
      for (const [type, p] of Object.entries(pics)) {
        const mine = have.filter((x) => x.attributes.placementType === type);
        const good = mine.find((x) => x.attributes.state !== 'FAILED');
        if (good) {
          // what's there, in full, so a placement Apple still won't accept can be seen in the log
          let img = '';
          try { const r = await api(`/v1/appAssetLibraryPlacements/${good.id}/image`); const a = r.data?.attributes || {}; img = `; picture ${a.fileName} ${a.state}${a.stateDetails ? ' ' + JSON.stringify(a.stateDetails) : ''}`; } catch (e) { img = `; picture unreadable (${e.status || e.message})`; }
          say.push(`${where}, ${p.name}: has one (${good.attributes.state}${good.attributes.placementGroup ? ', ' + good.attributes.placementGroup : ''}${img})`);
          continue;
        }
        const failed = mine.length ? ` (the one there failed: ${JSON.stringify(mine[0].attributes.stateDetails || null)})` : '';
        if (!EDITABLE.test(state)) { say.push(`${where}, ${p.name}: none${failed}, but Apple has this version locked, so nothing changed`); continue; }
        say.push(`${where}, ${p.name}: none${failed}, ${send ? 'adding it' : 'would add ' + p.file}`);
        todo.push({ loc, where, type, old: mine });
      }
    }
  }
  if (!send || !todo.length) return say;

  const lib = (await api(`/v1/apps/${app.id}/assetLibrary`)).data;
  const imgs = {};
  for (const type of new Set(todo.map((t) => t.type))) imgs[type] = await upload(api, put, wait, lib.id, pics[type], say);
  for (const t of todo) {
    for (const o of t.old) await api(`/v1/appAssetLibraryPlacements/${o.id}`, 'DELETE');
    const r = await api('/v1/appAssetLibraryPlacements', 'POST', { data: { type: 'appAssetLibraryPlacements', attributes: { placementType: t.type },
      relationships: { image: { data: { type: 'appAssetLibraryImages', id: imgs[t.type] } },
        appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: t.loc.id } } } } });
    say.push(`${t.where}, ${pics[t.type].name}: added (${r.data?.attributes?.state || 'placed'})`);
  }
  return say;
}

// One picture into the asset library (or the one already there with the same name and size), ready to place.
async function upload(api, put, wait, libId, p, say) {
  const there = (await api(`/v1/appAssetLibraries/${libId}/images?limit=200`)).data || [];
  let img = there.find((x) => x.attributes.fileName === p.file && x.attributes.fileSize === p.buf.length && (DONE.test(x.attributes.state) || BUSY.test(x.attributes.state)));
  if (img) say.push(`${p.file}: already in the asset library (${img.attributes.state}), using it`);
  else {
    img = (await api('/v1/appAssetLibraryImages', 'POST', { data: { type: 'appAssetLibraryImages',
      attributes: { fileName: p.file, fileSize: p.buf.length, category: 'CREATIVE_ASSETS', referenceName: `Gaffer ${p.name.toLowerCase()}` },
      relationships: { assetLibrary: { data: { type: 'appAssetLibraries', id: libId } } } } })).data;
    for (const op of img.attributes.uploadOperations || []) {
      const res = await put(op.url, { method: op.method, headers: Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value])), body: p.buf.subarray(op.offset, op.offset + op.length) });
      if (!res.ok) throw new Error(`Uploading ${p.file} to Apple failed (${res.status})`);
    }
    await api(`/v1/appAssetLibraryImages/${img.id}`, 'PATCH', { data: { type: 'appAssetLibraryImages', id: img.id, attributes: { uploaded: true } } });
    say.push(`${p.file}: uploaded to the asset library`);
  }
  for (let i = 0; i < 60; i++) {
    const a = (await api(`/v1/appAssetLibraryImages/${img.id}`)).data.attributes;
    if (a.state === 'FAILED' || a.state === 'REJECTED') throw new Error(`Apple refused ${p.file}: ${JSON.stringify(a.stateDetails || a.state)}`);
    if (!BUSY.test(a.state)) { say.push(`${p.file}: processed by Apple (${a.state})`); return img.id; }
    await wait(5000);
  }
  throw new Error(`Apple was still processing ${p.file} after 5 minutes; run it again in a while`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const pics = readPics();
  const bad = problems(pics);
  if (bad.length) { for (const b of bad) console.error('::error::' + b); process.exit(1); }
  if (mode === 'check') { console.log('The header and search results pictures are fine.'); process.exit(0); }
  if (mode !== 'show' && mode !== 'send') { console.error('Usage: asc-header.mjs check | show | send'); process.exit(2); }
  for (const v of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']) if (!process.env[v]) { console.error(`::error::The ${v} secret isn't set`); process.exit(1); }
  for (const line of await run(client(), pics, { send: mode === 'send' })) console.log(line);
}
