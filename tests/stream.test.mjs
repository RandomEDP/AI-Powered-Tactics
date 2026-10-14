// Streaming a game live: the live-stream edge function (the real source, run here with stand-ins for Deno, the database
// and Cloudflare), and team-notify's "we're live" notification. Who may use it, the camera link being made once and kept,
// the link only taking a stream while the team is live, exactly one "we're live" however many gaffers are checking, and
// what the gaffer is told when Cloudflare says no.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const { check, eq, done } = suite('streaming a game live');

// ---------- stand-ins
const ENV = {}, DB = {}, USERS = { 'tok-ethan': 'u-ethan', 'tok-dan': 'u-dan', 'tok-jake': 'u-jake', 'tok-chaplin': 'u-chaplin', 'tok-rival': 'u-rival' };
const reset = () => Object.assign(DB, {
  teams: [{ id: 't-sop', code: 'SOPFC1', name: 'Sons of Pitches FC', short: 'SOP FC' }, { id: 't-ath', code: 'ATHLET', name: 'Athletico', short: '' }],
  team_members: [{ team_id: 't-sop', user_id: 'u-ethan' }, { team_id: 't-sop', user_id: 'u-dan' }, { team_id: 't-ath', user_id: 'u-rival' }],
  players: [{ team_id: 't-sop', pid: 1, user_id: 'u-jake' }, { team_id: 't-sop', pid: 2, user_id: 'u-chaplin' }, { team_id: 't-sop', pid: 3, user_id: null }],
  push_tokens: [{ user_id: 'u-jake', token: 'phone-jake' }, { user_id: 'u-chaplin', token: 'phone-chaplin' }, { user_id: 'u-dan', token: 'phone-dan' }, { user_id: 'u-ethan', token: 'phone-ethan' }],
  team_streams: [], live_matches: [{ team_id: 't-sop', state: { opp: 'Dog & Bone', phase: 'h1' } }] });
reset();
function from(table) {
  let op = 'select', body = null, back = false; const where = [];
  const b = {
    select() { if (op !== 'select') back = true; return b; },
    update(o) { op = 'update'; body = o; return b; }, upsert(o) { op = 'upsert'; body = o; return b; }, delete() { op = 'delete'; return b; },
    eq(c, v) { where.push((r) => r[c] === v); return b; }, in(c, v) { where.push((r) => v.includes(r[c])); return b; },
    is(c, v) { where.push((r) => (r[c] ?? null) === v); return b; }, not(c, o, v) { where.push((r) => (r[c] ?? null) !== v); return b; },
    maybeSingle() { return run().then((x) => ({ data: x.data ? x.data[0] || null : null, error: null })); },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    await new Promise((r) => setTimeout(r, 1)); // a real database answers later, so two calls can interleave
    const rows = DB[table], hit = rows.filter((r) => where.every((w) => w(r)));
    if (op === 'select') return { data: hit.map((r) => ({ ...r })), error: null };
    if (op === 'update') { hit.forEach((r) => Object.assign(r, body)); return { data: back ? hit.map((r) => ({ ...r })) : null, error: null }; }
    if (op === 'delete') { DB[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
    const i = rows.findIndex((r) => r.team_id === body.team_id); if (i >= 0) rows[i] = { ...rows[i], ...body }; else rows.push({ ...body }); return { data: null, error: null };
  }
  return b;
}
globalThis.__createClient = () => ({ from, auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) } });

