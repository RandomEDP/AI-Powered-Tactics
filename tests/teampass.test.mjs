// The team pass: the Gaffer tier paid for per team, with "Pay for the month" and "Chip in" bought through Apple.
// 1. The database (every migration in real Postgres): only Gaffer's server can add time; a purchase counts once; time
//    adds on from when the pass runs out (or from now, if it already has); anyone with the code sees who paid, never money.
// 2. The real team-pass edge function, with stand-ins for Deno and Apple, writing to that same database: it asks Apple
//    (signed with the In-App Purchase key, live first then TestFlight's sandbox) and refuses anything Apple doesn't
//    vouch for, anything refunded, and anyone claiming someone else's purchase.
// 3. The app on two phones: a gaffer and a player on the iPhone app with a stand-in for Apple's purchase sheet, and a
//    follower on the website. Chipping in, paying the month, a purchase made with no signal counted the next time, and
//    teamPaid() (what the ads ask).
import { suite, world, ROOT } from './lib.mjs';
import { database } from './pg.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const { check, eq, done } = suite('the team pass: paying per team, and chipping in');

// ================= 1. the database
const d = await database();
const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com'), rival = await d.user('rival@example.com');
const sop = await d.rpc(ethan, 'create_team', { p_name: 'Sons of Pitches FC', p_short: 'SOP FC', p_color: '#5b2a86', p_crest: null, p_settings: {}, p_players: [{ pid: 1, name: 'Ethan' }, { pid: 2, name: 'Jake' }] });
const ath = await d.rpc(rival, 'create_team', { p_name: 'Athletico', p_short: '', p_color: '#123456', p_crest: null, p_settings: {}, p_players: [{ pid: 1, name: 'Ron' }] });
const sopId = (await d.admin(`select id from public.teams where code = $1`, [sop.code]))[0].id, athId = (await d.admin(`select id from public.teams where code = $1`, [ath.code]))[0].id;
await d.admin(`update public.players set user_id = $1 where team_id = $2 and pid = 2`, [jake.id, sopId]);
await d.admin(`insert into public.profiles (user_id, username, name) values ($1, 'edp_gaffer', 'Ethan'), ($2, 'rival', '')`, [ethan.id, rival.id]);
const asServer = async (sql, params) => { await d.db.exec('set role service_role'); try { return (await d.db.query(sql, params)).rows; } finally { await d.db.exec('reset role'); } };
// (a moment apart, so "newest first" never depends on two purchases landing in the same millisecond, as on a fast CI runner)
const put = async (team, user, tx, product, pence) => (await new Promise((ok) => setTimeout(ok, 5)), await asServer(`select public.pass_credit($1, $2, $3, $4, $5, 'Sandbox') as r`, [team, user, tx, product, pence]))[0].r;
const DAY = 86400000, near = (a, b) => Math.abs(a - b) < 60000;

let p = await d.rpc(null, 'team_pass', { p_code: sop.code.toLowerCase() });
eq([p.paid, p.until, p.pot, p.goal, p.chips], [false, null, 0, 499, []], 'a team nobody has paid for: not paid, an empty pot out of £4.99, and anyone with the code can see so');
eq(await d.rpc(null, 'team_pass', { p_code: 'ZZZZZZ' }), null, 'a wrong code shows nothing');
for (const [who, label] of [[null, 'someone not signed in'], [jake, 'a player'], [ethan, 'the gaffer']]) {
  check(/permission denied/i.test(await d.fails(d.rpc(who, 'pass_credit', { p_team: sopId, p_user: ethan.id, p_tx: '1', p_product: 'month', p_pence: 499, p_env: 'Sandbox' }))), `${label} can't put money in the pot themselves (only Gaffer's server, once Apple says the purchase is real)`);
  eq((await d.as(who, 'select count(*)::int as n from public.pass_purchases').catch(() => [{ n: 0 }]))[0].n, 0, `${label} sees no purchases directly`);
  eq((await d.as(who, 'select count(*)::int as n from public.team_pass').catch(() => [{ n: 0 }]))[0].n, 0, `${label} can't read the pass table directly either`);
}

