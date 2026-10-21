// Says what App Store Connect has for each of Gaffer's in-app purchases (its product id, name, type and state), and
// whether each id the app asks the App Store for is there. Read-only; run by "Update App Store text and pictures".
//   node scripts/asc-iap.mjs        needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8
// A purchase the app can't find ("The App Store doesn't have that yet") is usually one that's missing here, has a
// different product id, or isn't APPROVED yet (or Apple's Paid Apps agreement isn't active, which this can't see).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, BUNDLE_ID } from './asc-text.mjs';

// The ids the app asks for (index.html VOICE_BUY and PASS_IDS).
export const WANTED = ['voice.steve', 'team.month', 'team.chip099', 'team.chip199', 'team.chip299'].map((k) => BUNDLE_ID + '.' + k);

const PLAIN = {
  APPROVED: 'approved, on sale', READY_FOR_SALE: 'approved, on sale', MISSING_METADATA: 'missing details (price, name or review screenshot)',
  READY_TO_SUBMIT: 'ready to submit, but not sent to Apple with a version yet', WAITING_FOR_REVIEW: 'waiting for Apple to review it',
  IN_REVIEW: 'in review', DEVELOPER_ACTION_NEEDED: 'Apple sent it back: something to fix', REJECTED: 'turned down by Apple',
  PENDING_BINARY_APPROVAL: 'waiting for the app version it was sent with', DEVELOPER_REMOVED_FROM_SALE: 'taken off sale',
  REMOVED_FROM_SALE: 'removed from sale',
};

export async function run(api) {
  const say = [];
  const app = (await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) throw new Error(`App Store Connect has no app with the bundle ID ${BUNDLE_ID}`);
  const iaps = (await api(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`)).data || [];
  const byId = Object.fromEntries(iaps.map((i) => [i.attributes.productId, i.attributes]));
  for (const { attributes: a } of iaps) say.push(`${a.productId}: "${a.name}", ${a.inAppPurchaseType}, ${a.state} (${PLAIN[a.state] || 'see App Store Connect'})`);
  for (const id of WANTED) if (!byId[id]) say.push(`${id}: not in App Store Connect (the app asks for this id; check it's spelt exactly so)`);
  if (!iaps.length) say.push('App Store Connect has no in-app purchases for Gaffer');
  return say;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const v of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']) if (!process.env[v]) { console.error(`::error::The ${v} secret isn't set`); process.exit(1); }
  try { for (const line of await run(client())) console.log(line); }
  catch (e) { console.log(`::warning::Couldn't read the in-app purchases: ${e.message}`); }
}