// Cloudflare: live inputs, each with a camera that is or isn't sending. A switched-off input turns the camera away.
const CF = { inputs: {}, calls: [], refuse: 0, lifecycleDown: false, n: 0 };
const camera = (uid, on) => { CF.inputs[uid].camera = on; };
const live = (li) => !!li && li.enabled && li.camera;
const APNS = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
  const reply = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.push.apple.com/')) { APNS.push({ to: url.split('/').pop(), payload: body, headers: init.headers }); return new Response('', { status: 200 }); }
  let m = url.match(/^https:\/\/customer-abc\.cloudflarestream\.com\/([0-9a-f]+)\/lifecycle$/);
  if (m) { if (CF.lifecycleDown) throw new TypeError('fetch failed'); return reply(200, { isInput: true, videoUID: null, live: live(CF.inputs[m[1]]) }); }
  m = url.match(/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/acct-1\/stream\/live_inputs(?:\/([0-9a-f]+))?$/);
  if (!m) throw new Error('unexpected fetch ' + url);
  CF.calls.push({ method, uid: m[1] || null, body, auth: init.headers.Authorization });
  if (CF.refuse) return reply(CF.refuse, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
  const view = (li) => ({ uid: li.uid, enabled: li.enabled, status: live(li) ? 'connected' : null, rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: li.key },
    playback: { hls: `https://customer-abc.cloudflarestream.com/${li.uid}/manifest/video.m3u8` }, recording: li.recording, deleteRecordingAfterDays: li.days });
  if (method === 'POST' && !m[1]) {
    const uid = crypto.createHash('md5').update('in' + (++CF.n)).digest('hex');
    CF.inputs[uid] = { uid, key: 'k' + crypto.createHash('md5').update('key' + CF.n).digest('hex'), enabled: body.enabled !== false, recording: body.recording, days: body.deleteRecordingAfterDays, camera: false };
    return reply(200, { success: true, result: view(CF.inputs[uid]) });
  }
  const li = CF.inputs[m[1]]; if (!li) return reply(404, { success: false, errors: [{ code: 10003, message: 'Not found' }] });
  if (method === 'GET') return reply(200, { success: true, result: view(li) });
  if (method === 'PUT') { Object.assign(li, { enabled: body.enabled, recording: body.recording, days: body.deleteRecordingAfterDays }); return reply(200, { success: true, result: view(li) }); }
  return reply(405, { success: false });
};

// The real edge functions, with their two Deno imports swapped for the stand-ins above.
const load = async (name) => {
  let handler = null;
  globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
  const src = fs.readFileSync(path.join(ROOT, `supabase/functions/${name}/index.ts`), 'utf8')
    .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
    .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
  check(!/^import /m.test(src), `${name}: its only imports are the two that have stand-ins here`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), `${name}.ts`); fs.writeFileSync(file, src);
  await import(file);
  return async (token, body) => {
    const res = await handler(new Request('https://x.supabase.co/functions/v1/' + name, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) }));
    return Object.assign(await res.json(), { status: res.status });
  };
};
const stream = await load('live-stream');
const S = (who, action, extra = {}) => stream(who, Object.assign({ code: 'sopfc1 ', action }, extra));
const row = () => DB.team_streams.find((r) => r.team_id === 't-sop') || null;

