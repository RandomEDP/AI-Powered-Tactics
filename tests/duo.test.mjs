// iPhone Duo (Ethan, 31 October 2026: "optimise it for iPhone Duo"). Duo has a shorter, wider outer screen, where iOS puts the
// tab bar down the side, and a big inner screen that opens like a book, with a fold down the middle. Gaffer follows the screen's
// size, never the phone's name: on a screen short for its width the bar goes down the side and the content keeps the full height;
// where there's room for two columns the lists of cards go two across with the gap down the middle, where the fold is; at the
// larger text sizes it stays one column. Opening and closing the phone changes it straight away.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: iPhone Duo, the outer and inner screens');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png` }); };

const SIZES = { iphone: { width: 390, height: 844 }, closed: { width: 466, height: 678 }, open: { width: 932, height: 678 }, upright: { width: 678, height: 932 } };
const A = await w.phone({ db: true, native: true, label: 'ethan', viewport: SIZES.iphone });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]'); await A.run(300);

// two finished games with highlights, so Highlights has cards to lay out
let db = w.db();
const sop = db.teams[0], T = 1791660000000;
db.games.push({ id: 'g-cat', team_id: sop.id, seq: 1, opp: 'Cat FC', us: 3, them: 1, finished_at: T - 7 * 864e5, friendly: false },
  { id: 'g-dog', team_id: sop.id, seq: 2, opp: 'Dog Squad', us: 15, them: 2, finished_at: T - 2 * 864e5, friendly: false });
db.clips.push({ team_id: sop.id, game_id: 'g-cat', seq: 0, path: sop.id + '/cat/01.mp4', store: 'r2', at: T - 7 * 864e5, dur: 14, pids: [8], label: '4\' Goal: Ethan' },
  { team_id: sop.id, game_id: 'g-dog', seq: 0, path: sop.id + '/dog/01.mp4', store: 'r2', at: T - 2 * 864e5, dur: 14, pids: [1], label: '9\' Goal: Spice' });
w.setDb(db);
await A.page.reload(); await A.run(1500);

const p = A.page;
await p.emulateMedia({ reducedMotion: 'reduce' }); // (no fade-ins, so the pictures show each screen as it settles)
const size = async (name) => { await p.setViewportSize(SIZES[name]); await p.evaluate(() => window.dispatchEvent(new Event('resize'))); await A.run(150); }; // (the screen changing size, as opening or closing the phone does)
const look = () => p.evaluate(() => {
  const d = document.documentElement, r = (el) => el.getBoundingClientRect(), tabs = [...document.querySelectorAll('#tabs .tabrow button')].filter((b) => !b.hidden).map(r);
  const app = r(document.querySelector('.app')), row = r(document.querySelector('#tabs .tabrow'));
  const cols = (sel) => { const el = document.querySelector(sel), was = el.hidden; el.hidden = false; const st = getComputedStyle(el), t = st.gridTemplateColumns, n = st.columnCount !== 'auto' ? +st.columnCount : st.display !== 'grid' ? 1 : /^repeat\((\d+)/.test(t) ? +RegExp.$1 : t.split(' ').length; el.hidden = was; return n; };
  const gap = (sel) => { const el = document.querySelector(sel), st = getComputedStyle(el), b = r(el), left = b.left + parseFloat(st.paddingLeft), inner = b.width - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight), g = parseFloat(st.columnGap);
    const kids = [...el.children].filter((k) => k.offsetParent && !k.classList.contains('hero')).map(r), mid = left + inner / 2;
    const L = Math.max(...kids.filter((k) => k.left < mid).map((k) => k.right)), R = Math.min(...kids.filter((k) => k.left > mid).map((k) => k.left));
    return Math.round((L + R) / 2); }; // (the middle of the gap between what's actually in the left column and the right)
  return { rail: d.classList.contains('rail'), wide: d.classList.contains('wide'), vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth,
    sameX: new Set(tabs.map((t) => Math.round(t.left))).size === 1, sameY: new Set(tabs.map((t) => Math.round(t.top))).size === 1,
    row: { left: Math.round(row.left), right: Math.round(row.right), top: Math.round(row.top), bottom: Math.round(row.bottom) }, app: { left: Math.round(app.left), right: Math.round(app.right) },
    home: cols('#v-home'), hl: cols('#hlList'), feed: cols('#fdBody'), games: cols('#gamesTrack'), gapHome: document.querySelector('#v-home:not([hidden])') && cols('#v-home') > 1 ? gap('#v-home') : null };
});

// ---------- an ordinary iPhone: nothing changes
await A.click('#tabs [data-tab="home"]'); await A.run(200);
let L = await look();
check(!L.rail && !L.wide && L.sameY && L.row.bottom > L.vh - 40, `an ordinary iPhone keeps the bar along the bottom and one column (${JSON.stringify(L.row)})`);
eq([L.home, L.over], [1, false], 'the Team page is one column, and nothing runs off the side');

