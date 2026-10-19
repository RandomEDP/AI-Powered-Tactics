// Using the rest of Gaffer while the highlights are cut (Ethan: "you should be able to leave that page when it is creating
// highlights and then it has a banner somewhere to display progress", and "have ads showing below while it's creating").
// The cut carries on when you leave its screen; a bar above the tab bar says how it's going and goes back to it; a second
// cut can't start, nor can another team be opened, while one runs. On the free tier a banner ad sits under the cut screen
// once the 30-second ad has closed, and goes when you leave it or the cut ends.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phone: cutting in the background');
const w = await world();

const native = () => { // the native ReelCutter and Google's AdMob, as the web app sees them
  window.__rc = []; window.__ad = []; const L = {};
  let cfg; Object.defineProperty(window, 'APT_CONFIG', { configurable: true, get: () => cfg, set: (v) => { cfg = v; if (v && v.ads) v.ads.banner = 'ca-app-pub-2627873247729818/0000000001'; } }); // (a banner unit, as Ethan will make in AdMob)
  window.Capacitor.Plugins.ReelCutter = {
    addListener: (n, f) => { if (n === 'progress') window.__prog = f; return { remove() {} }; },
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    readable: async () => ({ bad: [] }),
    cut: async (o) => { window.__rc.push(['cut', o]); if (window.__prog) window.__prog({ stage: 'clip', i: 0, n: o.clips.length, p: 0.5 }); await window.__hold;
      return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile } }; },
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
  window.Capacitor.Plugins.AdMob = {
    initialize: async () => { window.__ad.push('initialize'); }, requestConsentInfo: async () => ({ status: 'NOT_REQUIRED', canRequestAds: true }),
    trackingAuthorizationStatus: async () => ({ status: 'denied' }), requestTrackingAuthorization: async () => {},
    prepareRewardVideoAd: async (o) => { window.__ad.push('prepare'); return { adUnitId: o.adId }; },
    addListener: (n, f) => { (L[n] = L[n] || []).push(f); return Promise.resolve({ remove: () => { L[n] = (L[n] || []).filter((x) => x !== f); } }); },
    showRewardVideoAd: () => { window.__ad.push('show'); setTimeout(() => (L.onRewardedVideoAdShowed || []).forEach((f) => f()), 300);
      return new Promise((res) => setTimeout(() => { (L.onRewardedVideoAdReward || []).forEach((f) => f({})); res({}); (L.onRewardedVideoAdDismissed || []).forEach((f) => f()); }, 30000)); },
    showBanner: async (o) => { window.__ad.push(['banner', o]); (L.bannerAdSizeChanged || []).forEach((f) => f({ width: 390, height: 62 })); },
    removeBanner: async () => { window.__ad.push('unbanner'); },
  };
};
const ads = () => A.page.evaluate(() => window.__ad.map((x) => (Array.isArray(x) ? x[0] : x)));
const bar = async () => (await A.visible('#cutBar')) ? A.page.$eval('#cutBar', (b) => b.querySelector('.cbtext b').textContent + ': ' + b.querySelector('.cbtext span').textContent) : null;
const out = process.argv[2], shot = async (name) => { if (out) await A.page.screenshot({ path: `${out}/${name}.png` }); };

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(native); await A.page.reload(); await A.run(500);
await A.page.evaluate(() => { window.__hold = new Promise((r) => { window.__go = r; }); }); // (the cut takes as long as the test wants)
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); if (await A.visible('#benchOk')) await A.click('#benchOk'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);

// ---------- the cut starts: the 30-second ad first, then the banner under the cut screen
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
if (await A.visible('#cutBody [data-cutdo="next"]')) await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); }); await A.click('#cutBody [data-cutdo="here"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(500);
check(await A.visible('#adAskPop'), 'on the free tier the 30-second ad is offered first');
await A.click('#adAskYes'); await A.run(3000);
eq([(await ads()).includes('show'), (await ads()).includes('banner')], [true, false], 'the 30-second ad plays, with no banner over it');
await A.run(31000);
const ban = await A.page.evaluate(() => (window.__ad.find((x) => Array.isArray(x) && x[0] === 'banner') || [])[1]);
eq(ban && [ban.adId, ban.position, ban.adSize, ban.isTesting], ['ca-app-pub-2627873247729818/0000000001', 'BOTTOM_CENTER', 'ADAPTIVE_BANNER', false], 'once it closes, Gaffer\'s banner ad goes along the bottom of the cut screen');
check(await A.page.evaluate(() => document.body.classList.contains('adbanned') && getComputedStyle(document.documentElement).getPropertyValue('--adban').trim() === '62px'), 'and the screen makes room for it, as tall as Google says it is');
const work = await A.text('#cutBody');
check(/Cutting clip 1 of 1, 50%/.test(work) && /You can use the rest of Gaffer while it cuts/.test(work) && /iOS pauses the cutting once Gaffer is put away/.test(work), 'the cut screen says how far it\'s got, that you can use the rest of Gaffer, and to keep Gaffer open');
check(await bar() === null, 'no bar on the cut screen itself');
await shot('cutting');

// ---------- leaving: the cut carries on, the bar shows it, the banner goes
await A.click('#cutBody [data-cutdo="away"]'); await A.run(800);
eq([await A.view(), (await ads()).includes('unbanner')], ['highlights', true], 'Use Gaffer while it cuts goes back to Highlights, and the banner ad goes with the cut screen');
eq(await bar(), 'Highlights v Dog Squad: Cutting clip 1 of 1, 50%', 'a bar above the tab bar says what\'s being cut and how far it\'s got');
check(await A.page.evaluate(() => { const b = document.getElementById('cutBar').getBoundingClientRect(), t = document.querySelector('#tabs .tabrow').getBoundingClientRect(); return b.bottom <= t.top + 1 && b.height >= 44; }), 'sitting just above the tab bar, big enough to tap');
await shot('cutting-bar');
await A.click('#tabs [data-tab="home"]'); await A.run(500);
eq([await A.view(), !!(await bar())], ['home', true], 'it follows you to the Team page');
await A.page.evaluate(() => window.__prog({ stage: 'reel', p: 0.4 })); await A.run(200);
eq(await bar(), 'Highlights v Dog Squad: Joining the full reel, 40%', 'and keeps up with the cut');

// one cut at a time
await A.click('#mHighlights'); await A.run(500); await A.click('#hlList [data-cut]'); await A.run(500);
check(await A.view() === 'cut' && /Joining the full reel, 40%/.test(await A.text('#cutBody')), 'Cut from video while one is running opens the one running, never a second');
eq((await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'cut').length)), 1, 'only one cut was asked of the phone');
check((await ads()).filter((x) => x === 'banner').length === 2, 'back on the cut screen the banner comes back');
await A.click('#v-cut .back'); await A.run(500);

// ---------- done while you're elsewhere
await A.page.evaluate(() => window.__go()); await A.run(3000);
eq(await bar(), 'Highlights v Dog Squad: Ready to watch. Tap to see them.', 'when it finishes elsewhere, the bar says the highlights are ready');
check(w.db().clips.length === 1, 'the clip went up while you were on another screen');
await A.click('#cutBar'); await A.run(500);
check(await A.view() === 'cut' && /now in Highlights for the whole team/.test(await A.text('#cutBody')), 'tapping it opens the finished cut, to share the reel');
check(!(await A.page.evaluate(() => window.__ad.slice(-1)[0] && window.__ad.slice(-1)[0][0] === 'banner')), 'no banner ad once the cut is done');
await A.click('#v-cut .back'); await A.run(500);
eq(await bar(), null, 'once seen, the bar goes');
done();