let r = await put(sopId, jake.id, '2000000001', 'chip069', 69);
eq([r.added, r.pot, r.months, r.until], [true, 69, 0, null], 'a 69p chip-in goes in the pot; nothing is unlocked yet');
r = await put(sopId, jake.id, '2000000001', 'chip069', 69);
eq([r.added, r.pot], [false, 69], 'the same purchase claimed again adds nothing');
check(/another team/.test(await d.fails(put(athId, jake.id, '2000000001', 'chip069', 69))), 'nor can it go in another team\'s pot as well');
r = await put(sopId, rival.id, '2000000002', 'chip249', 249); r = await put(sopId, ethan.id, '2000000003', 'chip149', 149);
eq([r.pot, r.months, (await d.rpc(null, 'team_pass', { p_code: sop.code })).paid], [467, 0, false], 'the pot fills up from anyone: £4.67 of £4.99 is still not paid');
r = await put(sopId, jake.id, '2000000004', 'chip069', 69);
check(r.months === 1 && r.pot === 37 && near(r.until, Date.now() + 30 * DAY), 'the chip-in that takes it past £4.99 starts the whole team\'s month there and then, and the 37p over stays in the pot');
const until1 = r.until;
r = await put(sopId, ethan.id, '2000000005', 'month', 499);
eq([r.months, r.pot, r.until - until1], [1, 37, 30 * DAY], 'paying the whole month adds 30 days on to the end, not from now');
p = await d.rpc(jake, 'team_pass', { p_code: sop.code });
eq([p.paid, p.until, p.pot, p.chips.map((c) => [c.who, c.me])], [true, r.until, 37, [['edp_gaffer', false], ['Jake', true], ['edp_gaffer', false], ['rival', false], ['Jake', true]]],
  'everyone sees it paid, until when, the pot for next month, and who chipped in (their name in the squad, else their username; newest first; "me" for their own)');
check(!JSON.stringify(p.chips).match(/pence|price|amount|chip069|transaction|2000000001|Sandbox|user_id/), 'but never what each person paid, nor anything about Apple or accounts');
await d.admin(`update public.team_pass set paid_until = now() - interval '3 days' where team_id = $1`, [sopId]);
p = await d.rpc(null, 'team_pass', { p_code: sop.code });
eq([p.paid, p.pot], [false, 37], 'a pass that ran out shows as not paid, with what\'s in the pot kept');
r = await put(sopId, jake.id, '2000000006', 'month', 499);
check(near(r.until, Date.now() + 30 * DAY) && r.pot === 37, 'and the next full pot starts again from now (the days it was unpaid aren\'t paid for)');
eq((await d.admin(`select private.team_is_paid($1) as a, private.team_is_paid($2) as b`, [sopId, athId]))[0], { a: true, b: false }, 'private.team_is_paid is there for other SQL to ask');
await d.admin(`delete from auth.users where id = $1`, [rival.id]);
eq((await d.admin(`select count(*)::int as n, count(user_id)::int as u from public.pass_purchases where team_id = $1`, [sopId]))[0], { n: 6, u: 5 }, 'deleting an account keeps what it put in the pot but forgets who it was');

