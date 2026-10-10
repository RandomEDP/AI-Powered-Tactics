// Keeps CI from filling the Apple account with signing certificates.
// Every signed build on a fresh GitHub Mac makes Xcode create a new development certificate, and Apple caps how many
// an account can hold. This lists the account's certificates before a build, and afterwards revokes only the
// development certificates that build created.
//   node scripts/asc-certs.mjs list > before.txt
//   node scripts/asc-certs.mjs revoke-new before.txt
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 in the environment.
import crypto from 'node:crypto';
import fs from 'node:fs';

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }) + '.' + b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head), { key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' });
  return head + '.' + sig.toString('base64url');
}
async function api(path, method = 'GET') {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, { method, headers: { Authorization: 'Bearer ' + token() } });
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return method === 'DELETE' ? null : res.json();
}
async function certificates() {
  const out = []; let path = '/v1/certificates?limit=200&fields[certificates]=certificateType,displayName,name,expirationDate';
  while (path) { const page = await api(path); out.push(...page.data); path = page.links && page.links.next ? page.links.next.replace('https://api.appstoreconnect.apple.com', '') : null; }
  return out;
}

const mode = process.argv[2];
const all = await certificates();
if (mode === 'list') {
  for (const c of all) console.log(c.id);
  console.error(`The account holds ${all.length} certificates: ` + all.map((c) => c.attributes.certificateType).join(', '));
} else if (mode === 'revoke-new') {
  const before = new Set(fs.readFileSync(process.argv[3], 'utf8').split(/\s+/).filter(Boolean));
  const made = all.filter((c) => !before.has(c.id) && /DEVELOPMENT/.test(c.attributes.certificateType || ''));
  for (const c of made) { await api('/v1/certificates/' + c.id, 'DELETE'); console.log('Revoked the development certificate this build created: ' + (c.attributes.name || c.id)); }
  if (!made.length) console.log('This build created no development certificates.');
} else {
  console.error('Usage: asc-certs.mjs list | revoke-new <file>'); process.exit(2);
}
