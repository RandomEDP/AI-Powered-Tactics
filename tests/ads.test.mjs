// Rewarded ads (the free tier, 0032_rewarded_ads.sql and the ad-reward edge function). Ethan's idea: no banners; instead
// someone chooses to watch a short ad to unlock one thing: another game's highlights, AI commentary on a reel, or a second
// cut. Never during a game, never for a paid team, and the unlock can't be faked from the phone once real ads are on:
// Google's AdMob calls our server, signed, and only that grants it.
//   1. the database: tickets, grants, the free try, one cut from an ad a month, commentary unlocks, who may do what
//   2. the real ad-reward function: Google's signature checked (a key made here stands in for Google's)
//   3. the phones: a gaffer on the free tier through two games, a player, and a game going on
import { world, suite, ROOT } from './lib.mjs';
import { database } from './pg.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const { check, eq, done } = suite('rewarded ads');

// ---------- 1. the database
const d = await database();
const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), sam = await d.user('sam@example.com');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#1f6b4a', p_crest: null, p_settings: {}, p_players: [{ pid: 1, name: 'Spice' }, { pid: 2, name: 'Jake' }] });
await d.rpc(jake, 'claim_player', { p_code: sop.code, p_pid: 2, p_last_name: '', p_position: 'fwd' });
const game = async (seq) => (await d.admin(`insert into public.games (id, team_id, seq, opp, us, them) values (gen_random_uuid(), $1, $2, 'Dog Squad', 2, 1) returning id`, [sop.id, seq]))[0].id;
const g1 = await game(1), g2 = await game(2), g3 = await game(3);
const un = (who) => d.rpc(who, 'my_unlocks', { p_code: sop.code });

eq(await d.rpc(null, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: g1 }).catch(() => 'denied'), 'denied', 'nobody can ask for an ad without signing in');
const priv = await d.admin(`select has_function_privilege('authenticated', 'public.ad_grant(text,text,text)', 'execute') a, has_function_privilege('anon', 'public.ad_grant(text,text,text)', 'execute') n, has_function_privilege('service_role', 'public.ad_grant(text,text,text)', 'execute') s`);
eq([priv[0].a, priv[0].n, priv[0].s], [false, false, true], 'only the server (the ad-reward function) can grant an ad: not a signed-in phone, not anyone');
for (const who of [null, sam, jake]) eq([await d.as(who, 'select count(*)::int n from public.unlocks').then((r) => r[0].n, () => 'denied'), await d.as(who, 'select count(*)::int n from public.ad_settings').then((r) => r[0].n, () => 'denied')].map((x) => x === 0 || x === 'denied'), [true, true], 'nobody reads or writes the unlocks or the ad settings directly');

// another game's highlights
let tk = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: g1 });
check(/^[0-9a-f-]{36}$/.test(tk.ticket), 'a player gets a ticket for an ad to unlock a game');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: '00000000-0000-0000-0000-000000000000' }), { error: 'no_game' }, 'only for a game of that team');
eq(await d.rpc(sam, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'no_ticket', 'someone else can\'t claim their ticket');
eq((await un(jake)).games, [], 'nothing is unlocked before the ad');
eq(await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'granted', 'with test ads (trust_app on) the app\'s word that the ad finished is taken');
eq((await un(jake)).games, [g1], 'and that game is unlocked for them');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: g1 }), { error: 'not_needed' }, 'no second ad for a game already unlocked');
eq((await un(ethan)).games, [], 'it\'s theirs only, not the whole team\'s');

// real ads: only Google's signed call grants it
await d.admin(`update public.ad_settings set trust_app = false`);
tk = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: g2 });
eq(await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'waiting', 'with real ads, the app saying the ad finished unlocks nothing');
const grant = (t, u, tx) => d.admin(`select public.ad_grant($1, $2, $3) r`, [t, u, tx]).then((r) => r[0].r);
eq(await grant(tk.ticket, sam.id, 'tx-1'), 'wrong_user', 'Google\'s call must name the account the ad was loaded for');
eq(await grant('not-a-ticket', jake.id, 'tx-1'), 'no_ticket', 'and a real ticket');
eq(await grant(tk.ticket, jake.id, 'tx-1'), 'granted', 'Google\'s call grants it');
eq(await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket }), 'granted', 'and the app is told so');
const tk2 = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: g3 });
eq(await grant(tk2.ticket, jake.id, 'tx-1'), 'duplicate', 'one ad pays once: its transaction can\'t grant a second ticket');
eq((await d.admin(`select by_google from public.unlocks where id = $1`, [tk.ticket]))[0].by_google, true, 'a grant from Google is marked as one');
await d.admin(`update public.ad_settings set trust_app = true`);