// ================= 2. the team-pass edge function, against a stand-in Apple and the database above
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' }, USERS = { 'tok-ethan': ethan.id, 'tok-jake': jake.id };
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const BUNDLE = 'com.randomedp.aipoweredtactics';
const APPLE = { live: {}, sandbox: {} }, ASKED = [];
const jws = (o) => 'eyJhbGciOiJFUzI1NiJ9.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.c2ln';
const buy = (where, id, o) => { APPLE[where][id] = Object.assign({ transactionId: id, bundleId: BUNDLE, productId: BUNDLE + '.team.chip149', appAccountToken: jake.id.toUpperCase(), environment: where === 'live' ? 'Production' : 'Sandbox' }, o); };
let appleDown = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const m = url.match(/^https:\/\/api\.storekit(-sandbox)?\.itunes\.apple\.com\/inApps\/v1\/transactions\/([^/?]+)$/);
  if (!m) throw new Error('unexpected fetch ' + url);
  if (appleDown) return new Response('', { status: 500 });
  const auth = String((init.headers || {}).Authorization || ''), [h, b, s] = auth.replace('Bearer ', '').split('.');
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + b), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s || '', 'base64url'));
  ASKED.push({ where: m[1] ? 'sandbox' : 'live', ok, head: JSON.parse(Buffer.from(h, 'base64url')), body: JSON.parse(Buffer.from(b, 'base64url')) });
  if (!ok) return new Response('', { status: 401 });
  const t = APPLE[m[1] ? 'sandbox' : 'live'][decodeURIComponent(m[2])];
  return t ? new Response(JSON.stringify({ signedTransactionInfo: jws(t) }), { status: 200 }) : new Response(JSON.stringify({ errorCode: 4040010 }), { status: 404 });
};
function from(table) {
  const where = [];
  const b = { select() { return b; }, eq(c, v) { where.push([c, v]); return b; },
    maybeSingle: async () => ({ data: (await d.admin(`select * from public.${table} where ${where.map((w, i) => `${w[0]} = $${i + 1}`).join(' and ')} limit 1`, where.map((w) => w[1])))[0] || null, error: null }) };
  return b;
}
const rpc = async (name, a) => {
  try { return { data: (await asServer(`select public.${name}(${Object.keys(a).map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, Object.values(a)))[0].r, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
};
globalThis.__createClient = () => ({ from, rpc, auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) } });
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/team-pass/index.ts'), 'utf8')
  .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
  .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
check(!/^import /m.test(src), 'the function\'s only imports are the two that have stand-ins here');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), 'team-pass.ts'); fs.writeFileSync(file, src);
const { PRODUCTS } = await import(file);
const call = async (token, body) => {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/team-pass', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(Object.assign({ code: sop.code, action: 'claim' }, body)) }));
  return Object.assign(await res.json(), { status: res.status });
};
eq(Object.values(PRODUCTS).map((x) => [x.kind, x.pence]), [['month', 499], ['chip069', 69], ['chip149', 149], ['chip249', 249]], 'the whole month fills the pot at once; the chip-ins put in 69p, £1.49 or £2.49');

const before = (await d.rpc(null, 'team_pass', { p_code: sop.code })).pot;
eq((await call(null, { transaction_id: '3000000001' })).status, 401, 'nobody signed in can claim anything');
r = await call('tok-jake', { transaction_id: '3000000001' });
eq([r.status, r.reason], [503, 'not_configured'], 'before the In-App Purchase key is set, it says so (and the app keeps the purchase to count later)');
check(/Nothing has been lost/.test(r.error), 'in words that say nothing is lost');
Object.assign(ENV, { IAP_KEY_ID: 'KEY123', IAP_ISSUER_ID: 'issuer-1', IAP_KEY_P8: p8 });

buy('sandbox', '3000000001');
r = await call('tok-jake', { transaction_id: '3000000001' });
eq([r.status, r.added, r.kind, r.pot - before], [200, true, 'chip149', 149], 'a TestFlight £1.49 chip-in: checked with Apple and put in the team\'s pot');
eq(ASKED.slice(-2).map((a) => [a.where, a.ok]), [['live', true], ['sandbox', true]], 'it asks the live App Store first, then TestFlight\'s sandbox, both properly signed');
const a0 = ASKED[ASKED.length - 1];
eq([a0.head.alg, a0.head.kid, a0.head.typ, a0.body.iss, a0.body.aud, a0.body.bid, a0.body.exp - a0.body.iat], ['ES256', 'KEY123', 'JWT', 'issuer-1', 'appstoreconnect-v1', BUNDLE, 600], 'with the token Apple\'s App Store Server API expects');
r = await call('tok-jake', { transaction_id: '3000000001' });
eq([r.status, r.added], [200, false], 'claiming it again (a retry) adds nothing');

buy('live', '3000000002', { productId: BUNDLE + '.team.month', appAccountToken: ethan.id });
r = await call('tok-ethan', { transaction_id: '3000000002' });
eq([r.status, r.kind, ASKED[ASKED.length - 1].where], [200, 'month', 'live'], 'a real App Store purchase is found on the live App Store');
eq((await call('tok-ethan', { transaction_id: '9999999999' })).reason, 'unknown', 'a made-up purchase: Apple doesn\'t know it, nothing added');
eq((await call('tok-ethan', { transaction_id: '3000000001' })).reason, 'not_yours', 'someone claiming another person\'s purchase is refused (Apple has the buyer\'s account on it)');
buy('sandbox', '3000000003', { appAccountToken: null }); eq((await call('tok-jake', { transaction_id: '3000000003' })).reason, 'not_yours', 'so is a purchase with no account on it');
buy('sandbox', '3000000004', { revocationDate: Date.now() }); eq((await call('tok-jake', { transaction_id: '3000000004' })).reason, 'refunded', 'a refunded purchase doesn\'t count');
buy('sandbox', '3000000005', { productId: BUNDLE + '.coins' }); eq((await call('tok-jake', { transaction_id: '3000000005' })).reason, 'wrong_product', 'nor anything that isn\'t a team pass');
buy('sandbox', '3000000006', { bundleId: 'com.other.app' }); eq((await call('tok-jake', { transaction_id: '3000000006' })).reason, 'wrong_app', 'nor a purchase from another app');
eq((await call('tok-jake', { transaction_id: '1', environment: 'Xcode' })).reason, 'xcode', 'a test purchase from Xcode is turned down with a reason (Apple can\'t check those)');
eq((await call('tok-jake', { transaction_id: '../x' })).reason, 'unknown', 'a nonsense transaction id never reaches Apple');
buy('sandbox', '3000000007'); r = await call('tok-jake', { transaction_id: '3000000007', code: ath.code });
eq([r.status, r.added], [200, true], 'a player can chip in for another team too (it\'s a gift, which Apple allows)');
r = await call('tok-jake', { transaction_id: '3000000007' });
eq([r.status, /another team/.test(r.error)], [409, true], 'but one purchase never pays for two teams');
appleDown = true; buy('sandbox', '3000000008'); r = await call('tok-jake', { transaction_id: '3000000008' }); appleDown = false;
eq([r.status, /Couldn't reach Apple/.test(r.error)], [502, true], 'if Apple can\'t be reached it says so, and nothing is added');
await d.close();

// ================= 3. the app
const w = await world();
const appleSheet = () => { // Apple's purchase sheet, as the web app sees it through TeamPassPlugin
  const K = '__apple_unfinished'; // Apple keeps unfinished purchases across launches
  const S = window.__apple = { calls: [], get unfinished() { return JSON.parse(localStorage.getItem(K) || '[]'); }, set unfinished(v) { localStorage.setItem(K, JSON.stringify(v)); }, next: 'bought', n: Number(localStorage.getItem('__txn') || Math.floor(Math.random() * 1e6) * 100), said: [] };
  window.Capacitor.Plugins.TeamPass = {
    products: async () => ({ products: [['month', '£4.99'], ['chip069', '£0.69'], ['chip149', '£1.49'], ['chip249', '£2.49']].map(([k, price]) => ({ id: 'com.randomedp.aipoweredtactics.team.' + k, price })) }),
    buy: async (o) => { S.calls.push(['buy', o.id]); if (S.next !== 'bought') return { status: S.next };
      const t = { transactionId: String(++S.n), productId: o.id, account: o.account, environment: 'Sandbox' }; localStorage.setItem('__txn', S.n);
      S.unfinished = S.unfinished.concat([t]); window.__appleBought(t); return Object.assign({ status: 'bought' }, t); },
    unfinished: async () => ({ list: S.unfinished.slice() }),
    finish: async (o) => { S.calls.push(['finish', o.transactionId]); S.unfinished = S.unfinished.filter((t) => t.transactionId !== o.transactionId); return { finished: true }; },
    addListener: (n, f) => { if (n === 'transaction') S.said.push(f); return { remove() {} }; },
  };
};
const appleBought = async (P) => { await P.page.exposeFunction('__appleBought', (t) => { const db = w.db(); db.apple = db.apple || {}; db.apple[t.transactionId] = { productId: t.productId, account: t.account }; w.setDb(db); }); };

const G = await w.phone({ db: true, native: true, label: 'gaffer' });
await appleBought(G); await G.ctx.addInitScript(appleSheet); await G.page.reload(); await G.run(500);
await G.click('#createBtn'); await G.signUp('ethan@example.com');
await G.page.fill('#tName', 'Sons of Pitches FC'); await G.page.fill('#tShort', 'SOP FC'); await G.page.fill('#tPlayers', 'Ethan\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nSpice'); await G.click('#tCreate'); await G.run(600);
const code = await G.text('#codeBig'); await G.click('#v-code [data-go="home"]'); await G.click('#tabs [data-tab="home"]'); await G.run(500);
eq([await G.visible('#passCard'), await G.page.evaluate(() => window.gafferTeamPaid())], [false, false], 'with the Experimental switch off, nothing about paying shows (and the team isn\'t paid)');
await G.click('#mOptions'); await G.page.check('#expTrack'); await G.run(300);
if (await G.visible('#planOk')) await G.click('#planOk');
check(/£4\.99 a month for the whole team/.test(await G.page.textContent('#planPop')) && /chips in what they like until the pot reaches £4\.99/.test(await G.page.textContent('#planPop')), 'Plans says the Gaffer tier is one price for the whole team, from a pot everyone chips into');
await G.click('#tabs [data-tab="home"]'); await G.run(500);
eq([await G.visible('#passCard'), await G.text('#passState'), await G.text('#passPot')], [true, 'Everyone chips in what they like. When the pot reaches £4.99, the whole team gets a month of the Gaffer tier.', 'Team pot: £0.00 of £4.99'], 'switched on, the Team page shows the team pot');
eq(await G.page.$$eval('#passCard [data-pass]', (b) => b.map((x) => [x.textContent, x.className])), [['£0.69', 'plain tint'], ['£1.49', 'plain tint'], ['£2.49', 'plain tint'], ['Pay the whole month (£4.99)', 'plain primary']], 'three chip-in amounts with Apple\'s own prices, and paying the whole month (the gaffer\'s main button)');
check(/doesn’t unlock anything until the pot is full; anything over carries into the next month/.test(await G.text('#passHow')), 'before anyone pays, it says chipping in unlocks nothing until the pot is full, and nothing over is lost');

// before the server has its In-App Purchase key: paid, kept, and counted later
await G.click('[data-pass="chip249"]'); await G.run(800);
check(/Nothing has been lost/.test(await G.text('#passMsg')), 'if Gaffer\'s server can\'t check purchases yet, the gaffer is told nothing is lost');
eq([await G.page.evaluate(() => window.__apple.unfinished.length), await G.page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('apt-pass-pending') || '{}')).length)], [1, 1], 'and the purchase is kept, not finished with Apple');
w.setDb(Object.assign(w.db(), { appleReady: true }));
await G.page.reload(); await G.run(1500); await G.click('#tabs [data-tab="home"]'); await G.run(500);
eq([await G.text('#passPot'), /Thanks to you\.$/.test(await G.text('#passState'))], ['Team pot: £2.49 of £4.99', true], 'opening Gaffer again counts it by itself: £2.49 in the pot');
eq([await G.page.evaluate(() => window.__apple.unfinished.length), await G.page.evaluate(() => window.__apple.calls.filter((c) => c[0] === 'finish').length), await G.page.evaluate(() => window.gafferTeamPaid())], [0, 1, false], 'then it\'s finished with Apple, once; the pot isn\'t full, so the team isn\'t paid yet');
eq(await G.page.$eval('#passCard .passbar', (b) => b.getAttribute('aria-valuenow')), '249', 'the bar shows how full the pot is');

// a player chips in, on their own iPhone
const J = await w.phone({ db: true, native: true, label: 'jake' });
await appleBought(J); await J.ctx.addInitScript(appleSheet); await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2500);
await J.click('#tabs [data-tab="home"]'); await J.run(500);
await J.click('#mOptions').catch(() => {}); if (await J.visible('#expTrack')) { await J.page.check('#expTrack'); await J.run(300); if (await J.visible('#planOk')) await J.click('#planOk'); } await J.click('#tabs [data-tab="home"]'); await J.run(800);
eq(await J.page.$eval('#passCard [data-pass="month"]', (x) => x.className), 'plain', 'for a player, paying the whole month isn\'t the main button');
await J.page.evaluate(() => { window.__apple.next = 'cancelled'; }); await J.click('[data-pass="chip149"]'); await J.run(500);
eq([await J.visible('#passMsg'), w.db().team_pass[0].pot], [false, 249], 'cancelling Apple\'s sheet changes nothing and says nothing');
await J.page.evaluate(() => { window.__apple.next = 'bought'; }); await J.click('[data-pass="chip149"]'); await J.run(800);
eq([await J.text('#passMsg'), await J.text('#passPot')], ['Thanks for chipping in! The pot is at £3.98 of £4.99.', 'Team pot: £3.98 of £4.99'], 'chipping in thanks them and says how full the pot is now');
await J.click('[data-pass="chip249"]'); await J.run(800);
const untilJ = w.db().team_pass[0].paid_until;
check(/^Thanks for chipping in! That filled the pot\. The whole team has the Gaffer tier until \w{3} \d+ \w{3}\. £1\.48 is already in the pot for next month\.$/.test(await J.text('#passMsg')), `the chip-in that fills the pot starts the month, and says what's over is kept (${await J.text('#passMsg')})`);
check(Math.abs(untilJ - (await J.now()) - 30 * 86400000) < 120000, 'the month runs 30 days from then');
eq([await J.page.evaluate(() => window.gafferTeamPaid()), await J.text('#passPot'), /^Paid until .+\. Thanks to you and ethan_fc\.$/.test(await J.text('#passState'))], [true, 'Next month’s pot: £1.48 of £4.99', true], 'now the team is paid, the card names who chipped in, and next month\'s pot has started');
await G.page.reload(); await G.run(1500); await G.click('#tabs [data-tab="home"]'); await G.run(500);
check(/Thanks to Jake and you\./.test(await G.text('#passState')), `the gaffer's phone shows Jake chipped in too (${await G.text('#passState')})`);
eq(await G.visible('#passLow'), false, 'with weeks left there\'s no "running out"');

// the gaffer pays the whole month
await G.click('[data-pass="month"]'); await G.run(800);
eq([w.db().team_pass[0].paid_until - untilJ, w.db().team_pass[0].pot], [30 * 86400000, 148], 'paying the whole month adds 30 days on to the end, and next month\'s pot is left as it was');
eq(await G.page.evaluate(() => window.__apple.calls.map((c) => c[0])), ['buy', 'finish'], 'and it\'s finished with Apple only after Gaffer counted it');
const db1 = w.db(); db1.team_pass[0].paid_until = (await G.now()) + 3 * 86400000 - 60000; w.setDb(db1);
await G.page.reload(); await G.run(1500); await G.click('#tabs [data-tab="home"]'); await G.run(500);
eq(await G.text('#passLow'), 'Runs out in 3 days. Chip in to fill the pot for next month.', 'near the end it says so, and asks for chip-ins');

// a follower on the website (no Apple), and with no signal
const F = await w.phone({ db: true, label: 'follower' });
await F.page.fill('#joinCode', code); await F.click('#joinBtn'); await F.run(500); await F.click('#jFollow'); await F.run(800);
eq([await F.visible('#passCard'), /^Paid until /.test(await F.text('#passState')), await F.page.$$eval('#passCard [data-pass]', (b) => b.length), /from Gaffer’s iPhone app/.test(await F.text('#passCard'))], [true, true, 0, true], 'a paid team shows it to everyone; on the website there are no buy buttons, just where to chip in from');
eq(await F.page.evaluate(() => window.gafferTeamPaid()), true, 'teamPaid() says so on every phone (so the ads stay away)');
await F.ctx.addInitScript(() => { window.__offline = true; }); await F.page.reload(); await F.run(1500);
eq(await F.page.evaluate(() => window.gafferTeamPaid()), true, 'and still says so with no signal, from what the phone last heard');

await done();
