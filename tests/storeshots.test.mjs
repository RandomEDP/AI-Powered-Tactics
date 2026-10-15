// The App Store pictures (store/6 iPhone (6.9 inch)) and the script that sends them to App Store Connect
// (scripts/asc-shots.mjs), run against a stand-in for Apple's API: one version waiting for review (locked, never
// touched) and a new one being got ready, which has the old pictures until they're replaced.
import { suite } from './lib.mjs';
import crypto from 'node:crypto';
import { readSets, problems, run } from '../scripts/asc-shots.mjs';
import { client } from '../scripts/asc-text.mjs';
const { check, eq, done } = suite('store pictures');

const sets = readSets(), s = sets.APP_IPHONE_67;
eq(problems(sets), [], 'the pictures in the repo are the size Apple wants for the 6.9" iPhone, and no more than 10');
check(s.files.length >= 5 && /-1-highlights/.test(s.files[0].name), 'they go in order, highlights first: ' + s.files.map((f) => f.name).join(', '));
const tiny = Buffer.from(s.files[0].buf); tiny.writeUInt32BE(1206, 16);
check(problems({ APP_IPHONE_67: { ...s, files: [{ name: 'x.png', buf: tiny }] } }).some((p) => /1206 × 2622|1206 ×/.test(p)), 'a picture the wrong size is caught');

// a stand-in App Store Connect
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { ASC_KEY_ID: 'K', ASC_ISSUER_ID: 'I', ASC_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
let n = 0; const shots = {}, sets2 = { ss1: { loc: 'vl1', type: 'APP_IPHONE_67', ids: ['old1', 'old2'] }, ss2: { loc: 'vl2', type: 'APP_IPHONE_67', ids: ['old3'] } };
for (const id of ['old1', 'old2', 'old3']) shots[id] = { sum: 'x', uploaded: true };
const bytes = {}, calls = [];
async function apple(url, opts) {
  const p = url.replace('https://api.appstoreconnect.apple.com', ''), m = opts.method;
  calls.push(m + ' ' + p);
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (p === '/v1/apps?filter[bundleId]=com.randomedp.aipoweredtactics') return reply(200, { data: [{ id: 'app1' }] });
  if (p === '/v1/apps/app1/appStoreVersions?filter[platform]=IOS&limit=5') return reply(200, { data: [
    { id: 'v1', attributes: { versionString: '1.0', appVersionState: 'WAITING_FOR_REVIEW' } }, { id: 'v2', attributes: { versionString: '1.1', appVersionState: 'PREPARE_FOR_SUBMISSION' } }] });
  if (p === '/v1/appStoreVersions/v1/appStoreVersionLocalizations') return reply(200, { data: [{ id: 'vl1', attributes: { locale: 'en-GB' } }] });
  if (p === '/v1/appStoreVersions/v2/appStoreVersionLocalizations') return reply(200, { data: [{ id: 'vl2', attributes: { locale: 'en-GB' } }] });
  let r = p.match(/^\/v1\/appStoreVersionLocalizations\/(\w+)\/appScreenshotSets$/);
  if (r) return reply(200, { data: Object.entries(sets2).filter(([, x]) => x.loc === r[1]).map(([id, x]) => ({ id, attributes: { screenshotDisplayType: x.type } })) });
  r = p.match(/^\/v1\/appScreenshotSets\/(\w+)\/appScreenshots$/);
  if (r) return reply(200, { data: sets2[r[1]].ids.map((id) => ({ id, attributes: { sourceFileChecksum: shots[id].sum } })) });
  if (m === 'POST' && p === '/v1/appScreenshots') {
    const id = 'new' + ++n, set = body.data.relationships.appScreenshotSet.data.id;
    if (sets2[set].loc === 'vl1') return reply(409, { errors: [{ code: 'STATE_ERROR' }] });
    shots[id] = { size: body.data.attributes.fileSize, uploaded: false }; sets2[set].ids.push(id);
    return reply(201, { data: { id, attributes: { uploadOperations: [{ method: 'PUT', url: 'https://upload.example/' + id, offset: 0, length: body.data.attributes.fileSize, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }] } } });
  }
  r = p.match(/^\/v1\/appScreenshots\/(\w+)$/);
  if (r && m === 'PATCH') { Object.assign(shots[r[1]], { uploaded: body.data.attributes.uploaded, sum: body.data.attributes.sourceFileChecksum }); return reply(200, { data: {} }); }
  if (r && m === 'DELETE') { for (const x of Object.values(sets2)) x.ids = x.ids.filter((i) => i !== r[1]); delete shots[r[1]]; return reply(204); }
  r = p.match(/^\/v1\/appScreenshotSets\/(\w+)\/relationships\/appScreenshots$/);
  if (r && m === 'PATCH') { sets2[r[1]].ids = body.data.map((x) => x.id); return reply(204); }
  return reply(404, { errors: [] });
}
const put = async (url, opts) => { bytes[url.split('/').pop()] = opts.body.length; return { ok: true, status: 200 }; };
const api = client(env, apple);

const shown = await run(api, sets, { send: false, put });
check(!calls.some((c) => /^(POST|PATCH|DELETE)/.test(c)), 'show changes nothing');
check(shown.some((l) => /1\.1 .*would replace 1 pictures with \d+/.test(l)), 'show says the version being got ready would get the new pictures: ' + shown.join(' | '));
check(shown.some((l) => /1\.0 .*locked by Apple, nothing changed/.test(l)), 'and that the one waiting for review is locked');

const sent = await run(api, sets, { send: true, put });
eq(sets2.ss1.ids, ['old1', 'old2'], 'the version waiting for review keeps its pictures, untouched');
eq(sets2.ss2.ids.length, s.files.length, 'the version being got ready has exactly the new pictures');
check(sets2.ss2.ids.every((id) => shots[id] && shots[id].uploaded && bytes[id] === shots[id].size), 'each one uploaded whole and marked as uploaded');
check(!shots.old3, 'the old picture is gone');
check(calls.findIndex((c) => c === 'DELETE /v1/appScreenshots/old3') > calls.lastIndexOf('POST /v1/appScreenshots'), 'the old one is only deleted once every new one is up');
check(sent.some((l) => /replaced 1 pictures with/.test(l)), 'the log says so: ' + sent.join(' | '));

const again = await run(api, sets, { send: true, put });
check(again.some((l) => /1\.1 .*already up to date/.test(l)), 'sending twice changes nothing more: ' + again.join(' | '));
await done();
