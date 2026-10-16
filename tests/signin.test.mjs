// Signing in and making an account (Ethan: "these pages need to be split up"). The welcome screen has Sign in and Create
// account, each going to its own page; the sign-in page has Forgot your password?, which emails a reset link, and the
// link opens Gaffer to choose a new password.
import { world, suite } from './lib.mjs';
const { check, eq, done } = suite('phones: signing in, making an account and resetting a password');
const w = await world();
const out = process.argv[2], shot = async (P, name) => { if (out) await P.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };
const user = (email) => (w.db().users || []).find((u) => u.email === email);

const P = await w.phone({ db: true, label: 'new' });
eq([await P.text('#acctBtn'), await P.text('#acctNew')], ['Sign in', 'Create account'], 'the welcome screen has Sign in and Create account, in the list under the team code');
await shot(P, 'welcome');

// ---------- Create account: its own page, with only what making an account needs
await P.click('#acctNew'); await P.run(200);
eq([await P.view(), await P.text('#aTitle'), await P.visible('#aUser'), await P.visible('#aTerms'), await P.visible('#aSignUp'), await P.visible('#aSignIn'), await P.visible('#aForgot')],
  ['account', 'Create an account', true, true, true, false, false], 'Create account opens its own page: email, password, username and the terms, no Sign in button');
await shot(P, 'create-account');
await P.page.fill('#aEmail', 'sam@example.com'); await P.page.fill('#aPass', 'firstpassword'); await P.page.fill('#aUser', 'samwise'); await P.check('#aTerms');
// Supabase's own mail has a small hourly limit (a friend of Ethan's got "email rate limit exceeded", October 2026)
await P.page.evaluate(() => { window.__signUpError = 'email rate limit exceeded'; });
await P.click('#aSignUp'); await P.run(400);
eq([await P.text('#aMsg'), !!user('sam@example.com'), await P.page.inputValue('#aEmail')], ['Gaffer’s sending too many sign-up emails right now. Try again in an hour; your details are still filled in.', false, 'sam@example.com'],
  'too many sign-up emails: it says so in plain words and keeps what they typed');
await P.page.evaluate(() => { delete window.__signUpError; });
await P.click('#aSignUp'); await P.run(400);
eq([!!user('sam@example.com'), await P.text('#aTitle'), await P.page.inputValue('#aEmail'), await P.visible('#aUser')], [true, 'Sign in', 'sam@example.com', false],
  'made: it moves on to the sign-in page with the email kept, ready for once the email is confirmed');
check(/Account made\. Check your email/.test(await P.text('#aMsg')), `and says to confirm it first (${await P.text('#aMsg')})`);
await P.click('#aSignIn'); await P.run(1500);
eq(await P.view() !== 'account' || await P.visible('#aIn'), true, 'then Sign in signs in');

// ---------- signed out: Sign in is its own page too, and can go across to Create account and back
await P.page.evaluate(() => { localStorage.setItem('apt-app', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('apt-app') || '{}'), { view: 'welcome' }))); });
await P.click('#tabs [data-tab="profile"]').catch(() => {}); await P.run(300);
await P.page.evaluate(() => { const b = document.querySelector('#aSignOut'); if (b) b.click(); }); await P.run(800);
if (await P.view() !== 'welcome') { await P.page.evaluate(() => { const b = document.querySelector('.view:not([hidden]) [data-go="welcome"]'); if (b) b.click(); }); await P.run(300); }
await P.click('#acctBtn'); await P.run(200);
eq([await P.text('#aTitle'), await P.visible('#aSignIn'), await P.visible('#aForgot'), await P.visible('#aUser'), await P.visible('#aTerms'), await P.visible('#aSignUp')],
  ['Sign in', true, true, false, false, false], 'Sign in opens its own page: email, password, Sign in and Forgot your password?, nothing about making an account');
await shot(P, 'sign-in');
await P.click('#aToUp'); await P.run(100);
eq(await P.text('#aTitle'), 'Create an account', '"New to Gaffer? Create an account" goes across');
await P.click('#aToIn'); await P.run(100);
eq(await P.text('#aTitle'), 'Sign in', 'and "Already have an account? Sign in" back');
await P.page.fill('#aEmail', 'sam@example.com'); await P.page.fill('#aPass', 'wrongpassword'); await P.click('#aSignIn'); await P.run(500);
check(/don’t match/.test(await P.text('#aMsg')), `a wrong password says so (${await P.text('#aMsg')})`);

// ---------- forgot it: a reset link by email
await P.click('#aForgot'); await P.run(100);
eq([await P.text('#aTitle'), await P.visible('#aPass'), await P.visible('#aResetSend'), await P.page.inputValue('#aEmail')], ['Reset your password', false, true, 'sam@example.com'],
  'Forgot your password? asks only for the email (already filled in)');
await shot(P, 'reset');
await P.page.fill('#aEmail', 'not an email'); await P.click('#aResetSend'); await P.run(200);
eq([await P.text('#aMsg'), (w.db().resets || []).length], ['Enter the email you signed up with.', 0], 'it needs a real email');
await P.page.fill('#aEmail', 'sam@example.com'); await P.click('#aResetSend'); await P.run(400);
eq((w.db().resets || []).map((r) => r.email), ['sam@example.com'], 'Send me a reset link asks for the email');
check(!!(w.db().resets[0].to || '').length, 'with a link back to Gaffer');
check(/a reset link is on its way/.test(await P.text('#aMsg')) && /junk/.test(await P.text('#aMsg')), `and says what to do next (${await P.text('#aMsg')})`);
await P.click('#aForgotBack'); await P.run(100);
eq(await P.text('#aTitle'), 'Sign in', 'Back to sign in');

// ---------- the link in the email: Gaffer opens to choose a new password
await P.page.evaluate(() => window.__recover('sam@example.com')); await P.run(800);
eq([await P.view(), await P.text('#aTitle'), await P.visible('#aEmail'), await P.visible('#aPass'), await P.text('#aPassLabel')], ['account', 'Choose a new password', false, true, 'New password'],
  'opening the reset link goes straight to choosing a new password');
await shot(P, 'new-password');
await P.page.fill('#aPass', 'short'); await P.click('#aNewSave'); await P.run(200);
eq([await P.text('#aMsg'), user('sam@example.com').password], ['Passwords need at least 8 characters.', 'firstpassword'], 'too short isn\'t saved');
await P.page.fill('#aPass', 'brandnewpassword'); await P.click('#aNewSave'); await P.run(500);
eq([user('sam@example.com').password, await P.text('#aMsg'), await P.visible('#aIn')], ['brandnewpassword', 'Your new password is saved, and you’re signed in.', true], 'a good one is saved, and they\'re signed in');

// ---------- and it works from then on
await P.click('#aSignOut'); await P.run(800);
await P.click('#acctBtn'); await P.run(200);
await P.page.fill('#aEmail', 'sam@example.com'); await P.page.fill('#aPass', 'firstpassword'); await P.click('#aSignIn'); await P.run(500);
check(/don’t match/.test(await P.text('#aMsg')), 'the old password no longer works');
await P.page.fill('#aPass', 'brandnewpassword'); await P.click('#aSignIn'); await P.run(1500);
eq(await P.page.evaluate(() => !!sessionStorage.getItem('__mockuser')), true, 'the new one does');

await w.close();
await done(P);
