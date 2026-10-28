// Players a side in a game among the squad and in a friendly (Ethan, 28 October 2026: "when doing friendlies it auto maxes
// out the team size, it doesn't allow subs, you should be able to set the game size and overflow go into subs"). Blank is
// everyone on all game, as before. With a number, each side keeps that many on and the rest of that side sit on its own
// bench, taking turns every few minutes so everyone plays about the same. Nobody ever changes sides: the changes, the
// quick swap, an injury and the watch all keep to one side.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: players a side and subs in friendlies');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); }; // node tests/sidesubs.test.mjs <dir> to look at it
const sideOf = (m, id) => m.house.side[id];
const onSide = (m, s, sd) => s.on.filter((id) => sideOf(m, id) === sd);
const benchSide = (m, s, sd) => s.bench.filter((id) => sideOf(m, id) === sd);
const mins = (m) => { const r = {}; m.squad.forEach((id) => { r[id] = 0; }); m.segs.forEach((s) => s.on.forEach((id) => { r[id] += s.to - s.from; })); return r; };

// ---------- a game among the squad: 13 turn up, 7 v 6, five a side on the pitch
const A = await w.phone({ db: true, native: true, label: 'gaffer' });
await A.click('#createBtn'); await A.signUp('ethan@example.com');
await A.page.fill('#tName', 'Sons of Pitches FC'); await A.page.fill('#tShort', 'SOP FC');
await A.page.fill('#tPlayers', 'Spice\nJake\nChaplin\nHarrison\nPuxley\nIssac\nReece\nEthan\nJosh\nTom\nDan\nSam\nLuke'); await A.click('#tCreate'); await A.run(600);
await A.click('#v-code [data-go="home"]');
await A.click('#mNew'); await A.click('#gKind [data-kind="house"]');
eq(await A.text('#hMsg'), 'Bibs 7 v 6 Shirts.', 'everyone is split into two sides to start with');
check(await A.visible('#hPer') && (await A.page.inputValue('#hPer')) === '' && (await A.page.getAttribute('#hPer', 'placeholder')) === 'Everyone', 'Players a side starts blank: everyone plays');
await A.page.fill('#hPer', '5'); await A.run(200);
eq(await A.text('#hMsg'), 'Bibs 7 v 6 Shirts. 5 a side on the pitch: 2 on the Bibs bench and 1 on the Shirts bench, and the subs come on every 5 minutes so everyone plays about the same.',
  'with 5 a side, the extras on each side go on that side\'s bench');
await A.page.fill('#hPer', '7'); await A.run(200);
eq(await A.text('#hMsg'), 'Bibs 7 v 6 Shirts. 7 a side on the pitch, so nobody sits out. Shirts only has 6.', 'a number nobody goes over: nobody sits out');
await A.page.fill('#hPer', '5'); await A.run(200);
await shot(A, 'house-sides-setup');
await A.click('#hKick'); await A.run(300);

let m = await A.match();
eq([m.sub, m.pitch, m.segs.length], [5, 10, 6], 'the game has 5-minute stretches (6 over two halves of 15) with 10 on the pitch');
check(m.segs.every((s) => onSide(m, s, 'a').length === 5 && onSide(m, s, 'b').length === 5), 'every stretch has exactly 5 of each side on');
check(m.segs.every((s) => benchSide(m, s, 'a').length === 2 && benchSide(m, s, 'b').length === 1), 'and 2 Bibs and 1 Shirt on the bench');
const gm = mins(m), aMins = Object.keys(gm).filter((id) => sideOf(m, +id) === 'a').map((id) => gm[id]), bMins = Object.keys(gm).filter((id) => sideOf(m, +id) === 'b').map((id) => gm[id]);
check(Math.max(...aMins) - Math.min(...aMins) <= 5 && Math.min(...aMins) >= 20, `Bibs' minutes are within one stretch of each other (${aMins.join(', ')})`);
eq(bMins, [25, 25, 25, 25, 25, 25], 'every Shirt plays 25 of the 30 minutes');
check(await A.visible('#benchSheet'), 'before kick-off the bench sheet says who starts on the bench');
await A.click('#benchOk');
eq([await A.visible('#swapCard'), await A.visible('#rotaSec'), await A.visible('#edBtn')], [true, true, false], 'the Next change card and the rota show (editing the subs is from the card, one side at a time)');
check((await A.text('#pitchNow')).includes('bench') && (await A.text('#benchNow')).includes('bench'), 'each side shows who\'s on its bench');
check(/\((Bibs|Shirts)\)/.test(await A.text('#rota')), 'the rota says which side each sub is on');
const ws = await A.watch();
check(ws.changes.length >= 5 && !ws.due, 'the watch has the changes to buzz for');

