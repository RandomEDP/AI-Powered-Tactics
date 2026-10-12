// Filming the game with the gaffer's own iPhone: "Film with this iPhone" in the stream sheet gets the camera link ready
// and starts the camera on it (which streams through that link and records to Photos at the same time); the gaffer can
// go back to Gaffer and back to the camera; ending it on the camera screen switches the link off too and says the
// recording is in Photos; and ending the stream (or finishing the game) in Gaffer stops the camera first. The camera
// itself is native (LiveCamPlugin.swift); here it's a stand-in that behaves the same way to the web app.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: filming the game with this iPhone');
const w = await world();
const stream = () => (w.db().team_streams || [])[0] || null;
const setDb = (o) => w.setDb(Object.assign(w.db(), o));

const camera = () => { // the native camera, as the web app sees it
  const C = window.__cam = { calls: [], said: [], on: false, refuse: null };
  window.Capacitor.Plugins.LiveCam = {
    start: async (o) => { C.calls.push(['start', o]); if (C.refuse) { C.said.forEach((f) => f({ state: 'starting', shown: false })); throw new Error(C.refuse); } /* (the real one says it's starting before it finds it can't) */ C.on = true; return { state: 'connecting', shown: true, rec: true }; },
    show: async () => { C.calls.push(['show']); return { shown: C.on }; },
    stop: async () => { C.calls.push(['stop']); const was = C.on; C.on = false; return was ? { saved: true, seconds: 1800 } : { saved: false, none: true }; },
    state: async () => ({ state: C.on ? 'live' : 'idle' }),
    addListener: (n, f) => { if (n === 'state') C.said.push(f); return { remove() {} }; },
  };
  window.__camSay = (d) => C.said.forEach((f) => f(d));
};
const cam = (P) => P.page.evaluate(() => window.__cam.calls.map((c) => c[0]));
const say = async (P, d) => { await P.page.evaluate((x) => window.__camSay(x), d); await P.run(300); };

// ---------- a gaffer on the iPhone app, with the experimental switch on, and a follower
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(camera); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]');
await A.click('#tabs [data-tab="options"]'); await A.page.check('#expTrack'); await A.run(300); await A.click('#tabs [data-tab="home"]');
const B = await w.phone({ db: true, native: true, label: 'follower' });
await B.page.fill('#joinCode', code); await B.click('#joinBtn'); await B.run(500); await B.click('#jFollow'); await B.run(800);
await B.ctx.route('https://customer-test.cloudflarestream.com/*/lifecycle', (r) => {
  const st = (w.db().team_streams || [])[0]; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ isInput: true, live: !!(w.db().camera && st && st.enabled) }) });
});

// ---------- the sheet offers this iPhone first, with the GoPro or another iPhone as the other way
await A.newGame('Dog'); await A.run(500);
await A.click('#streamBtn'); await w.run(1500);
const link = await A.page.inputValue('#liveLink');
eq([await A.visible('#liveCam'), await A.text('#liveCam'), /records it in full quality to Photos at the same time/.test(await A.text('#liveBody')), /Or use a GoPro or another iPhone/.test(await A.text('#liveBody'))],
  [true, 'Film with this iPhone', true, true], 'the sheet offers Film with this iPhone (streams and records to Photos at once), and the camera link for a GoPro or another iPhone');
check(/about 4 GB of space an hour/.test(await A.text('#liveBody')) && /power bank/.test(await A.text('#liveBody')), 'and says what filming takes: space for the recording, and a power bank for a whole game');

// the camera isn't allowed: the gaffer is told exactly why, and nothing else changes
await A.page.evaluate(() => { window.__cam.refuse = 'Gaffer isn’t allowed to use the camera. Turn it on in Settings, Gaffer, Camera, then try again.'; });
await A.click('#liveCam'); await A.run(300);
eq([await A.text('#liveMsg'), await A.visible('#liveCam') && !(await A.visible('#liveCamShow')), typeof stream().started_at], ['Gaffer isn’t allowed to use the camera. Turn it on in Settings, Gaffer, Camera, then try again.', true, 'number'], 'if the camera isn\'t allowed, the sheet says so in the camera\'s own words, and the link stays ready');
await A.page.evaluate(() => { window.__cam.refuse = null; });

