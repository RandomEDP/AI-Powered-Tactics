// Your own short clips (Ethan, October 2026: "you should be able to upload custom short clips to Gaffer, max 30 seconds
// long, and then you can post them to your profile / feed"). New post → Upload: on the website a video of 30 seconds or
// less goes as it is (a longer one is turned down, saying why); on the iPhone app a longer one has its 30 seconds chosen
// with a slider and the phone trims it. Either way the file goes straight to R2, in the poster's own folder, and becomes
// a post like any other: on Home (Following and All) and the profile, with likes, comments and report; deleting it also
// deletes the file.
import { world, suite, ROOT } from './lib.mjs';
import path from 'path';
const { check, eq, done } = suite('phones: your own short clips');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const media = (n) => path.join(ROOT, 'tests/media', n);

// ---------- Ethan's team, and Jake, who has an account and a username but no clips of his own
const A = await w.phone({ db: true, label: 'ethan' });
await A.click('#createBtn'); await A.signUp('ethan@example.com', 'gaffer_ethan');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
let db = w.db();
db.users.push({ id: 'u-jake', email: 'jake@example.com', password: 'longpassword' });
db.profiles.push({ user_id: 'u-jake', username: 'Chappers', name: 'Jake Smith', private: false, pins: [] });
db.follows.push({ follower: db.users[0].id, followee: 'u-jake', status: 'accepted', at: Date.now() });
w.setDb(db);
const signIn = async (P) => {
  await P.click('#acctBtn'); await P.page.fill('#aEmail', 'jake@example.com'); await P.page.fill('#aPass', 'longpassword'); await P.click('#aSignIn'); await P.run(1500);
  if (await P.visible('#tmAgree')) { await P.click('#tmAgree'); await P.run(300); }
  await P.click('#pplBtn'); await P.run(1000);
};

// ---------- on the website: 30 seconds or less, as it is
const J = await w.phone({ db: true, label: 'jake-web' });
await signIn(J);
await J.click('#fdNew'); await J.run(1000);
eq(await J.page.$$eval('#npKind button', (b) => b.map((x) => x.textContent)), ['Your clips', 'Your reels', 'Upload'], 'a new post can be one of your clips, one of your reels, or a video you upload');
await J.click('#npKind [data-k="own"]'); await J.run(300);
check(/up to 30 seconds/.test(await J.text('#npList')) && await J.visible('#npChoose'), 'Upload asks for a video from your phone, up to 30 seconds');
eq(await J.page.$eval('#npPost', (b) => b.disabled), true, 'Share waits for one');
await J.page.setInputFiles('#npFile', media('clip-45s.webm')); await J.page.waitForTimeout(800); await J.run(300);
check(/0:45 long\. Clips can be up to 30 seconds: trim it in Photos first/.test(await J.text('#npMsg')) && await J.visible('#npMsg'), 'a longer one is turned down, saying how long it is and what to do');
eq(await J.page.$eval('#npPost', (b) => b.disabled), true, 'and there\'s still nothing to share');
await J.page.setInputFiles('#npFile', media('clip-12s.webm')); await J.page.waitForTimeout(800); await J.run(300);
eq([await J.visible('#npMsg'), await J.visible('#npPrev'), /0:12 long/.test(await J.text('#npList')), await J.page.$eval('#npPost', (b) => b.disabled)], [false, true, true, false], 'one of 12 seconds is shown to check, ready to share');
await J.page.fill('#npCap', 'Rabona in the cage'); await shot(J, 'upload-web');
await J.click('#npPost'); await J.page.waitForTimeout(500); await J.run(1500);
db = w.db();
const p1 = (db.posts || []).filter((p) => p.kind === 'own');
eq(p1.map((p) => [p.user_id, p.team_id, p.store, p.caption, Math.round(p.dur)]), [['u-jake', null, 'r2', 'Rabona in the cage', 12]], 'it\'s posted with its caption and length, in no team');
check(/^users\/u-jake\/[a-z0-9]+\.mp4$/.test(p1[0].path), `into his own folder (${p1[0].path})`);
eq((db.files || []).filter((f) => f.path === p1[0].path).map((f) => [f.bucket, f.size > 500, f.type]), [['r2', true, 'video/mp4']], 'the video went straight to R2');
check(!(db.files || []).some((f) => f.bucket === 'clips' && f.path.startsWith('users/')), 'never to Supabase\'s storage');
eq([await J.view(), await J.page.$$eval('#fdBody .post', (x) => x.length)], ['feed', 1], 'it\'s on his Home');
check(/Own clip/.test(await J.text('#fdBody .post header small')) && (await J.page.$eval('#fdBody .post video', (v) => v.getAttribute('src'))).endsWith(p1[0].path + '#t=0.1'), 'playing his clip, marked as his own');

