// The redesign (Ethan asked for the app to look better, after a review against Apple's design guidelines): text that
// follows the iPhone's text size, colours that are easy to read, match mode with the logging buttons under your thumb,
// iPhone-style navigation (back, large titles, swipe back), the Team page, sheets, switches, Games as a list, and the
// team's colour sent to the watch.
import { world, suite, ROOT } from './lib.mjs';
import fs from 'fs';
import path from 'path';
const { check, eq, done } = suite('phones: the redesign');
const w = await world();
const out = process.argv[2], shot = async (P, name, full) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: !!full }); };

// ---------- the CSS: every text size on the type scale, in rem, so the whole app follows the iPhone's text size
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const px = css.split('\n').filter((l) => /font-size: ?[0-9.]+px/.test(l) && !/\.lk-|lk-frame/.test(l) && !/^html \{/.test(l)); // (the root itself is the 17px everything is measured from)
eq(px, [], 'no text size is fixed in pixels (only the little clip preview, which is a drawing of a video frame)');
const inline = html.slice(html.indexOf('</style>')).match(/font-size: ?[0-9.]+px/g) || [];
eq(inline, [], 'nor in the screens the script draws');

const A = await w.phone({ db: true, native: true, label: 'ethan' });
// ---------- the welcome screen: the team code leads, the rest is one quiet list under it
const wl = await A.page.evaluate(() => ['createBtn', 'acctBtn', 'acctNew', 'pplBtn'].map((id) => { const b = document.getElementById(id); return [!!b.closest('.wlist'), Math.round(b.getBoundingClientRect().height)]; }));
check(wl.every(([inList, h]) => inList && h >= 44), `Start a team, Sign in, Create account and Open your feed are rows of one list, each at least 44 points tall (${JSON.stringify(wl)})`);
check(await A.page.evaluate(() => document.querySelectorAll('#v-welcome .plain.primary').length === 1 && !!document.querySelector('#wJoin .plain.primary')), 'Find team is the one main button on the welcome screen');
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]');
await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);
const p = A.page;

