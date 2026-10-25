// Sharing a post to social media (Ethan, October 2026: "there should be a post to social media share button after posting
// something in the main feed, this way we generate a video in portrait including a gaffer logo and download App Store
// thing"). On the iPhone app, straight after posting (and from ⋯ on your own posts) Gaffer offers Share to social media:
// the phone makes the post's video tall with Gaffer's mark and the App Store end card (ReelCutter.socialVideo), then opens
// the share sheet. The website and other people's posts don't offer it.
import { world, suite, ROOT } from './lib.mjs';
import path from 'path';
const { check, eq, done } = suite('phones: share a post to social media');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const media = (n) => path.join(ROOT, 'tests/media', n);

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

// ---------- the iPhone app: post a clip, and Gaffer offers to share it to social media
const N = await w.phone({ db: true, native: true, label: 'jake-iphone' });
await N.ctx.addInitScript(() => {
  window.__rc = []; window.__hold = null;
  window.Capacitor.convertFileSrc = (p) => location.origin + '/_capacitor_file_' + p;
  window.Capacitor.Plugins.ReelCutter = { addListener: (n, f) => { (window.__rcOn = window.__rcOn || {})[n] = f; return { remove() {} }; },
    pickVideo: async (o) => { window.__rc.push(['pick', o]); return { path: '/phone/source9.mov', duration: 14 }; },
    trimVideo: async (o) => { window.__rc.push(['trim', o]); return { path: '/phone/own/' + o.file, size: 4e6, duration: o.dur }; },
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: new Blob(['x'.repeat(2000)], { type: 'video/mp4' }), headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    socialVideo: (o) => { window.__rc.push(['social', o]); const on = window.__rcOn.progress;
      if (on) { on({ stage: 'fetch', p: 1, job: o.job }); on({ stage: 'tall', p: 0.5, job: o.job }); }
      if (window.__hold) return new Promise((res, rej) => { window.__hold = { res, rej }; });
      return Promise.resolve({ path: '/phone/social/' + o.file, size: 9e6 }); },
    cancel: async (o) => { window.__rc.push(['cancel', o]); if (window.__hold && window.__hold.rej) window.__hold.rej(new Error('Stopped. Nothing was made.')); return {}; },
    share: async (o) => { window.__rc.push(['share', o]); return { completed: false }; } };
});
await N.page.reload(); await N.run(1500);
await signIn(N);
const rc = (k) => N.page.evaluate((x) => window.__rc.filter((c) => c[0] === x).map((c) => c[1]), k);
await N.click('#fdNew'); await N.run(800); await N.click('#npKind [data-k="own"]'); await N.run(200);
await N.click('#npChoose'); await N.run(300); await N.page.fill('#npCap', 'Top bins'); await N.click('#npPost'); await N.run(1500);
eq([await N.view(), await N.visible('#postPop'), await N.visible('#socPop')], ['feed', false, true], 'once it\'s posted, Gaffer offers to share it to social media');
check(/tall video for Instagram, TikTok/.test(await N.text('#soLead')) && /Gaffer’s logo/.test(await N.text('#soLead')) && /where to get the app/.test(await N.text('#soLead')), 'saying it makes a tall video with Gaffer\'s logo and where to get the app');
eq([await N.text('#soMake'), await N.text('#soClose')], ['Make the video', 'Not now'], 'Make the video, or Not now');
eq((await rc('social')).length, 0, 'nothing is made until asked');
await shot(N, 'social-offer');
await N.click('#soMake'); await N.run(600);
const made = (await rc('social'))[0];
const post = (w.db().posts || []).filter((p) => p.kind === 'own')[0];
eq(made.url, '/phone/own/' + post.path.split('/').pop(), 'it\'s made from the clip already on the phone (nothing is fetched again)');
eq([made.outro.kicker, made.outro.title, made.outro.sub, made.outro.app], ['Posted on Gaffer', 'Own clip', '@Chappers · gaffermanager.app', 'Gaffer: Small-Sided Football'], 'the end card names the post, who posted it, Gaffer\'s website and the app');
check(!/github/i.test(JSON.stringify(made)) && !/5-a-side/i.test(JSON.stringify(made)), 'with no GitHub address and never "5-a-side"');
check(/^so-/.test(made.job) && /^gaffer-[a-z0-9]+\.mp4$/i.test(made.file), 'as a job of its own, so its progress isn\'t mixed up with a reel\'s');
eq((await rc('share')).map((o) => o.path), ['/phone/social/' + made.file], 'once it\'s made, the share sheet opens with it');
eq([await N.text('#soMake'), await N.text('#soClose')], ['Share it', 'Done'], 'and it can be shared again');
await N.click('#soMake'); await N.run(300);
eq([(await rc('share')).length, (await rc('social')).length], [2, 1], 'sharing again uses the same video');
await N.click('#soClose'); await N.run(200);
eq(await N.visible('#socPop'), false, 'Done closes it');

// ---------- from ⋯ on your own post, any time later; and Stop while it's being made
await N.page.evaluate(() => { window.__hold = {}; });
await N.click('#fdBody .post [data-pmore]'); await N.run(200);
check(await N.visible('#fdBody [data-psoc]'), 'your own post has Share to social media under ⋯');
await N.click('#fdBody [data-psoc]'); await N.run(200); await N.click('#soMake'); await N.run(400);
const again = (await rc('social'))[1];
check(again.url.endsWith(post.path), `from the feed it's made from the post's video (${again.url})`);
check(/Making it tall, 50%/.test(await N.text('#soProg')) && await N.page.$eval('#soMake', (b) => b.disabled), 'it says how far it\'s got');
eq(await N.text('#soClose'), 'Stop', 'and it can be stopped');
await N.click('#soClose'); await N.run(400);
eq([(await rc('cancel')).map((o) => o.job), await N.visible('#socPop'), (await rc('share')).length], [[again.job], false, 2], 'Stop stops it on the phone and shares nothing');

// ---------- someone else's post, and the website, don't offer it
const J = await w.phone({ db: true, label: 'jake-web' });
await signIn(J);
await J.click('#fdBody .post [data-pmore]'); await J.run(200);
eq(await J.page.$$eval('#fdBody [data-psoc]', (x) => x.length), 0, 'the website doesn\'t offer it (the phone makes the video)');
await J.click('#fdNew'); await J.run(800); await J.click('#npKind [data-k="own"]'); await J.run(200);
await J.page.setInputFiles('#npFile', media('clip-12s.webm')); await J.page.waitForTimeout(800); await J.run(300);
await J.click('#npPost'); await J.page.waitForTimeout(500); await J.run(1500);
eq([await J.view(), await J.visible('#socPop')], ['feed', false], 'nor after posting on the website');
await A.click('#tabs [data-tab="feed"]'); await A.run(1500);
await A.click('#fdBody .post [data-pmore]'); await A.run(200);
eq(await A.page.$$eval('#fdBody [data-psoc]', (x) => x.length), 0, 'nor on someone else\'s post');

await w.close();
await done(A, N, J);