// ---------- filming
await A.click('#liveCam'); await A.run(300);
const started = await A.page.evaluate(() => window.__cam.calls.filter((c) => c[0] === 'start').slice(-1)[0][1]);
eq([started.url, started.title], [link, 'SOP FC v Dog'], 'Film with this iPhone starts the camera on the ready camera link, named for the game');
eq([await A.visible('#liveCamShow'), /This iPhone is filming/.test(await A.text('#liveBody')), /recording the whole game to Photos/.test(await A.text('#liveBody')), await A.visible('#liveLink'), await A.visible('#liveNew')],
  [true, true, true, false, false], 'while it films, the sheet says so (and that it\'s recording to Photos), without the link steps for other cameras');
await say(A, { state: 'connecting', shown: false, rec: true }); // Back to Gaffer on the camera screen
await A.click('#liveClose');
eq(await A.text('#streamBtn'), 'Show the camera', 'back in Gaffer, the game screen\'s button goes back to the camera');
await A.click('#streamBtn');
eq((await cam(A)).slice(-1)[0], 'show', 'and does');

// the picture gets through: the team is told without waiting for the next check
setDb({ camera: true });
await say(A, { state: 'live', shown: true, rec: true }); await w.run(1500);
eq([w.db().livePushes, await B.visible('#liveCard')], [1, true], 'the camera saying it\'s live gets the team told straight away, once');
await say(A, { state: 'retrying', shown: false, rec: true });
await A.click('#v-game .back');
eq([/This iPhone is filming|being streamed now/.test(await A.text('#liveCard')), await A.visible('#lcCam')], [true, true], 'the gaffer\'s Home card has Show the camera too');
await A.click('#lcCam');
eq((await cam(A)).slice(-1)[0], 'show', 'which goes back to the camera');
await A.click('#mResume'); await A.tap('#lvManage'); // the stream settings, from the stream itself
check(/The signal dropped. This iPhone keeps trying, and keeps recording/.test(await A.text('#liveBody')), 'when the signal drops, the sheet says it keeps trying and keeps recording');
await A.click('#liveClose');

// ---------- ended on the camera screen: the camera link goes off too, and the recording is in Photos
await A.page.evaluate(() => { window.__cam.on = false; });
await say(A, { state: 'ended', by: 'user', saved: true, seconds: 1800, shown: false }); await w.run(2000);
eq([stream().started_at, await A.text('#streamBtn'), await B.visible('#liveCard')], [null, 'Stream this game', false], 'ending it on the camera screen switches the camera link off, and the team\'s card goes');
await A.click('#streamBtn'); await w.run(1500); // (opening the sheet gets the link ready again)
await A.click('#liveEnd'); await A.click('#liveEnd'); await w.run(1000);
eq((await cam(A)).filter((c) => c === 'stop').length, 0, 'ending a stream the iPhone isn\'t filming leaves the camera alone');

// ---------- ended in Gaffer (or with the game): the camera stops first, so its recording is safe
await A.click('#liveGo'); await w.run(1000); await A.click('#liveCam'); await A.run(300);
await A.click('#liveEnd'); await A.click('#liveEnd'); await w.run(1500);
eq([(await cam(A)).slice(-1)[0], stream().started_at, await A.text('#liveMsg')], ['stop', null, 'Stream ended. The recording is kept for 30 days. The full-quality recording from this iPhone is in Photos.'],
  'End stream in Gaffer stops the camera, switches the link off, and says the recording is in Photos');
await A.click('#liveGo'); await w.run(1000); await A.click('#liveCam'); await A.run(300); await A.click('#liveClose');
await A.click('#finish'); await A.click('#finish'); await w.run(2000);
eq([(await cam(A)).slice(-1)[0], stream().started_at], ['stop', null], 'finishing the game stops the camera and ends the stream');

// ---------- a follower, and the web: no camera offered
await B.click('#mResume').catch(() => {});
eq(await B.page.evaluate(() => !!document.getElementById('liveCam')), false, 'nobody else is offered the camera');

for (const P of [A, B]) for (const e of P.errs) check(false, 'page error: ' + e);
await w.close();
done();
