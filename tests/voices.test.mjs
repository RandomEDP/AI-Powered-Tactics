// Commentary voices (Ethan: "Only let the free one usable … Let them hear it before unlock", then "remove all the voices
// for now apart from the base free one … And the sweary one lets call it East London Steve 18+ … we only need to select
// the voice"). Read it straight is free; East London Steve 18+ is a one-off £3.99 through Apple.
// 1. The database (every migration in real Postgres): only Gaffer's server can unlock a voice; a purchase unlocks one
//    voice for one account; my_voices says what you own and nothing about Apple; deleting an account forgets it.
// 2. The real team-pass edge function ("voice"), with a stand-in Apple, writing to that database.
// 3. The real reel-voice: a paid voice is refused to anyone who hasn't bought it; samples are made once and kept.
// 4. The app: hearing a sample before buying (no AI ask, nothing about the team sent), the cut and a player's reel
//    stopped on Steve before he's unlocked, unlocking, the voice then used, the same account on a second phone, Restore
//    purchases, and Steve still open until 0034 is live.
import { suite, world, ROOT } from './lib.mjs';
import { database } from './pg.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const { check, eq, done } = suite('commentary voices bought once, with samples');

// ================= 1. the database
const d = await database();
const ethan = await d.user('ethan@example.com'), jake = await d.user('jake@example.com');
const asServer = async (sql, params) => { await d.db.exec('set role service_role'); try { return (await d.db.query(sql, params)).rows; } finally { await d.db.exec('reset role'); } };
const credit = async (user, voice, tx) => (await asServer(`select public.voice_credit($1, $2, $3, 'Sandbox') as r`, [user, voice, tx]))[0].r;
for (const [who, label] of [[null, 'someone not signed in'], [jake, 'a player'], [ethan, 'the gaffer']]) {
  check(/permission denied/i.test(await d.fails(d.rpc(who, 'voice_credit', { p_user: ethan.id, p_voice: 'steve', p_tx: '1', p_env: 'Sandbox' }))), `${label} can't unlock a voice themselves (only Gaffer's server, once Apple says the purchase is real)`);
  eq((await d.as(who, 'select count(*)::int as n from public.voice_unlocks').catch(() => [{ n: 0 }]))[0].n, 0, `${label} sees nothing in the unlocks table directly`);
}
eq(await d.rpc(ethan, 'my_voices'), null, 'until Steve is on sale, my_voices says so (null) and the app keeps him open');
eq((await d.admin(`select private.has_voice($1, 'steve') a`, [jake.id]))[0].a, true, 'and anyone may use him');
await d.admin(`update public.voice_settings set on_sale = true`);
eq(await d.rpc(ethan, 'my_voices'), [], 'once he is on sale, nobody owns a voice to start with');
eq((await d.as(ethan, 'select count(*)::int as n from public.voice_settings').catch(() => [{ n: 0 }]))[0].n, 0, 'nobody can read or change the on-sale switch directly');
check(/permission denied/i.test(await d.fails(d.rpc(null, 'my_voices'))), 'my_voices is only for someone signed in');
eq(await credit(ethan.id, 'Steve', '4000000001'), { added: true }, 'Gaffer\'s server unlocks East London Steve for Ethan');
eq(await credit(ethan.id, 'steve', '4000000001'), { added: false }, 'the same purchase again (a retry) changes nothing');
check(/another account/.test(await d.fails(credit(jake.id, 'steve', '4000000001'))), 'one purchase never unlocks a voice for two accounts');
eq(await credit(ethan.id, 'steve', '4000000002'), { added: false }, 'a second purchase of the same voice adds nothing');
eq([await d.rpc(ethan, 'my_voices'), await d.rpc(jake, 'my_voices')], [['steve'], []], 'my_voices lists your own voices only');
eq((await d.admin(`select private.has_voice($1, 'free') a, private.has_voice($1, 'steve') b, private.has_voice($2, 'steve') c`, [ethan.id, jake.id]))[0], { a: true, b: true, c: false }, 'the free voice is everyone\'s; Steve only for whoever bought him');
eq((await d.admin(`select public, allowed_mime_types from storage.buckets where id = 'voice-samples'`))[0], { public: true, allowed_mime_types: ['audio/mpeg'] }, 'the samples live in a public bucket of MP3s');
await d.admin(`delete from auth.users where id = $1`, [ethan.id]);
eq((await d.admin(`select count(*)::int as n from public.voice_unlocks`))[0].n, 0, 'deleting the account deletes its voices too');

