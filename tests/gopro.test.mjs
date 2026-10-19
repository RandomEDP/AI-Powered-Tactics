// A camera's video from a GoPro share link (Ethan, October 2026: "I have a GoPro premium all my footage goes there ... I
// can paste a GoPro share link and you download it from there"). An iPhone video still comes from Photos.
// First the real gopro-link edge function, run here with stand-ins for Deno, the database and GoPro's own servers (their
// answers copied from what a real public share link gave, October 2026): only a team's gaffers can use it, it finds the
// share in whatever was pasted, lists the videos newest first, and picks the 1080p version of a 4K or 5.3K video (a half
// of 5.3K is over 10 GB) but the original when that's no bigger. Then the phone: paste the link on the cameras screen,
// pick which video when there are several, it downloads (ReelCutter.fetchVideo, a stand-in here) and lines up from when
// the camera started recording, exactly like a video chosen from Photos; a bad link says what to do.
import { world, suite, ROOT } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { check, eq, done } = suite('a GoPro link for the highlights (an iPhone video comes from Photos)');

// ---------- the edge function
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' }, USERS = { 'tok-ethan': 'u-ethan', 'tok-jake': 'u-jake' };
const DB = { teams: [{ id: 't-sop', code: 'SOPFC1' }], team_members: [{ team_id: 't-sop', user_id: 'u-ethan' }] };
function from(table) {
  const where = [];
  const b = { select() { return b; }, eq(c, v) { where.push((r) => r[c] === v); return b; },
    maybeSingle: async () => ({ data: DB[table].filter((r) => where.every((w) => w(r)))[0] || null, error: null }) };
  return b;
}
globalThis.__createClient = () => ({ from, auth: { getUser: async (t) => ({ data: { user: USERS[t] ? { id: USERS[t] } : null } }) } });
const cdn = (id, label) => `https://media-cdn-vod-us-west-2.gopro.com/owner/${id}/${label}/default/1.mp4?Expires=1&Signature=s`;
const vars = (id, w, h) => [
  { label: 'source', type: 'mp4', width: w, height: h, quality: h + 'p', available: true, url: cdn(id, 'source'), head: cdn(id, 'source') + '&head' },
  { label: 'high_res_proxy_mp4', type: 'mp4', width: 1920, height: 1080, quality: '1080p', available: true, url: cdn(id, 'proxy'), head: cdn(id, 'proxy') + '&head' },
  { label: 'mp4_low', type: 'mp4', width: 426, height: 240, quality: '240p', available: true, url: cdn(id, 'low') }];
const SHARES = {
  OneHalfVid01: [{ id: 'LvV9MVbapDqKy', type: 'Video', filename: 'GX010042.MP4', captured_at: '2026-10-10T17:58:00Z', source_duration: '2400000', file_size: 12000000000, w: 5312, h: 2988 }],
  TwoHalves001: [{ id: 'Half1aaaaaaaa', type: 'Video', filename: 'GX010050.MP4', captured_at: '2026-10-10T17:58:00Z', source_duration: '1080000', file_size: 900000000, w: 1920, h: 1080 },
    { id: 'Photo1aaaaaaa', type: 'Photo', filename: 'GOPR0051.JPG', captured_at: '2026-10-10T18:30:00Z' },
    { id: 'Half2aaaaaaaa', type: 'Video', filename: 'GX010052.MP4', captured_at: '2026-10-10T18:01:30Z', source_duration: '1080000', file_size: 950000000, w: 1920, h: 1080 }],
  FourKVideo01: [{ id: 'FourKaaaaaaaa', type: 'Video', filename: 'GX010090.MP4', captured_at: '2026-10-10T17:58:00Z', source_duration: '1800000', file_size: 5400000000, w: 3840, h: 2160 }],
  OnlyPhotos01: [{ id: 'Photo2aaaaaaa', type: 'Photo', filename: 'GOPR0060.JPG' }],
};
// the newer kind of share (gopro.com/v/<uuid>, Ethan's links in October 2026), read from /media/items/ with each video under `medium`
const ITEMS = { '26a90bf2-007d-4321-9a3b-5c7e1f0d2a44': [{ id: 'NewShareVid01', type: 'Video', filename: 'GX010077.MP4', captured_at: '2026-10-10T17:58:00Z', source_duration: '1800000', file_size: 1100000000, w: 1920, h: 1080 }],
  '00000000-0000-4000-8000-0000000000aa': 'private' };
