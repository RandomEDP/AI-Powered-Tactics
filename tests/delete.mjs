import { chromium } from 'playwright';
import fs from 'fs';
const MOCK = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8') + `
;(function(){ const make = window.supabase.createClient; window.supabase.createClient = function(){ const c = make(); const rpc0 = c.rpc;
  c.rpc = function(name, a){ if (name !== 'delete_my_account') return rpc0(name, a);
    const d = JSON.parse(localStorage.getItem('__mockdb')); const uid = sessionStorage.getItem('__mockuser');
    const mine = d.team_members.filter(m => m.user_id === uid).map(m => m.team_id);
    const solo = mine.filter(t => !d.team_members.some(m => m.team_id === t && m.user_id !== uid));
    d.teams = d.teams.filter(t => solo.indexOf(t.id) < 0); d.team_members = d.team_members.filter(m => m.user_id !== uid && solo.indexOf(m.team_id) < 0);
    d.users = d.users.filter(u => u.id !== uid); localStorage.setItem('__mockdb', JSON.stringify(d)); return Promise.resolve({ data: solo.length, error: null }); };
  return c; }; })();`;
const BASE = 'http://localhost:8766/'; // serve the repo root on this port first
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 400, height: 900 } });
await ctx.addInitScript(() => { if (!localStorage.getItem('apt-app')) localStorage.setItem('apt-app', JSON.stringify({ teams: [], active: null, view: 'welcome', introSeen: true, plansSeen: true })); }); // skip the first-launch intro
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.includes('vendor/supabase.js')) return r.fulfill({ contentType: 'application/javascript', body: MOCK }); return u.startsWith(BASE) ? r.continue() : r.abort(); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(BASE); await p.waitForTimeout(300);
console.log('privacy link:', await p.getAttribute('#v-welcome [data-privacy]', 'href'));
await p.click('#acctBtn'); await p.fill('#aEmail', 'x@example.com'); await p.fill('#aPass', 'longpassword'); await p.click('#aSignUp'); await p.click('#aSignIn'); await p.waitForTimeout(300);
await p.click('#createBtn'); await p.fill('#tName', 'Solo FC'); await p.click('#tCreate'); await p.waitForTimeout(300); await p.click('#v-code [data-go="home"]');
await p.click('#mSwitch'); await p.click('#acctBtn');
console.log('delete visible:', await p.isVisible('#aDelete'));
await p.click('#aDelete'); console.log('armed:', await p.textContent('#aDelete')); await p.click('#aDelete'); await p.waitForTimeout(600);
const d = await p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
console.log('message:', await p.textContent('#aMsg'), '| users left:', d.users.length, '| teams left:', d.teams.length, '| signed out:', await p.isVisible('#aSignIn'));
await p.goto(BASE + 'privacy.html'); console.log('privacy page:', await p.title(), '|', (await p.textContent('h2')).trim());
console.log('errors:', JSON.stringify(errs)); await b.close();