// ================= 2. team-pass, action "voice", against a stand-in Apple and the database above
const gaffer = await d.user('gaffer@example.com');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const BUNDLE = 'com.randomedp.aipoweredtactics', APPLE = {};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', IAP_KEY_ID: 'K', IAP_ISSUER_ID: 'I', IAP_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const USERS = { 'tok-gaffer': gaffer.id, 'tok-jake': jake.id };
const buy = (id, o) => { APPLE[id] = Object.assign({ transactionId: id, bundleId: BUNDLE, productId: BUNDLE + '.voice.steve', appAccountToken: gaffer.id.toUpperCase(), environment: 'Sandbox' }, o); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const m = String(url).match(/^https:\/\/api\.storekit(-sandbox)?\.itunes\.apple\.com\/inApps\/v1\/transactions\/([^/?]+)$/);
  if (!m) throw new Error('unexpected fetch ' + url);
  const t = m[1] && APPLE[decodeURIComponent(m[2])];
  return t ? new Response(JSON.stringify({ signedTransactionInfo: 'x.' + Buffer.from(JSON.stringify(t)).toString('base64url') + '.y' }), { status: 200 }) : new Response('{}', { status: 404 });
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
const load = async (name, client) => {
  let handler = null;
  globalThis.__createClient = () => client;
  globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
  const src = fs.readFileSync(path.join(ROOT, `supabase/functions/${name}/index.ts`), 'utf8')
    .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
    .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), `${name}.ts`); fs.writeFileSync(file, src);
  const mod = await import(file);
  return { mod, call: async (token, body) => { const res = await handler(new Request(`https://x.supabase.co/functions/v1/${name}`, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); } };
};
const TP = await load('team-pass', { from, rpc, auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) } });
eq(TP.mod.VOICE_PRODUCTS, { [BUNDLE + '.voice.steve']: 'steve' }, 'East London Steve is the one voice for sale; the free one isn\'t sold');
const claim = (who, tx, o) => TP.call(who, Object.assign({ action: 'voice', transaction_id: tx }, o));
buy('5000000001');
let r = await claim('tok-gaffer', '5000000001');
eq([r.status, r.added, r.voice], [200, true, 'steve'], 'Steve bought in TestFlight: checked with Apple and unlocked on the account (no team needed)');
eq((await claim('tok-gaffer', '5000000001')).added, false, 'claiming it again adds nothing');
eq((await claim('tok-jake', '5000000001')).reason, 'not_yours', 'nobody else can claim it (Apple has the buyer\'s account on it)');
buy('5000000002', { productId: BUNDLE + '.team.chip' });
eq((await claim('tok-gaffer', '5000000002')).reason, 'wrong_product', 'a team chip-in can\'t be passed off as a voice');
buy('5000000003', { productId: BUNDLE + '.voice.puck' });
eq((await claim('tok-gaffer', '5000000003')).reason, 'wrong_product', 'nor anything that isn\'t a voice for sale');
buy('5000000004', { revocationDate: Date.now() });
eq((await claim('tok-gaffer', '5000000004')).reason, 'refunded', 'a refunded voice isn\'t unlocked');
buy('5000000005');
eq((await TP.call('tok-gaffer', { action: 'claim', code: 'NOPE00', transaction_id: '5000000005' })).error, 'No such team.', 'a voice can\'t be claimed as a team pass');
eq(await d.rpc(gaffer, 'my_voices'), ['steve'], 'Steve is the gaffer\'s');