// ---------- who can use it
eq((await S(null, 'link')).status, 401, 'nobody signed in gets anything');
let r = await S('tok-jake', 'link');
eq([r.status, r.error, CF.calls.length], [403, "Only a gaffer can stream the team's games", 0], 'a player can\'t stream the team\'s games, and Cloudflare is never asked');
eq((await stream('tok-ethan', { code: 'NOPE00', action: 'link' })).status, 404, 'a wrong code gets nothing');
eq((await S('tok-ethan', 'dance')).status, 400, 'nor does an unknown action');
r = await S('tok-ethan', 'link');
eq([r.status, r.reason, r.error], [503, 'not_configured', "Live streaming isn't set up on Gaffer's server yet."], 'before the Cloudflare secrets are set, the gaffer is told streaming isn\'t set up yet');
Object.assign(ENV, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', CLOUDFLARE_ACCOUNT_ID: 'acct-1', CLOUDFLARE_STREAM_TOKEN: 'cf-token' });

// ---------- the camera link: made once, kept, off until the team goes live
r = await S('tok-ethan', 'link');
const made = CF.calls.find((c) => c.method === 'POST'), uid1 = row() && row().input_uid, key1 = CF.inputs[uid1] && CF.inputs[uid1].key;
eq([r.status, r.url, r.server, r.key, r.on], [200, 'rtmps://live.cloudflare.com:443/live/' + key1, 'rtmps://live.cloudflare.com:443/live/', key1, false], 'a gaffer asking for the camera link gets one to paste into GoPro Quik, server and key joined');
eq([made.auth, made.body.enabled, made.body.recording.mode, made.body.deleteRecordingAfterDays, /Sons of Pitches FC/.test(made.body.meta.name)], ['Bearer cf-token', false, 'automatic', 30, true], 'it is made switched off, recording every stream, kept for 30 days, named after the team');
eq([row().hls, row().started_at, row().gid], [`https://customer-abc.cloudflarestream.com/${uid1}/manifest/video.m3u8`, null, null], 'the database keeps where it plays from; no stream is on');
check(!JSON.stringify(DB).includes(key1), 'the stream key itself is never written to the database');
r = await stream('tok-dan', { code: 'SOPFC1', action: 'link' });
eq([r.url, CF.calls.filter((c) => c.method === 'POST').length], ['rtmps://live.cloudflare.com:443/live/' + key1, 1], 'the other gaffer gets the same link: Quik remembers it, so it never changes by itself');
camera(uid1, true);
const lifecycle = async (uid) => (await fetch(`https://customer-abc.cloudflarestream.com/${uid}/lifecycle`)).json();
eq([(await S('tok-ethan', 'status')).on, (await lifecycle(uid1)).live], [false, false], 'a GoPro sending before anyone has pressed Go live is turned away');
camera(uid1, false);

// ---------- going live for a game
r = await S('tok-ethan', 'start', { gid: 'game-1' });
const put = CF.calls.filter((c) => c.method === 'PUT').pop();
eq([r.status, r.on, r.hls, r.url, CF.inputs[uid1].enabled], [200, true, row().hls, 'rtmps://live.cloudflare.com:443/live/' + key1, true], 'Go live switches the link on and hands back where it plays');
eq([put.body.recording.mode, put.body.deleteRecordingAfterDays], ['automatic', 30], 'switching it on keeps it recording (every update sends the settings in full)');
eq([row().gid, typeof row().started_at, row().on_air_at], ['game-1', 'string', null], 'the database now says a stream is on for this game');
eq(await S('tok-ethan', 'status'), { on: true, on_air: false, first: false, status: 200 }, 'until the GoPro starts sending, the stream is on but nothing is getting through');
camera(uid1, true);
const both = await Promise.all([S('tok-ethan', 'status'), S('tok-dan', 'status'), S('tok-ethan', 'status')]);
eq([both.every((x) => x.on_air), both.filter((x) => x.first).length], [true, 1], 'the camera gets through: three checks at once from two gaffers, and exactly one is told to say "we\'re live"');
eq((await S('tok-dan', 'status')).first, false, 'later checks never say it again');
r = await S('tok-ethan', 'start', { gid: 'game-1' });
eq([r.on, (await S('tok-ethan', 'status')).first, typeof row().on_air_at], [true, false, 'string'], 'pressing Go live again for the same game changes nothing (no second "we\'re live")');
eq((await S('tok-ethan', 'renew')).status, 409, 'a new link can\'t be made in the middle of a stream');

// ---------- ending it
r = await S('tok-dan', 'stop');
eq([r.on, CF.inputs[uid1].enabled, row().started_at, row().gid, row().on_air_at, live(CF.inputs[uid1])], [false, false, null, null, null, false], 'End stream switches the link off (cutting the GoPro off) and the database says nothing is on');
eq((await S('tok-ethan', 'status')).on, false, 'and the status agrees');
r = await S('tok-ethan', 'start', { gid: 'game-2' });
eq([r.on, (await S('tok-ethan', 'status')).first, row().gid], [true, true, 'game-2'], 'the next game\'s stream gets its own "we\'re live"');
DB.team_streams[0].started_at = new Date(Date.now() - 5 * 3600000).toISOString();
eq((await S('tok-ethan', 'status')).on, false, 'a stream nobody ended is over after four hours');
r = await S('tok-ethan', 'start', { gid: 'game-2' });
eq([r.on, (await S('tok-ethan', 'status')).first], [true, true], 'and going live again after that starts afresh');
CF.lifecycleDown = true;
eq((await S('tok-ethan', 'status')).on_air, true, 'if Cloudflare\'s public check can\'t be reached, the link\'s own state is asked instead');
CF.lifecycleDown = false;
await S('tok-ethan', 'stop');

// ---------- a new link, if the old one has got out
r = await S('tok-ethan', 'renew');
const uid2 = row().input_uid;
eq([r.status, uid2 !== uid1, r.url, CF.inputs[uid1].enabled, CF.inputs[uid2].enabled], [200, true, 'rtmps://live.cloudflare.com:443/live/' + CF.inputs[uid2].key, false, false], 'a new link replaces the old one, which takes nothing from now on');
eq(row().hls, `https://customer-abc.cloudflarestream.com/${uid2}/manifest/video.m3u8`, 'and the team watches from the new one');
delete CF.inputs[uid2];
r = await S('tok-ethan', 'link');
eq([r.status, row().input_uid !== uid2, !!CF.inputs[row().input_uid]], [200, true, true], 'a link deleted on Cloudflare\'s side is simply made again');

// ---------- when Cloudflare says no
CF.refuse = 403;
r = await S('tok-ethan', 'start', { gid: 'game-3' });
eq([r.status, r.error], [502, "Cloudflare turned down Gaffer's streaming key. It needs the Stream: Edit permission on the account."], 'a key without permission: the gaffer is told exactly that');
eq(row().started_at, null, 'and nothing is marked as live');
CF.refuse = 500;
r = await S('tok-ethan', 'link');
eq([r.status, /^Cloudflare couldn't do that just now \(Authentication error\)\. Try again in a minute\.$/.test(r.error)], [502, true], 'anything else: Cloudflare\'s reason and to try again');
CF.refuse = 0;

// ---------- team-notify: "we're live", sent by the server once per stream, from whichever phone on the team sees it first
// (the gaffer's own phone may be in GoPro Quik or an iPhone streaming app at the time)
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
Object.assign(ENV, { APNS_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }), APNS_KEY_ID: 'KEY123', APPLE_TEAM_ID: 'TEAM123' });
const notify = await load('team-notify');
const tell = (who) => notify(who, { code: 'SOPFC1', kind: 'live' });
await S('tok-ethan', 'start', { gid: 'game-4' });
const uid4 = row().input_uid; camera(uid4, false);
eq([(await tell('tok-jake')).reason, APNS.length, row().notified_at], ['not_live', 0, null], 'nobody is told while the picture isn\'t getting through, whoever asks');
camera(uid4, true);
eq([(await tell('tok-rival')).status, APNS.length, row().notified_at], [403, 0, null], 'someone outside the team can\'t set it off');
const asked = await Promise.all([tell('tok-jake'), tell('tok-chaplin'), tell('tok-ethan')]);
eq([asked.filter((x) => x.sent > 0).length, asked.filter((x) => x.reason === 'already').length], [1, 2], 'three phones seeing it at once (a gaffer\'s and two players\'): it is sent once');
const by = asked.findIndex((x) => x.sent > 0), byPhone = ['phone-jake', 'phone-chaplin', 'phone-ethan'][by];
const to = APNS.map((a) => a.to).sort(), p0 = APNS[0].payload;
eq([to.length, to.includes(byPhone), new Set(to).size], [3, false, 3], 'to everyone in the team except the phone that saw it, each phone once');
eq([p0.kind, p0.code, p0.aps.sound, p0.aps.alert.title, p0.aps.alert.body], ['live', 'SOPFC1', 'whistle.wav', 'SOP FC v Dog & Bone is live', 'Tap to watch the game.'], 'worded by the server, with the whistle, and tapping it opens the stream');
eq([typeof row().notified_at, typeof row().on_air_at], ['string', 'string'], 'and the stream is marked as on air');
APNS.length = 0;
eq([(await tell('tok-dan')).reason, APNS.length], ['already', 0], 'a phone asking later doesn\'t send it again');
await S('tok-ethan', 'stop'); await S('tok-ethan', 'start', { gid: 'game-5' }); camera(row().input_uid, true);
eq([row().notified_at, (await tell('tok-chaplin')).sent], [null, 3], 'the next game\'s stream gets its own');
APNS.length = 0; await S('tok-ethan', 'stop');
eq([(await tell('tok-jake')).reason, APNS.length], ['not_live', 0], 'and nothing once the stream has ended');