const asked = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); asked.push((init.method || 'GET') + ' ' + url);
  let m = url.match(/^https:\/\/api\.gopro\.com\/collections\/([A-Za-z0-9-]+)\/media$/);
  if (m) {
    check(/application\/vnd\.gopro\.jk\.media\+json/.test(init.headers?.Accept || ''), 'GoPro is asked the way its own share page asks (it says 406 otherwise)');
    return SHARES[m[1]] ? new Response(JSON.stringify({ _embedded: { media: SHARES[m[1]].map(({ w, h, ...x }) => x) } })) : new Response('{}', { status: 404 });
  }
  m = url.match(/^https:\/\/api\.gopro\.com\/media\/items\/([A-Za-z0-9-]+)\?page=1&per_page=200$/);
  if (m) {
    check(/application\/vnd\.gopro\.jk\.media\+json/.test(init.headers?.Accept || ''), 'a newer share is asked for the way GoPro\'s own page asks');
    const x = ITEMS[m[1]];
    if (x === 'private') return new Response('', { status: 403 });
    return x ? new Response(JSON.stringify({ items: x.map(({ w, h, ...v }) => ({ id: 'item-' + v.id, medium: v })), _pages: { current_page: 1, total_pages: 1 } })) : new Response('', { status: 404 });
  }
  m = url.match(/^https:\/\/api\.gopro\.com\/media\/([A-Za-z0-9]+)\/download$/);
  if (m) { const x = [...Object.values(SHARES), ...Object.values(ITEMS).filter(Array.isArray)].flat().find((v) => v.id === m[1]); return new Response(JSON.stringify({ filename: x.filename, _embedded: { variations: vars(x.id, x.w, x.h) } })); }
  if (/&head$/.test(url) && init.method === 'HEAD') return new Response(null, { headers: { 'content-length': '1400000000' } });
  m = url.match(/^https:\/\/gopro\.app\.link\/(\w+)$/);
  if (m) return new Response(null, { status: 302, headers: { location: 'https://gopro.com/v/' + m[1] } });
  throw new Error('unexpected fetch ' + url);
};
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/gopro-link/index.ts'), 'utf8')
  .replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '')
  .replace(/^import \{ createClient \} from "jsr:@supabase\/supabase-js@2";\n/m, 'const createClient = (globalThis as any).__createClient;\n');
check(!/^import /m.test(src), 'its only imports are the two that have stand-ins here');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-fn-')), 'gopro-link.ts'); fs.writeFileSync(file, src);
const { shareId, pickVersion } = await import(file);
const call = async (token, link, code = 'sopfc1', res4k = null) => {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/gopro-link', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify({ code, link, res: res4k }) }));
  return Object.assign(await res.json(), { status: res.status });
};

eq([shareId('https://gopro.com/v/ZNVvED8QDzR5V'), shareId('Check out my GoPro video! https://gopro.com/v/ZNVvED8QDzR5V?share=1'), shareId('  ZNVvED8QDzR5V '), shareId('https://example.com/v/x'), shareId('hello')],
  ['ZNVvED8QDzR5V', 'ZNVvED8QDzR5V', 'ZNVvED8QDzR5V', null, null], 'the share is found in the link, in a message with the link in it, or on its own; anything else isn\'t one');
eq([pickVersion(vars('a', 5312, 2988)).label, pickVersion(vars('a', 3840, 2160)).label, pickVersion(vars('a', 1920, 1080)).label, pickVersion(vars('a', 2704, 1520).slice(0, 1)).label, pickVersion(vars('a', 1920, 1080).slice(2)), pickVersion([])],
  ['high_res_proxy_mp4', 'high_res_proxy_mp4', 'source', 'source', null, null], 'a 5.3K or 4K video comes as GoPro\'s 1080p copy (plenty for highlights, a fraction of the size); a 1080p one as the original; never the tiny preview');

eq([(await call(null, 'https://gopro.com/v/OneHalfVid01')).status, (await call('tok-jake', 'https://gopro.com/v/OneHalfVid01')).status], [401, 403], 'nobody signed in, and nobody but the team\'s gaffers, can use it');
const one = await call('tok-ethan', 'https://gopro.com/v/OneHalfVid01');
eq([one.status, one.videos.length, one.videos[0].name, one.videos[0].quality, one.videos[0].url, one.videos[0].duration, one.videos[0].size, one.videos[0].captured],
  [200, 1, 'GX010042.MP4', '1080p', cdn('LvV9MVbapDqKy', 'proxy'), 2400, 1400000000, '2026-10-10T17:58:00Z'],
  'one video: its name, the 1080p copy\'s address and size (asked of GoPro, so the phone can check it has room), its length and when it started recording');
