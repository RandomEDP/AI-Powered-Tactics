// Says what Apple's side holds for signing the app and the App Clip with the shared app group, and can clear out
// provisioning profiles that were made before the group was ticked, so the next signed build makes fresh ones.
// Build 266 and 274 failed with "Provisioning profile ... doesn't match the entitlements file's value for the
// com.apple.security.application-groups entitlement" even after the group was ticked on both bundle ids.
//   node scripts/asc-profiles.mjs check     (changes nothing)
//   node scripts/asc-profiles.mjs refresh   (deletes only profiles for these bundle ids that lack the group)
// Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 in the environment.
import crypto from 'node:crypto';

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
const IDS = ['com.randomedp.aipoweredtactics', 'com.randomedp.aipoweredtactics.Clip'];
const GROUP = 'group.Com.randomedp.aipoweredtactics';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }) + '.' + b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head), { key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' });
  return head + '.' + sig.toString('base64url');
}
async function api(path, method = 'GET') {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, { method, headers: { Authorization: 'Bearer ' + token() } });
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 400));
  return method === 'DELETE' ? null : res.json();
}
// The groups a profile grants, read from the plist inside its signed wrapper.
export function profileGroups(content) {
  const text = Buffer.from(content, 'base64').toString('latin1');
  const m = text.match(/<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
  return m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]) : null;
}

const mode = process.argv[2];
if (mode !== 'check' && mode !== 'refresh') { console.error('Usage: asc-profiles.mjs check | refresh'); process.exit(2); }
let stale = 0;
for (const ident of IDS) {
  const res = await api('/v1/bundleIds?filter[identifier]=' + encodeURIComponent(ident) + '&include=bundleIdCapabilities,profiles&limit=5');
  const b = res.data.find((x) => x.attributes.identifier === ident);
  if (!b) { console.log(`${ident}: not registered with Apple`); continue; }
  const inc = res.included || [];
  const caps = inc.filter((x) => x.type === 'bundleIdCapabilities').map((x) => x.attributes.capabilityType);
  console.log(`${ident}: capabilities ${caps.sort().join(', ') || 'none'}`);
  console.log(`  App Groups ${caps.includes('APP_GROUPS') ? 'is' : 'is NOT'} switched on`);
  const profiles = inc.filter((x) => x.type === 'profiles');
  if (!profiles.length) console.log('  no provisioning profiles (the next signed build makes them)');
  for (const p of profiles) {
    const a = p.attributes, groups = profileGroups(a.profileContent || '');
    const has = !!groups && groups.includes(GROUP);
    console.log(`  profile "${a.name}" (${a.profileType}, ${a.profileState}, made ${a.createdDate}): app groups ${groups ? groups.join(', ') || 'none' : 'not in it'}`);
    if (!has) {
      stale++;
      if (mode === 'refresh') {
        try { await api('/v1/profiles/' + p.id, 'DELETE'); console.log('    deleted, so the next build makes a fresh one'); }
        catch (e) { console.log('    could not delete it: ' + e.message); }
      }
    }
  }
}
console.log(stale ? `${stale} profile(s) without ${GROUP}.` : `Every profile has ${GROUP}.`);
