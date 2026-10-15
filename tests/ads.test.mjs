// Rewarded ads (the free tier, 0035_rewarded_ads.sql and the ad-reward edge function). Ethan: no banners, just a 30-second
// ad to see your own highlight reel. Never during a game, never for a paid team, and the unlock can't be faked from the
// phone once real ads are on: Google's AdMob calls our server, signed, and only that grants it.
//   1. the database: tickets, grants, who may do what
//   2. the real ad-reward function: Google's signature checked (a key made here stands in for Google's)
//   3. the phones: a player on the free tier, a teammate, the gaffer, and a game going on
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
const reel1 = `${sop.id}/players/2/reel-1.mp4`, reel2 = `${sop.id}/players/2/reel-2.mp4`, spiceReel = `${sop.id}/players/1/reel-1.mp4`;
await d.rpc(jake, 'save_player_reel', { p_code: sop.code, p_pid: 2, p_path: reel1, p_marks: [] });
await d.rpc(ethan, 'save_player_reel', { p_code: sop.code, p_pid: 1, p_path: spiceReel, p_marks: [] });
const un = (who) => d.rpc(who, 'my_unlocks', { p_code: sop.code });

eq(await d.rpc(null, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel1 }).catch(() => 'denied'), 'denied', 'nobody can ask for an ad without signing in');
const priv = await d.admin(`select has_function_privilege('authenticated', 'public.ad_grant(text,text,text)', 'execute') a, has_function_privilege('anon', 'public.ad_grant(text,text,text)', 'execute') n, has_function_privilege('service_role', 'public.ad_grant(text,text,text)', 'execute') s`);
eq([priv[0].a, priv[0].n, priv[0].s], [false, false, true], 'only the server (the ad-reward function) can grant an ad: not a signed-in phone, not anyone');
for (const who of [null, sam, jake]) eq([await d.as(who, 'select count(*)::int n from public.ad_unlocks').then((r) => r[0].n, () => 'denied'), await d.as(who, 'select count(*)::int n from public.ad_settings').then((r) => r[0].n, () => 'denied')].map((x) => x === 0 || x === 'denied'), [true, true], 'nobody reads or writes the unlocks or the ad settings directly');

let tk = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel1 });
check(/^[0-9a-f-]{36}$/.test(tk.ticket), 'a player gets a ticket for an ad to see their own reel');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: spiceReel }), { error: 'no_reel' }, 'only their own reel');
const ahead = `${sop.id}/players/2/reel-${Date.now()}.mp4`; // (0037: the reel is made while the ad plays, so the ad unlocks the name it will have)
check(!!(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: ahead })).ticket, 'a player can get a ticket for the name of a new reel in their own folder, before it\'s made');
for (const [bad, why] of [[`${sop.id}/players/1/reel-${Date.now()}.mp4`, 'not in someone else\'s folder'], [`${sop.id}/players/2/reel-${Date.now() - 8 * 86400000}.mp4`, 'not an old name'], [`${sop.id}/players/2/../1/reel-${Date.now()}.mp4`, 'not a name that climbs out of the folder'], [`${sop.id}/players/2/clip-${Date.now()}.mp4`, 'only a reel']])
  eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: bad }), { error: 'no_reel' }, why);
eq(await d.rpc(sam, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel1 }), { error: 'not_allowed' }, 'someone not in the squad gets nothing');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'game', p_target: reel1 }), { error: 'not_allowed' }, 'a reel is the only thing an ad unlocks');
eq(await d.rpc(sam, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'no_ticket', 'someone else can\'t claim their ticket');
eq((await un(jake)).reels, [], 'nothing is unlocked before the ad');
eq(await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'granted', 'with test ads (trust_app on) the app\'s word that the ad finished is taken');
eq((await un(jake)).reels, [reel1], 'and the reel is unlocked for them');
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel1 }), { error: 'not_needed' }, 'no second ad for the same reel');

