// Read-only: prints what Apple's API says about the header and search slots of each version, in full, for working out
// why App Store Connect still says "Header Image - This field is required".
import { BUNDLE_ID, client } from './asc-text.mjs';
const api = client();
const j = (x) => JSON.stringify(x, null, 1).slice(0, 4000);
const tryGet = async (p) => { try { return await api(p); } catch (e) { return { error: e.message.slice(0, 600) }; } };
const app = (await api(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
console.log('refData', j(await tryGet('/v1/appAssetLibraryRefData')));
const versions = await api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=3`);
for (const v of versions.data) {
  console.log('== version', v.attributes.versionString, v.attributes.appVersionState);
  for (const loc of (await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data) {
    console.log('-- loc', loc.attributes.locale, loc.id);
    console.log(j(await tryGet(`/v1/appStoreVersionLocalizations/${loc.id}/placements?limit=50&include=image`)));
  }
}
const lib = (await api(`/v1/apps/${app.id}/assetLibrary`)).data;
const imgs = (await api(`/v1/appAssetLibraries/${lib.id}/images?limit=200`)).data;
for (const i of imgs.filter((x) => /header|search/.test(x.attributes.fileName))) console.log('img', i.id, j(i.attributes));
