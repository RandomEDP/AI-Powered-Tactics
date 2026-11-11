// The App Store header and search results pictures (store/4 Header and Search Results) and the script that places them
// on every language of the version being got ready (scripts/asc-header.mjs), against a stand-in for Apple's App Asset
// Library API. Apple wouldn't take 1.2 for review without them: "English (U.K.) - Header Image - This field is required".
import { suite } from './lib.mjs';
import crypto from 'node:crypto';
import { readPics, problems, run } from '../scripts/asc-header.mjs';
import { client } from '../scripts/asc-text.mjs';
const { check, eq, done } = suite('store header');

const pics = readPics();
eq(problems(pics), [], 'the header is 3840 × 1646, the search picture 3:2, and neither has a see-through layer');
const wide = Buffer.from(pics.PRODUCT_PAGE_HEADER_ASSET.buf); wide.writeUInt32BE(1646, 20); wide.writeUInt32BE(3000, 16);
check(problems({ ...pics, PRODUCT_PAGE_HEADER_ASSET: { ...pics.PRODUCT_PAGE_HEADER_ASSET, buf: wide } }).some((p) => /3000 × 1646/.test(p)), 'a header the wrong size is caught');
const see = Buffer.from(pics.APP_STORE_SEARCH_RESULTS_ASSET.buf); see[25] = 6;
check(problems({ ...pics, APP_STORE_SEARCH_RESULTS_ASSET: { ...pics.APP_STORE_SEARCH_RESULTS_ASSET, buf: see } }).some((p) => /alpha/.test(p)), 'a picture with an alpha layer is caught');

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { ASC_KEY_ID: 'K', ASC_ISSUER_ID: 'I', ASC_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
// 1.1 is live with nothing; 1.2 is being got ready: en-US already has a header, en-GB has nothing.
const placements = { pl0: { loc: 'vl2us', type: 'PRODUCT_PAGE_HEADER_ASSET', img: 'i0', state: 'PARENT_PREPARE_FOR_SUBMISSION' } };
const images = {}, calls = [], bytes = {}; let n = 0, polls = 0;
async function apple(url, opts) {
  const p = url.replace('https://api.appstoreconnect.apple.com', ''), m = opts.method;
  calls.push(m + ' ' + p);
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (p === '/v1/apps?filter[bundleId]=com.randomedp.aipoweredtactics') return reply(200, { data: [{ id: 'app1' }] });
  if (p === '/v1/apps/app1/appStoreVersions?filter[platform]=IOS&limit=5') return reply(200, { data: [
    { id: 'v1', attributes: { versionString: '1.1', appVersionState: 'READY_FOR_DISTRIBUTION' } }, { id: 'v2', attributes: { versionString: '1.2', appVersionState: 'PREPARE_FOR_SUBMISSION' } }] });
  if (p === '/v1/appStoreVersions/v1/appStoreVersionLocalizations') return reply(200, { data: [{ id: 'vl1', attributes: { locale: 'en-GB' } }] });
  if (p === '/v1/appStoreVersions/v2/appStoreVersionLocalizations') return reply(200, { data: [{ id: 'vl2', attributes: { locale: 'en-GB' } }, { id: 'vl2us', attributes: { locale: 'en-US' } }] });
  let r = p.match(/^\/v1\/appStoreVersionLocalizations\/(\w+)\/placements\?limit=50$/);
  if (r) return reply(200, { data: Object.entries(placements).filter(([, x]) => x.loc === r[1]).map(([id, x]) => ({ id, attributes: { placementType: x.type, state: x.state } })) });
  if (p === '/v1/apps/app1/assetLibrary') return reply(200, { data: { type: 'appAssetLibraries', id: 'lib1' } });
  if (p === '/v1/appAssetLibraries/lib1/images?limit=200') return reply(200, { data: Object.entries(images).map(([id, x]) => ({ id, attributes: x })) });
  if (m === 'POST' && p === '/v1/appAssetLibraryImages') {
    const a = body.data.attributes; if (body.data.relationships.assetLibrary.data.id !== 'lib1') return reply(409, {});
    const id = 'img' + ++n; images[id] = { fileName: a.fileName, fileSize: a.fileSize, category: a.category, state: 'AWAITING_UPLOAD' };
    return reply(201, { data: { id, attributes: { ...images[id], uploadOperations: [{ method: 'PUT', url: 'https://upload.example/' + id, offset: 0, length: a.fileSize, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }] } } });
  }
  r = p.match(/^\/v1\/appAssetLibraryImages\/(\w+)$/);
  if (r && m === 'PATCH') { images[r[1]].state = body.data.attributes.uploaded ? 'UPLOAD_COMPLETE' : 'AWAITING_UPLOAD'; return reply(200, { data: {} }); }
  if (r && m === 'GET') { const x = images[r[1]]; if (x.state === 'UPLOAD_COMPLETE' && ++polls % 2 === 0) x.state = 'PREPARE_FOR_SUBMISSION'; return reply(200, { data: { id: r[1], attributes: x } }); }
  if (m === 'POST' && p === '/v1/appAssetLibraryPlacements') {
    const d = body.data, img = images[d.relationships.image.data.id];
    if (!img || img.state !== 'PREPARE_FOR_SUBMISSION') return reply(409, { errors: [{ detail: 'image not ready' }] });
    const id = 'pl' + ++n; placements[id] = { loc: d.relationships.appStoreVersionLocalization.data.id, type: d.attributes.placementType, img: d.relationships.image.data.id, state: 'PARENT_PREPARE_FOR_SUBMISSION' };
    return reply(201, { data: { id, attributes: { placementType: d.attributes.placementType, state: 'PARENT_PREPARE_FOR_SUBMISSION' } } });
  }
  return reply(404, { errors: [] });
}
const put = async (url, opts) => { bytes[url.split('/').pop()] = opts.body.length; return { ok: true, status: 200 }; };
const api = client(env, apple), wait = async () => {};

const shown = await run(api, pics, { send: false, put, wait });
check(!calls.some((c) => /^(POST|PATCH|DELETE)/.test(c)), 'show changes nothing');
check(shown.some((l) => /1\.2 .*en-GB\), Header: none, would add header-3840x1646\.png/.test(l)), 'show finds en-GB has no header: ' + shown.join(' | '));
check(shown.some((l) => /1\.2 .*en-US\), Header: has one/.test(l)), 'and that en-US already has one');
check(shown.some((l) => /1\.1 .*locked/.test(l)), 'the live version is left alone');

