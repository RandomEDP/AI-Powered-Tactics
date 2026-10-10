# Gaffer

Line-ups, sub rotations, live scores, stats and highlight reels for small-sided football teams.
An iOS app (and the same app on the web) backed by Supabase, usable offline at the pitch.

## What it does

- **Teams with codes.** Organisers sign in and create teams. Each team gets a 6-character follow code; anyone with it can follow live games and stats without an account.
- **Player accounts.** A player enters the team code, picks their unclaimed name, and signs up. That links their account to the player's stats, on as many teams as they like. Gaffers (team admins) are marked in the squad.
- **Game polls.** A gaffer posts the next game (opponent, kick-off, location, cost). Players answer in, in goal or out: one keeper, and up to 7 outfield (or 4 with no subs). The team screen shows who's playing on a pitch map, placed by each player's position, which the gaffer can drag around. The poll's details become the defaults for the next one.
- **Gaffers.** Each team also has a private 10-character organiser code. A signed-in person who enters it becomes a co-organiser.
- **Minutes planning.** A slider from *Aggressive* (most effective players by goals and assists per minute play most, everyone gets at least 5 minutes) to *Fairness* (equal minutes, any extra to whoever has played least this season).
- **Match day.** Countdown to each change, tap-to-swap upcoming subs, player injured or leaving with a suggested replacement, added time, goals, assists, keeper saves and highlights.
- **Everyone can watch along and log goals.** At kick-off, everyone with the team open gets a "Game started" pop-up, and signed-in players get a notification on their iPhone (see below). Goal logging by the team is on by default and can be switched off in Options. When anyone logs a goal the score locks on every phone for 8 seconds, so the same goal isn't counted twice.
- **Games.** Gaffers can line up as many games as they like. Each has its own poll, line-up map and calendar entry, swiped through on the Games screen; the next one also sits on the team screen. A bar along the bottom switches between Home, Games and Settings.
- **Game modes.** Each game or poll is 5-a-side (squad of 5 to 8) or 7-a-side (squad of 7 to 10), with its own length, sub interval and whether there is a half time; the last format used for each is remembered. A tournament is one poll for the day with any number of short games started from it. Tournament games count towards players' season totals, stay out of the league record, and have their own view in Stats.
- **Insights.** Match ratings out of 10 and a man of the match for every game, season form, player chemistry (how the team does while two players are on together, and who sets up whom), and when goals are scored and conceded. All of it is worked out from the logged stats; no AI model is involved.
- **Highlights.** Every event is timestamped. In the iPhone app a gaffer picks the GoPro or phone footage from their photos (one continuous video is best; one per half also works) and the phone cuts a clip per moment, each with the app's watermark and a caption, plus one joined reel that ends on an outro card. The clips are uploaded for the whole team to watch by game or by player (oldest first); the full recording and the joined reel stay on the phone. On a computer, the same screen writes an ffmpeg script instead. Watch-shortcut times can be imported.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app (HTML, CSS, JS) |
| `config.js` | Supabase project URL and publishable key. Both are public by design; never put a secret or `service_role` key here |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `sw.js` | Offline support: caches the app shell; team data is kept on the phone and syncs when back online |
| `supabase/functions/team-notify/` | Edge function that sends the team's notifications to their iPhones: game started, new poll, highlights ready, and the gaffer's poll nudge. (`game-started` is the older, kick-off-only version, kept for earlier builds.) It needs three secrets set in Supabase (Edge Functions → Secrets): `APNS_KEY_P8`, `APNS_KEY_ID` and `APPLE_TEAM_ID`. Until they are set it does nothing |
| `supabase/migrations/` | Database schema, row level security and functions |
| `supabase/seed_sons_of_pitches.sql` | One-off import of the original team |
| `privacy.html` | Privacy policy (linked from the app and needed for the App Store listing) |
| `tests/` | Browser tests against an in-memory stand-in for Supabase, the iOS alerts and account deletion |
| `vendor/` | Bundled Supabase library and fonts, so the app works with no signal |
| `ios/`, `capacitor.config.json`, `package.json` | The iOS app (see below) |
| `ios/App/Watch/` | Apple Watch companion app (SwiftUI): clock, score, next changes, and logging goals and highlights. It has no sign-in; the iPhone app sends it the game in progress |
| `plugins/reel-cutter/` | Native iOS plugin that cuts the highlight clips on the phone (AVFoundation): video picker, watermark, captions, outro card, share sheet. Also holds the calendar and Apple Watch link plugins |