// ---------- team-notify: a report tells Gaffer's moderators straight away (Apple's 1.2: reports looked at within a day)
Object.assign(DB, { moderators: [{ user_id: 'u-ethan' }], post_reports: [], profile_reports: [], message_reports: [], stream_reports: [] });
const rep = (who, what) => notify(who, { kind: 'report', what });
APNS.length = 0;
eq([(await rep('tok-jake', 'post')).status, APNS.length], [404, 0], 'nobody is told unless the caller really has just reported something');
DB.post_reports.push({ user_id: 'u-jake', created_at: new Date(Date.now() - 3600000).toISOString() });
eq([(await rep('tok-jake', 'post')).status, APNS.length], [404, 0], 'nor for a report from an hour ago');
DB.stream_reports.push({ user_id: 'u-rival', created_at: new Date().toISOString() });
r = await rep('tok-rival', 'stream');
eq([r.sent, APNS.map((a) => a.to)], [1, ['phone-ethan']], 'someone from any team reporting a live stream: the moderator\'s phone is told, and only it');
eq([APNS[0].payload.kind, APNS[0].payload.aps.alert.title, APNS[0].payload.aps.alert.body], ['report', 'Something was reported in Gaffer', 'A live stream was reported. Have a look and deal with it within 24 hours.'], 'worded by the server');
APNS.length = 0; DB.message_reports.push({ user_id: 'u-chaplin', created_at: new Date().toISOString() });
eq([(await rep('tok-chaplin', 'chat')).sent, APNS[0].payload.aps.alert.body], [1, 'A chat message was reported. Have a look and deal with it within 24 hours.'], 'a chat message too');
eq((await rep(null, 'post')).status, 401, 'and nobody signed out can set it off');
APNS.length = 0;

