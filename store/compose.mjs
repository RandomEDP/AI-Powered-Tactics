// Lays out the App Store pictures in Gaffer's style (purple, a big headline, the app in a phone) from the screens
// store/capture.mjs took, the tracking still in store/src/tracking.png and the earlier slides kept in store/src/kept.
//   node store/capture.mjs && node store/compose.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(HERE, '../tests/package.json'))('playwright');
const local = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync(local) ? local : undefined) });
const data = (file) => 'data:' + (file.endsWith('.woff2') ? 'font/woff2' : 'image/png') + ';base64,' + fs.readFileSync(file).toString('base64');
const raw = (name) => data(path.join(HERE, 'raw', name + '.png'));
const src = (name) => data(path.join(HERE, 'src', name));
const FONT = data(path.join(HERE, '../vendor/fonts/BricolageGrotesque.woff2'));

const CSS = `
@font-face { font-family: 'Bricolage Grotesque'; font-weight: 200 800; font-stretch: 75% 100%; src: url(${FONT}) format('woff2'); }
* { box-sizing: border-box; margin: 0; }
body { position: relative; overflow: hidden; font-family: 'Bricolage Grotesque', sans-serif; color: #f6f2e7;
  background: radial-gradient(120% 75% at 88% 0%, #6d48e6 0%, #4d2cb6 42%, #2d1871 82%, #271466 100%); }
.ring { position: absolute; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .16); }
h1 { position: absolute; font-weight: 800; font-stretch: 100%; letter-spacing: -.04em; line-height: .98; }
.sub { position: absolute; font-weight: 450; color: rgba(246, 242, 231, .84); line-height: 1.28; letter-spacing: -.005em; }
.phone { position: absolute; background: #0e0b1a; box-shadow: 0 40px 120px rgba(10, 4, 40, .45); }
.screen { position: absolute; overflow: hidden; background: #f0f0ec; }
.screen img { display: block; width: 100%; }
.island { position: absolute; background: #0e0b1a; border-radius: 999px; z-index: 2; }
.banner { position: absolute; z-index: 3; display: flex; gap: 26px; align-items: center; background: #f7f6fa; color: #15140f;
  box-shadow: 0 24px 60px rgba(10, 4, 40, .35); }
.banner img { flex: none; }
.banner b { display: block; font-weight: 700; letter-spacing: -.01em; }
.banner span { display: block; color: #3c3a36; }
.banner small { position: absolute; color: #8a877f; font-weight: 500; }
.chips { position: absolute; display: grid; }
.chip { display: flex; align-items: center; background: rgba(255, 255, 255, .09); border: 2px solid rgba(255, 255, 255, .12); }
.chip i { flex: none; border-radius: 50%; }
.chip b { display: block; font-weight: 750; letter-spacing: -.015em; }
.chip span { display: block; color: rgba(246, 242, 231, .76); font-weight: 450; }
.brand { position: absolute; display: flex; align-items: center; }
.brand b { font-weight: 800; font-stretch: 100%; letter-spacing: -.035em; }
`;

async function render(W, H, body, out) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="width:${W}px;height:${H}px">${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  await page.close();
  console.log('made', path.relative(HERE, out));
}