## iOS app

The iOS app wraps the same web app with [Capacitor](https://capacitorjs.com) and adds native extras:
lock-screen alerts for each change and for half time and full time (so a locked phone still buzzes), haptics, and keeping the screen awake during a game.
Everything is built on GitHub's Macs, so no Mac is needed.

- `ios/` is the Xcode project. `capacitor.config.json` sets the app ID `com.randomedp.aipoweredtactics` and name.
- `npm run ios:sync` copies the web app into the iOS project (`www/` is generated, not committed).
- `.github/workflows/ios.yml` checks the app builds on every push, and signs and uploads to TestFlight when run by hand.

### One-time Apple setup (needs the Apple Developer Program, £79 a year)

1. **Register the app ID.** developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App. Bundle ID (explicit): `com.randomedp.aipoweredtactics`.
2. **Create the app.** App Store Connect → Apps → + → New App: iOS, name *AI Powered Tactics* (or another if taken), the bundle ID above, SKU `aipoweredtactics`.
3. **Make an API key for the builds.** App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → +. Access: **Admin** (needed so the build can create its own signing certificate). Download the `.p8` file (you only get one chance) and note the **Key ID** and the **Issuer ID** shown above the list.
4. **Find your Team ID.** developer.apple.com → Account → Membership details.
5. **Add four repository secrets.** GitHub → this repo → Settings → Secrets and variables → Actions → New repository secret:
   - `APPLE_TEAM_ID`: the Team ID
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: the whole contents of the `.p8` file, including the BEGIN and END lines
6. **Build.** GitHub → Actions → iOS → Run workflow (TestFlight ticked). About 10 to 15 minutes later the build appears in App Store Connect → TestFlight.
7. **Install.** Add yourself under TestFlight → Internal Testing, then install from the TestFlight app on your iPhone. Teammates can be added as internal testers (they need an App Store Connect user) or through a public TestFlight link under External Testing, which needs a short beta review by Apple.

Never put the `.p8` key, or any secret, in the code or in chat. GitHub secrets are encrypted and only available to the build.

## Security model

- All tables have row level security. Only a team's organisers can read or change its rows directly.
- Followers read a team only through `get_team(code)`, which needs the exact code, never returns the organiser code, and cannot list teams.
- `create_team`, `join_as_organiser`, `new_organiser_code` and `delete_my_account` require a signed-in user. Deleting an account also deletes teams that person organises alone.
- `queue_goal` lets followers log a goal only when the team allows it, and only as a sanitised payload the organiser's app folds in.
- Live updates use a Supabase Realtime broadcast channel per team that only says "something changed"; clients then re-read through the functions above.

## Setup

1. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root. The app is served at `https://<user>.github.io/AI-Powered-Tactics/`.
2. **Supabase Auth URLs:** Authentication → URL Configuration. Set *Site URL* to the Pages address above and add it under *Redirect URLs*, so confirmation emails link back to the app.
3. **Database:** the migrations in `supabase/migrations/` are already applied to the project. To rebuild elsewhere, run them in order in the SQL editor.

## Running the tests

```
python3 -m http.server 8766        # from the repo root
cd tests && npm i playwright && node flow.mjs && node native.mjs && node delete.mjs && node players.mjs && node polls.mjs
node shots.mjs shots light   # screenshots of every screen, for checking the design
```