// ================= 3. reel-voice: paid voices only for their owners; samples made once
const TEAM = { id: 't-sop', code: 'SOPFC1' }, STORE = {}, GOOGLE = [];
const vdb = (table) => {
  const where = [];
  const b = { select() { return b; }, upsert: async () => ({ error: null }), eq(c, v) { where.push((x) => x[c] === v); return b; }, in(c, v) { where.push((x) => v.includes(x[c])); return b; },
    maybeSingle: async () => ({ data: rows().filter((x) => where.every((w) => w(x)))[0] || null, error: null }),
    then(res, rej) { return Promise.resolve({ data: rows().filter((x) => where.every((w) => w(x))), error: null }).then(res, rej); } };
  const rows = () => table === 'teams' ? [TEAM] : table === 'team_members' ? [{ team_id: 't-sop', user_id: gaffer.id }] : table === 'players' ? [{ team_id: 't-sop', pid: 2, user_id: jake.id }]
    : table === 'voice_unlocks' ? VU : table === 'voice_settings' ? SALE : [];
  return b;
};
let VU = [{ user_id: gaffer.id, voice: 'steve' }], SALE = [{ id: 1, on_sale: false }];
const RV = await load('reel-voice', { from: vdb, storage: { from: (bk) => ({ upload: async (name, bytes, o) => { STORE[bk + '/' + name] = { n: bytes.length, type: o.contentType }; return { error: null }; } }) },
  auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) } });
ENV.GOOGLE_TTS_KEY = 'k';
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://texttospeech.googleapis.com/')) { GOOGLE.push(JSON.parse(init.body)); return new Response(JSON.stringify({ audioContent: Buffer.from('mp3!').toString('base64') }), { status: 200 }); }
  const m = url.match(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/(voice-samples\/.+)$/);
  if (m && init.method === 'HEAD') return new Response(null, { status: STORE[m[1]] ? 200 : 404 });
  throw new Error('unexpected fetch ' + url);
};
const say = (who, voice, style) => RV.call(who, { code: 'sopfc1', lines: ['What a goal from Jake!'], voice, style });
for (const [voice, style] of [['Fenrir', 'plain'], ['Fenrir', 'hype'], ['Puck', 'hype']]) {
  GOOGLE.length = 0; r = await say('tok-jake', voice, style);
  eq([r.audio.length, r.voice, GOOGLE.map((g) => [g.voice.name, g.voice.model_name || ''])], [1, 'Fenrir', [['en-GB-Chirp3-HD-Fenrir', '']]], `the free voice is read straight for anyone in the team, whatever an older app asks for (${voice}, ${style})`);
}
GOOGLE.length = 0; r = await say('tok-jake', 'Fenrir', 'sweary');
eq([r.reason, r.audio && r.audio.length], [undefined, 1], 'until Steve is on sale (voice_settings.on_sale), nobody is refused him');
SALE[0].on_sale = true;
GOOGLE.length = 0; r = await say('tok-jake', 'Fenrir', 'sweary');
eq([r.reason, r.locked, GOOGLE.length], ['locked', ['steve'], 0], 'East London Steve isn\'t, for a player who hasn\'t bought him, and nothing goes to Google');
eq(r.error, 'East London Steve is a paid voice: unlock him in the voice picker, or pick Gaffer\'s commentator, which is free.', 'saying exactly why, and what to do');
GOOGLE.length = 0; r = await say('tok-gaffer', 'Fenrir', 'sweary');
check(!r.error && GOOGLE[0].voice.model_name === 'gemini-2.5-flash-tts' && /Cockney/.test(GOOGLE[0].input.prompt), 'the gaffer, who bought Steve, gets him: performed, in his Cockney accent');
GOOGLE.length = 0; r = await RV.call('tok-jake', { action: 'sample', voice: 'Fenrir', style: 'sweary' });
eq([r.url, r.made, Object.keys(STORE)], ['https://x.supabase.co/storage/v1/object/public/voice-samples/fenrir-sweary.mp3', true, ['voice-samples/fenrir-sweary.mp3']], 'anyone signed in can hear Steve before buying: made once and kept in the samples bucket');
eq([STORE['voice-samples/fenrir-sweary.mp3'].type, GOOGLE[0].voice.model_name], ['audio/mpeg', 'gemini-2.5-flash-tts'], 'as an MP3, performed as he\'ll sound');
check(!/Jake|Sons|SOP/.test(GOOGLE[0].input.text) && /fucking/.test(GOOGLE[0].input.text), 'the sample swears, and names nobody, so nothing about the team goes to Google');
GOOGLE.length = 0; r = await RV.call('tok-gaffer', { action: 'sample', voice: 'Fenrir', style: 'sweary' });
eq([r.url, r.made, GOOGLE.length], ['https://x.supabase.co/storage/v1/object/public/voice-samples/fenrir-sweary.mp3', undefined, 0], 'the next person to hear it gets the same file, and Google isn\'t asked again');
r = await RV.call('tok-jake', { action: 'sample', style: 'hype' });
check(r.url.endsWith('/fenrir-plain.mp3') && !GOOGLE.pop().voice.model_name, 'the free voice has its own sample, read straight');
eq((await RV.call(null, { action: 'sample' })).error, 'Sign in first.', 'samples are for someone signed in');
globalThis.fetch = realFetch;
await d.close();

