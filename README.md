# AI Powered Tactics

Line-ups, sub rotations, live scores, stats and highlight reels for small-sided football teams.
An iOS app (and the same app on the web) backed by Supabase, usable offline at the pitch.

## What it does

- **Teams with codes.** Organisers sign in and create teams. Each team gets a 6-character follow code; anyone with it can follow live games and stats without an account.
- **Organisers.** Each team also has a private 10-character organiser code. A signed-in person who enters it becomes a co-organiser.
- **Minutes planning.** A slider from *Aggressive* (most effective players by goals and assists per minute play most, everyone gets at least 5 minutes) to *Fairness* (equal minutes, any extra to whoever has played least this season).
- **Match day.** Countdown to each change, tap-to-swap upcoming subs, player injured or leaving with a suggested replacement, added time, goals, assists, keeper saves and highlights.
- **Followers can log goals** if the organiser switches that on in Options.
- **Highlights.** Every event is timestamped. The Highlights screen writes an ffmpeg script that cuts a GoPro recording into a reel, and season reels per player. Watch-shortcut times can be imported.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app (HTML, CSS, JS) |
| `config.js` | Supabase project URL and publishable key. Both are public by design; never put a secret or `service_role` key here |
| `manifest.webmanifest`, `icons/` | Home-screen install |
| `sw.js` | Offline support: caches the app shell; team data is kept on the phone and syncs when back online |
| `supabase/migrations/` | Database schema, row level security and functions |
| `supabase/seed_sons_of_pitches.sql` | One-off import of the original team |
| `tests/` | Browser tests against an in-memory stand-in for Supabase, and for the iOS alerts |
| `vendor/` | Bundled Supabase library and fonts, so the app works with no signal |
| `ios/`, `capacitor.config.json`, `package.json` | The iOS app (see below) |

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
- `create_team`, `join_as_organiser` and `new_organiser_code` require a signed-in user.
- `queue_goal` lets followers log a goal only when the team allows it, and only as a sanitised payload the organiser's app folds in.
- Live updates use a Supabase Realtime broadcast channel per team that only says "something changed"; clients then re-read through the functions above.

## Setup

1. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root. The app is served at `https://<user>.github.io/AI-Powered-Tactics/`.
2. **Supabase Auth URLs:** Authentication → URL Configuration. Set *Site URL* to the Pages address above and add it under *Redirect URLs*, so confirmation emails link back to the app.
3. **Database:** the migrations in `supabase/migrations/` are already applied to the project. To rebuild elsewhere, run them in order in the SQL editor.

## Running the tests

```
python3 -m http.server 8766        # from the repo root
cd tests && npm i playwright && node flow.mjs && node native.mjs
```