// ---------- text size and colours
eq(await p.evaluate(() => getComputedStyle(document.documentElement).fontSize), '17px', 'the root is the iPhone\'s standard 17 points');
eq(await p.evaluate(() => { document.documentElement.style.fontSize = '23px'; const n = parseFloat(getComputedStyle(document.body).fontSize); document.documentElement.style.fontSize = ''; window.gafferTextSize(); return n; }), 23, 'set the root bigger (as Larger Text does) and the text follows');
const contrast = await p.evaluate(() => {
  const st = getComputedStyle(document.documentElement), v = (k) => st.getPropertyValue(k).trim();
  const L = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const r = (a, b) => { const x = L(a), y = L(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  return { bib: r(v('--bib'), v('--bg')), bibSoft: r(v('--bib'), v('--bib-soft')), red: r(v('--agg'), v('--bg')), muted: r(v('--muted'), v('--fill')) };
});
check(contrast.bib >= 4.5 && contrast.bibSoft >= 4.5, `the bib orange reads as ordinary text on the page and on its own chips (${contrast.bib}:1, ${contrast.bibSoft}:1)`);
check(contrast.red >= 4.5 && contrast.muted >= 4.5, `red for anything risky, and grey notes on grey buttons, are easy to read too (${contrast.red}:1, ${contrast.muted}:1)`);
// (the UI/UX review: in dark mode the orange and red are lighter, so white writing on them was 2.3:1 and 3.1:1)
const onFill = async () => p.evaluate(() => {
  const st = getComputedStyle(document.documentElement), v = (k) => st.getPropertyValue(k).trim();
  const hex = (c) => c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c;
  const L = (h) => { h = hex(h); const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const r = (a, b) => { const x = L(a), y = L(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  return { bench: r(v('--bib-ink'), v('--bib')), del: r(v('--danger-ink'), v('--agg')) };
});
for (const scheme of ['light', 'dark']) {
  await p.emulateMedia({ colorScheme: scheme });
  const c = await onFill();
  check(c.bench >= 4.5 && c.del >= 4.5, `${scheme} mode: writing on a picked Bench button and on a red "Tap to confirm" is easy to read (${c.bench}:1, ${c.del}:1)`);
}
await p.emulateMedia({ colorScheme: 'light' });

// ---------- the Team page: the settings gear in the header, a fact on each tile
check(await p.evaluate(() => !!document.querySelector('.hero #mOptions')) && /Team settings/.test(await A.text('#mOptions')), 'Team settings is the gear in the team\'s header (and says so to VoiceOver)');
eq([await A.text('#mStatsSub'), await A.text('#mHlSub'), await A.text('#mInsSub')], ['Fills up as you play', 'Cut from your videos', 'Ratings and chemistry'], 'before any games, each tile says what it\'s for');
eq(await A.text('#homeForm'), '', 'and there\'s no form guide yet');
const tileTops = await p.evaluate(() => ['mStats', 'mHighlights', 'mInsights', 'mBoard'].map((id) => { const b = document.getElementById(id), t = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); const g = document.createRange(); g.selectNodeContents(t); return Math.round(g.getBoundingClientRect().top - b.getBoundingClientRect().top); }));
check(Math.abs(tileTops[0] - tileTops[1]) <= 1 && Math.abs(tileTops[2] - tileTops[3]) <= 1, `the tiles' titles sit at the same height across each row, whatever their fact says (${tileTops})`);

// ---------- match mode
await A.newGame('Dog Squad'); await A.click('#go'); await A.run(3000);
const dock = async () => p.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const d = r('dock'); return { bottom: Math.round(d.bottom), vh: innerHeight, us: r('goalUs').top >= 0 && r('goalUs').bottom <= innerHeight, them: r('goalThem').bottom <= innerHeight, hl: r('hlBtn').bottom <= innerHeight }; });
let d = await dock();
check(d.bottom === d.vh && d.us && d.them && d.hl, `the goal and highlight buttons sit along the bottom of the screen, under your thumb, at kick-off (${JSON.stringify(d)})`);
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await A.run(200);
d = await dock();
check(d.bottom === d.vh && d.us && d.hl, 'and still there after scrolling down to the rota');
await p.evaluate(() => window.scrollTo(0, 0));
check(await p.evaluate(() => !!document.querySelector('#clock #usN') && !!document.querySelector('#clock #themN')), 'the score is in the clock panel, the headline of the screen');
await shot(A, 'match-mode');
const svLines = await p.evaluate(() => { const b = document.getElementById('svBtn'), t = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); const g = document.createRange(); g.selectNodeContents(t); return new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size; });
eq(svLines, 1, '"Keeper save" fits on one line in the dock, next to Highlight and Undo');
// CI's Chromium draws text a little wider than a laptop's: it must still fit with room to spare
const svWide = await p.evaluate(() => { const d = document.getElementById('dock'); d.style.letterSpacing = '.04em'; const b = document.getElementById('svBtn'), t = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); const g = document.createRange(); g.selectNodeContents(t); const n = new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size; d.style.letterSpacing = ''; return n; });
eq(svWide, 1, '"Keeper save" still fits on one line with slightly wider text');
const und = await p.evaluate(() => { const u = document.getElementById('undo'), r = u.getBoundingClientRect(); return { w: r.width >= 44, h: r.height >= 44, name: u.getAttribute('aria-label') }; });
eq(und, { w: true, h: true, name: 'Undo the last thing logged' }, 'Undo in the dock is a 44-point icon button with its name for VoiceOver');
await A.click('#goalUs'); await A.run(300); await p.waitForTimeout(500);
const sheet = await p.evaluate(() => { const b = [...document.querySelectorAll('#picker .chips .pick:not(.wide)')].map((x) => x.getBoundingClientRect()); const s = document.querySelector('#picker .picker').getBoundingClientRect(); return { cols: new Set(b.map((x) => Math.round(x.left))).size, widths: new Set(b.map((x) => Math.round(x.width))).size, tall: Math.min(...b.map((x) => x.height)), bottom: Math.round(s.bottom), vh: innerHeight, cancel: !!document.querySelector('#picker .phead [data-cancel]') }; });
check(sheet.cols === 2 && sheet.widths === 1 && sheet.tall >= 44, `Who scored? is two even columns of names, each at least 44 points tall (${JSON.stringify(sheet)})`);
check(Math.abs(sheet.bottom - sheet.vh) <= 1 && sheet.cancel, `as a sheet from the bottom of the screen, with Cancel at the top (${JSON.stringify(sheet)})`);
await shot(A, 'who-scored-sheet');
await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="x"]'); await A.run(300);
eq([await A.text('#usN'), await p.evaluate(() => document.getElementById('dock').classList.contains('locked')), await p.evaluate(() => getComputedStyle(document.getElementById('goalUs')).opacity)], ['1', true, '1'],
  'after a goal the score locks for 8 seconds, shown as a sweep along the goal buttons (which stay readable)');
