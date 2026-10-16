// Reviews on the App Store (Ethan: "a button somewhere to leave a review, and prompt users once to do this at some point
// that feels reasonable"). Settings has "Rate Gaffer on the App Store", which opens Gaffer's page on Write a Review. Apple's
// own stars are asked for once a phone, just after someone shares a reel or highlights video (not if they cancel the share
// sheet), and never during a game.
import { readFileSync } from 'node:fs';
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: rating Gaffer on the App Store');
const w = await world();
const review = () => { // the iPhone's AppReview plugin, as the web app sees it
  window.__rv = []; window.__rvFail = false;
  window.Capacitor.Plugins.AppReview = {
    ask: async () => { window.__rv.push('ask'); },
    write: async (o) => { window.__rv.push('write ' + JSON.stringify(o)); if (window.__rvFail) throw new Error('Couldn\'t find Gaffer in the App Store just now.'); return { opened: true }; } };
};
const said = (P) => P.page.evaluate(() => window.__rv.slice());

const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.ctx.addInitScript(review); await A.page.reload(); await A.run(500);
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJosh\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// ---------- the button in Settings
await A.click('#mOptions'); await A.run(400);
eq([await A.view(), await A.visible('#optRate'), await A.text('#optRateBtn')], ['options', true, 'Rate Gaffer on the App Store'], 'Settings has Rate Gaffer on the App Store');
check(!/5-a-side/i.test(await A.text('#optRate')), 'and doesn\'t call Gaffer a 5-a-side app');
await A.click('#optRateBtn'); await A.run(300);
eq([await said(A), await A.visible('#optRateMsg')], [['write {"id":""}'], false], 'tapping it opens the App Store on Write a Review (the phone looks up Gaffer\'s id itself)');
await A.page.evaluate(() => { window.__rvFail = true; }); await A.click('#optRateBtn'); await A.run(300);
eq([await A.visible('#optRateMsg'), /Couldn't find Gaffer/.test(await A.text('#optRateMsg'))], [true, true], 'if the App Store can\'t be opened, it says why');
await A.page.evaluate(() => { window.__rvFail = false; window.__rv.length = 0; }); await A.click('#optRateBtn'); await A.run(300);
eq(await A.visible('#optRateMsg'), false, 'and the message goes once it works');

// ---------- Apple's stars, once, after a good share
await A.page.evaluate(() => { window.__rv.length = 0; });
await A.page.evaluate(() => window.gafferRateAfter(Promise.resolve({ completed: false }))); await A.run(2000);
eq(await said(A), [], 'cancelling the share sheet asks nothing');
await A.page.evaluate(() => window.gafferRateAfter(Promise.reject(new Error('gone')))); await A.run(2000);
eq(await said(A), [], 'nor does a share that failed');
await A.page.evaluate(() => window.gafferRateAfter(Promise.resolve({ completed: true }))); await A.run(500);
eq(await said(A), [], 'after a share, it waits for the share sheet to go…');
await A.run(1500);
eq(await said(A), ['ask'], '…then asks for Apple\'s stars');
await A.page.evaluate(() => window.gafferRateAfter(Promise.resolve({ completed: true }))); await A.run(2000);
eq(await said(A), ['ask'], 'only ever once on a phone');
await A.page.reload(); await A.run(800);
eq(await A.page.evaluate(() => window.gafferRateAsk()), false, 'even after Gaffer is opened again');

// ---------- never during a game
await A.page.evaluate(() => { localStorage.removeItem('apt-rate'); window.__rv.length = 0; });
if (await A.view() !== 'home') { await A.click('#tabs [data-tab="home"]'); await A.run(400); }
await A.click('#mNew'); await A.run(300); await A.click('#gKind [data-kind="solo"]'); await A.run(200);
await A.page.fill('#sOpp', 'Dog Squad'); await A.click('#sKick'); await A.run(500);
eq(await A.view(), 'game', 'a game is on');
await A.page.evaluate(() => window.gafferRateAfter(Promise.resolve({ completed: true }))); await A.run(2000);
eq([await said(A), await A.page.evaluate(() => !!localStorage.getItem('apt-rate'))], [[], false], 'a share during a game asks nothing, and the one go is kept for later');

// ---------- every share sheet for a reel goes through it
const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shares = src.match(/\.share\(\{ path: [^)]*\)[^;]*;/g) || [];
check(shares.length >= 10, 'found the reel share sheets (' + shares.length + ')');
eq(shares.filter((x) => !/rateAfter\(|shared = await/.test(src.slice(src.indexOf(x) - 40, src.indexOf(x) + x.length))), [], 'every one of them can lead to the ask');

// ---------- the website and Android
const Wb = await w.phone({ label: 'web' }); await Wb.run(500);
eq(await Wb.page.evaluate(() => window.gafferRateAsk()), false, 'the website never asks (no App Store there)');
await w.close?.();
done();
