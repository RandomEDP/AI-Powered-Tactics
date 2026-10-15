// Lays out the App Store and social pictures in Gaffer's style (deep purple, a big headline, the app in a phone) from the
// screens store/capture.mjs took (the redesigned app, in dark mode) and stills from the real highlights Gaffer cut of
// SOP FC 15–2 Dog Squad (store/src/footage: the score box and the GOAL bar are the app's own graphics, burnt into the clip).
//   node store/capture.mjs && node store/compose.mjs
// Nothing behind the Experimental switch (live streaming, player tracking, the Gaffer tier) goes in these.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(HERE, '../tests/package.json'))('playwright');
const local = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync(local) ? local : undefined) });
const data = (file) => 'data:' + (file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png') + ';base64,' + fs.readFileSync(file).toString('base64');
const raw = (name) => data(path.join(HERE, 'raw', name + '.png'));
const src = (name) => data(path.join(HERE, 'src', name));
const foot = (name) => data(path.join(HERE, 'src/footage', name + '.jpg'));
const FONT = data(path.join(HERE, '../vendor/fonts/BricolageGrotesque.woff2'));

const CSS = `
@font-face { font-family: 'Bricolage Grotesque'; font-weight: 200 800; font-stretch: 75% 100%; src: url(${FONT}) format('woff2'); }
* { box-sizing: border-box; margin: 0; }
body { position: relative; overflow: hidden; font-family: 'Bricolage Grotesque', sans-serif; color: #f6f2e7;
  background: radial-gradient(120% 75% at 88% 0%, #6d48e6 0%, #4d2cb6 38%, #2a1670 78%, #1c0f4d 100%); }
.ring { position: absolute; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .14); }
h1 { position: absolute; font-weight: 800; font-stretch: 100%; letter-spacing: -.04em; line-height: .98; }
h1 em { font-style: normal; color: #c9b8ff; }
.sub { position: absolute; font-weight: 450; color: rgba(246, 242, 231, .84); line-height: 1.28; letter-spacing: -.005em; }
.phone { position: absolute; background: #0e0b1a; box-shadow: 0 40px 120px rgba(6, 2, 30, .55), 0 0 0 2px rgba(255, 255, 255, .08); }
.screen { position: absolute; overflow: hidden; background: #0d0d0d; }
.screen img { display: block; width: 100%; }
.island { position: absolute; background: #0e0b1a; border-radius: 999px; z-index: 2; }
.clip { position: absolute; overflow: hidden; background: #000; box-shadow: 0 34px 100px rgba(6, 2, 30, .6), 0 0 0 2px rgba(255, 255, 255, .12); }
.clip img { display: block; width: 100%; height: 100%; object-fit: cover; }
.tag { position: absolute; display: flex; align-items: center; gap: .45em; font-weight: 700; letter-spacing: .01em; color: #1c0f4d;
  background: #f6f2e7; border-radius: 999px; box-shadow: 0 12px 30px rgba(6, 2, 30, .35); }
.tag i { width: .62em; height: .62em; border-radius: 50%; background: #6d48e6; }
.chips { position: absolute; display: grid; }
.chip { display: flex; align-items: center; background: rgba(255, 255, 255, .09); border: 2px solid rgba(255, 255, 255, .12); }
.chip i { flex: none; border-radius: 50%; }
.chip b { display: block; font-weight: 750; letter-spacing: -.015em; }
.chip span { display: block; color: rgba(246, 242, 231, .76); font-weight: 450; }
.brand { position: absolute; display: flex; align-items: center; }
.brand b { font-weight: 800; font-stretch: 100%; letter-spacing: -.035em; }
.banner { position: absolute; z-index: 5; display: flex; gap: 26px; align-items: center; background: rgba(247, 246, 250, .97); color: #15140f;
  box-shadow: 0 24px 60px rgba(6, 2, 30, .45); }
.banner b { display: block; font-weight: 700; letter-spacing: -.01em; }
.banner span { display: block; color: #3c3a36; }
.banner small { position: absolute; color: #8a877f; font-weight: 500; }
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

// A portrait phone: x, y, w (outer width); runs off the bottom unless h; tilt in degrees.
function phone({ x, y, w, h, img, tilt = 0, z = 1 }) {
  const f = Math.round(w * 0.0186), r = Math.round(w * 0.129), sw = w - 2 * f, sh = h ? h - 2 * f : Math.round(sw * 874 / 402);
  const ih = Math.round(w * 0.0776), iw = Math.round(w * 0.309);
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${sh + 2 * f}px;border-radius:${r}px;transform:rotate(${tilt}deg);z-index:${z}">
    <div class="screen" style="left:${f}px;top:${f}px;width:${sw}px;height:${sh}px;border-radius:${r - f}px"><img src="${img}"></div>
    <div class="island" style="left:${(w - iw) / 2}px;top:${f + Math.round(w * 0.022)}px;width:${iw}px;height:${ih}px"></div></div>`;
}
// The same phone on its side, playing a highlight full screen (16:9 footage, letterboxed as the iPhone shows it).
function landscape({ x, y, w, img, tilt = 0, z = 1 }) {
  const f = Math.round(w * 0.0165), sw = w - 2 * f, sh = Math.round(sw * 402 / 874), r = Math.round(sh * 0.2);
  const iw = Math.round(sh * 0.15), ih = Math.round(sh * 0.58);
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${sh + 2 * f}px;border-radius:${r + f}px;transform:rotate(${tilt}deg);z-index:${z}">
    <div class="screen" style="left:${f}px;top:${f}px;width:${sw}px;height:${sh}px;border-radius:${r}px;background:#000">
      <img src="${img}" style="width:100%;height:100%;object-fit:contain"></div>
    <div class="island" style="left:${f + Math.round(sh * 0.03)}px;top:${f + (sh - ih) / 2}px;width:${iw}px;height:${ih}px"></div></div>`;
}
// A frame of footage on its own, as a card.
const clip = ({ x, y, w, h, img, r = 36, tilt = 0, z = 1, pos = 'center' }) => `<div class="clip" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px;transform:rotate(${tilt}deg);z-index:${z}"><img src="${img}" style="object-position:${pos}"></div>`;
const tag = (x, y, s, text, z = 4) => `<div class="tag" style="left:${x}px;top:${y}px;font-size:${34 * s}px;padding:${16 * s}px ${28 * s}px;z-index:${z}"><i></i>${text}</div>`;
const ring = (cx, cy, r) => `<div class="ring" style="left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px"></div>`;
const words = (L, title, sub) => `<h1 style="left:${L.x}px;top:${L.ty}px;font-size:${L.tf}px;width:${L.tw}px">${title}</h1>
  <p class="sub" style="left:${L.x}px;top:${L.sy}px;font-size:${L.sf}px;width:${L.sw}px">${sub}</p>`;
const brand = (x, y, s) => `<div class="brand" style="left:${x}px;top:${y}px;gap:${36 * s}px"><img src="${src('icon.png')}" style="width:${148 * s}px;height:${148 * s}px;border-radius:${34 * s}px">
  <b style="font-size:${120 * s}px">Gaffer</b></div>`;
// A notification as iOS shows it, in the words the app sends (goalPush, the poll's notifyTeam).
const banner = (x, y, w, s, title, body) => `<div class="banner" style="left:${x}px;top:${y}px;width:${w}px;border-radius:${46 * s}px;padding:${28 * s}px ${30 * s}px">
  <img src="${src('icon.png')}" style="width:${92 * s}px;height:${92 * s}px;border-radius:${22 * s}px;flex:none">
  <div style="font-size:${33 * s}px;line-height:1.25"><b>${title}</b><span>${body}</span></div>
  <small style="right:${30 * s}px;top:${24 * s}px;font-size:${27 * s}px">now</small></div>`;
const chips = (x, y, w, cols, s, list) => `<div class="chips" style="left:${x}px;top:${y}px;width:${w}px;grid-template-columns:repeat(${cols},1fr);gap:${26 * s}px">` +
  list.map(([c, t, d]) => `<div class="chip" style="gap:${30 * s}px;padding:${30 * s}px ${36 * s}px;border-radius:${40 * s}px"><i style="width:${30 * s}px;height:${30 * s}px;background:${c};box-shadow:0 0 0 ${9 * s}px ${c}33"></i>
    <div><b style="font-size:${44 * s}px">${t}</b><span style="font-size:${34 * s}px">${d}</span></div></div>`).join('') + '</div>';
const CLIP_CHIPS = [['#c9b8ff', 'The score on screen', 'And the clock, as on the telly'], ['#f5b83b', 'Who scored, who set it up', 'From the goals you logged'],
  ['#3dd07f', 'From the best camera', 'GoPro or iPhone footage, up to four cameras'], ['#ff8a5c', 'A commentator, if you like', 'AI commentary calls each goal']];

// ---------- the App Store pictures: what each says, and what's on its phone
const SLIDES = [
  { n: 1, key: 'highlights', title: 'Highlights,<br>cut for you', sub: 'Tap Goal as it goes in. Gaffer cuts every moment from your GoPro or iPhone footage, score and all.', img: raw('mh'), hero: true },
  { n: 2, key: 'subs', title: 'Fair subs,<br>sorted', sub: 'Gaffer plans who comes off and when, so everyone plays about the same. It warns you 30 seconds before each change.', img: raw('game') },
  { n: 3, key: 'clips', title: 'Every goal,<br>on the telly', sub: 'Each clip has the score, the clock and who scored, like the highlights on a Saturday night.', footage: true },
  { n: 4, key: 'poll', title: 'Who’s in<br>on Tuesday?', sub: 'Send a poll, see who’s in and who’s in goal, and the line-up draws itself.', img: raw('games') },
  { n: 5, key: 'share', title: 'Share the<br>best bits', sub: 'Post your goals to Home for your teammates and followers to watch.', img: raw('feed') },
  { n: 6, key: 'stats', title: 'Every goal<br>counted', sub: 'Goals, assists, minutes and goals let in, for every player, every game.', img: raw('stats') },
  { n: 7, key: 'bench', title: 'Ready for<br>kick-off', sub: 'Who starts on the bench, who’s in goal and when the first change comes, before the whistle.', img: raw('bench') },
];

// iPhone 6.3", 1206 × 2622, and the shorter "duo" crop, 1398 × 2034, laid out as the earlier slides were
const SIZES = [
  { dir: '1 iPhone (6.3 inch)', prefix: 'iphone', W: 1206, H: 2622, L: { x: 86, ty: 140, tf: 124, tw: 1060, sy: 438, sf: 45, sw: 1030 }, P: { x: 120, y: 681, w: 967 }, ring: [1310, 157, 740], s: 1 },
  { dir: '2 iPhone Duo', prefix: 'iphone-duo', W: 1398, H: 2034, L: { x: 99, ty: 112, tf: 146, tw: 1250, sy: 432, sf: 53, sw: 1200 }, P: { x: 178, y: 699, w: 1046 }, ring: [1420, 150, 760], s: 1.1 },
];
for (const Z of SIZES) {
  for (const f of fs.readdirSync(path.join(HERE, Z.dir))) if (f.endsWith('.png')) fs.unlinkSync(path.join(HERE, Z.dir, f)); // the set is made whole each time
  const duo = Z.W > 1300;
  for (const S of SLIDES) {
    let body = ring(...Z.ring) + words(Z.L, S.title, S.sub);
    if (S.footage) { // the clip itself, big, with what's on it
      const cw = Z.W - 2 * Z.L.x + 60, ch = Math.round(cw * 9 / 16), cy = Z.P.y + (duo ? -20 : 90);
      body += clip({ x: Z.L.x - 30, y: cy, w: cw, h: ch, img: foot('21'), r: 40 * Z.s, tilt: -1.5 });
      body += tag(Z.W - Z.L.x - 380 * Z.s, cy + ch - 34, Z.s, 'Cut by Gaffer');
      body += duo ? chips(Z.L.x, cy + ch + 80, Z.W - 2 * Z.L.x, 2, 0.86, CLIP_CHIPS) : chips(Z.L.x, cy + ch + 130, Z.W - 2 * Z.L.x, 1, 1.18, CLIP_CHIPS);
    } else {
      const cw = Math.round((Z.W - 2 * Z.L.x) * 0.92), ch = Math.round(cw * 9 / 16), cy = Z.P.y - (duo ? 90 : 60);
      body += phone({ ...Z.P, y: S.hero ? cy + ch - (duo ? 120 : 90) : Z.P.y, img: S.img });
      if (S.hero) { // Ethan's 3–0 as Gaffer cut it, above the phone playing the whole match
        body += clip({ x: Z.L.x - 10, y: cy, w: cw, h: ch, img: foot('04-goal'), r: 36 * Z.s, tilt: -2.5, z: 3 });
        body += tag(Z.L.x + cw - 360 * Z.s, cy + ch - 40, Z.s, 'Cut by Gaffer');
      }
    }
    await render(Z.W, Z.H, body, path.join(HERE, Z.dir, `${Z.prefix}-${S.n}-${S.key}.png`));
  }
}

// ---------- the header (3840 × 1646) and search result (1920 × 1280) pictures
const headline = 'Your team,<br><em>sorted</em>', strap = 'Fair subs, polls, stats and highlights cut from your GoPro or iPhone footage.';
{
  const W = 3840, H = 1646;
  let body = ring(330, 2480, 1000) + brand(150, 330, 1) +
    `<h1 style="left:150px;top:560px;font-size:210px;width:1700px">${headline}</h1><p class="sub" style="left:150px;top:1060px;font-size:60px;width:1500px">${strap}</p>`;
  body += landscape({ x: 1900, y: 150, w: 1860, img: foot('04-goal'), tilt: 3 });
  body += phone({ x: 1720, y: 560, w: 600, img: raw('mh'), tilt: -5, z: 2 });
  body += phone({ x: 3120, y: 780, w: 580, img: raw('game'), tilt: 5, z: 2 });
  await render(W, H, body, path.join(HERE, '4 Header and Search Results', 'header-3840x1646.png'));
}
{
  const W = 1920, H = 1280;
  let body = ring(170, 1210, 330) + brand(76, 280, 0.5) +
    `<h1 style="left:76px;top:400px;font-size:112px;width:880px">${headline}</h1><p class="sub" style="left:76px;top:660px;font-size:34px;width:780px">${strap}</p>`;
  body += landscape({ x: 930, y: 120, w: 960, img: foot('04-goal'), tilt: 3 });
  body += phone({ x: 870, y: 470, w: 320, img: raw('mh'), tilt: -5, z: 2 });
  body += phone({ x: 1560, y: 600, w: 310, img: raw('game'), tilt: 5, z: 2 });
  await render(W, H, body, path.join(HERE, '4 Header and Search Results', 'search-1920x1280.png'));
}

// ---------- social: squares (1080 × 1080), stories (1080 × 1920) and a wide one (1920 × 1080)
const SOC = path.join(HERE, '5 Social');
const out = (name) => path.join(SOC, name + '.png');
{ // the highlight, square: the clip, then the phone with the whole match
  let body = ring(980, 60, 420) + `<h1 style="left:70px;top:70px;font-size:96px;width:900px">Highlights,<br>cut for you</h1>`;
  body += clip({ x: 70, y: 330, w: 640, h: 360, img: foot('04-goal'), r: 30, tilt: -2.5, z: 3 });
  body += tag(380, 660, 0.8, 'Cut by Gaffer', 5);
  body += phone({ x: 640, y: 300, w: 380, img: raw('mh'), tilt: 4, z: 2 });
  body += `<p class="sub" style="left:70px;top:800px;font-size:36px;width:540px">Log the goals as they go in. Gaffer cuts each one from your GoPro or iPhone footage.</p>`;
  await render(1080, 1080, body, out('square-1-highlights'));
}
{ // the highlight, story
  let body = ring(980, 120, 520) + brand(70, 110, 0.5) + `<h1 style="left:70px;top:230px;font-size:120px;width:960px">Every goal,<br><em>cut for you</em></h1>`;
  body += clip({ x: 50, y: 520, w: 980, h: 551, img: foot('04-goal'), r: 34, tilt: -2 });
  body += phone({ x: 300, y: 1130, w: 480, img: raw('hl'), z: 2 });
  body += tag(640, 1080, 0.9, 'Ethan, 8′', 4);
  await render(1080, 1920, body, out('story-1-highlights'));
}
{ // full time, square: the keeper's arms up at 15–2, as Gaffer cut it
  let body = ring(990, 1040, 360) + clip({ x: 0, y: 0, w: 1080, h: 608, img: foot('27-ft'), r: 0 });
  body += `<div style="position:absolute;left:0;top:420px;width:1080px;height:190px;background:linear-gradient(180deg,rgba(42,22,112,0),rgba(42,22,112,.9))"></div>`;
  body += `<h1 style="left:70px;top:620px;font-size:104px;width:960px">Full time.<br>Highlights <em>ready.</em></h1>`;
  body += `<p class="sub" style="left:70px;top:870px;font-size:36px;width:900px">SOP FC 15–2 Dog Squad, cut into 17 moments by Gaffer, score and all.</p>`;
  await render(1080, 1080, body, out('square-2-full-time'));
}
{ // subs, square
  let body = ring(80, 1000, 380) + `<h1 style="left:70px;top:80px;font-size:100px;width:560px">Fair subs,<br><em>sorted</em></h1>`;
  body += `<p class="sub" style="left:70px;top:330px;font-size:36px;width:500px">Everyone plays about the same. Gaffer tells you who’s off, who’s on and when.</p>`;
  body += phone({ x: 600, y: 90, w: 430, img: raw('game'), tilt: 3 });
  body += banner(60, 640, 560, 0.75, 'Goal! SOP FC 3–0 Dog Squad', 'Ethan.');
  await render(1080, 1080, body, out('square-3-subs'));
}
{ // the poll, square
  let body = ring(1000, 1000, 380) + `<h1 style="left:70px;top:80px;font-size:100px;width:560px">Who’s in<br><em>on Tuesday?</em></h1>`;
  body += `<p class="sub" style="left:70px;top:330px;font-size:36px;width:500px">One poll, everyone answers, the line-up draws itself.</p>`;
  body += phone({ x: 600, y: 90, w: 430, img: raw('games'), tilt: 3 });
  body += banner(60, 640, 560, 0.75, 'Sons of Pitches FC v Borussia Teeth', 'New game on Tue 13 Oct, 19:30. Are you in?');
  await render(1080, 1080, body, out('square-4-poll'));
}
{ // sharing, story
  let body = ring(100, 1800, 520) + brand(70, 110, 0.5) + `<h1 style="left:70px;top:230px;font-size:120px;width:960px">Share the<br><em>best bits</em></h1>`;
  body += `<p class="sub" style="left:70px;top:500px;font-size:44px;width:900px">Post your goals for your teammates and followers to watch.</p>`;
  body += phone({ x: 190, y: 680, w: 700, img: raw('feed') });
  await render(1080, 1920, body, out('story-2-share'));
}
{ // the clip, story: what's on it
  let body = ring(980, 1700, 520) + brand(70, 110, 0.5) + `<h1 style="left:70px;top:230px;font-size:120px;width:960px">Every goal,<br><em>on the telly</em></h1>`;
  body += clip({ x: 50, y: 560, w: 980, h: 551, img: foot('21'), r: 34, tilt: -1.5 });
  body += chips(70, 1200, 940, 1, 1, CLIP_CHIPS);
  await render(1080, 1920, body, out('story-3-clip'));
}
{ // wide, for YouTube, X or a website
  let body = ring(170, 1010, 330) + brand(90, 150, 0.5) + `<h1 style="left:90px;top:280px;font-size:118px;width:820px">Your team,<br><em>sorted</em></h1>
    <p class="sub" style="left:90px;top:560px;font-size:36px;width:740px">${strap}</p>`;
  body += landscape({ x: 860, y: 90, w: 1000, img: foot('04-goal'), tilt: 3 });
  body += phone({ x: 850, y: 450, w: 330, img: raw('mh'), tilt: -5, z: 2 });
  body += phone({ x: 1540, y: 560, w: 320, img: raw('game'), tilt: 5, z: 2 });
  await render(1920, 1080, body, out('wide-1920x1080'));
}
await browser.close();