check(/^Goal: Jake/.test(await A.text('#events li:first-child span:nth-child(2)')), 'the list of what\'s happened says Goal: before our scorer, as it does for theirs');
await A.run(9000);
eq(await p.evaluate(() => document.getElementById('dock').classList.contains('locked')), false, 'and unlocks after');
// ---------- Player injured or leaving, and the subs pop-ups, are sheets like Who scored?
await A.click('#outBtn'); await p.waitForTimeout(500);
const outSheet = await p.evaluate(() => { const b = [...document.querySelectorAll('#outPicker .chips .pick')].map((x) => x.getBoundingClientRect()); const s = document.querySelector('#outPicker .picker').getBoundingClientRect(); return { cols: new Set(b.map((x) => Math.round(x.left))).size, tall: Math.min(...b.map((x) => x.height)), bottom: Math.round(s.bottom), vh: innerHeight, cancel: !!document.querySelector('#outPicker .phead [data-cancel]'), grabber: getComputedStyle(document.querySelector('#outPicker .picker'), '::before').width }; });
check(outSheet.cols === 2 && outSheet.tall >= 44 && Math.abs(outSheet.bottom - outSheet.vh) <= 1 && outSheet.cancel && outSheet.grabber === '38px', `Who is out? is a sheet from the bottom with a grabber, Cancel at the top and two even columns (${JSON.stringify(outSheet)})`);
await p.evaluate(() => { const o = document.getElementById('outPicker'); o.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await A.run(200);
eq(await p.evaluate(() => document.getElementById('outPicker').innerHTML), '', 'a tap outside it closes it, as with the other sheets');
const segH = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'seg'; d.innerHTML = '<button type="button">Bench</button>'; document.body.appendChild(d); const h = d.firstChild.getBoundingClientRect().height; d.remove(); return Math.round(h); });
check(segH >= 44, `the line-up's Start, Bench and Out buttons are 44 points tall, like every other button (${segH})`);
const ws = await A.watch();
eq(ws.color, '#4c2bb0', 'the watch is sent the team\'s colour, so its Goal button wears the kit');
await A.click('#finish'); await A.click('#finish'); await A.run(1500);
await p.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); }); await A.run(400);
eq(await A.text('#homeForm'), 'W', 'after a win the Team page\'s form guide shows it');
eq(await A.text('#mStatsSub'), 'Jake, 1 goal', 'and the Stats tile names the top scorer');

// ---------- navigation: back, the small title bar, swiping back from the edge
await A.click('#mStats'); await A.run(300);
check(await p.evaluate(() => { const b = document.querySelector('#v-stats .back'); return getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)' && /Home/.test(b.textContent); }), 'back is the kit-coloured chevron and the name of where it goes, with no grey pill');
await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(400);
eq([await p.evaluate(() => document.getElementById('topbar').classList.contains('on')), await A.text('#tbTitle')], [true, 'Stats'], 'scrolled down, the large title shows small at the top');
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400);
eq(await p.evaluate(() => document.getElementById('topbar').classList.contains('on')), false, 'and goes again at the top');
const swipe = (x0, x1) => p.evaluate(([a, b]) => {
  const t = (x) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400 });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(a)], changedTouches: [t(a)], bubbles: true }));
  for (let x = a; x <= b; x += 20) document.dispatchEvent(new TouchEvent('touchmove', { touches: [t(x)], changedTouches: [t(x)], bubbles: true }));
  document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(b)], bubbles: true }));
}, [x0, x1]);
await swipe(150, 330); await A.run(300);
eq(await A.view(), 'stats', 'a swipe that starts mid-screen doesn\'t go back');
await swipe(6, 60); await A.run(300);
eq(await A.view(), 'stats', 'nor a short one from the edge');
await swipe(6, 220); await A.run(300);
eq(await A.view(), 'home', 'a swipe in from the left edge goes back, as in iOS\'s own apps');