// cuts: the team's free try, then one from an ad a month
eq(await d.rpc(jake, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g1 }), 'none', 'a player can\'t cut');
eq((await un(ethan)).free_cut, true, 'a new team has its free cut');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g1 }), 'free', 'the first cut is the free try');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g1 }), 'ok', 'cutting the same game again costs nothing');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g2 }), 'none', 'another game needs an ad');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'cut' }), { error: 'not_allowed' }, 'only a gaffer can watch for a cut');
tk = await d.rpc(ethan, 'ad_ticket', { p_code: sop.code, p_kind: 'cut' });
eq(await d.rpc(ethan, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'granted', 'the gaffer watches one');
let u = await un(ethan);
eq([u.free_cut, u.cut_ready, u.cut_month, u.cut_games], [false, true, true, [g1]], 'and has a cut waiting');
eq(await d.rpc(ethan, 'ad_ticket', { p_code: sop.code, p_kind: 'cut' }), { error: 'month' }, 'one cut from an ad a month');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g2 }), 'ad', 'which goes on the next game cut');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g3 }), 'none', 'and then that\'s it until next month');
await d.admin(`update public.unlocks set granted_at = granted_at - interval '40 days' where kind = 'cut' and source = 'ad'`);
eq((await un(ethan)).cut_month, false, 'next month, another');
eq(await d.rpc(ethan, 'use_unlock', { p_code: sop.code, p_kind: 'cut', p_target: g2 }), 'ok', 'a game cut with an ad stays paid for');

// commentary
eq(await d.rpc(sam, 'ad_ticket', { p_code: sop.code, p_kind: 'voice' }), { error: 'not_allowed' }, 'commentary is for the gaffers and the squad\'s players');
eq(await d.rpc(jake, 'use_unlock', { p_code: sop.code, p_kind: 'voice' }), 'none', 'no commentary without an ad');
tk = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'voice' }); await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true });
eq([(await un(jake)).voice, (await un(ethan)).voice], [1, 0], 'one ad, one commentary, for whoever watched it');
eq([await d.rpc(jake, 'use_unlock', { p_code: sop.code, p_kind: 'voice' }), await d.rpc(jake, 'use_unlock', { p_code: sop.code, p_kind: 'voice' })], ['ok', 'none'], 'used once');
await d.admin(`delete from auth.users where id = $1`, [jake.id]);
eq((await d.admin(`select count(*)::int n from public.unlocks where user_id is null and kind = 'voice'`))[0].n, 1, 'a deleted account leaves nothing that names them');

// ---------- 2. the ad-reward function, with stand-ins for Deno, the database and Google's keys
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' }, GRANTS = [];
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), spki = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
let keyFetches = 0;
globalThis.fetch = async (url) => { if (String(url) !== 'https://www.gstatic.com/admob/reward/verifier-keys.json') throw new Error('unexpected fetch ' + url); keyFetches++;
  return new Response(JSON.stringify({ keys: [{ keyId: 3335741209, pem: '', base64: spki }] }), { status: 200 }); };
globalThis.__createClient = () => ({ rpc: async (name, args) => { GRANTS.push([name, args]); return { data: 'granted', error: null }; } });
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/ad-reward/index.ts'), 'utf8')
  .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
  .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