// ---------- the website turns down a caption Gaffer doesn't allow, and anything that isn't a video
await J.click('#fdNew'); await J.run(800); await J.click('#npKind [data-k="own"]'); await J.run(200);
await J.page.setInputFiles('#npFile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await J.run(300);
check(/isn’t a video/.test(await J.text('#npMsg')), 'something that isn\'t a video is turned down');
await J.click('#npCancel');

// ---------- everyone else sees it like any other post
await A.click('#tabs [data-tab="feed"]'); await A.run(1500);
eq(await A.page.$$eval('#fdBody .post header b', (b) => b.map((x) => x.textContent)), ['Chappers'], 'it\'s on Home for people who follow him');
await A.click('#fdBody .post [data-like]'); await A.run(800);
eq((w.db().post_likes || []).filter((l) => l.liked).length, 1, 'it can be liked');
await A.click('#fdBody .post [data-pcm]'); await A.run(600);
await A.page.fill('#fdBody [data-cform] input', 'Filth'); await A.page.press('#fdBody [data-cform] input', 'Enter'); await A.run(800);
eq((w.db().post_comments || []).map((c) => c.body), ['Filth'], 'commented on');
await A.click('#fdBody .post [data-pmore]'); await A.click('#fdBody [data-preport][data-why="Offensive"]'); await A.run(800);
eq((w.db().post_reports || []).map((r) => r.reason), ['Offensive'], 'and reported to Gaffer');
await A.click('#fdBody .post header .who'); await A.run(1200);
eq(await A.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 1, 'it\'s in the grid on his profile');

// ---------- on the iPhone app: a longer video has its 30 seconds chosen, and the phone trims it
const N = await w.phone({ db: true, native: true, label: 'jake-iphone' });
await N.ctx.addInitScript(() => {
  window.__rc = [];
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  window.Capacitor.Plugins.ReelCutter = { addListener: (n, f) => { (window.__rcOn = window.__rcOn || {})[n] = f; return { remove() {} }; },
    pickVideo: async (o) => { window.__rc.push(['pick', o]); return { path: '/phone/source9.mov', duration: 75.4 }; },
    trimVideo: async (o) => { window.__rc.push(['trim', o]); if (window.__rcOn.progress) window.__rcOn.progress({ stage: 'trim', p: 0.5 }); return { path: '/phone/own/' + o.file, size: 9e6, duration: o.dur }; },
    upload: async (o) => { window.__rc.push(['upload', o.path]); const r = await fetch(o.url, { method: 'PUT', body: new Blob(['x'.repeat(2000)], { type: 'video/mp4' }), headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; } };
});
await N.page.reload(); await N.run(1500);
await signIn(N);
await N.click('#fdNew'); await N.run(800); await N.click('#npKind [data-k="own"]'); await N.run(200);
check(/If it’s longer, you choose which 30 seconds/.test(await N.text('#npList')), 'on the iPhone, a longer video is fine: you choose which 30 seconds');
await N.click('#npChoose'); await N.run(500);
const rc = (k) => N.page.evaluate((x) => window.__rc.filter((c) => c[0] === x).map((c) => c[1]), k);
eq((await rc('pick')).map((o) => o.slot), [9], 'it picks from Photos (in a slot of its own, so a cut\'s videos are left alone)');
eq([await N.visible('#npStart'), await N.text('#npWin')], [true, 'From 0:00 to 0:30 of 1:15.'], 'a video of 1:15 gets a slider for which 30 seconds');
await N.page.$eval('#npStart', (r) => { r.value = '20'; r.dispatchEvent(new Event('input', { bubbles: true })); }); await N.run(200);
eq(await N.text('#npWin'), 'From 0:20 to 0:50 of 1:15.', 'sliding it moves the 30 seconds');
await shot(N, 'upload-iphone');
await N.click('#npPost'); await N.run(1500);
const trim = (await rc('trim'))[0];
eq([trim.path, trim.start, trim.dur], ['/phone/source9.mov', 20, 30], 'the phone trims those 30 seconds');
db = w.db();
const p2 = (db.posts || []).filter((p) => p.kind === 'own' && !p.removed_at).sort((x, y) => y.created_at - x.created_at)[0];
eq([(await rc('upload'))[0], Math.round(p2.dur)], ['/phone/own/' + p2.path.split('/').pop(), 30], 'uploads the trimmed file through the phone\'s background uploads, and posts it');
check((db.files || []).some((f) => f.bucket === 'r2' && f.path === p2.path), 'into R2');

// ---------- deleting it deletes the file too
await J.click('#tabs [data-tab="profile"]'); await J.run(1200);
eq(await J.page.$$eval('#prBody .pgrid .ptile', (x) => x.length), 2, 'both are on his own profile');
await J.click('#prBody .ptile:first-child'); await J.run(500);
await J.click('#pvBody [data-pmore]'); await J.click('#pvBody [data-pdel]'); await J.click('#pvBody [data-pdel]'); await J.run(1000);
db = w.db();
eq([(db.posts || []).filter((p) => !p.removed_at).length, (db.files || []).some((f) => f.path === p2.path)], [1, false], 'deleting the post deletes his clip from R2 too');

// ---------- if R2 isn't taking files, nothing is posted and it says so (never the old storage)
db = w.db(); db.r2Off = true; w.setDb(db);
await N.click('#fdNew'); await N.run(800); await N.click('#npKind [data-k="own"]'); await N.run(200); await N.click('#npChoose'); await N.run(300); await N.click('#npPost'); await N.run(1500);
check(/isn’t working on Gaffer’s server at the moment/.test(await N.text('#npMsg')) && await N.visible('#postPop'), 'if the clip store isn\'t working, it says so and keeps the post open to try again');
eq((w.db().posts || []).filter((p) => !p.removed_at).length, 1, 'and nothing is posted');

// ---------- deleting his account deletes his clips' files too
db = w.db(); db.r2Off = false; w.setDb(db);
check((db.files || []).some((f) => f.path === p1[0].path), '(his first clip is still in R2)');
await J.click('#tabs [data-tab="profile"]'); await J.run(800); await J.click('#prGear'); await J.run(500);
eq(await J.view(), 'account', '(with no team open, the gear opens his account)');
await J.click('#aDelete'); await J.click('#aDelete'); await J.run(2000);
db = w.db();
eq([db.users.some((u) => u.id === 'u-jake'), (db.files || []).filter((f) => f.path.startsWith('users/u-jake/')).length], [false, 0], 'deleting his account deletes his uploaded clips from R2 as well');

await w.close();
await done(A, J, N);
