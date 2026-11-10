// What's wrong with how a screen is laid out: writing that overlaps, runs off the screen or is cut off, words broken in two,
// a page that scrolls sideways. Shared by bigtext.test.mjs and rotate.test.mjs.
// What's wrong on the screen as it is now.
export const problems = (P) => P.page.evaluate(() => {
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

// Buttons and boxes in a pop-up or bar (anything fixed to the screen) that can't be reached: off the top or bottom of the screen,
// with nothing between them and the pop-up that scrolls. (The page itself scrolls, so anything in it can always be reached.)
export const unreachable = (P) => P.page.evaluate(() => {
  const shown = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden' || x.hidden || s.opacity === '0') return false; const d = x.parentElement; if (d && d.tagName === 'DETAILS' && !d.open && x.tagName !== 'SUMMARY') return false; } return true; };
  const out = [];
  for (const el of document.querySelectorAll('button, input:not([type="hidden"]), textarea, select, a[href], [data-go]')) {
    if (!shown(el) || el.classList.contains('vh')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.top >= -1 && r.bottom <= innerHeight + 1) continue;
    let fixed = null, scrolls = false;
    for (let x = el.parentElement; x && x !== document.documentElement; x = x.parentElement) {
      const s = getComputedStyle(x);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && x.scrollHeight > x.clientHeight + 1) scrolls = true;
      if (s.position === 'fixed') { fixed = x; break; }
    }
    if (fixed && !scrolls) out.push(((el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 30)) + ' (' + (fixed.id ? '#' + fixed.id : fixed.className) + ') is off the screen and can\'t be scrolled to');
  }
  return [...new Set(out)];
});