// ================= 4. the app
const w = await world();
const cutter = () => { // the native ReelCutter, as the web app sees it (as in reels.test.mjs)
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => Object.assign({ file: c.file, path: '/phone/' + c.file }, c.voice ? { voiced: { file: c.file.replace('.mp4', 'v.mp4'), path: '/phone/' + c.file.replace('.mp4', 'v.mp4') } } : {})), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14) } }; },
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video' }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => { window.__rc.push(['join', o]); return { path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14) }; },
    readable: async () => ({ bad: [] }), share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
};
const appleSheet = () => { // Apple, as the web app sees it through TeamPassPlugin (as in teampass.test.mjs, plus what the Apple ID owns)
  const K = '__apple_unfinished', O = '__apple_owned';
  const S = window.__apple = { calls: [], get unfinished() { return JSON.parse(localStorage.getItem(K) || '[]'); }, set unfinished(v) { localStorage.setItem(K, JSON.stringify(v)); },
    get owned() { return JSON.parse(localStorage.getItem(O) || '[]'); }, set owned(v) { localStorage.setItem(O, JSON.stringify(v)); }, next: 'bought', n: Number(localStorage.getItem('__txn') || Math.floor(Math.random() * 1e6) * 100) };
  window.Capacitor.Plugins.TeamPass = {
    products: async (o) => ({ products: o.ids.map((id) => ({ id, price: '£3.99' })) }),
    buy: async (o) => { S.calls.push(['buy', o.id]); if (S.next !== 'bought') return { status: S.next };
      const t = { transactionId: String(++S.n), productId: o.id, account: o.account, environment: 'Sandbox' }; localStorage.setItem('__txn', S.n);
      S.unfinished = S.unfinished.concat([t]); S.owned = S.owned.concat([t]); window.__appleBought(t); return Object.assign({ status: 'bought' }, t); },
    unfinished: async () => ({ list: S.unfinished.slice() }),
    owned: async (o) => { S.calls.push(['owned', !!o.sync]); return { list: S.owned.slice() }; },
    finish: async (o) => { S.calls.push(['finish', o.transactionId]); S.unfinished = S.unfinished.filter((t) => t.transactionId !== o.transactionId); return { finished: true }; },
    addListener: () => ({ remove() {} }),
  };
};
const appleBought = async (P) => { await P.page.exposeFunction('__appleBought', (t) => { const db = w.db(); db.apple = db.apple || {}; db.apple[t.transactionId] = { productId: t.productId, account: t.account }; w.setDb(db); }); };
const voiceCalls = () => (w.db().calls || []).filter((x) => x.name === 'reel-voice');
const opts = (P, sel) => P.page.$$eval(sel + ' option', (o) => o.map((x) => x.textContent));
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await appleBought(A); await A.ctx.addInitScript(cutter); await A.ctx.addInitScript(appleSheet); await A.page.reload(); await A.run(500);
w.setDb(Object.assign(w.db(), { voicesSold: true, appleReady: true }));
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(60000); await A.click('#go'); await A.run(50000);
await A.click('#goalUs'); await A.click('#picker button[data-p="3"]'); await A.click('#picker button[data-p="2"]'); await A.run(60000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await home(A); await A.run(400);

await A.click('#mHighlights'); await A.click('#hlList [data-cut]');
const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]'); await A.run(500);
eq(await opts(A, '#cutVoiceName'), ['Read it straight, free', 'East London Steve 18+, £3.99'], 'the highlight maker has two voices: the free one, and East London Steve at Apple\'s price');
eq(await A.visible('#cutVoiceStyle'), false, 'and no separate delivery to pick');
eq(await A.page.$$eval('#cutBody [data-vo="buy"]', (b) => b.length), 0, 'with the free voice picked there\'s nothing to unlock');
await A.page.selectOption('#cutVoiceName', 'steve'); await A.run(300);
eq(await A.page.$$eval('#cutBody [data-vo="buy"]', (b) => b.map((x) => x.textContent)), ['Unlock East London Steve (£3.99)'], 'picking Steve offers to unlock him');
eq(await A.text('#cutBody [data-volock]'), 'A sweary Cockney pub commentator: he swears at the football, never at anyone. 18+. £3.99 to unlock, once, and yours to keep on any phone you sign in to.', 'saying who he is, what he costs and that he\'s kept');
check(await A.visible('#cutBody [data-vo="restore"]'), 'with Restore purchases, as Apple asks for with anything bought once');

