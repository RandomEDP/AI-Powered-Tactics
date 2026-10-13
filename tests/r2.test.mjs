// Highlight clips in Cloudflare R2: the real clip-store edge function, run here with stand-ins for Deno, the database,
// Supabase storage and R2. Its upload links are signed the way S3 (and R2) check them, proved against Amazon's own worked
// example; only a team's gaffers get links, and only for the team's own folder; and the clips cut before R2 move across,
// both copies, with the old files deleted only once the new ones are safely in place.
import { suite, ROOT } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { check, eq, done } = suite('clips in Cloudflare R2');

const ENV = {}, USERS = { 'tok-ethan': 'u-ethan', 'tok-jake': 'u-jake', 'tok-rival': 'u-rival' };
const DB = {
  teams: [{ id: 't-sop', code: 'SOPFC1' }, { id: 't-ath', code: 'ATHLET' }],
  team_members: [{ team_id: 't-sop', user_id: 'u-ethan' }, { team_id: 't-ath', user_id: 'u-rival' }],
  clips: [{ team_id: 't-sop', game_id: 'g1', seq: 0, path: 't-sop/2026-10-10_dog/01.mp4', vpath: 't-sop/2026-10-10_dog/01v.mp4', store: null },
    { team_id: 't-sop', game_id: 'g1', seq: 1, path: 't-sop/2026-10-10_dog/02.mp4', vpath: null, store: null }],
};
const OLD = { 't-sop/2026-10-10_dog/01.mp4': 'clip one', 't-sop/2026-10-10_dog/01v.mp4': 'clip one, with commentary', 't-sop/2026-10-10_dog/02.mp4': 'clip two' }, R2 = {}, REMOVED = [];
function from(table) {
  let op = 'select', body = null; const where = [];
  const b = {
    select() { return b; }, update(o) { op = 'update'; body = o; return b; },
    eq(c, v) { where.push((r) => r[c] === v); return b; },
    maybeSingle() { return run().then((x) => ({ data: x.data ? x.data[0] || null : null, error: null })); },
    then(res, rej) { return run().then(res, rej); },
  };
  async function run() {
    const hit = DB[table].filter((r) => where.every((w) => w(r)));
    if (op === 'update') { hit.forEach((r) => Object.assign(r, body)); return { data: null, error: null }; }
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  return b;
}
globalThis.__createClient = () => ({ from, auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) },
  storage: { from: (bucket) => ({ remove: async (paths) => { paths.forEach((p) => { REMOVED.push(bucket + ':' + p); delete OLD[p]; }); return { data: paths, error: null }; } }) } });
let refusePut = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = init.method || 'GET';
  let m = url.match(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/clips\/(.+)$/);
  if (m) { const k = decodeURIComponent(m[1]); return k in OLD ? new Response(OLD[k], { status: 200 }) : new Response('', { status: 404 }); }
  m = url.match(/^https:\/\/acct-1\.r2\.cloudflarestorage\.com\/gaffer-clips\/([^?]+)\?(.+)$/);
  if (!m) throw new Error('unexpected fetch ' + url);
  const k = decodeURIComponent(m[1]);
  check(/X-Amz-Signature=[0-9a-f]{64}$/.test(m[2]) && m[2].includes('X-Amz-Credential=r2-access%2F'), `R2 is only called through a signed link (${method} ${k})`);
  if (method === 'PUT') { if (refusePut) return new Response('nope', { status: 403 }); R2[k] = { body: new TextDecoder().decode(init.body), type: init.headers['Content-Type'] }; return new Response('', { status: 200 }); }
  if (method === 'DELETE') { delete R2[k]; return new Response(null, { status: 204 }); }
  throw new Error('unexpected ' + method);
};

// the real function, with its two Deno imports swapped for the stand-ins above
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/clip-store/index.ts'), 'utf8')
  .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
  .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
check(!/^import /m.test(src), 'its only imports are the two that have stand-ins here');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), 'clip-store.ts'); fs.writeFileSync(file, src);
const { presign } = await import(file);
const call = async (token, body) => {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/clip-store', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) }));
  return Object.assign(await res.json(), { status: res.status });
};