// A portrait phone: x, y, w (outer width); h defaults to running off the bottom; tilt in degrees.
function phone({ x, y, w, h, img, tilt = 0, z = 1 }) {
  const f = Math.round(w * 0.0186), r = Math.round(w * 0.129), sw = w - 2 * f, sh = h ? h - 2 * f : Math.round(sw * 874 / 402);
  const ih = Math.round(w * 0.0776), iw = Math.round(w * 0.309);
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${sh + 2 * f}px;border-radius:${r}px;transform:rotate(${tilt}deg);z-index:${z}">
    <div class="screen" style="left:${f}px;top:${f}px;width:${sw}px;height:${sh}px;border-radius:${r - f}px"><img src="${img}"></div>
    <div class="island" style="left:${(w - iw) / 2}px;top:${f + Math.round(w * 0.022)}px;width:${iw}px;height:${ih}px"></div></div>`;
}
// The same phone on its side, playing a video (letterboxed as the iPhone does).
function landscape({ x, y, w, img, tilt = 0, z = 1 }) {
  const f = Math.round(w * 0.0165), sw = w - 2 * f, sh = Math.round(sw * 402 / 874), r = Math.round(sh * 0.27);
  const iw = Math.round(sh * 0.16), ih = Math.round(sh * 0.62);
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${sh + 2 * f}px;border-radius:${r + f}px;transform:rotate(${tilt}deg);z-index:${z}">
    <div class="screen" style="left:${f}px;top:${f}px;width:${sw}px;height:${sh}px;border-radius:${r}px;background:#000;display:flex;align-items:center;justify-content:center">
      <img src="${img}" style="height:100%;width:auto"></div>
    <div class="island" style="left:${f + Math.round(sh * 0.035)}px;top:${f + (sh - ih) / 2}px;width:${iw}px;height:${ih}px"></div></div>`;
}
const ring = (cx, cy, r) => `<div class="ring" style="left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px"></div>`;
const words = (L, title, sub) => `<h1 style="left:${L.x}px;top:${L.ty}px;font-size:${L.tf}px;width:${L.tw}px">${title}</h1>
  <p class="sub" style="left:${L.x}px;top:${L.sy}px;font-size:${L.sf}px;width:${L.sw}px">${sub}</p>`;
// The "we're live" notification as iOS shows it, with the words team-notify sends.
const banner = (x, y, w, s) => `<div class="banner" style="left:${x}px;top:${y}px;width:${w}px;border-radius:${46 * s}px;padding:${28 * s}px ${30 * s}px">
  <img src="${src('icon.png')}" style="width:${92 * s}px;height:${92 * s}px;border-radius:${22 * s}px">
  <div style="font-size:${33 * s}px;line-height:1.25"><b>SOP FC v Borussia Teeth is live</b><span>Tap to watch the game.</span></div>
  <small style="right:${30 * s}px;top:${24 * s}px;font-size:${27 * s}px">now</small></div>`;
const CHIPS = [['#f5b83b', 'Finds every player', 'Reads shirt numbers from the footage'], ['#c17ef0', 'Draws every run', 'Where each player went, on a pitch map'],
  ['#3fb4ee', 'Heat maps and distance', 'For each player, every game'], ['#3dd07f', 'Your own camera', 'GoPro or phone footage from behind a goal']];
const chips = (x, y, w, cols, s, list = CHIPS) => `<div class="chips" style="left:${x}px;top:${y}px;width:${w}px;grid-template-columns:repeat(${cols},1fr);gap:${26 * s}px">` +
  list.map(([c, t, d]) => `<div class="chip" style="gap:${30 * s}px;padding:${30 * s}px ${36 * s}px;border-radius:${40 * s}px"><i style="width:${30 * s}px;height:${30 * s}px;background:${c};box-shadow:0 0 0 ${9 * s}px ${c}33"></i>
    <div><b style="font-size:${44 * s}px">${t}</b><span style="font-size:${34 * s}px">${d}</span></div></div>`).join('') + '</div>';

// ---------- the slides: what each says, and what's on its phone
const SLIDES = [
  { n: 2, key: 'live', title: 'Stream your<br>games live', sub: 'Your GoPro sends the game to the squad’s phones, with the score on screen.', img: raw('live-home'), extra: 'banner' },
  { n: 3, key: 'highlights', title: 'Highlights,<br>cut for you', sub: 'Log the goals as they go in. Each one is cut from the best camera’s GoPro or phone footage.', img: raw('cut') },
  { n: 4, key: 'tracking', title: 'Track every<br>player', sub: 'Runs, heat maps and distance from your GoPro or phone footage.', tracking: true },
  { n: 5, key: 'gaffer', title: 'Do more with<br>the Gaffer tier', sub: 'Live streams, a highlight reel every game, AI commentary and your team’s Elo.', img: raw('plans') },
];
const KEPT = [[1, 'game'], [6, 'poll'], [7, 'mins'], [8, 'stats']];
const KEPT_FROM = { game: '1-game', poll: '2-poll', mins: '3-mins', stats: '4-stats' };