// hearing him first: no AI ask, the same stored sample for everyone
await A.click('#cutBody [data-vo="hear"]'); await A.run(600);
const smp = voiceCalls().pop();
eq([smp.body.action, smp.body.style, smp.body.lines, smp.body.code], ['sample', 'sweary', undefined, undefined], 'Hear a sample asks for Steve\'s stored sample, with nothing about the team');
eq([await A.visible('#aiPop'), await A.text('#cutBody [data-vomsg]')], [false, 'Playing East London Steve.'], 'and plays it straight away, before buying, without the AI question (nothing is sent about anyone)');
await A.click('#cutBody [data-vo="hear"]'); await A.run(300);
eq(voiceCalls().filter((x) => x.body.action === 'sample').length, 1, 'hearing it again plays the same file; nothing is fetched twice');

// a cut with Steve not unlocked yet stops before anything is recorded
await A.page.check('#cutVoice'); await A.run(200);
await A.click('#cutBody [data-cutdo="go"]'); await A.run(500);
eq([await A.visible('#aiPop'), voiceCalls().filter((x) => x.body.lines).length, await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'cut').length)], [false, 0, 0], 'cutting with Steve locked: nothing is recorded or cut');
check(/East London Steve isn’t unlocked yet\. Unlock him under the voice, or pick Read it straight, which is free\./.test(await A.text('#cutBody')), 'and it says why, and what to do');

// unlocking
await A.click('#cutBody [data-vo="buy"]'); await A.run(1200);
eq(await A.text('#cutBody [data-vomsg]'), 'East London Steve is unlocked. He’s yours on any phone you sign in to Gaffer on.', 'buying Steve unlocks him');
eq([(w.db().voice_unlocks || []).map((x) => x.voice), await A.page.evaluate(() => window.__apple.calls.map((c) => c[0]))], [['steve'], ['buy', 'finish']], 'kept on the account by Gaffer\'s server, then finished with Apple');
eq([(await opts(A, '#cutVoiceName'))[1], await A.page.$$eval('#cutBody [data-vo="buy"]', (b) => b.length)], ['East London Steve 18+', 0], 'Steve shows no price now, and nothing to unlock');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(300); await A.click('#aiYes'); await A.run(3000);
const used = voiceCalls().filter((x) => x.body.lines).pop();
eq([used.body.style, (await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'cut').map((x) => x[1]))).pop().clips.every((c) => !!c.voice)], ['sweary', true], 'then the cut goes ahead, with every clip called by Steve');
check(used.body.lines.some((l) => /fuck|shit|bollocks|bastard|filth|hell/i.test(l)), 'in his own sweary lines');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(500);

// a player's reel: the same picker; the free voice reads straight
await A.click('#hlToggle [data-by="player"]'); await A.click('#hlList [data-hlm="pmake:3"]'); await A.click('#hlSheet [data-preel="3"]'); await A.click('#rbVoice'); await A.run(300);
eq(await opts(A, '#rbVoiceName'), ['Read it straight, free', 'East London Steve 18+'], 'the reel builder knows Steve is unlocked');
await A.page.selectOption('#rbVoiceName', 'free'); await A.run(300); await A.click('#rbMake'); await A.run(1500);
eq(voiceCalls().pop().body.style, 'plain', 'the free voice is asked for read straight (free up to Google\'s million characters a month)');