// ---------- Settings: switches, in grouped cards, Experimental at the end
await A.click('#mOptions'); await A.run(300);
eq(await p.evaluate(() => ['oFind', 'oScore', 'expTrack'].map((id) => document.getElementById(id).getAttribute('role') + ':' + Math.round(document.getElementById(id).getBoundingClientRect().width))), ['switch:51', 'switch:51', 'switch:51'], 'on/off settings are iPhone switches');
const was = await p.isChecked('#oScore'); await A.click('#oScore'); await A.run(200);
eq(await p.isChecked('#oScore'), !was, 'which switch when tapped');
await A.click('#oScore'); await A.run(200);
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await A.run(400);
await p.evaluate(() => document.getElementById('oName').scrollIntoView()); await A.run(400);
check(await p.evaluate(() => document.getElementById('oName').getBoundingClientRect().top >= document.getElementById('topbar').getBoundingClientRect().bottom), 'something scrolled into view (a box being typed in) clears the small title bar');
await p.evaluate(() => window.scrollTo(0, 0)); await A.run(300);
check(await p.evaluate(() => { const e = document.getElementById('expTrack'), g = document.getElementById('optGaffer'); return !!(g.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Experimental comes after the team\'s own settings');
check(await p.evaluate(() => getComputedStyle(document.getElementById('oCrest')).position === 'absolute') && await A.visible('label[for="oCrest"]'), 'the crest has a "Choose a picture" button, not the browser\'s own file box');
check(await p.evaluate(() => ['wipe', 'leave', 'oDelete'].every((id) => document.getElementById(id).classList.contains('danger'))), 'Reset all stats, Remove team and Delete my account are red');
const fmt = await p.evaluate(() => ['setHalf', 'setSub', 'setPitch'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
check(new Set(fmt).size === 1, `Match format's three boxes line up, even with "Sub every (min)" on two lines (${fmt})`);
await shot(A, 'settings', true);
// Removing a player takes their stats too, so it's two taps (the first turns × into a red Remove)
const squadN = async () => p.evaluate(() => document.querySelectorAll('#squad [data-rm]').length);
const n0 = await squadN();
await A.click('#squad [data-rm]'); await A.run(200);
eq([await squadN(), await A.text('#squad [data-rm].armed')], [n0, 'Remove'], 'one tap on × only asks: it turns into a red Remove');
await A.run(4500);
eq([await squadN(), await p.evaluate(() => document.querySelectorAll('#squad [data-rm].armed').length)], [n0, 0], 'left alone, it goes back to × with nobody removed');
await A.click('#squad [data-rm]'); await A.click('#squad [data-rm]'); await A.run(300);
eq(await squadN(), n0 - 1, 'and a second tap removes the player');
await A.click('#optBack'); await A.run(300);

// ---------- Games as a list
for (const [opp, date] of [['Borussia Teeth', '2026-10-13'], ['Real Sociable', '2026-10-20']]) {
  await A.click('#tabs [data-tab="games"]'); await A.click('#gamesNew'); await A.page.fill('#pOpp', opp); await A.page.fill('#pDate', date); await A.page.fill('#pTime', '19:30'); await A.click('#pSave'); await A.run(800);
}
await A.click('#tabs [data-tab="games"]'); await A.run(300);
const cards = await p.evaluate(() => [...document.querySelectorAll('#gamesTrack .fxc')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.bottom)]; }));
check(cards.length === 2 && cards[0][0] === cards[1][0] && cards[1][1] > cards[0][2], `the games lined up are a list, one under the other, not a sideways carousel (${JSON.stringify(cards)})`);
eq([await A.text('#gamesCount'), await p.evaluate(() => !document.getElementById('gamesDots'))], ['2 games lined up.', true], 'with no "swipe for the others" to learn');

// ---------- the tab bar floats, frosted, and chat's box sits at the bottom
check(await p.evaluate(() => { const r = document.querySelector('#tabs .tabrow').getBoundingClientRect(); return r.left > 0 && innerWidth - r.right > 0 && innerHeight - r.bottom > 0; }), 'the tab bar floats clear of the edges');
await A.click('#tabs [data-tab="chat"]'); await A.run(500);
const cf = await p.evaluate(() => { const f = document.getElementById('chatForm').getBoundingClientRect(), t = document.querySelector('#tabs .tabrow').getBoundingClientRect(); return { hidden: document.getElementById('chatForm').hidden, f: Math.round(f.bottom), t: Math.round(t.top) }; });
check(!cf.hidden && cf.f <= cf.t + 1 && cf.t - cf.f < 24, `the chat box sits just above the tab bar, whatever is in the chat (${JSON.stringify(cf)})`);

await done(A);