// the quick swap on the Next change card only offers the same side
const t1 = 1, s1 = m.segs[t1], comer = s1.on.find((id) => !m.segs[0].on.includes(id));
await A.click(`#swapBody [data-q="on"][data-id="${comer}"]`); await A.run(200);
const offered = await A.page.$$eval('#quickSwap [data-c]', (b) => b.map((x) => +x.getAttribute('data-c')));
check(offered.length > 0 && offered.every((id) => sideOf(m, id) === sideOf(m, comer)), 'swapping who comes on only offers players from the same side');
await A.click('#quickSwap [data-cancel]');

// kick off; the first change is due at 5:00 and waits for Subs done
await A.click('#go'); await A.run(5 * 60000 + 2000);
check(await A.visible('#subPopDone'), 'at 5:00 the change is due');
await A.click('#subPopDone'); await A.run(300);
m = await A.match();
eq(m.ok, 1, 'Subs done makes it');

// an injury: someone from Bibs on the pitch goes off, and a Bib comes on
const s = m.segs[1], hurt = onSide(m, s, 'a')[0];
await A.click('#outBtn'); await A.click(`#outPicker [data-o="${hurt}"]`); await A.run(200);
const subs = await A.page.$$eval('#outPicker [data-r]', (b) => b.map((x) => +x.getAttribute('data-r')));
check(subs.length === 2 && subs.every((id) => sideOf(m, id) === 'a'), 'only Bibs on the bench are offered to come on');
await A.click(`#outPicker [data-r="${subs[0]}"]`); await A.run(300);
m = await A.match();
const later = m.segs.filter((x) => x.h > 0 || x.from >= 6);
check(later.every((x) => onSide(m, x, 'a').length === 5 && onSide(m, x, 'b').length === 5 && !x.on.includes(hurt)), 'both sides still have 5 on for the rest of the game');
await shot(A, 'house-sides-game');

// ---------- a friendly outside any team: 3 v 3, two a side on the pitch
const B = await w.phone({ db: true, native: true, label: 'friendly' });
await B.click('#acctNew'); await B.signUp('dan@example.com', 'dan_dog');
await B.page.evaluate(() => document.querySelector('#fdFriendly').click()); await B.run(300);
for (const g of ['Ali', 'Bo', 'Cal', 'Dee', 'Eve']) { await B.page.fill('#frGuest', g); await B.click('#frAddG'); }
eq(await B.text('#frCount'), 'Bibs 3 v 3 Shirts.', 'six people, three a side');
await B.page.fill('#frPer', '2'); await B.page.fill('#frSub', '10'); await B.page.fill('#frHalf', '20'); await B.run(200);
eq(await B.text('#frCount'), 'Bibs 3 v 3 Shirts. 2 a side on the pitch: 1 on the Bibs bench and 1 on the Shirts bench, and the subs come on every 10 minutes so everyone plays about the same.', 'two a side, changing every 10 minutes');
await shot(B, 'friendly-sides-setup');
await B.click('#frKick'); await B.run(800);
m = await B.match();
eq([await B.view(), m.sub, m.pitch, m.segs.length], ['game', 10, 4, 4], 'the friendly is played 2 a side, with 10-minute stretches');
check(m.segs.every((x) => onSide(m, x, 'a').length === 2 && onSide(m, x, 'b').length === 2 && benchSide(m, x, 'a').length === 1 && benchSide(m, x, 'b').length === 1), 'one on each bench every stretch');
const fm = Object.values(mins(m)).sort((a, b) => a - b);
check(fm[fm.length - 1] - fm[0] <= 10 && fm[0] >= 20, `everyone plays about the same (${fm.join(', ')})`);
eq(JSON.parse(await B.page.evaluate(() => localStorage.getItem('apt-friendly'))).per, 2, 'the friendly screen remembers the number a side for next time');

// ---------- blank is everyone on, as before
await B.click('#abandonBtn'); await B.run(200); if (await B.visible('#abandonPop')) { await B.page.click('#abandonPop .danger'); await B.run(400); }
await B.page.evaluate(() => document.querySelector('#fdFriendly').click()); await B.run(300);
await B.page.fill('#frPer', ''); await B.run(200);
eq(await B.text('#frCount'), 'Bibs 3 v 3 Shirts.', 'cleared, it says nothing about subs');
await B.click('#frKick'); await B.run(800);
m = await B.match();
check(m && m.segs.length === 2 && m.segs.every((x) => !x.bench.length) && m.sub === m.half, 'and the game has everyone on all game, no subs');
check(!(await B.visible('#swapCard')), 'with no Next change card');

await done(A, B);
