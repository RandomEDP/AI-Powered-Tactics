// The App Store text (store/text) and the script that sends it to App Store Connect (scripts/asc-text.mjs), run against
// a stand-in for Apple's API: one version waiting for review (locked, so only the promotional text can change) and a
// new one being got ready (everything can change).
import { suite } from './lib.mjs';
import crypto from 'node:crypto';
import { readText, problems, client, run, FIELDS } from '../scripts/asc-text.mjs';
const { check, eq, done } = suite('store text');

const text = readText();
eq(problems(text), [], 'the text in the repo fits Apple\'s limits and the rules');
eq(Object.keys(text).sort(), Object.keys(FIELDS).sort(), 'every field has a file');
check(text.name === 'Gaffer: Small-Sided Football', 'the name matches the app\'s');
check(!/wrist/i.test(text.subtitle), 'the subtitle doesn\'t lead with the watch');
check(problems({ ...text, subtitle: 'x'.repeat(31) }).some((p) => /31 characters; Apple allows 30/.test(p)), 'a subtitle over 30 characters is caught');
check(problems({ ...text, description: 'Film it on a GoPro' }).some((p) => /iPhone works too/.test(p)), 'GoPro without iPhone is caught');
check(problems({ ...text, description: 'See github.com/x' }).some((p) => /GitHub/.test(p)), 'a GitHub link is caught');
check(problems({ ...text, whats_new: 'Now for every 5-a-side team' }).some((p) => /whats_new.*small-sided/.test(p)), 'What\'s New calling it a 5-a-side app is caught');
check(problems({ ...text, subtitle: 'The 5-a-side app' }).some((p) => /small-sided/.test(p)), 'calling it a 5-a-side app is caught');
check(problems({ ...text, keywords: 'a, b' }).length && problems({ ...text, keywords: 'a,a' }).length, 'wasted or repeated keywords are caught');