// ---------- the commentary voice (reel-voice): the team's gaffers, and its players for their own reels; nobody else
DB.voice_usage = [];
const voiceFn = await load('reel-voice');
ENV.GOOGLE_TTS_KEY = 'tts-key';
const before = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => String(url).startsWith('https://texttospeech.googleapis.com/') ? new Response(JSON.stringify({ audioContent: 'QUFBQUFB' }), { status: 200 }) : before(url, init);
const V = (who) => voiceFn(who, { code: 'sopfc1', lines: ['What a goal from Jake!'], style: 'plain' });
eq([(await V('tok-ethan')).engine, (await V('tok-jake')).engine], ['chirp', 'chirp'], 'a gaffer gets commentary, and so does a player who has joined the squad as himself (for his own reel)');
eq((await V('tok-rival')).error, "Only the team's gaffers and players can add commentary. Join the squad as yourself first.", 'someone who isn\'t in the team gets none');
eq((await V(null)).error, 'Sign in first.', 'nor does anyone not signed in');
eq(DB.voice_usage[0] && DB.voice_usage[0].chars, 2 * 'What a goal from Jake!'.length, 'both count against the team\'s monthly allowance');
const ttsAsked = [];
globalThis.fetch = async (url, init = {}) => { if (String(url).startsWith('https://texttospeech.googleapis.com/')) { ttsAsked.push(JSON.parse(init.body)); return new Response(JSON.stringify({ audioContent: 'QUFBQUFB' }), { status: 200 }); } return before(url, init); };
const said = async (style) => { ttsAsked.length = 0; const out = await voiceFn('tok-ethan', { code: 'sopfc1', lines: ['HOW THE FUCK has Jake scored that?'], style }); return [out.engine, (ttsAsked[0] && ttsAsked[0].input.prompt) || '', ttsAsked[0] && ttsAsked[0].input.text]; };
const [swEngine, swPrompt, swText] = await said('sweary');
check(swEngine === 'gemini' && /foul-mouthed/.test(swPrompt) && /swear words and all/.test(swPrompt) && swText === 'HOW THE FUCK has Jake scored that?', 'Sweary (18+) is performed as a foul-mouthed pub commentator, the line said word for word');
check(/broad, proper East London Cockney accent/.test(swPrompt) && /Never Australian/.test(swPrompt), 'in a proper East London Cockney accent, spelt out (it came out Australian)');
check(/excitable British football commentator/.test((await said('hype'))[1]), 'Live commentator is still the excitable telly commentator');

// Google's per-minute limit on the commentator voice (what Ethan's reels kept hitting: every line was asked for at once)
ENV.VOICE_RETRY_MS = '5';
let busy = 0, most = 0, refusals = 0;
const quota = (n) => async (url, init = {}) => {
  if (!String(url).startsWith('https://texttospeech.googleapis.com/')) return before(url, init);
  const body = JSON.parse(init.body), gem = body.voice.model_name === 'gemini-2.5-flash-tts';
  busy++; most = Math.max(most, busy); await new Promise((r) => setTimeout(r, 2)); busy--;
  if (gem && refusals < n) { refusals++; return new Response(JSON.stringify({ error: { message: 'Quota exceeded for aiplatform.googleapis.com/global_generate_content_requests_per_minute_per_project_per_base_model with base model: gemini-2.5-flash-tts.' } }), { status: 429 }); }
  return new Response(JSON.stringify({ audioContent: gem ? 'R0VNSU5J' : 'Q0hJUlA=' }), { status: 200 });
};
globalThis.fetch = quota(3);
const paced = await voiceFn('tok-ethan', { code: 'sopfc1', lines: ['One.', 'Two.', 'Three.', 'Four.'], style: 'sweary' });
eq([paced.engine, paced.audio, most], ['gemini', ['R0VNSU5J', 'R0VNSU5J', 'R0VNSU5J', 'R0VNSU5J'], 1], 'told to slow down, it asks one line at a time and tries again: every line is performed');
busy = 0; most = 0; refusals = 0; globalThis.fetch = quota(1000);
const flat = await voiceFn('tok-ethan', { code: 'sopfc1', lines: ['One.', 'Two.'], style: 'hype' });
check(flat.engine === 'chirp' && flat.audio.every((a) => a === 'Q0hJUlA=') && /IAM & Admin, Quotas, search gemini-2.5-flash-tts/.test(flat.note || ''), `if Google keeps refusing, the lines are read straight and the note says which limit to raise (${flat.note})`);
delete ENV.VOICE_RETRY_MS;

globalThis.fetch = realFetch;
await done();
