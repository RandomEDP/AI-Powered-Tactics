// The biggest text sizes (Ethan's mum has Larger Text turned up, and on her phone things overlapped). With the iPhone's
// text at its biggest (the app keeps it to 26 points) on a 375-point-wide iPhone (SE, mini), every screen a gaffer and a
// player use is walked, and on each one: no two bits of writing cross, nothing runs off the side or makes the page scroll
// sideways, no word is broken in two, and nothing is cut off inside its own box (tables that scroll sideways and text ending in … are fine).
// node tests/bigtext.test.mjs <dir> saves a picture of each screen.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: the biggest text sizes');
const w = await world();
const out = process.argv[2];
const SIZE = 26, VIEW = { width: 375, height: 667 };

const cutter = () => { // the iPhone's ReelCutter, so the gaffer can cut some highlights
  window.Capacitor.Plugins.ReelCutter = {
    addListener: () => ({ remove() {} }),
    pickVideo: async (o) => ({ path: '/phone/game' + o.slot + '.mov', duration: 5400 }),
    cut: async (o) => ({ clips: o.clips.map((c) => ({ file: c.file, path: '/phone/' + c.file })), reel: { path: '/phone/' + o.reelFile, marks: o.clips.map((c, i) => i * 14.04) } }),
    upload: async (o) => { const r = await fetch(o.url, { method: 'PUT', body: 'video', headers: { 'Content-Type': 'video/mp4' } }); return { status: r.status, ok: r.ok }; },
    joinReel: async (o) => ({ path: '/phone/' + o.file, size: 1000, marks: o.items.map((x, i) => i * 14.04) }),
    share: async () => ({}), cleanup: async () => ({}),
  };
  window.Capacitor.convertFileSrc = (path) => location.origin + '/_capacitor_file_' + path;
};
const big = (P) => P.page.evaluate((n) => window.gafferTextSize(n), SIZE);
const tab = async (P, t) => { for (let i = 0; i < 3 && !(await P.visible('#tabs [data-tab="' + t + '"]')); i++) { await home(P); await P.run(300); } await P.tap('#tabs [data-tab="' + t + '"]'); await P.run(300); };
const home = (P) => P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="home"]') || document.querySelector('.view:not([hidden]) .back'); if (b) b.click(); });