// a new reel, and real ads: only Google's signed call grants it
await d.rpc(jake, 'save_player_reel', { p_code: sop.code, p_pid: 2, p_path: reel2, p_marks: [] });
eq(await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel1 }), { error: 'no_reel' }, 'a replaced reel can\'t be asked for');
await d.admin(`update public.ad_settings set trust_app = false`);
tk = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel2 });
check(!!tk.ticket, 'a new reel needs a new ad');
eq(await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket, p_app_says: true }), 'waiting', 'with real ads, the app saying the ad finished unlocks nothing');
const grant = (t, u, tx) => d.admin(`select public.ad_grant($1, $2, $3) r`, [t, u, tx]).then((r) => r[0].r);
eq(await grant(tk.ticket, sam.id, 'tx-1'), 'wrong_user', 'Google\'s call must name the account the ad was loaded for');
eq(await grant('not-a-ticket', jake.id, 'tx-1'), 'no_ticket', 'and a real ticket');
eq(await grant(tk.ticket, jake.id, 'tx-1'), 'granted', 'Google\'s call grants it');
eq([await d.rpc(jake, 'ad_claim', { p_ticket: tk.ticket }), (await un(jake)).reels.sort()], ['granted', [reel1, reel2].sort()], 'and the app is told so');
await d.admin(`delete from public.ad_unlocks where target = $1 and tx is null`, [reel1]);
const tk2 = await d.rpc(jake, 'ad_ticket', { p_code: sop.code, p_kind: 'reel', p_target: reel2 });
eq(tk2, { error: 'not_needed' }, '(already unlocked)');
await d.admin(`insert into public.ad_unlocks (id, team_id, user_id, kind, target) values ('11111111-1111-1111-1111-111111111111', $1, $2, 'reel', $3)`, [sop.id, jake.id, reel2]);
eq(await grant('11111111-1111-1111-1111-111111111111', jake.id, 'tx-1'), 'duplicate', 'one ad pays once: its transaction can\'t grant a second ticket');
eq((await d.admin(`select by_google from public.ad_unlocks where id = $1`, [tk.ticket]))[0].by_google, true, 'a grant from Google is marked as one');
await d.admin(`update public.ad_settings set trust_app = true`);
await d.admin(`delete from auth.users where id = $1`, [jake.id]);
eq((await d.admin(`select count(*)::int n from public.ad_unlocks`))[0].n, 0, 'deleting an account deletes its unlocks');

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
const setup = () => { // Google's AdMob, as the web app sees it
  window.__ad = []; const L = {};
  window.Capacitor.Plugins.AdMob = {
    initialize: async () => { window.__ad.push('initialize'); }, requestConsentInfo: async () => { window.__ad.push('consent'); return { status: 'NOT_REQUIRED', canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' }; },
    trackingAuthorizationStatus: async () => ({ status: window.__att || 'notDetermined' }), requestTrackingAuthorization: async () => { window.__ad.push('att'); window.__att = 'denied'; },
    prepareRewardVideoAd: async (o) => { window.__ad.push(['prepare', o]); return { adUnitId: o.adId }; },
    addListener: (n, f) => { (L[n] = L[n] || []).push(f); return Promise.resolve({ remove: () => { L[n] = (L[n] || []).filter((x) => x !== f); } }); },
    showRewardVideoAd: () => { window.__ad.push('show'); const early = window.__adEarly; return new Promise((res) => setTimeout(() => {
      if (!early) { (L.onRewardedVideoAdReward || []).forEach((f) => f({ type: 'Reward', amount: 1 })); res({ type: 'Reward', amount: 1 }); }
      (L.onRewardedVideoAdDismissed || []).forEach((f) => f()); }, 30000)); }, // (a 30-second ad)
    showPrivacyOptionsForm: async () => { window.__ad.push('choices'); },
  };
};
const out = process.argv[2], shot = async (Ph, name) => { if (out) await Ph.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/ads.test.mjs <dir> to look at it
const ads = (Ph) => Ph.page.evaluate(() => window.__ad.slice());
const home = (Ph) => Ph.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });
const freeTier = () => { const a = JSON.parse(localStorage.getItem('apt-app')); a.exp = { track: true, ads: true }; localStorage.setItem('apt-app', JSON.stringify(a)); };

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(setup); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); if (await A.visible('#benchOk')) await A.click('#benchOk'); await A.click('#go'); await A.run(40000); // (a finished game, so Highlights has something)
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);
const tid = w.db().teams[0].id, jr = (n) => `${tid}/players/2/reel-${n}.mp4`;
const db = w.db(); db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword', meta: { terms: 1 } });
db.players.find((p) => p.pid === 2).user_id = 'u-jake'; db.profiles = (db.profiles || []).concat({ user_id: 'u-jake', username: 'jake_p', name: 'Jake', private: false, pins: [] });
const gid = db.games.find((g) => g.team_id === tid).id; db.clips.push({ team_id: tid, game_id: gid, seq: 0, path: tid + '/dog/01.mp4', store: 'r2', at: Date.now() - 3600000, dur: 14, pids: [2], label: '2\' Goal: Jake' });
db.player_reels = [{ team_id: tid, pid: 2, path: jr(1), store: 'r2', marks: [{ t: 0, label: 'Goal v Dog Squad' }], made_at: Date.now() }, { team_id: tid, pid: 3, path: `${tid}/players/3/reel-1.mp4`, store: 'r2', marks: [], made_at: Date.now() }];
w.setDb(db);