const two = await call('tok-ethan', 'https://gopro.com/v/TwoHalves001');
eq([two.videos.map((v) => v.name), two.videos.map((v) => v.quality), two.videos.map((v) => v.size)], [['GX010052.MP4', 'GX010050.MP4'], ['1080p', '1080p'], [950000000, 900000000]], 'two halves: both videos, newest first, photos left out; already 1080p, so the originals (sized from GoPro\'s own list)');
eq((await call('tok-ethan', 'https://gopro.app.link/OneHalfVid01')).videos?.[0]?.name, 'GX010042.MP4', 'a Quik short link is followed to the share it stands for');
const bad = [await call('tok-ethan', 'https://example.com/v/OneHalfVid01'), await call('tok-ethan', 'https://gopro.com/v/GoneGoneGone1'), await call('tok-ethan', 'https://gopro.com/v/OnlyPhotos01')];
eq(bad.map((x) => [x.status, x.reason]), [[400, 'not_gopro'], [404, 'not_shared'], [404, 'no_video']], 'not a GoPro link, a share that\'s gone, and a share with no video each say so');
check(/tap Share, then Copy link/.test(bad[0].error) && /isn't shared any more/.test(bad[1].error) && /only photos/.test(bad[2].error), 'each in plain words, with what to do');
check(!asked.some((a) => /example\.com/.test(a)), 'a link to anywhere but GoPro is never fetched');
// 4K, for the Gaffer tier (Ethan: "allow 4k uploads only for the pro gaffer tier ... also ... from GoPro footage")
eq([pickVersion(vars('a', 3840, 2160), '4k').label, pickVersion(vars('a', 2704, 1520), '4k').label, pickVersion(vars('a', 5312, 2988), '4k').label, pickVersion(vars('a', 2160, 3840), '4k').label, pickVersion(vars('a', 1080, 1920)).label],
  ['source', 'source', 'high_res_proxy_mp4', 'source', 'source'], 'with 4K asked for, the original up to 4K (either way up); a 5.3K one is still GoPro\'s 1080p copy; a portrait 1080p one is the original either way');
const k4 = [await call('tok-ethan', 'https://gopro.com/v/FourKVideo01'), await call('tok-ethan', 'https://gopro.com/v/FourKVideo01', 'sopfc1', '4k')];
eq(k4.map((x) => [x.videos[0].quality, x.videos[0].url, x.videos[0].size]), [['1080p', cdn('FourKaaaaaaaa', 'proxy'), 1400000000], ['2160p', cdn('FourKaaaaaaaa', 'source'), 5400000000]],
  'a 4K video comes as the 1080p copy as usual, and as the 4K original (with its real size, so the phone checks there\'s room) when 4K is on');
eq([shareId('https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44'), shareId('Check this https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44?utm_source=quik'), shareId(' 26a90bf2-007d-4321-9a3b-5c7e1f0d2a44 ')], ['26a90bf2-007d-4321-9a3b-5c7e1f0d2a44', '26a90bf2-007d-4321-9a3b-5c7e1f0d2a44', '26a90bf2-007d-4321-9a3b-5c7e1f0d2a44'],
  'the newer kind of link (gopro.com/v/ then a long id with dashes, which Ethan\'s were) is read whole, not cut off at the first dash');
const fresh = await call('tok-ethan', 'Check this https://gopro.com/v/26a90bf2-007d-4321-9a3b-5c7e1f0d2a44?utm_source=quik');
eq([fresh.status, fresh.videos?.map((v) => v.name), fresh.videos?.[0]?.quality, fresh.videos?.[0]?.url, fresh.videos?.[0]?.duration], [200, ['GX010077.MP4'], '1080p', cdn('NewShareVid01', 'source'), 1800],
  'a newer link\'s video is found through GoPro\'s /media/items/ list, then downloaded like any other');
const shut = [await call('tok-ethan', 'https://gopro.com/v/00000000-0000-4000-8000-0000000000aa'), await call('tok-ethan', 'https://gopro.com/v/11111111-2222-4333-8444-555555555555')];
eq(shut.map((x) => [x.status, x.reason]), [[404, 'not_shared'], [404, 'not_shared']], 'a newer link GoPro keeps to signed-in people, or one that\'s gone, says so');
check(/link anyone can open/.test(shut[0].error) && /isn't shared any more/.test(shut[1].error), 'the signed-in-only one says to share it again with a link anyone can open');
check(asked.includes('GET https://api.gopro.com/collections/11111111-2222-4333-8444-555555555555/media'), 'a newer id GoPro can\'t find in /media/items/ is tried as an older share too');

// ---------- the phone
const w = await world();
const cutter = () => {
  window.__rc = [];
  window.Capacitor.Plugins.ReelCutter = {
    addListener: (ev, f) => { if (ev === 'progress') window.__rcProg = f; return { remove() {} }; },
    pickVideo: async (o) => { window.__rc.push(['pick', o.slot]); return { cancelled: true }; },
    fetchVideo: async (o) => {
      window.__rc.push(['fetch', o]);
      if (window.__noRoom) throw new Error('That video is 1.4 GB and this phone only has 0.3 GB free. Free up some space (or share just the half you need from GoPro Quik) and try again.');
      window.__rcProg({ stage: 'download', p: 0.42 });
      await new Promise((r) => setTimeout(r, 2000));
      return { path: '/phone/downloads/' + o.key + '.mp4', duration: o.key.includes('Half') ? 1080 : 2400 };
    },
    cut: async (o) => { window.__rc.push(['cut', o]); return { clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile } }; },
    readable: async (o) => ({ bad: [] }), share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
};
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(40000);
await A.click('#goalUs'); await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(30000);
await A.click('#endHalf'); await A.click('#endHalf'); await A.run(60000); await A.click('#go'); await A.run(50000);
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await A.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
await A.page.evaluate((s) => { window.__gopro = s; }, { 'https://gopro.com/v/OneHalfVid01': one, 'https://gopro.com/v/TwoHalves001': two, 'https://gopro.com/v/GoneGoneGone1': { error: bad[1].error, reason: 'not_shared' } });
await A.click('#mHighlights'); await A.click('#hlList [data-cut]');

check(await A.page.isVisible('#cutBody [data-cutdo="gpadd"]'), 'the cameras screen offers Add from a GoPro link, next to Add a camera (from Photos)');
await A.click('#cutBody [data-cutdo="gpadd"]');
eq([await A.page.locator('#camSvg [data-cam]').count(), await A.page.isVisible('#gpLink'), await A.page.isVisible('#cutBody [data-cutdo="gpadd"]')], [1, true, false], 'it adds a camera (to drag where it stood) and asks for the link');
check(/tap Share, then Copy link/.test(await A.text('#gpBox')) && /iPhone\? Choose it from Photos/.test(await A.text('#gpBox')), 'saying where to get the link in GoPro Quik, and that an iPhone video comes from Photos');
await A.click('#cutBody [data-cutdo="gpno"]');
eq([await A.page.locator('#camSvg [data-cam]').count(), await A.page.isVisible('#gpBox')], [0, false], 'Cancel takes the new camera away again, as cancelling Photos does');

// a bad link
await A.click('#cutBody [data-cutdo="gpadd"]');
await A.page.fill('#gpLink', 'https://gopro.com/v/GoneGoneGone1'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(300);
check(/isn't shared any more/.test(await A.text('#gpMsg')), 'a link that\'s gone says so, and what to do');
eq(await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'fetch').length), 0, 'and nothing is downloaded');

// one video: straight to the download, then lined up from when the camera started
await A.page.fill('#gpLink', 'https://gopro.com/v/OneHalfVid01'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(100);
check(/Downloading the video, 42%\. It carries on if you put Gaffer away\./.test(await A.text('#cutProg')), `the download shows how far it's got (${await A.text('#cutProg')})`);
await A.run(2500);
const f1 = await A.page.evaluate(() => window.__rc.filter((x) => x[0] === 'fetch').pop()[1]);
eq([f1.url, f1.key, f1.size], [cdn('LvV9MVbapDqKy', 'proxy'), 'gp-LvV9MVbapDqKy-1080p', 1400000000], 'the phone downloads GoPro\'s address itself, named so a second go picks the same file up, with its size to check there\'s room');
check(/^40 min, started 17:58$/.test((await A.text('#cutBody .camlist li span')).trim()), `the camera now has its video, started when GoPro says (${await A.text('#cutBody .camlist li span')})`);
check(!(await A.page.isVisible('#gpBox')), 'and the link box has gone');
await A.click('#cutBody [data-cutdo="next"]');
const rows = await A.page.$$eval('#cutBody .marks li', (li) => li.map((x) => [x.querySelector('b').textContent, x.querySelector('span').textContent]));
const ko = rows.find((x) => /^Kick-off/.test(x[0]));
check(/^About 02:0\d$/.test(ko[1]), `kick-off is guessed from the camera's clock, two minutes in (${ko[1]}), as with a video from Photos`);
eq(await A.page.evaluate(() => document.getElementById('cutPrev').getAttribute('src').replace(location.origin, '')), '/_capacitor_file_/phone/downloads/gp-LvV9MVbapDqKy-1080p.mp4', 'and the downloaded file is what plays to line it up');

// a link with both halves: pick the first half, then the second half from the same link
await A.click('#cutBody [data-cutdo="cams"]');
await A.click('#cutBody [data-cutdo="gp"]');
await A.page.fill('#gpLink', 'https://gopro.com/v/TwoHalves001'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(300);
const opts = await A.page.$$eval('#cutBody .gplist button', (b) => b.map((x) => x.textContent));
eq(opts, ['GX010052.MP410 Oct 18:01, 18 min, 1080p, 950 MB', 'GX010050.MP410 Oct 17:58, 18 min, 1080p, 900 MB'], 'several videos: each with when it started, how long, how sharp and how big, to pick from');
check(/Pick the first half here, then use Add a second-half video/.test(await A.text('#gpBox')), 'saying how to add the other half');
await A.click('#cutBody [data-cutdo="gpuse"][data-i="1"]'); await A.run(2500);
check(/^18 min, started 17:58$/.test((await A.text('#cutBody .camlist li span')).trim()), 'the first half is the camera\'s video now (the same video again would keep its marks)');
await A.click('#cutBody [data-cutdo="next"]');
check(await A.page.isVisible('#cutBody [data-cutdo="gp2"]'), 'the second half can come from a link too');
await A.click('#cutBody [data-cutdo="gp2"]');
check(/Second-half video from a link/.test(await A.text('#gpBox')), 'the box says it\'s for the second half');
await A.page.fill('#gpLink', 'https://gopro.com/v/TwoHalves001'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(300);
await A.click('#cutBody [data-cutdo="gpuse"][data-i="0"]'); await A.run(2500);
check(await A.page.isVisible('#cutBody [data-cutdo="drop2"]'), 'and the second half is added, as one from Photos is');
const sec = (await A.page.$$eval('#cutBody .marks li', (li) => li.map((x) => [x.querySelector('b').textContent, x.querySelector('span').textContent]))).find((x) => /Second-half/.test(x[0]));
check(/second video/.test(sec[1]), `the second-half kick-off is placed in the second video (${sec[1]})`);

// no room on the phone
await A.click('#cutBody [data-cutdo="cams"]');
await A.page.evaluate(() => { window.__noRoom = true; });
await A.click('#cutBody [data-cutdo="gp"]'); await A.page.fill('#gpLink', 'https://gopro.com/v/OneHalfVid01'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(400);
check(/this phone only has 0\.3 GB free/.test(await A.text('#gpMsg')), 'not enough room on the phone says how much is needed, and what to do');
check(/^18 min/.test((await A.text('#cutBody .camlist li span')).trim()), 'and the camera keeps the video it had');
await A.click('#cutBody [data-cutdo="gpno"]');

// 4K highlights (the Gaffer tier; everyone has it in early access)
await A.page.evaluate(() => { window.__noRoom = false; });
const goproAsked = () => w.db().calls.filter((c) => c.name === 'gopro-link').pop().body;
check(await A.page.isVisible('#cut4k') && !(await A.page.isChecked('#cut4k')), 'the cameras screen offers Highlights in 4K, off to start');
check(/4K GoPro or iPhone footage/.test(await A.text('label[for="cut4k"]')), 'saying it works for GoPro or iPhone footage, and what it costs in size and time');
await A.click('#cutBody [data-cutdo="gp"]'); await A.page.fill('#gpLink', 'https://gopro.com/v/OneHalfVid01'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(2600);
eq(goproAsked().res, null, 'with it off, a GoPro link asks for the usual 1080p copy');
await A.page.check('#cut4k'); await A.run(100);
eq(await A.page.evaluate(() => localStorage.getItem('apt-4k')), '1', 'switching it on is kept on this phone');
await A.click('#cutBody [data-cutdo="gp"]'); await A.page.fill('#gpLink', 'https://gopro.com/v/OneHalfVid01'); await A.click('#cutBody [data-cutdo="gpgo"]'); await A.run(2600);
eq(goproAsked().res, '4k', 'with it on, a GoPro link asks for the 4K original');
check(await A.page.isChecked('#cut4k'), 'and it stays on as the screen is redrawn');
await A.click('#cutBody [data-cutdo="next"]'); await A.click('#cutBody [data-cutdo="here"]'); await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000);
const cutWith = await A.page.evaluate(() => { const c = window.__rc.filter((x) => x[0] === 'cut').pop(); return c && c[1].quality; });
eq(cutWith, '4k', 'and the phone is asked to cut the clips in 4K (an iPhone video from Photos is used as it is, so it\'s cut in 4K too)');

await w.close();
await done();