// What's wrong on the screen as it is now.
const problems = (P) => P.page.evaluate(() => {
  const shown = (e) => {
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden' || x.hidden || s.opacity === '0' || x.classList.contains('vh')) return false;
      const d = x.parentElement; if (d && d.tagName === 'DETAILS' && !d.open && x.tagName !== 'SUMMARY') return false;
    }
    return true;
  };
  const style = (e, f) => { for (let x = e; x; x = x.parentElement) { const r = f(getComputedStyle(x), x); if (r !== undefined) return r; } return null; };
  const layer = (e) => style(e, (s, x) => (s.position === 'fixed' || s.position === 'sticky' ? x : undefined)); // the page, or a bar or pop-up over it
  const dots = (e) => style(e, (s) => (s.textOverflow === 'ellipsis' && s.overflow !== 'visible' ? true : undefined)); // cut short with … on purpose
  const slides = (e) => style(e.parentElement, (s, x) => (s.overflowX === 'auto' || s.overflowX === 'scroll' ? x : undefined)); // in something that scrolls sideways
  const name = (e) => { const a = []; for (let x = e; x && x !== document.body && a.length < 3; x = x.parentElement) a.unshift(x.id ? '#' + x.id : x.tagName.toLowerCase() + (typeof x.className === 'string' && x.className.trim() ? '.' + x.className.trim().split(/\s+/).join('.') : '')); return a.join(' > '); };
  const bits = [], walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    const el = n.parentElement; if (!n.textContent.trim() || !el || el.closest('svg, script, style') || !shown(el)) continue;
    const g = document.createRange(); g.selectNodeContents(n);
    // (only the middle of each line: a glyph's box reaches above and below its line, so tightly set lines touch)
    for (const b of g.getClientRects()) if (b.width > 1 && b.height > 1) bits.push({ el, t: n.textContent.trim().slice(0, 30), l: b.left, r: b.right, t0: b.top + b.height * 0.25, b0: b.bottom - b.height * 0.25 });
  }
  const out = new Set();
  for (let i = 0; i < bits.length; i++) for (let j = i + 1; j < bits.length; j++) {
    const a = bits[i], b = bits[j]; if (a.el === b.el) continue;
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b0, b.b0) - Math.max(a.t0, b.t0) > 1 && layer(a.el) === layer(b.el) && !dots(a.el) && !dots(b.el))
      out.add('"' + a.t + '" (' + name(a.el) + ') runs into "' + b.t + '" (' + name(b.el) + ')');
  }
  for (const b of bits) if ((b.r > innerWidth + 1 || b.l < -1) && !dots(b.el) && !slides(b.el)) out.add('"' + b.t + '" (' + name(b.el) + ') runs off the screen');
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest('svg') || !el.clientWidth || !el.textContent.trim()) continue;
    const s = getComputedStyle(el);
    if (s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2) {
      // (only when it's writing that's cut off, not a decoration like the circle on the team's header)
      const r = el.getBoundingClientRect(), cut = bits.some((b) => el.contains(b.el) && (b.r > r.right + 1 || b.l < r.left - 1) && !dots(b.el));
      if (cut) out.add(name(el) + ' cuts off its writing');
    }
  }
  // a word broken in two across lines ("Chapli / n"); long things like email addresses may break
  const walk2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk2.nextNode());) {
    const el = n.parentElement; if (!el || el.closest('svg, script, style') || !shown(el) || dots(el)) continue;
    for (const m of n.textContent.matchAll(/[A-Za-z’']{2,15}/g)) {
      const g = document.createRange(); g.setStart(n, m.index); g.setEnd(n, m.index + m[0].length);
      const tops = [...g.getClientRects()].filter((b) => b.width > 0).map((b) => b.top); if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 6) out.add('"' + m[0] + '" (' + name(el) + ') is broken in two');
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.add('the page scrolls sideways (' + document.documentElement.scrollWidth + ' wide)');
  return [...out];
});
const seen = [];
const scan = async (P, what) => {
  await big(P); await P.run(300);
  const p = await problems(P); seen.push(what);
  if (out) await P.page.waitForTimeout(400);
  if (out) await P.page.screenshot({ path: `${out}/${String(seen.length).padStart(2, '0')}-${what.replace(/[^a-z0-9]+/gi, '-')}.png` });
  eq(p, [], what + ': nothing overlaps, runs off the screen or is cut off');
};

// ---------- the gaffer, on an iPhone with the biggest text
const A = await w.phone({ db: true, native: true, label: 'gaffer', viewport: VIEW });
await A.ctx.addInitScript(cutter); await A.page.reload(); await A.run(500);
eq(await A.page.evaluate((n) => { window.gafferTextSize(n); return [getComputedStyle(document.documentElement).fontSize, document.documentElement.classList.contains('bigtext')]; }, SIZE), ['26px', true], 'the app takes the biggest text size, and marks the page as having big text');
eq(await A.page.evaluate(() => { window.gafferTextSize(17); const r = [getComputedStyle(document.documentElement).fontSize, document.documentElement.classList.contains('bigtext')]; window.gafferTextSize(26); return r; }), ['17px', false], 'and the standard size, without the mark');
await scan(A, 'welcome');
await A.click('#createBtn'); await scan(A, 'create an account');
await A.signUp('ethan@example.com'); await scan(A, 'start a team');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC'); await A.click('#tColors button[data-c="#4c2bb0"]');
await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan'); await A.click('#tCreate'); await A.run(600);
await scan(A, 'the team code');
const code = await A.text('#codeBig'); await A.click('#v-code [data-go="home"]'); await A.run(300);
await A.click('#meCard [data-me="pick"]'); await A.run(300); await A.click('#joinList [data-pid="8"]'); await A.click('#joinList [data-pos="fwd"]'); await A.click('#joinList [data-do="claim"]'); await A.run(600);
await scan(A, 'the Team page');
await A.click('#mNew'); await A.page.fill('#opp', 'Athletico Pathetico'); await scan(A, 'new game');
await A.click('#startGame'); await scan(A, 'the minutes planner');
await A.click('#kick'); await A.run(300); await scan(A, 'the bench at kick-off');
await A.click('#go'); await A.run(3000); await scan(A, 'match mode');
const dk = await A.page.evaluate(() => { const d = document.getElementById('dock').getBoundingClientRect(), v = document.getElementById('v-game'); window.scrollTo(0, document.body.scrollHeight); const last = [...v.children].filter((e) => e.offsetParent && !e.closest('#dock') && getComputedStyle(e).position !== 'fixed').pop().getBoundingClientRect(); return { dock: Math.round(d.top), last: Math.round(last.bottom) }; });
check(dk.last <= dk.dock, `scrolled to the end, the last of the game screen clears the dock, which is taller with big text (${JSON.stringify(dk)})`);
await A.page.evaluate(() => window.scrollTo(0, 0));
eq(await A.page.evaluate(() => [getComputedStyle(document.querySelector('#hlBtn svg')).display, getComputedStyle(document.querySelector('#undo svg')).display]), ['none', 'block'], 'in the dock, Highlight and Keeper save drop their little icons to make room for the words, but Undo (only an icon) keeps its');
await A.click('#goalUs'); await A.run(500); await scan(A, 'who scored?');
await A.click('#picker button[data-p="2"]'); await A.click('#picker button[data-p="3"]'); await A.run(300);
await scan(A, 'match mode after a goal');
await A.run(5 * 60000 - 35000); await scan(A, 'subs coming up');
await A.run(40000); await scan(A, 'the subs pop-up');
if (await A.visible('#subPopDone')) await A.click('#subPopDone');
await A.click('#outBtn'); await A.run(400); await scan(A, 'player injured or leaving');
await A.page.evaluate(() => document.getElementById('outPicker').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await A.run(200);
await A.click('#finish'); await A.click('#finish'); await A.run(1500); await scan(A, 'full time');
await home(A); await A.run(400); await scan(A, 'the Team page after a game');
for (const [sel, what] of [['#mStats', 'stats'], ['#mInsights', 'insights'], ['#mOptions', 'settings'], ['#mBoard', 'the tactics board'], ['#mGotw', 'Goal of the Week']]) {
  await home(A); await A.run(300); await A.tap(sel); await A.run(600); await scan(A, what);
}
// the highlights: cutting a game, and its card
await tab(A, 'home'); await A.tap('#mHighlights'); await A.run(600); await scan(A, 'Highlights before cutting');
await A.click('#hlList [data-cut]'); await A.run(400); await scan(A, 'cutting: where the cameras stood');
await A.page.locator('#camSvg').scrollIntoViewIfNeeded(); const bx = await A.page.locator('#camSvg').boundingBox(); await A.page.mouse.click(bx.x + bx.width * 0.08, bx.y + bx.height * 0.6); await A.run(600);
await A.click('#cutBody [data-cutdo="next"]'); await A.run(400); await scan(A, 'cutting: lining up the video');
await A.page.evaluate(() => { Object.defineProperty(document.getElementById('cutPrev'), 'currentTime', { configurable: true, get: () => 200, set: () => {} }); });
await A.click('#cutBody [data-cutdo="here"]');
await A.click('#cutBody [data-cutdo="go"]'); await A.run(3000); await scan(A, 'cutting: done');
await A.click('#cutBody [data-cutdo="finish"]'); await A.run(800); await scan(A, 'Highlights with a cut game');
await A.click('#hlToggle [data-by="player"]'); await A.run(400); await scan(A, 'Highlights by player');
await A.click('#hlToggle [data-by="game"]'); await A.run(400);
await A.tap('#hlList .mhbtn'); await A.run(800); await scan(A, 'the whole match highlights');
await A.page.evaluate(() => { const c = document.querySelector('#mhPop [data-mhclose], #mhPop .close, #mhPop [aria-label="Close"]'); if (c) c.click(); else document.getElementById('mhPop').hidden = true; }); await A.run(300);
await A.tap('#hlList [data-hlm^="make:"]'); await A.run(400); await scan(A, 'make a highlight (the sheet)');
await A.tap('#hlSheet [data-hlmx]'); await A.run(300);
await A.tap('#hlList [data-hlm^="edit:"]'); await A.run(400); await scan(A, 'edit footage (the sheet)');
await A.tap('#hlSheet [data-fixg]'); await A.run(400); await scan(A, 'fix a goal'); await A.page.evaluate(() => { document.getElementById('fixPop').hidden = true; });
if (await A.visible('#hlSheet [data-hlmx]')) { await A.tap('#hlSheet [data-hlmx]'); await A.run(300); }
await A.click('#hlToggle [data-by="player"]'); await A.run(400);
if (await A.visible('#hlList [data-preel]')) { await A.tap('#hlList [data-preel]'); await A.run(500); await scan(A, 'make a reel'); await A.page.evaluate(() => { document.getElementById('reelPop').hidden = true; }); }
// the poll, chat, the feed, a profile, finding people
await tab(A, 'games'); await A.click('#gamesNew'); await A.run(300); await scan(A, 'a new poll');
await A.page.fill('#pOpp', 'Rovers'); await A.page.fill('#pDate', '2026-10-14'); await A.page.fill('#pTime', '19:30'); await A.click('#pSave'); await A.run(800);
await tab(A, 'games'); await A.run(400); await scan(A, 'Games with a poll');
await tab(A, 'home'); await A.tap('#mChat'); await A.run(400);
await A.page.fill('#chatText', 'Who is driving Wednesday? I can take three in the car if anyone needs a lift'); await A.page.press('#chatText', 'Enter'); await A.run(600);
await scan(A, 'chat');
await tab(A, 'feed'); await A.run(800); await scan(A, 'Home (the feed)');
await tab(A, 'profile'); await A.run(800); await scan(A, 'your profile');
await tab(A, 'feed'); await A.run(400); await A.tap('#fdFind'); await A.run(600); await scan(A, 'find people');
await tab(A, 'feed'); await A.run(400);
if (await A.visible('#fdFriendly')) { await A.tap('#fdFriendly'); await A.run(600); await scan(A, 'play a friendly'); }
await tab(A, 'home'); await A.run(300); await A.click('#mNew'); await A.run(300);
if (await A.visible('#gKind')) { await A.tap('#gKind [data-kind="house"], #gKind button:last-child'); await A.run(400); await scan(A, 'a game among ourselves'); }

// ---------- a player joining on their own iPhone with the biggest text
const J = await w.phone({ db: true, native: true, label: 'jake', viewport: VIEW });
await J.page.fill('#joinCode', code); await J.click('#joinBtn'); await J.run(500);
await scan(J, 'joining a team');
await J.click('#joinList [data-pid="2"]'); await J.page.fill('#jLast', 'Smith'); await J.page.fill('#jNum', '7'); await J.click('#joinList [data-pos="fwd"]');
await J.page.fill('#jEmail', 'jake@example.com'); await J.page.fill('#jUser', 'jake_s'); await J.page.fill('#jPass', 'longpassword'); await J.check('#jTerms'); await scan(J, 'joining: your details');
await J.click('#joinList [data-do="up"]'); await J.run(800);
await J.click('#pendCard [data-go="account"]'); await J.page.fill('#aEmail', 'jake@example.com'); await J.page.fill('#aPass', 'longpassword'); await J.click('#aSignIn'); await J.run(2000);
if (await J.view() !== 'home') { await tab(J, 'home'); await J.run(500); }
await scan(J, 'a player\'s Team page');
await tab(J, 'games'); await J.run(400); await scan(J, 'a player\'s Games');
await J.click('#gamesTrack [data-vote="in"]'); await J.run(1500); await scan(J, 'add to calendar?');
await J.page.evaluate(() => { const n = document.getElementById('askNo'); if (n) n.click(); }); await J.run(300);
await tab(J, 'home'); await J.tap('#mChat'); await J.run(1200); await scan(J, 'a player\'s chat');
await tab(J, 'highlights'); await J.run(1200); await scan(J, 'a player\'s Highlights');
await tab(J, 'profile'); await J.run(800); await scan(J, 'a player\'s profile');

check(seen.length >= 40, `every screen was looked at (${seen.length})`);
await done(A, J);