// the gaffer, in early access: no ads anywhere; the free tier only behind the Experimental switch
await A.page.reload(); await A.run(2000);
await A.click('#mHighlights'); await A.run(300); await A.click('#hlToggle [data-by="player"]'); await A.run(500);
eq([await A.page.$$eval('#hlList [data-ad]', (b) => b.length), await A.page.$$eval('#hlList .reelp video', (v) => v.length)], [0, 2], 'early access (everyone has Gaffer): no ads, every reel plays');
await home(A); await A.run(300); await A.click('#mOptions'); await A.run(300);
eq([await A.visible('#expAdsRow'), await A.visible('#optAds')], [false, false], 'the free tier can only be tried behind the Experimental switch');
await A.check('#expTrack'); await A.run(300); if (await A.visible('#planOk')) await A.click('#planOk');
await A.check('#expAds'); await A.run(1500);
eq([await A.visible('#expAdsRow'), await A.visible('#optAds')], [true, true], 'Try the free tier, and Settings then has an Ads section (Ad choices)');
check(/30-second ad you choose to watch to see your own highlight reel/.test(await A.text('#optAds')) && /never ads during a game/.test(await A.text('#optAds')), 'which says what the one ad is for, and never during a game');
await A.click('#optAdsBtn'); await A.run(500);
check((await ads(A)).includes('choices'), 'Ad choices opens Google\'s form to change the answer about personalised ads');
await home(A); await A.run(300);
await A.click('#mHighlights'); await A.run(300); await A.click('#hlToggle [data-by="player"]'); await A.run(1500);
eq([await A.page.$$eval('#hlList [data-ad]', (b) => b.length), await A.page.$$eval('#hlList .reelp video', (v) => v.length)], [0, 2], 'on the free tier, other people\'s reels still play (it\'s only your own reel)');

// Jake, the player: his own reel is behind the ad
const cutter = () => { // the native ReelCutter, as the web app sees it
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = { addListener: () => ({ remove() {} }), cleanup: async () => ({}),
    joinReel: async (o) => { window.__rc.push(['join', Date.now()]); if (window.__hold) await window.__hold; return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14.04) }; },
    share: async (o) => { window.__rc.push(['share', Date.now()]); return {}; } };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const J = await w.phone({ db: true, native: true, label: 'jake' });