check(!/^import /m.test(src), 'its only imports are the two that have stand-ins here');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), 'ad-reward.ts'); fs.writeFileSync(file, src);
const { derToRaw } = await import(file);
const websafe = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const google = (params, { key = pair.privateKey, keyId = '3335741209', tamper } = {}) => { // a callback as AdMob makes it: the query signed, then signature and key_id last
  const q = new URLSearchParams(params).toString(), sig = crypto.sign('sha256', Buffer.from(q), key);
  return `https://x.supabase.co/functions/v1/ad-reward?${tamper ? tamper(q) : q}&signature=${websafe(sig)}&key_id=${keyId}`;
};
const hit = async (url) => { const r = await handler(new Request(url)); return [r.status, await r.text()]; };
const P = { ad_network: '5450213213286189855', ad_unit: '1712485313', custom_data: '11111111-2222-3333-4444-555555555555', reward_amount: '1', reward_item: 'Reward', timestamp: '1760540000000', transaction_id: 'tx-abc', user_id: 'user-1' };
eq((await hit('https://x.supabase.co/functions/v1/ad-reward'))[0], 200, 'AdMob\'s "Verify URL" check (no ad behind it) gets a 200');
eq(await hit(google(P)), [200, '{"result":"granted"}'], 'a call signed with Google\'s key grants the ticket');
eq(GRANTS.pop(), ['ad_grant', { p_ticket: P.custom_data, p_user: 'user-1', p_tx: 'tx-abc' }], 'passing on the ticket, the account and Google\'s transaction id');
eq((await hit(google(P, { tamper: (q) => q.replace('user-1', 'user-2') })))[0], 403, 'a call changed after Google signed it is turned away');
eq((await hit(google(P, { key: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey })))[0], 403, 'and one signed with any other key');
eq((await hit(google(P, { keyId: '999' })))[0], 403, 'and one naming a key Google doesn\'t have');
ENV.ADMOB_AD_UNITS = 'ca-app-pub-1234/999';
eq((await hit(google(P)))[0], 403, 'with ADMOB_AD_UNITS set, only those ad units are taken');
ENV.ADMOB_AD_UNITS = 'ca-app-pub-1234/1712485313';
eq((await hit(google(P)))[0], 200, 'Gaffer\'s own unit is');
eq(GRANTS.length, 1, 'only the good calls reached the database');
check(keyFetches >= 1 && keyFetches <= 3, `Google's keys are fetched once and kept (fetched ${keyFetches} times)`);
const der = Buffer.from('3045022100' + 'ff'.repeat(32) + '0220' + '01'.repeat(32), 'hex'), raw = derToRaw(new Uint8Array(der));
eq([raw.length, raw[0], raw[32]], [64, 255, 1], 'Google\'s DER signatures become the 64-byte form the check needs (the leading zero of a high r dropped)');