// ---------- iPhone 6.3", 1206 × 2622, and the shorter "duo" crop, 1398 × 2034, laid out as the earlier slides were
const SIZES = [
  { dir: '1 iPhone (6.3 inch)', prefix: 'iphone', W: 1206, H: 2622, L: { x: 86, ty: 140, tf: 124, tw: 1060, sy: 438, sf: 45, sw: 1030 }, P: { x: 120, y: 681, w: 967 }, ring: [1310, 157, 740], s: 1 },
  { dir: '2 iPhone Duo', prefix: 'iphone-duo', W: 1398, H: 2034, L: { x: 99, ty: 112, tf: 146, tw: 1250, sy: 432, sf: 53, sw: 1200 }, P: { x: 178, y: 699, w: 1046 }, ring: [1420, 150, 760], s: 1.1 },
];
for (const Z of SIZES) {
  for (const [n, k] of KEPT) fs.copyFileSync(path.join(HERE, 'src/kept', `${Z.prefix}-${KEPT_FROM[k]}.png`), path.join(HERE, Z.dir, `${Z.prefix}-${n}-${k}.png`));
  for (const S of SLIDES) {
    let body = ring(...Z.ring) + words(Z.L, S.title, S.sub);
    if (S.tracking) {
      const duo = Z.W > 1300, lw = Z.W - 70, ly = Z.P.y + (duo ? 40 : 150); // the whole picture, pitch map and all
      body += landscape({ x: 35, y: ly, w: lw, img: src('tracking.png') });
      const lh = Math.round((lw - 2 * Math.round(lw * 0.0165)) * 402 / 874) + 2 * Math.round(lw * 0.0165);
      body += duo ? chips(Z.L.x, ly + lh + 90, Z.W - 2 * Z.L.x, 2, 0.92) : chips(Z.L.x, ly + lh + 150, Z.W - 2 * Z.L.x, 1, 1.24);
    } else {
      body += phone({ ...Z.P, img: S.img });
      if (S.extra === 'banner') body += banner(Z.P.x - 30, Z.P.y - Math.round(34 * Z.s), Z.P.w + 60, Z.s * 1.12); // dropping in over the top of the phone
    }
    await render(Z.W, Z.H, body, path.join(HERE, Z.dir, `${Z.prefix}-${S.n}-${S.key}.png`));
  }
}

// ---------- the header (3840 × 1646) and search result (1920 × 1280) pictures
const brand = (x, y, s) => `<div class="brand" style="left:${x}px;top:${y}px;gap:${36 * s}px"><img src="${src('icon.png')}" style="width:${148 * s}px;height:${148 * s}px;border-radius:${34 * s}px">
  <b style="font-size:${120 * s}px">Gaffer</b></div>`;
const headline = 'Run your<br>5-a-side team<br>from your pocket', strap = 'Fair subs, live streams, auto highlights and player tracking.';
{
  const W = 3840, H = 1646;
  let body = ring(330, 2480, 1000) + brand(150, 370, 1) +
    `<h1 style="left:150px;top:600px;font-size:178px;width:1700px">${headline}</h1><p class="sub" style="left:150px;top:1205px;font-size:60px;width:1600px">${strap}</p>`;
  body += landscape({ x: 1980, y: 170, w: 1820, img: src('tracking.png'), tilt: 3 });
  body += phone({ x: 1720, y: 520, w: 620, img: raw('live-home'), tilt: -5, z: 2 });
  body += phone({ x: 3080, y: 760, w: 600, img: raw('game'), tilt: 5, z: 2 });
  await render(W, H, body, path.join(HERE, '4 Header and Search Results', 'header-3840x1646.png'));
}
{
  const W = 1920, H = 1280;
  let body = ring(170, 1210, 330) + brand(76, 300, 0.5) +
    `<h1 style="left:76px;top:425px;font-size:92px;width:880px">${headline}</h1><p class="sub" style="left:76px;top:745px;font-size:32px;width:820px">${strap}</p>`;
  body += landscape({ x: 960, y: 130, w: 940, img: src('tracking.png'), tilt: 3 });
  body += phone({ x: 900, y: 460, w: 330, img: raw('live-home'), tilt: -5, z: 2 });
  body += phone({ x: 1560, y: 600, w: 320, img: raw('game'), tilt: 5, z: 2 });
  await render(W, H, body, path.join(HERE, '4 Header and Search Results', 'search-1920x1280.png'));
}
await browser.close();