await J.ctx.addInitScript(setup); await J.ctx.addInitScript(cutter); await J.ctx.addInitScript(freeTier); await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500); await J.click('#jFollow'); await J.run(800);
await J.page.evaluate(() => { const b = document.querySelector('[data-go="account"]'); if (b) b.click(); }); await J.run(300);
if (await J.visible('#aEmail')) { await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(1500); }
if (await J.view() !== 'home') { await J.click('#myTeams button, #myTeams a'); await J.run(1500); }
const mine = '#hlList .hcard:has(.badge.you)';
const openMine = async () => { if (await J.view() !== 'highlights') { if (await J.view() !== 'home') { await home(J); await J.run(300); } await J.click('#mHighlights'); await J.run(300); } await J.click('#hlToggle [data-by="player"]'); await J.run(1500); };
await openMine();
eq([await J.page.$$eval(mine + ' .reelp video', (v) => v.length), await J.page.$$eval(mine + ' [data-ad="reel"]', (b) => b.length), await J.page.$$eval('#hlList .reelp video', (v) => v.length)], [0, 1, 1], 'his own reel is behind "Watch a 30-second ad to see your reel"; a teammate\'s reel still plays');
check(/stays unlocked until you make a new one/.test(await J.text(mine)), 'saying it stays unlocked until he makes a new one');
await shot(J, 'reel-locked');

// a game set up or going: no ad
await A.click('#tabs [data-tab="home"]').catch(async () => { await home(A); }); await A.run(300); await A.newGame('Athletic'); await A.run(3000); await J.run(25000);
await J.click(mine + ' [data-ad="reel"]'); await J.run(2000);
eq([(await ads(J)).includes('show'), /never play during a game/.test(await J.text(mine))], [false, true], 'with a game on, no ad plays: it says to watch the reel once the game\'s finished');
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await J.run(25000);

// closed early: still locked
await J.page.evaluate(() => { window.__adEarly = true; });
await J.click(mine + ' [data-ad="reel"]'); await J.run(32000);
check(/closed before the end/.test(await J.text(mine)) && await J.page.$$eval(mine + ' .reelp video', (v) => v.length) === 0, 'an ad closed early unlocks nothing, and says so');
await J.page.evaluate(() => { window.__adEarly = false; });

// watched to the end
await J.click(mine + ' [data-ad="reel"]'); await J.run(2000);
const prep = (await ads(J)).find((x) => Array.isArray(x) && x[0] === 'prepare')[1];
eq((await ads(J)).filter((x) => typeof x === 'string').slice(0, 3), ['initialize', 'consent', 'att'], 'Google\'s ads are started, the consent check runs and Apple\'s tracking question is asked, before the first ad');
eq([prep.adId, prep.isTesting, prep.ssv.userId, /^tk-/.test(prep.ssv.customData)], ['ca-app-pub-2627873247729818/1194270899', false, 'u-jake', true], 'Gaffer\'s own rewarded ad unit, real ads, carrying the account and the ticket for the server-side check');
check(/playing/.test(await J.text(mine)), 'it says the ad is playing');
await J.run(31000); await J.run(1500);
eq([await J.page.$$eval(mine + ' .reelp video', (v) => v.length), await J.page.$$eval(mine + ' [data-ad]', (b) => b.length)], [1, 0], 'watched to the end: his reel plays');
eq((await ads(J)).filter((x) => x === 'att').length, 1, 'Apple\'s tracking question is only ever asked once');
await J.page.reload(); await J.run(2000); await openMine();
eq(await J.page.$$eval(mine + ' .reelp video', (v) => v.length), 1, 'and it stays unlocked (kept on the server)');

// a new reel needs a new ad
const db2 = w.db(); db2.player_reels.find((r) => r.pid === 2).path = jr(2); w.setDb(db2);
await J.page.reload(); await J.run(2000); await openMine();
eq(await J.page.$$eval(mine + ' [data-ad="reel"]', (b) => b.length), 1, 'a new reel is behind a new ad');