// the same account on another iPhone: Steve is already there; Restore brings back one bought but never counted
const B = await w.phone({ db: true, native: true, label: 'gaffer, second iPhone' });
await appleBought(B); await B.ctx.addInitScript(cutter); await B.ctx.addInitScript(appleSheet); await B.page.reload(); await B.run(500);
await B.click('#acctBtn'); await B.page.fill('#aEmail', 'ethan@example.com'); await B.page.fill('#aPass', 'longpassword'); await B.click('#aSignIn'); await B.run(2500);
await B.click('#myTeams button[data-team]'); await B.run(1500);
eq(await B.page.evaluate(() => window.gafferVoiceOwns('steve')), true, 'signed in on a second iPhone, Steve is already unlocked (he\'s on the account)');
const J = await w.phone({ db: true, native: true, label: 'jake' });
await appleBought(J); await J.ctx.addInitScript(cutter); await J.ctx.addInitScript(appleSheet); await J.page.reload(); await J.run(500);
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500);
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2500);
const jake2 = await J.page.evaluate(() => sessionStorage.getItem('__mockuser'));
eq(await J.page.evaluate(() => window.gafferVoiceOwns('steve')), false, 'Jake, on his own account, doesn\'t have Steve');
await J.page.evaluate((a) => { window.__apple.owned = [{ transactionId: '7000000001', productId: 'com.randomedp.aipoweredtactics.voice.steve', account: a, environment: 'Sandbox' }]; }, jake2);
w.setDb(Object.assign(w.db(), { apple: Object.assign(w.db().apple || {}, { 7000000001: { productId: 'com.randomedp.aipoweredtactics.voice.steve', account: jake2 } }) }));
await J.click('#tabs [data-tab="home"]'); await J.run(300);
await J.click('#mHighlights'); await J.click('#hlToggle [data-by="player"]'); await J.click('#hlList [data-hlm="pmake:2"]'); await J.click('#hlSheet [data-preel="2"]'); await J.click('#rbVoice'); await J.run(300);
await J.page.selectOption('#rbVoiceName', 'steve'); await J.run(300);
const jb = voiceCalls().length; await J.click('#rbMake'); await J.run(800);
eq([voiceCalls().length, /East London Steve isn’t unlocked yet/.test(await J.text('#rbMsg'))], [jb, true], 'his own reel with Steve locked: nothing recorded, and it says why');
await J.click('#reelPop [data-vo="restore"]'); await J.run(1200);
eq([await J.text('#reelPop [data-vomsg]'), await J.page.evaluate(() => window.__apple.calls.filter((c) => c[0] === 'owned'))], ['Restored: East London Steve.', [['owned', true]]], 'Restore purchases asks Apple and unlocks what this Apple ID bought');
eq([(await opts(J, '#rbVoiceName'))[1], (w.db().voice_unlocks || []).map((x) => x.voice)], ['East London Steve 18+', ['steve', 'steve']], 'Steve is unlocked on Jake\'s account too');

// 0034 live but Steve not on sale yet (my_voices says null): he stays open, as Sweary was (and the same before 0034)
w.setDb(Object.assign(w.db(), { voicesSold: 'off', voice_unlocks: [] }));
const C = await w.phone({ db: true, native: true, label: 'gaffer, old server' });
await C.ctx.addInitScript(cutter); await C.ctx.addInitScript(appleSheet); await C.page.reload(); await C.run(500);
await C.click('#acctBtn'); await C.page.fill('#aEmail', 'jake@example.com'); await C.page.fill('#aPass', 'longpassword'); await C.click('#aSignIn'); await C.run(2500);
await C.click('#myTeams button[data-team]'); await C.run(1500);
eq(await C.page.evaluate(() => window.gafferVoiceOwns('steve')), true, 'until the server sells voices, Steve isn\'t locked');

await done();