// ---------- 3. the phones
const w = await world();
const setup = () => { // the native parts: the highlight cutter and Google's AdMob, as the web app sees them
  window.__ad = []; const L = {};
  window.Capacitor.Plugins.AdMob = {
    initialize: async (o) => { window.__ad.push('initialize'); }, requestConsentInfo: async () => { window.__ad.push('consent'); return { status: 'NOT_REQUIRED', canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }; },
    trackingAuthorizationStatus: async () => ({ status: window.__att || 'notDetermined' }), requestTrackingAuthorization: async () => { window.__ad.push('att'); window.__att = 'denied'; },
    prepareRewardVideoAd: async (o) => { window.__ad.push(['prepare', o]); return { adUnitId: o.adId }; },
    addListener: (n, f) => { (L[n] = L[n] || []).push(f); return Promise.resolve({ remove: () => { L[n] = (L[n] || []).filter((x) => x !== f); } }); },
    showRewardVideoAd: () => { window.__ad.push('show'); const early = window.__adEarly; return new Promise((res) => setTimeout(() => {
      if (!early) { (L.onRewardedVideoAdReward || []).forEach((f) => f({ type: 'Reward', amount: 1 })); res({ type: 'Reward', amount: 1 }); }
      (L.onRewardedVideoAdDismissed || []).forEach((f) => f()); }, 30000)); }, // (a 30-second ad)
    showPrivacyOptionsForm: async () => { window.__ad.push('choices'); },
  };
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }), pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { (window.__cuts = window.__cuts || []).push(o); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14) } }; },
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }), share: async () => ({}), cleanup: async () => ({}), readable: async () => ({ bad: [] }),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
};
const out = process.argv[2], shot = async (Ph, name) => { if (out) await Ph.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/ads.test.mjs <dir> to look at it
const ads = (Ph) => Ph.page.evaluate(() => window.__ad.slice());
const cuts = (Ph) => Ph.page.evaluate(() => (window.__cuts || []).length);
const home = (Ph) => Ph.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const playGame = async (Ph, opp) => {
  await Ph.newGame(opp); if (await Ph.visible('#benchOk')) await Ph.click('#benchOk');
  await Ph.click('#go'); await Ph.run(40000);
  await Ph.click('#goalUs'); await Ph.click('#picker button[data-p="2"]'); await Ph.click('#picker button[data-p="3"]'); await Ph.run(30000);
  await Ph.click('#finish'); await Ph.click('#finish'); await Ph.run(1500); await home(Ph); await Ph.run(400);
};
const cutFirst = async (Ph) => { // the newest game, one camera, kick-off lined up, then the cut screen's last step
  await Ph.click('#hlList [data-cut]');
  const bx = await Ph.page.locator('#camSvg').boundingBox(); await Ph.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await Ph.run(600);
  await Ph.click('#cutBody [data-cutdo="next"]');
  await Ph.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
  await Ph.click('#cutBody [data-cutdo="here"]');
};

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(setup); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');

await playGame(A, 'Dog Squad');
await A.click('#mHighlights'); await A.run(500);
eq(await A.page.$$eval('#hlList [data-ad]', (b) => b.length), 0, 'early access (everyone has Gaffer): no ads anywhere');
await home(A); await A.run(300); await A.click('#mOptions'); await A.run(300);
eq([await A.visible('#expAdsRow'), await A.visible('#optAds')], [false, false], 'the free tier can only be tried behind the Experimental switch');
await A.check('#expTrack'); await A.run(300); if (await A.visible('#planOk')) await A.click('#planOk');
await A.check('#expAds'); await A.run(1500);
eq([await A.visible('#expAdsRow'), await A.visible('#optAds')], [true, true], 'Try the free tier, and Settings then has an Ads section (Ad choices)');
check(/never ads during a game/.test(await A.text('#optAds')), 'which says there are never ads during a game');
await A.click('#optAdsBtn'); await A.run(500);
check((await ads(A)).includes('choices'), 'Ad choices opens Google\'s form to change the answer about personalised ads');
await home(A); await A.run(300); await A.run(300);

// the free try: the first cut needs no ad; commentary does
await A.click('#mHighlights'); await A.run(1500);
await cutFirst(A);
await shot(A, 'cut-voice-ad');
eq([await A.visible('#cutVoice'), await A.page.$$eval('#cutBody [data-ad="voice"]', (b) => b.length)], [false, 1], 'on the free tier the commentary switch is replaced by "Watch a short ad for commentary"');
await A.click('#cutBody [data-ad="voice"]'); await A.run(2000);
const prep = (await ads(A)).find((x) => Array.isArray(x) && x[0] === 'prepare')[1];
eq((await ads(A)).filter((x) => typeof x === 'string'), ['initialize', 'consent', 'att', 'choices', 'show'], 'Google\'s ads are started, the consent check runs, Apple\'s tracking question is asked once, then the ad plays');
eq([prep.adId, prep.isTesting, prep.ssv.userId === (w.db().users.find((x) => x.email === 'ethan@example.com') || {}).id, /^tk-/.test(prep.ssv.customData)], ['ca-app-pub-3940256099942544/1712485313', true, true, true], 'Google\'s test rewarded ad, carrying the account and the ticket for the server-side check');
check(/playing/.test(await A.text('#cutBody')), 'it says the ad is playing');
await A.run(31000); await A.run(1500);
eq(await A.visible('#cutVoice'), true, 'watched to the end: the commentary switch appears');
check(/Commentary unlocked/.test(await A.text('#cutBody')), 'and it says so');
await A.page.check('#cutVoice'); await A.run(300);
await A.page.evaluate(() => localStorage.setItem('apt-voice', JSON.stringify({ voice: 'Puck', style: 'hype' })));
await A.click('#cutBody [data-cutdo="go"]'); await A.run(300); if (await A.visible('#aiYes')) await A.click('#aiYes');
await A.run(4000);
eq(await cuts(A), 1, 'the free cut goes ahead');
eq((w.db().calls || []).filter((x) => x.name === 'reel-voice').map((x) => x.body.voice), ['Fenrir'], 'commentary from an ad is read in the free voice, even with a paid voice picked');
eq([(w.db().unlocks || []).filter((x) => x.kind === 'cut' && x.source === 'free').length, (w.db().unlocks || []).filter((x) => x.kind === 'voice' && x.used_at).length], [1, 1], 'using the team\'s free try and the commentary unlock');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(800);

// game two: the free try is used, so cutting it needs an ad
await home(A); await A.run(300); await A.run(300);
await playGame(A, 'Rovers');
await A.click('#mHighlights'); await A.run(1500);
const g2card = '#hlList .hcard:first-child';
eq([await A.page.$$eval(g2card + ' [data-cut]', (b) => b.length), await A.page.$$eval(g2card + ' [data-ad="cut"]', (b) => b.length)], [0, 1], 'with the free cut used, the next game offers an ad for another cut');
check(/free cut is used/.test(await A.text(g2card)), 'saying why');
await shot(A, 'cut-offer');
await A.page.evaluate(() => { window.__adEarly = true; });
await A.click(g2card + ' [data-ad="cut"]'); await A.run(32000);
check(/closed before the end/.test(await A.text(g2card)) && await A.page.$$eval(g2card + ' [data-cut]', (b) => b.length) === 0, 'an ad closed early unlocks nothing, and says so');
await A.page.evaluate(() => { window.__adEarly = false; });
await A.click(g2card + ' [data-ad="cut"]'); await A.run(32000); await A.run(1500);
eq(await A.page.$$eval(g2card + ' [data-cut]', (b) => b.length), 1, 'watched to the end: the cut button is back');
eq((await ads(A)).filter((x) => x === 'att').length, 1, 'Apple\'s tracking question is only ever asked once');
await cutFirst(A); await A.click('#cutBody [data-cutdo="go"]'); await A.run(4000);
eq(await cuts(A), 2, 'and the second game is cut');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(1500);
eq([await A.page.$$eval(g2card + ' [data-cut]', (b) => b.length), /month/.test(await A.text('#hlList'))], [1, false], 'cutting a game again costs nothing');

// the older game: the newest game's highlights are free, others need an ad each
const g1card = '#hlList .hcard:has-text("Dog Squad")';
eq([await A.page.$$eval(g2card + ' .mhbtn', (b) => b.length), await A.page.$$eval(g1card + ' .mhbtn', (b) => b.length), await A.page.$$eval(g1card + ' [data-ad="game"]', (b) => b.length)], [1, 0, 1], 'the newest game\'s highlights play; the older game\'s are behind a short ad');
check(/newest game’s highlights are free/.test(await A.text(g1card)), 'which it explains');
await shot(A, 'locked-game');

// a player: the same lock, and an ad is never shown while a game is set up or going
const db = w.db(); db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword', meta: { terms: 1 } });
db.players.find((p) => p.pid === 2).user_id = 'u-jake'; db.profiles = (db.profiles || []).concat({ user_id: 'u-jake', username: 'jake_p', name: 'Jake', private: false, pins: [] }); w.setDb(db);
const J = await w.phone({ db: true, native: true, label: 'jake' });
await J.ctx.addInitScript(setup); await J.ctx.addInitScript(() => { const a = JSON.parse(localStorage.getItem('apt-app')); a.exp = { track: true, ads: true }; localStorage.setItem('apt-app', JSON.stringify(a)); });
await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.page.evaluate(() => { const b = document.querySelector('[data-go="account"]'); if (b) b.click(); }); await J.run(300);
if (await J.visible('#aEmail')) { await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500); }
if (await J.view() !== 'home') { await J.click('#myTeams button, #myTeams a'); await J.run(1500); }
await home(A); await A.run(300); await A.run(300); await A.newGame('Athletic'); await A.run(3000); await J.run(25000);
await J.click('#mHighlights'); await J.run(1500);
eq(await J.page.$$eval(g1card + ' [data-ad="game"]', (b) => b.length), 1, 'a player sees the same lock on the older game');
await J.click(g1card + ' [data-ad="game"]'); await J.run(2000);
eq([(await ads(J)).includes('show'), /never play during a game/.test(await J.text(g1card))], [false, true], 'with a game on, no ad plays: it says to unlock it once the game\'s finished');
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await J.run(25000);
await J.click(g1card + ' [data-ad="game"]'); await J.run(33000); await J.run(1500);
eq([await J.page.$$eval(g1card + ' .mhbtn', (b) => b.length), (w.db().unlocks || []).filter((x) => x.kind === 'game' && x.granted_at).length], [1, 1], 'after the game, the ad unlocks the older game\'s highlights for him');
eq(await A.page.$$eval(g1card + ' [data-ad="game"]', (b) => b.length), 1, 'and only for him');

await done(A, J);