// making his own reel: the ad plays while the phone makes it, so it's ready to watch when the ad ends
const rc = (k) => J.page.evaluate((k) => window.__rc.filter((x) => x[0] === k).length, k), shows = async () => (await ads(J)).filter((x) => x === 'show').length;
let s0 = await shows();
await J.click('#hlList [data-preel="2"]'); await J.run(300);
check(/30-second ad plays while your reel is made/.test(await J.text('#rbAdNote')), 'the reel maker says a 30-second ad plays while the reel is made'); await shot(J, 'reel-maker-free');
await J.click('#rbMake'); await J.run(3000);
eq([await shows() - s0, await rc('join'), await rc('share')], [1, 1, 0], 'Make the reel starts the ad and the reel at the same time; nothing to share until the ad has been watched');
check(/ready for when the ad ends/.test(await J.text('#rbProg')) && !(await J.visible('#rbMsg')), 'made before the ad ends, it waits for the ad (it doesn\'t say it\'s ready to watch yet)'); await shot(J, 'reel-making-during-ad');
const madeKey = w.db().player_reels.find((r) => r.pid === 2).path;
check(/\/players\/2\/reel-\d{13}\.mp4$/.test(madeKey) && madeKey !== jr(2), 'the new reel is on his card while the ad is still playing');
await J.run(30000); await J.run(1500);
eq([await rc('share'), /on your card/.test(await J.text('#rbMsg')), await J.visible('#rbShare')], [1, true, true], 'when the ad ends the reel is ready: the share sheet opens and it\'s on his card');
check(w.db().unlocks.some((u) => u.target === madeKey && u.granted_at), 'the ad unlocked that reel, by the name picked before it was made');
await J.click('#rbClose'); await J.run(800);
eq([await J.page.$$eval(mine + ' .reelp video', (v) => v.length), await J.page.$$eval(mine + ' [data-ad]', (b) => b.length)], [1, 0], 'and it plays on his card with no second ad');
check(await J.page.evaluate(() => localStorage.getItem('apt-ad-ahead')) === null, 'nothing is left waiting on the phone');

// closed early while the reel was made: the reel goes on his card, locked, and nothing to share
await J.page.evaluate(() => { window.__adEarly = true; }); s0 = await shows();
await J.click('#hlList [data-preel="2"]'); await J.run(300); await J.click('#rbMake'); await J.run(33000);
eq([await shows() - s0, /closed before the end/.test(await J.text('#rbMsg')), await J.visible('#rbShare'), await rc('share')], [1, true, false, 1], 'an ad closed early: the reel is made but locked, with no share');
await J.click('#rbClose'); await J.run(800);
eq(await J.page.$$eval(mine + ' [data-ad="reel"]', (b) => b.length), 1, 'it\'s on his card behind the ad, to watch there');
await J.page.evaluate(() => { window.__adEarly = false; });

// Gaffer closed after the ad was watched but before the reel was made: that ad counts for the next go
await J.page.evaluate(() => { window.__hold = new Promise(() => {}); }); s0 = await shows();
await J.click('#hlList [data-preel="2"]'); await J.run(300); await J.click('#rbMake'); await J.run(33000);
const was = await J.page.evaluate(() => JSON.parse(localStorage.getItem('apt-ad-ahead')));
check(!!(was && was.watched && was.ticket && was.key), 'while it\'s being made, the phone keeps the reel\'s name and the watched ad');
await J.page.reload(); await J.run(2000); await openMine(); s0 = await shows();
await J.click('#hlList [data-preel="2"]'); await J.run(300); await J.click('#rbMake'); await J.run(3000);
eq([await shows() - s0, w.db().player_reels.find((r) => r.pid === 2).path, await rc('share')], [0, was.key, 1], 'made again after reopening Gaffer: no second ad, the same name, and it\'s ready to share');
await J.click('#rbClose'); await J.run(800);
eq(await J.page.$$eval(mine + ' .reelp video', (v) => v.length), 1, 'and it plays on his card');

// a team that has paid (the team pass, 0032) never sees an ad: the same reel plays straight away
const db3 = w.db(); db3.team_pass = [{ team_id: tid, paid_until: Date.now() + 20 * 86400000, pot: 0 }]; w.setDb(db3);
await J.page.reload(); await J.run(2000); await openMine();
eq([await J.page.$$eval(mine + ' .reelp video', (v) => v.length), await J.page.$$eval(mine + ' [data-ad]', (b) => b.length), await J.page.evaluate(() => window.gafferTeamPaid())], [1, 0, true], 'a paid team: no ad, his reel plays');

await done(A, J);