const sent = await run(api, pics, { send: true, put, wait });
const on = (loc, type) => Object.values(placements).filter((x) => x.loc === loc && x.type === type);
eq(on('vl2', 'PRODUCT_PAGE_HEADER_ASSET').length, 1, 'en-GB on 1.2 now has a header');
eq(on('vl2', 'APP_STORE_SEARCH_RESULTS_ASSET').length, 1, 'and a search results picture');
eq(on('vl2us', 'PRODUCT_PAGE_HEADER_ASSET').length, 1, 'en-US keeps its one header, not a second');
eq(on('vl2us', 'APP_STORE_SEARCH_RESULTS_ASSET').length, 1, 'and gets the search picture too');
eq(on('vl1', 'PRODUCT_PAGE_HEADER_ASSET').length, 0, 'the live 1.1 is untouched');
eq(Object.keys(images).length, 2, 'each picture is uploaded once, however many languages use it');
check(Object.entries(images).every(([id, x]) => bytes[id] === x.fileSize && x.category === 'CREATIVE_ASSETS'), 'uploaded whole, as creative assets');
check(sent.some((l) => /en-GB\), Header: added/.test(l)), 'the log says so: ' + sent.join(' | '));

const before = calls.length;
const again = await run(api, pics, { send: true, put, wait });
check(!calls.slice(before).some((c) => /^(POST|PATCH|DELETE)/.test(c)) && again.every((l) => /has one|locked/.test(l)), 'sending twice changes nothing more');
await done();