// ---------- Duo closed: the outer screen, short and wide
await size('closed'); L = await look(); await shot(A, 'duo-closed-team');
check(L.rail && !L.wide, 'closed, the screen is short for its width, so the tab bar goes down the side');
check(L.sameX && !L.sameY && L.row.right >= L.vw - 14, `the five tabs stand one above the other at the right edge (${JSON.stringify(L.row)})`);
check(L.app.right <= L.row.left, `and the Team page sits clear of them (page ends at ${L.app.right}, bar starts at ${L.row.left})`);
check(L.row.top > 0 && L.row.bottom < L.vh, 'the bar fits on the screen top to bottom');
const padB = await p.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
check(padB < 60, `nothing is kept free along the bottom for a bar that isn't there (${padB}px)`);
eq(L.over, false, 'and nothing runs off the side');
await A.click('#tabs [data-tab="highlights"]'); await A.run(300); L = await look(); await shot(A, 'duo-closed-highlights');
check(L.hl === 1 && L.app.right <= L.row.left && !L.over, 'Highlights is one column on the outer screen too, clear of the bar');
await A.click('#tabs [data-tab="home"]'); await A.run(200);
await A.click('#mChat'); await A.run(300);
const chat = await p.evaluate(() => { const f = document.getElementById('chatForm').getBoundingClientRect(), t = document.querySelector('#tabs .tabrow').getBoundingClientRect(); return { right: Math.round(f.right), bar: Math.round(t.left), bottom: Math.round(f.bottom), vh: innerHeight }; });
check(chat.right <= chat.bar && chat.bottom > chat.vh - 40, `the chat box sits along the bottom, beside the bar, not under it (${JSON.stringify(chat)})`);
await A.click('#chatBack'); await A.run(200);

// ---------- Duo open on its side: the inner screen
await size('open'); L = await look(); await shot(A, 'duo-open-team');
check(L.rail && L.wide, 'open on its side, the bar stays down the side (as iOS keeps it) and there\'s room for two columns');
eq(L.home, 2, 'the Team page goes two across');
check(Math.abs(L.gapHome - L.vw / 2) <= 2, `with the gap between the columns down the middle of the screen, where the fold is (gap at ${L.gapHome}, middle ${L.vw / 2})`);
check(L.app.right <= L.row.left && !L.over, 'clear of the bar, nothing off the side');
await A.click('#tabs [data-tab="highlights"]'); await A.run(300); L = await look(); await shot(A, 'duo-open-highlights');
eq(L.hl, 2, 'Highlights goes two across');
const hc = await p.evaluate(() => [...document.querySelectorAll('#hlList > .hcard')].slice(0, 2).map((c) => Math.round(c.getBoundingClientRect().top)));
check(hc.length === 2 && hc[0] === hc[1], `the two games' cards side by side (${hc})`);
await A.click('#tabs [data-tab="games"]'); await A.run(200); L = await look(); eq(L.games, 2, 'Games goes two across');
await A.click('#tabs [data-tab="feed"]'); await A.run(300); L = await look(); eq(L.feed, 2, 'and so does Home');
await shot(A, 'duo-open-feed');

// ---------- the big text sizes keep one column
await A.click('#tabs [data-tab="home"]'); await A.run(200);
await p.evaluate(() => window.gafferTextSize(26)); await A.run(100); L = await look();
check(L.rail && !L.wide && L.home === 1, 'at the biggest text size it\'s one column again, so nothing is squashed');
await p.evaluate(() => window.gafferTextSize(17)); await A.run(100);
eq((await look()).wide, true, 'and two again at the standard size');

// ---------- Duo open upright: tall enough for the bar along the bottom
await size('upright'); L = await look(); await shot(A, 'duo-upright-team');
check(!L.rail && L.wide && L.sameY && L.row.bottom > L.vh - 40, 'open upright, the bar goes back along the bottom and the page stays two columns');
check(Math.abs(L.gapHome - L.vw / 2) <= 2 && !L.over, `the gap still down the middle (${L.gapHome} of ${L.vw})`);

// ---------- closing it again goes straight back
await size('closed'); L = await look();
check(L.rail && !L.wide && L.home === 1, 'closing it goes straight back to the side bar and one column');
await size('iphone'); L = await look();
check(!L.rail && !L.wide && L.row.bottom > L.vh - 40, 'and an ordinary iPhone\'s size is the ordinary layout');

// ---------- the CSS keeps left and right apart (Duo's camera and the system's controls are down one side only)
const html = (await import('fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const lop = css.split('\n').filter((l) => /padding:[^;]*max\([^)]*safe-area-inset-left[^;]*;/.test(l) && !/safe-area-inset-right/.test(l.match(/padding:[^;]*;/)[0]));
eq(lop, [], 'no padding uses the left inset for both sides');
check(!A.errs.length, 'no errors: ' + A.errs.join(' | '));
await w.close(); done();
