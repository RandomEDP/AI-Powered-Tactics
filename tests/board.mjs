// The tactics board: shapes, names, drawing, set pieces, saving. It is a sandbox and touches nothing else.
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const errs = [], out = process.argv[2]; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.route('**/*', (r) => r.request().url().startsWith(BASE) && !r.request().url().includes('supabase') ? r.continue() : r.abort());
await pg.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); });
const wait = (ms) => pg.waitForTimeout(ms), shot = async (n) => { if (out) { fs.mkdirSync(out, { recursive: true }); await wait(300); await pg.screenshot({ path: `${out}/${n}.png`, fullPage: true }); } };
const pcs = () => pg.$$eval('#tbSvg [data-pc]', (g) => g.map((x) => x.getAttribute('data-pc') + '@' + x.getAttribute('transform').replace(/translate\(|\)/g, '')));
await pg.goto(BASE); await wait(300);
await pg.click('#createBtn'); await pg.fill('#tName', 'Test United'); await pg.fill('#tPlayers', 'Marsh\nTobi\nDev\nKofi\nLuca\nAsh\nNiko\nEzra'); await pg.click('#tCreate'); await pg.click('#v-code [data-go="home"]');
await pg.click('#tabs [data-tab="board"]'); await wait(300);
console.log('board:', (await pcs()).length, 'pieces | shapes:', await pg.$$eval('[data-tbform]', (x) => x.map((y) => y.textContent)));
await pg.click('[data-tbform="1-2-1"]'); console.log('diamond:', (await pcs()).slice(1, 5).join(' '));
await pg.click('[data-tb="best"]'); console.log('named:', await pg.$$eval('#tbSvg [data-pc] text:last-child', (t) => t.map((x) => x.textContent)), '|', await pg.textContent('.tbout'));
// tap a player and rename; drag another
const box = await pg.locator('#tbSvg').boundingBox(), at = (x, y) => [box.x + x / 100 * box.width, box.y + y / 140 * box.height];
await pg.locator('#tbSvg').scrollIntoViewIfNeeded(); const bb = await pg.locator('#tbSvg').boundingBox(); const AT = (x, y) => [bb.x + x / 100 * bb.width, bb.y + y / 140 * bb.height];
await pg.mouse.click(...AT(50, 52)); await wait(200); console.log('tap a player ->', await pg.textContent('.tbsec h2'));
await pg.click('[data-tbpid="1"]'); await wait(200);
const bb2 = await pg.locator('#tbSvg').boundingBox(); const AT2 = (x, y) => [bb2.x + x / 100 * bb2.width, bb2.y + y / 140 * bb2.height];
await pg.mouse.move(...AT2(25, 82)); await pg.mouse.down(); await pg.mouse.move(...AT2(15, 60), { steps: 6 }); await pg.mouse.up(); await wait(200);
console.log('after a drag:', (await pcs()).find((x) => x.startsWith('u2')));
// draw a pass
await pg.click('[data-tbmode="pass"]'); await wait(100); const bb3 = await pg.locator('#tbSvg').boundingBox(); const AT3 = (x, y) => [bb3.x + x / 100 * bb3.width, bb3.y + y / 140 * bb3.height];
await pg.mouse.move(...AT3(50, 70)); await pg.mouse.down(); await pg.mouse.move(...AT3(60, 50), { steps: 8 }); await pg.mouse.move(...AT3(70, 20), { steps: 8 }); await pg.mouse.up(); await wait(200);
console.log('lines drawn:', await pg.$$eval('#tbSvg path[marker-end]', (x) => x.length));
await pg.click('[data-tb="them"]'); await pg.click('[data-tb="chem"]'); await wait(200); console.log('with opposition:', (await pcs()).length, 'pieces'); await shot('board');
// a set piece, played
await pg.click('[data-tbmode="move"]'); await pg.click('[data-tbset="0"]'); await wait(200); const before = (await pcs()).join(' ');
console.log('set piece:', await pg.textContent('.tbsec .note'), '| arrows:', await pg.$$eval('#tbSvg path[marker-end]', (x) => x.length)); await shot('setpiece');
await pg.click('[data-tb="play"]'); await wait(3200); console.log('played, pieces moved:', (await pcs()).join(' ') !== before, '| reset offered:', await pg.isVisible('[data-tb="reset"]'));
await pg.click('[data-tb="reset"]'); await wait(200); console.log('back to the start:', (await pcs()).join(' ') === before);
await pg.fill('#tbName', 'Corner one'); await pg.click('[data-tb="save"]'); await pg.click('[data-tbside="7"]'); await wait(200); console.log('7-a-side pieces:', (await pcs()).filter((x) => x.startsWith('u')).length, '| saved:', await pg.$$eval('[data-tbload]', (x) => x.map((y) => y.textContent)));
await pg.click('[data-tbload="0"]'); await wait(200); console.log('loaded save, ours:', (await pcs()).filter((x) => x.startsWith('u')).length);
for (const k of ['talk', 'coin', 'captain', 'pens']) { await pg.click(`[data-tb="${k}"]`); console.log(' ', k + ':', (await pg.textContent('.tbout')).slice(0, 70)); }
const dl = pg.waitForEvent('download', { timeout: 5000 }).catch(() => null); await pg.click('[data-tb="share"]'); const d = await dl; console.log('picture:', d ? d.suggestedFilename() : 'none');
await pg.reload(); await wait(400); console.log('after reload still on:', await pg.evaluate(() => [...document.querySelectorAll('[id^="v-"]')].filter((v) => !v.hidden).map((v) => v.id).join()), '| saves kept:', await pg.$$eval('[data-tbload]', (x) => x.length));
console.log('errors:', JSON.stringify(errs)); await b.close();