// a stand-in App Store Connect
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { ASC_KEY_ID: 'K', ASC_ISSUER_ID: 'I', ASC_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const old = { name: 'Gaffer: 5-a-Side Team Manager', subtitle: 'Old', description: 'Old', keywords: 'old', promotionalText: 'Old' };
const db = {
  'appInfoLocalizations/il1': { locked: true, a: { locale: 'en-GB', name: old.name, subtitle: old.subtitle } },
  'appInfoLocalizations/il2': { locked: false, a: { locale: 'en-GB', name: old.name, subtitle: old.subtitle } },
  'appStoreVersionLocalizations/vl1': { locked: true, a: { locale: 'en-GB', description: old.description, keywords: old.keywords, promotionalText: old.promotionalText } },
  'appStoreVersionLocalizations/vl2': { locked: false, a: { locale: 'en-GB', description: old.description, keywords: old.keywords, promotionalText: old.promotionalText } },
};
const routes = {
  '/v1/apps?filter[bundleId]=com.randomedp.aipoweredtactics': { data: [{ id: 'app1' }] },
  '/v1/apps/app1/appInfos': { data: [{ id: 'i1', attributes: { state: 'WAITING_FOR_REVIEW' } }, { id: 'i2', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
  '/v1/appInfos/i1/appInfoLocalizations': () => ({ data: [{ id: 'il1', attributes: db['appInfoLocalizations/il1'].a }] }),
  '/v1/appInfos/i2/appInfoLocalizations': () => ({ data: [{ id: 'il2', attributes: db['appInfoLocalizations/il2'].a }] }),
  '/v1/apps/app1/appStoreVersions?filter[platform]=IOS&limit=5': { data: [
    { id: 'v1', attributes: { versionString: '1.0', appVersionState: 'WAITING_FOR_REVIEW' } },
    { id: 'v2', attributes: { versionString: '1.1', appVersionState: 'PREPARE_FOR_SUBMISSION' } },
    { id: 'v0', attributes: { versionString: '0.9', appVersionState: 'REPLACED_WITH_NEW_VERSION' } }] },
  '/v1/appStoreVersions/v1/appStoreVersionLocalizations': () => ({ data: [{ id: 'vl1', attributes: db['appStoreVersionLocalizations/vl1'].a }] }),
  '/v1/appStoreVersions/v2/appStoreVersionLocalizations': () => ({ data: [{ id: 'vl2', attributes: db['appStoreVersionLocalizations/vl2'].a }] }),
};
let calls = [], authOk = true;
async function fake(url, opts) {
  const p = url.replace('https://api.appstoreconnect.apple.com', '');
  calls.push(opts.method + ' ' + p);
  const jwt = (opts.headers.Authorization || '').split(' ')[1].split('.');
  const pub = crypto.createPublicKey(privateKey);
  if (!crypto.verify('sha256', Buffer.from(jwt[0] + '.' + jwt[1]), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url'))) authOk = false;
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  if (opts.method === 'PATCH') {
    const row = db[p.slice(4)], body = JSON.parse(opts.body);
    if (!row) return reply(404, { errors: [] });
    const fields = Object.keys(body.data.attributes);
    if (row.locked && fields.some((f) => f !== 'promotionalText' || p.includes('appInfo'))) return reply(409, { errors: [{ code: 'STATE_ERROR' }] });
    Object.assign(row.a, body.data.attributes);
    return reply(200, { data: {} });
  }
  const r = routes[p];
  return r ? reply(200, typeof r === 'function' ? r() : r) : reply(404, { errors: [] });
}
const api = client(env, fake);

const shown = await run(api, text, { send: false });
check(!calls.some((c) => c.startsWith('PATCH')), 'show changes nothing');
check(shown.some((l) => /Version 1.1 .*would change description, keywords, promotionalText/.test(l)), 'show says what would change: ' + shown.join(' | '));
check(!shown.some((l) => /0\.9/.test(l)), 'an old replaced version is left alone');

calls = [];
const sent = await run(api, text, { send: true });
check(authOk, 'every request is signed with the key');
eq(db['appStoreVersionLocalizations/vl2'].a.description, text.description, 'the version being got ready gets the new description');
eq(db['appStoreVersionLocalizations/vl2'].a.keywords, text.keywords, 'and keywords');
eq(db['appStoreVersionLocalizations/vl2'].a.whatsNew, text.whats_new, 'and the What\'s New text');
check(db['appStoreVersionLocalizations/vl1'].a.whatsNew == null, 'the version waiting for review keeps its What\'s New');
eq(db['appInfoLocalizations/il2'].a.name, text.name, 'the editable app information gets the new name');
eq(db['appInfoLocalizations/il2'].a.subtitle, text.subtitle, 'and subtitle');
eq(db['appStoreVersionLocalizations/vl1'].a.description, old.description, 'the version waiting for review keeps its description');
eq(db['appStoreVersionLocalizations/vl1'].a.promotionalText, text.promotional_text, 'but takes the new promotional text');
eq(db['appInfoLocalizations/il1'].a.name, old.name, 'locked app information is left as it is');
check(sent.some((l) => /1\.0 .*only the promotional text was changed/.test(l)), 'the log says the locked version only took the promotional text: ' + sent.join(' | '));
check(sent.some((l) => /WAITING_FOR_REVIEW.*nothing changed/.test(l)), 'and that the locked name waits');

const again = await run(api, text, { send: true });
check(again.filter((l) => /up to date/.test(l)).length === 2, 'sending twice changes only what still differs: ' + again.join(' | '));

// The in-app purchases check (scripts/asc-iap.mjs): it asks for exactly the ids the app does, and says which are missing.
import fs from 'node:fs';
const iap = await import('../scripts/asc-iap.mjs');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appIds = [...html.matchAll(/'(com\.randomedp\.aipoweredtactics\.team\.\w+)'/g)].map((m) => m[1]);
check(appIds.length === 4 && appIds.every((id) => iap.WANTED.includes(id)), 'the purchases check knows every team pass id the app asks for');
check(/VOICE_BUY = 'com\.randomedp\.aipoweredtactics\.voice\.'/.test(html) && iap.WANTED.includes('com.randomedp.aipoweredtactics.voice.steve'), 'and East London Steve');
const iapApi = async (p) => p.startsWith('/v1/apps?') ? { data: [{ id: 'app1' }] }
  : { data: [{ attributes: { productId: 'com.randomedp.aipoweredtactics.voice.steve', name: 'East London Steve 18+', inAppPurchaseType: 'NON_CONSUMABLE', state: 'READY_TO_SUBMIT' } }] };
const lines = await iap.run(iapApi);
check(lines.some((l) => /voice\.steve.*READY_TO_SUBMIT \(ready to submit, but not sent/.test(l)), 'a purchase not yet sent to Apple is worded plainly: ' + lines.join(' | '));
check(lines.filter((l) => /not in App Store Connect/.test(l)).length === 4, 'and the four missing team pass ids are named');
await done();