// ---------- the signing, against Amazon's worked example for a presigned GET (S3 docs, "Authenticating Requests: Using Query Parameters")
const aws = await presign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', access: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1', at: new Date('2013-05-24T00:00:00Z'), expires: 86400 });
eq(aws.split('X-Amz-Signature=')[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404', 'upload links are signed exactly as S3 (and R2) check them: Amazon\'s own worked example comes out right');
check(aws.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&'), 'with the query in the order S3 expects');

// ---------- who can use it
const up = (who, paths, extra = {}) => call(who, Object.assign({ code: 'sopfc1', action: 'upload', paths }, extra));
const mine = ['t-sop/2026-10-17_dog/01.mp4', 't-sop/2026-10-17_dog/01v.mp4'];
Object.assign(ENV, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' });
eq([(await up(null, mine)).status, (await up('tok-jake', mine)).status, (await up('tok-rival', mine)).status], [401, 403, 403], 'nobody signed in, a player or another team\'s gaffer gets no upload links');
const notYet = await up('tok-ethan', mine);
eq([notYet.status, notYet.reason, notYet.error], [503, 'not_configured', "Clip storage isn't set up on Gaffer's server yet."], 'before the R2 secrets are set, the app is told (and uses the old storage)');
Object.assign(ENV, { CLOUDFLARE_ACCOUNT_ID: 'acct-1', R2_ACCESS_KEY_ID: 'r2-access', R2_SECRET_ACCESS_KEY: 'r2-secret', R2_BUCKET: 'gaffer-clips' });
eq([(await up('tok-ethan', ['t-ath/x/01.mp4'])).status, (await up('tok-ethan', ['t-sop/../t-ath/01.mp4'])).status, (await up('tok-ethan', [])).status], [400, 400, 400], 'only for files in the team\'s own folder');

// ---------- upload links
const links = await up('tok-ethan', mine);
eq(links.urls.length, 2, 'a gaffer gets one link per file');
check(links.urls.every((u, i) => u.startsWith(`https://acct-1.r2.cloudflarestorage.com/gaffer-clips/${mine[i]}?`) && /X-Amz-Expires=3600&/.test(u) && /X-Amz-Credential=r2-access%2F\d{8}%2Fauto%2Fs3%2Faws4_request/.test(u)),
  'each to that file in the bucket, good for an hour, signed with the R2 key (which never leaves the server)');
check(!JSON.stringify(links).includes('r2-secret'), 'the R2 secret itself is never sent');
await fetch(links.urls[0], { method: 'PUT', body: new TextEncoder().encode('new clip'), headers: { 'Content-Type': 'video/mp4' } });
eq(R2[mine[0]], { body: 'new clip', type: 'video/mp4' }, 'and the file goes straight into R2 with it');

// ---------- moving the clips cut before R2
const adopt = (seq) => call('tok-ethan', { code: 'SOPFC1', action: 'adopt', game_id: 'g1', seq });
refusePut = true;
const refused = await adopt(0);
eq([refused.status, DB.clips[0].store, 't-sop/2026-10-10_dog/01.mp4' in OLD, REMOVED.length], [502, null, true, 0], 'if R2 won\'t take a file, nothing changes: the clip stays where it was and plays as before');
refusePut = false;
const one = await adopt(0);
eq([one.moved, R2['t-sop/2026-10-10_dog/01.mp4'], R2['t-sop/2026-10-10_dog/01v.mp4'], DB.clips[0].store, REMOVED],
  [2, { body: 'clip one', type: 'video/mp4' }, { body: 'clip one, with commentary', type: 'video/mp4' }, 'r2', ['clips:t-sop/2026-10-10_dog/01.mp4', 'clips:t-sop/2026-10-10_dog/01v.mp4']],
  'a clip moves across with both its copies; the row says R2; then the old files are deleted');
eq([(await adopt(1)).moved, DB.clips[1].store, (await adopt(1)).moved], [1, 'r2', 0], 'one without commentary moves its one file, and asking again does nothing');
eq((await call('tok-rival', { code: 'SOPFC1', action: 'adopt', game_id: 'g1', seq: 0 })).status, 403, 'another team\'s gaffer can\'t move them');

// ---------- deleting
const gone = await call('tok-ethan', { code: 'SOPFC1', action: 'remove', paths: ['t-sop/2026-10-10_dog/01.mp4', 't-sop/2026-10-10_dog/01v.mp4'] });
eq([gone.removed, Object.keys(R2).sort()], [2, ['t-sop/2026-10-10_dog/02.mp4', mine[0]].sort()], 'deleting a game\'s highlights deletes its files from R2');
eq((await call('tok-ethan', { code: 'SOPFC1', action: 'remove', paths: ['t-ath/x/01.mp4'] })).status, 400, 'never another team\'s');

await done();
