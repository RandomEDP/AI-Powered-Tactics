// The shop (Ethan's ask): the cage phone mount and team kits with colours, a badge, names and numbers, and Gaffer on the
// chest for £9.99 a shirt instead of £14.99. Paid through Stripe's payment page (Apple Pay or card), never Apple's in-app
// purchase. Here: the real shop and shop-webhook functions under Node with stand-ins for Deno, the database and Stripe
// (prices worked out on the server, a live key refused until switched on, only Stripe's signed messages mark an order
// paid), then the Shop screen on a phone (behind Experimental, the kit designer's live preview, the order going off).
import { world, suite, ROOT } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const { check, eq, done } = suite('the shop');
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

// ---------- the app's prices are the server's
const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/shop/index.ts'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const num = (src, re) => Number((src.match(re) || [])[1]);
eq([num(html, /SHOP = \{ mount: (\d+)/), num(html, /kit: (\d+), sponsored/), num(html, /sponsored: (\d+), min/), num(html, /min: (\d+), max/), num(html, /postage: (\d+), sizes/)],
  [num(fn, /mount: \{[^}]*price: (\d+)/), num(fn, /kit: \{[^}]*price: (\d+)/), num(fn, /sponsored: (\d+)/), num(fn, /kit: \{[^}]*min: (\d+)/), num(fn, /postage: (\d+)/)],
  'the prices the app shows are the ones the server charges (mount, shirt, sponsored shirt, the smallest kit order, postage)');
eq([num(fn, /kit: \{[^}]*price: (\d+)/), num(fn, /sponsored: (\d+)/)], [1499, 999], 'a shirt is £14.99, or £9.99 with Gaffer on the chest');

// ---------- stand-ins: the database, signing in and Stripe
const ENV = {}, DB = { shop_orders: [], teams: [{ id: 't-sop', code: 'SOPFC1' }] }, USERS = { 'tok-ethan': { id: 'u-ethan', email: 'gaffer@example.com' }, 'tok-jake': { id: 'u-jake', email: 'jake@example.com' } };
let n = 0;
function from(table) {
  let op = 'select', body = null; const where = [];
  const run = async () => {
    const rows = DB[table], hit = rows.filter((r) => where.every((w) => w(r)));
    if (op === 'insert') { const r = { id: crypto.randomUUID(), created_at: new Date(Date.now() + (++n)).toISOString(), ...body }; rows.push(r); return { data: [r], error: null }; }
    if (op === 'update') { hit.forEach((r) => Object.assign(r, body)); return { data: null, error: null }; }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b = { select() { return b; }, insert(o) { op = 'insert'; body = o; return b; }, update(o) { op = 'update'; body = o; return b; },
    eq(c, v) { where.push((r) => r[c] === v); return b; }, maybeSingle: () => run().then((x) => ({ data: x.data[0] || null })), single: () => run().then((x) => ({ data: x.data[0] || null, error: null })),
    then: (res, rej) => run().then(res, rej) };
  return b;
}
globalThis.__createClient = () => ({ from, auth: { getUser: async (t) => ({ data: { user: USERS[t] || null } }) } });
const STRIPE = { sessions: {}, calls: [] };
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const reply = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  const m = url.match(/^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions(?:\/(.+))?$/); if (!m) throw new Error('unexpected fetch ' + url);
  STRIPE.calls.push({ method: init.method, auth: init.headers.Authorization, form: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
  if (init.method === 'POST') { const id = 'cs_test_' + (Object.keys(STRIPE.sessions).length + 1); STRIPE.sessions[id] = { id, url: 'https://checkout.stripe.com/c/pay/' + id, livemode: false, payment_status: 'unpaid', status: 'open' }; return reply(200, STRIPE.sessions[id]); }
  const s = STRIPE.sessions[decodeURIComponent(m[1])]; return s ? reply(200, s) : reply(404, { error: { message: 'No such checkout session' } });
};
const load = async (name) => {
  let handler = null;
  globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
  const src = fs.readFileSync(path.join(ROOT, `supabase/functions/${name}/index.ts`), 'utf8')
    .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
    .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
  check(!/^import /m.test(src), `${name}: its only imports are the two that have stand-ins here`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), `${name}.ts`); fs.writeFileSync(file, src);
  const mod = await import(file); return { mod, call: (req) => handler(req) };
};
const shop = await load('shop');
const call = async (token, body) => { const res = await shop.call(new Request('https://x.supabase.co/functions/v1/shop', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const squad = (k, more = {}) => Array.from({ length: k }, (_, i) => Object.assign({ name: ['Spice', 'Jake', 'Chaplin', 'Harrison', 'Puxley', 'Issac', 'Reece', 'Ethan', 'Dev', 'Josh'][i % 10], num: i + 1, size: 'M' }, more));
const kit = (shirts, sponsor = false) => ({ action: 'checkout', code: 'sopfc1', item: 'kit', design: { color: '#4C2BB0', color2: '#ffffff', pattern: 'stripes', sponsor, badge: null }, shirts });

eq((await call(null, { action: 'orders' })).status, 401, 'nobody signed in can order');
let r = await call('tok-ethan', kit(squad(8)));
eq([r.status, r.reason, DB.shop_orders.length], [503, 'not_configured', 0], 'before Stripe\'s key is set, the shop says paying isn\'t set up, and saves nothing');
Object.assign(ENV, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_live_abc' });
r = await call('tok-ethan', kit(squad(8)));
eq([r.status, r.reason, STRIPE.calls.length], [503, 'live_off', 0], 'a live Stripe key is refused until SHOP_LIVE is switched on, so nobody is charged by accident');
ENV.STRIPE_SECRET_KEY = 'sk_test_abc';

// ---------- what can't be ordered
eq([(await call('tok-ethan', kit(squad(7)))).error], ['A kit order is at least 8 shirts, so the printer will make it.'], 'a kit is at least 8 shirts');
eq([(await call('tok-ethan', kit(squad(31)))).status], [400], 'and at most 30');
eq([(await call('tok-ethan', kit(squad(8, { size: 'XXXXL' })))).error], ['Pick a size for every shirt.'], 'every shirt needs a real size');
eq([(await call('tok-ethan', kit(squad(8, { num: 100 })))).error], ['Shirt numbers go from 0 to 99.'], 'numbers go 0 to 99');
eq([(await call('tok-ethan', kit(squad(8, { name: '<script>' })))).status], [400], 'a name can only have letters and a few marks');
eq([(await call('tok-ethan', Object.assign(kit(squad(8)), { design: { color: 'red', color2: '#fff000', pattern: 'plain' } }))).error], ["Pick the kit's colours."], 'colours have to be real colours');
eq([(await call('tok-ethan', Object.assign(kit(squad(8)), { design: { color: '#000000', color2: '#ffffff', pattern: 'plain', badge: 'https://evil.example/x.png' } }))).status], [400], 'a badge is only a picture sent with the order, never a link elsewhere');
eq([(await call('tok-ethan', { action: 'checkout', item: 'mount', qty: 0 })).status, (await call('tok-ethan', { action: 'checkout', item: 'boots', qty: 1 })).status], [400, 400], 'no mounts, or something the shop doesn\'t sell, is turned down');
eq([STRIPE.calls.length, DB.shop_orders.length], [0, 0], 'none of those got as far as Stripe or the database');

// ---------- a kit order: priced by the server, whatever the phone says
r = await call('tok-ethan', Object.assign(kit(squad(8), true), { total: 1 }));
let o = DB.shop_orders[0], form = STRIPE.calls[0].form;
eq([r.status, r.url, r.order, o.status, o.total_pence, o.user_id, o.team_id], [200, 'https://checkout.stripe.com/c/pay/cs_test_1', o.id, 'awaiting_payment', 8 * 999 + 399, 'u-ethan', 't-sop'],
  'eight sponsored shirts: £79.92 + £3.99 postage, saved waiting for payment, for that account and team, and Stripe\'s payment page handed back');
eq([form['line_items[0][price_data][unit_amount]'], form['line_items[0][quantity]'], form['line_items[0][price_data][currency]'], form['shipping_options[0][shipping_rate_data][fixed_amount][amount]'], form['shipping_address_collection[allowed_countries][0]'], form['metadata[order]'], form.customer_email, form.mode],
  ['999', '8', 'gbp', '399', 'GB', o.id, 'gaffer@example.com', 'payment'], 'Stripe is asked for £9.99 × 8 in pounds, UK postage and address, tied to the order, with the buyer\'s email');
eq([form.success_url, form.cancel_url, STRIPE.calls[0].auth], ['https://x.supabase.co/functions/v1/shop-webhook?done=1', 'https://x.supabase.co/functions/v1/shop-webhook?done=0', 'Bearer sk_test_abc'], 'it comes back to a short "go back to Gaffer" page, never the website');
eq([o.shirts.map((s) => s.name).join(','), o.design.color, o.design.sponsor, o.stripe_session], ['SPICE,JAKE,CHAPLIN,HARRISON,PUXLEY,ISSAC,REECE,ETHAN', '#4c2bb0', true, 'cs_test_1'], 'the names are kept in capitals, with the design and Stripe\'s session');
r = await call('tok-ethan', kit(squad(10)));
eq([r.status, DB.shop_orders[1].total_pence], [200, 10 * 1499 + 399], 'without the sponsor ten shirts are £14.99 each');
r = await call('tok-jake', { action: 'checkout', item: 'mount', qty: 2 });
eq([r.status, DB.shop_orders[2].total_pence, DB.shop_orders[2].team_id], [200, 2 * 1299 + 399, null], 'two phone mounts, from someone with no team open');

// ---------- orders: your own only, and paid once Stripe says so
r = await call('tok-jake', { action: 'orders' });
eq(r.orders.map((x) => [x.item, x.total, x.status]), [['mount', 2997, 'awaiting_payment']], 'Jake sees only his own order');
STRIPE.sessions.cs_test_1.payment_status = 'paid'; STRIPE.sessions.cs_test_1.customer_details = { email: 'gaffer@example.com', phone: '07000 000000' };
STRIPE.sessions.cs_test_1.collected_information = { shipping_details: { name: 'E Example', address: { line1: '1 Test Street', city: 'Testtown', postal_code: 'TE1 1ST', country: 'GB' } } };
STRIPE.sessions.cs_test_2.status = 'expired';
r = await call('tok-ethan', { action: 'orders' });
eq(r.orders.map((x) => [x.item, x.shirts, x.sponsor, x.status, x.live]), [['kit', 10, false, 'cancelled', false], ['kit', 8, true, 'paid', false]], 'coming back from paying, the order shows paid (asked of Stripe); one left unpaid shows as not paid; both test mode');
eq([DB.shop_orders[0].ship.address.postal_code, DB.shop_orders[0].email], ['TE1 1ST', 'gaffer@example.com'], 'the delivery address Stripe collected is kept with the order, for posting it');

// ---------- the webhook: only Stripe's signed messages count
const hook = await load('shop-webhook');
const post = async (ev, { secret = 'whsec_test', t = Math.floor(Date.now() / 1000) } = {}) => {
  const body = JSON.stringify(ev), sig = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  const res = await hook.call(new Request('https://x.supabase.co/functions/v1/shop-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body }));
  return { status: res.status, text: await res.text() };
};
const mountId = DB.shop_orders[2].id, paid = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_3', livemode: false, payment_status: 'paid', metadata: { order: mountId }, customer_details: { email: 'jake@example.com' } } } };
r = await post(paid);
eq([r.status, DB.shop_orders[2].status], [400, 'awaiting_payment'], 'before the webhook secret is set, nothing is believed');
ENV.STRIPE_WEBHOOK_SECRET = 'whsec_test';
r = await post(paid, { secret: 'whsec_wrong' });
eq([r.status, DB.shop_orders[2].status], [400, 'awaiting_payment'], 'a message signed with the wrong secret is turned away');
r = await post(paid, { t: Math.floor(Date.now() / 1000) - 3600 });
eq([r.status, DB.shop_orders[2].status], [400, 'awaiting_payment'], 'so is an old one replayed');
r = await post(paid);
eq([r.status, DB.shop_orders[2].status, DB.shop_orders[2].email], [200, 'paid', 'jake@example.com'], 'Stripe\'s own message marks the mount order paid');
r = await post({ type: 'checkout.session.expired', data: { object: { metadata: { order: mountId } } } });
eq(DB.shop_orders[2].status, 'paid', 'a later "expired" never un-pays a paid order');
const page = await hook.call(new Request('https://x.supabase.co/functions/v1/shop-webhook?done=1'));
check(/Go back to Gaffer/.test(await page.text()), 'after paying, Stripe\'s page sends people to a line saying to go back to Gaffer');

// ---------- the Shop screen on the phone
const w = await world();
const A = await w.phone({ db: true, native: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
eq(await A.visible('#mShop'), false, 'the Shop isn\'t on the team page until Experimental is on');
await A.page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
await A.click('#mOptions'); await A.page.check('#expTrack'); await A.run(300);
await A.page.evaluate(() => { document.querySelectorAll('[role="dialog"]:not([hidden]) .close, #planPop [data-close]').forEach((b) => b.click()); });
check(await A.visible('#shopOpen'), 'Settings, Experimental has the Shop');
await A.tap('#shopOpen'); await A.run(300);
eq([await A.view(), await A.text('#shopBack')], ['shop', 'Settings'], 'it opens the Shop, with Back to Settings');
check(await A.visible('#shopTest'), 'it says it\'s in test mode, with Stripe\'s test card');
eq(await A.text('#mntTotal'), '1 × £12.99 + £3.99 postage = £16.98', 'the phone mount: price and postage');
await A.click('#mntMore'); eq(await A.text('#mntTotal'), '2 × £12.99 + £3.99 postage = £29.97', 'two of them');

const rows = () => A.page.$$eval('#kitRows [data-kf="name"]', (x) => x.map((i) => i.value));
eq(await rows(), ['SPICE', 'JAKE', 'CHAPLIN', 'HARRISON', 'PUXLEY', 'ISSAC', 'REECE', 'ETHAN'], 'the kit starts with the squad\'s names, one shirt each');
eq(await A.text('#kitSum'), '8 shirts × £14.99 + £3.99 postage = £123.91', 'eight shirts at £14.99');
const back = () => A.page.$$eval('#kitPrev figure:nth-child(2) text', (x) => x.map((t) => t.textContent));
eq(await back(), ['SPICE'], 'the back of the shirt in the preview shows the first name');
await A.page.fill('#kitRows [data-krow="1"] [data-kf="num"]', '9'); await A.run(100);
eq([await back(), await A.text('#kitPrev figure:nth-child(2) figcaption')], [['JAKE', '9'], 'Back: JAKE 9'], 'typing Jake\'s number shows his shirt from the back as it\'s typed');
eq(await A.page.$$eval('#kitPrev figure:first-child [data-kit="sponsor"]', (x) => x.length), 0, 'no sponsor on the chest to start with');
await A.page.click('#kitSpon'); await A.run(100);
eq([await A.page.$$eval('#kitPrev figure:first-child [data-kit="sponsor"]', (x) => x.map((t) => t.textContent)), await A.text('#kitSum')], [['GAFFER'], '8 shirts × £9.99 + £3.99 postage = £83.91'], 'Gaffer as the chest sponsor: GAFFER across the front and £9.99 a shirt');
await A.click('#kitPat [data-kpat="hoops"]');
check(await A.page.$$eval('#kitPrev figure:first-child rect[fill="#ffffff"]', (x) => x.length) >= 5, 'hoops in the second colour show on the shirt');
await A.click('#kitC1 [data-c="#b3202a"]');
eq(await A.page.$eval('#kitPrev figure:first-child rect', (r) => r.getAttribute('fill')), '#b3202a', 'picking a colour repaints the shirt');
await A.page.setInputFiles('#kitBadgeFile', { name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
await A.run(500);
eq(await A.page.$$eval('#kitPrev [data-kit="badge"]', (x) => x.length), 1, 'a badge picture goes on the chest');
await shot(A, 'shop-kit');
await A.click('#kitRows [data-krm="7"]');
eq([await A.page.isDisabled('#kitBuy'), /Add 1 more/.test(await A.text('#kitSum'))], [true, true], 'with seven shirts it says to add one more, and won\'t take the order');
await A.click('#kitAdd'); await A.page.fill('#kitRows [data-krow="7"] [data-kf="name"]', 'dev'); await A.page.fill('#kitRows [data-krow="7"] [data-kf="num"]', '10'); await A.page.selectOption('#kitRows [data-krow="7"] select', 'XL'); await A.run(100);
await A.click('#kitBuy'); await A.run(500);
let db = await A.db(); const last = (db.calls || []).filter((c) => c.name === 'shop' && c.body.action === 'checkout').pop();
eq([last.body.item, last.body.shirts.length, last.body.shirts[7], last.body.design.sponsor, last.body.design.pattern, last.body.design.color, /^data:image\/png/.test(last.body.design.badge)], ['kit', 8, { name: 'DEV', num: 10, size: 'XL' }, true, 'hoops', '#b3202a', true],
  'Pay sends the whole design: eight shirts with names, numbers and sizes, the sponsor, pattern, colour and badge');
eq(await A.page.evaluate(() => window.__opened), ['https://checkout.stripe.com/c/pay/cs_test_ord-1'], 'and opens Stripe\'s payment page (Apple Pay or card) in Safari');
await A.run(500);
check(/1 × |8 kit shirts \(Gaffer sponsor\)/.test(await A.text('#ordList')) && /Waiting for payment/.test(await A.text('#ordList')), `the order shows under Your orders, waiting for payment (${await A.text('#ordList')})`);
await shot(A, 'shop-ordered');
await A.click('#mntBuy'); await A.run(500);
db = await A.db();
eq((db.calls || []).filter((c) => c.name === 'shop' && c.body.action === 'checkout').map((c) => [c.body.item, c.body.qty || c.body.shirts.length]), [['kit', 8], ['mount', 2]], 'the two mounts go off as their own order');

// ---------- a name that can't go on a shirt
await A.page.fill('#kitRows [data-krow="0"] [data-kf="name"]', 'NAZI'); await A.run(100);
await A.click('#kitBuy'); await A.run(300);
eq([await A.text('#kitMsg'), (await A.db()).calls.filter((c) => c.name === 'shop' && c.body.action === 'checkout').length], ['Shirt 1: that name can’t go on a shirt.', 2], 'the word filter stops a name before anything is sent');
await A.click('#shopBack'); eq(await A.view(), 'options', 'Back goes to Settings');
await w.close();
await done(A);
