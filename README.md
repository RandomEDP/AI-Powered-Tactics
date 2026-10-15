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
- **Games among the squad.** New game → Among ourselves: split whoever's turned up into two sides of any size, with no fixed keeper, and add guests from outside the squad by name. A goal for one side only offers that side's players. Afterwards the gaffer can send the guests a link to the game's highlights, where they can get the app, make an account and join or start a team.
- **A game of just me.** New game → Just me: no line-up and no subs, just the clock, goals for and against and highlights, on the phone or the Apple Watch. Kept out of the team's record, and nobody gets a notification about it.
- **Games.** Gaffers can line up as many games as they like. Each has its own poll, line-up map and calendar entry, swiped through on the Games screen; the next one also sits on the team screen. A bar along the bottom switches between Home, Games and Settings.
- **Game modes.** Each game or poll is 5-a-side (squad of 5 to 8) or 7-a-side (squad of 7 to 10), with its own length, sub interval and whether there is a half time; the last format used for each is remembered. A tournament is one poll for the day with any number of short games started from it. Tournament games count towards players' season totals, stay out of the league record, and have their own view in Stats.
- **Tactics board.** A sandbox on its own tab: shapes for 5 and 7 a side, named players, an opposition, drawn runs and passes, set pieces that play back, chemistry lines from the stats, saved boards and a picture to share. It is one self-contained block in `index.html` (search for "tactics board") and is kept on the phone only.
- **Player tracking (experimental).** Switched on per person in Settings. In the iPhone app it follows named players through a recording made from a fixed camera behind a goal, finding people with YOLOX-S (Apache 2.0, bundled as `yolox_s.onnx` and run with ONNX Runtime) and reading shirt numbers with Apple's Vision, and gives each a heat map and distance. See `MatchVisionPlugin.swift`. It does not track the ball or the score.
- **Insights.** Match ratings out of 10 and a man of the match for every game, season form, player chemistry (how the team does while two players are on together, and who sets up whom), and when goals are scored and conceded. All of it is worked out from the logged stats; no AI model is involved.
- **Highlights.** Every event is timestamped. In the iPhone app a gaffer picks the GoPro or iPhone footage from their photos (one continuous video is best; one per half also works) and the phone cuts a clip per moment, each with the app's watermark and a caption, plus one joined reel that ends on an outro card. Each clip starts 8 seconds before its moment. The clips and the whole reel are uploaded for the whole team to watch: by game, the reel plays with its moments listed underneath (tap one to skip to it); by player, their clips one after another (oldest first); the full recording stays on the phone. With AI commentary each clip is kept with and without it, and anyone can switch it on or off. In the iPhone app anyone in the team can download a game's reel, or make a player's own reel (pick the clips, preview them, goals only, with an AI voice for the team's gaffers and players). The clips look like football on the telly: a score box with the crest and a ticking match clock, the scorer along the bottom, and a full-time card that ends with Gaffer and the App Store badge.
- **Profiles and following.** Everyone with an account picks a username (new accounts when they sign up; accounts from before get asked once when the app opens). A profile shows the player's teams, results, stats and up to three clips they choose, never their upcoming games. Each person picks public (anyone signed in can follow straight away) or private (they accept each follower). Teams can be found by name too, and tapped (from search or a profile) to see their squad, results and highlights, never their code, so joining still takes the code from the gaffer; a gaffer can switch this off in Options (on to start). People has search, follow requests, a feed of games played by people you follow (leaving out teams you're already in or follow), and report and block. Free for everyone.
- **Home, posts and your profile, like Instagram.** The bar along the bottom is Home, Team, Games, Chat and Profile. Home is a feed of moments posted by people you follow (and game cards of their goals); the + at the top posts one of your own highlight clips or player reels with a caption, the heart has follow requests and the magnifier finds people and teams. Posts can be liked, reported, or deleted by whoever posted them. Profile shows your posts in a grid, your followers, teams and stats, with Settings behind the gear; the tactics board and team settings are on the Team page. Everyone on your team is followed automatically (and follows you), tapping a name almost anywhere opens that person's profile, and posts can tag up to 10 people, which shows on their profile's Tagged tab (they can take themselves off).
- **Live streaming** (Gaffer tier, experimental). A gaffer streams the game through Cloudflare Stream for everyone following the team to watch in the app, with the score held back to match the picture. In the iPhone app, "Film with this iPhone" streams from the phone's own camera and records the whole game in full quality to Photos at the same time; a GoPro (through GoPro Quik) or another iPhone (through a streaming app such as Larix Broadcaster) can use the same camera link.

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
| `tests/` | Tests for the watch logic, the phone app, phone and watch together, and the database (see below) |
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

### Team pass: paying per team (one-time setup)

The Gaffer tier is paid for per team. In the iPhone app anyone on the team can **Pay for the month** (£4.99, 30 days for the whole team) or **Chip in** (69p, one player's share, so eight chip-ins make a month). Both are one-off purchases through Apple, never subscriptions. Gaffer's server (`supabase/functions/team-pass`) checks each one with Apple before it counts. Until the products below exist, the card (Team page, behind the Experimental switch) shows Apple's prices only once the App Store has them.

1. **Agreements.** App Store Connect → Business: sign the Paid Apps agreement and fill in bank and tax details (nothing can be sold until they're active). Then join the [App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/) so Apple takes 15%, not 30%.
2. **Make the two purchases.** App Store Connect → Gaffer → Monetization → In-App Purchases → + → **Non-Renewing Subscription**:
   - Reference name `Team pass: a month`, Product ID `com.randomedp.aipoweredtactics.team.month`, price £4.99, display name "Pay for the month", description "The Gaffer tier for your whole team for 30 days."
   - Reference name `Team pass: chip in`, Product ID `com.randomedp.aipoweredtactics.team.chip`, price £0.69, display name "Chip in", description "One player's share of the team's month: about 4 days."
   - Each needs a review screenshot (the Team page's "Gaffer for the team" card) and a line of review notes ("Pays for the Gaffer tier for the whole team; any team member can pay the month or chip in a share"). They go to review with the next app version.
3. **Make an In-App Purchase key** (so the server can ask Apple about purchases). App Store Connect → Users and Access → Integrations → In-App Purchase → +. Download the `.p8` (one chance only) and note its Key ID; the Issuer ID is the one on the App Store Connect API page. Add three Supabase Edge Function secrets (Project Settings → Edge Functions → Secrets), never in chat or the repo:
   - `IAP_KEY_ID`: the Key ID
   - `IAP_ISSUER_ID`: the Issuer ID
   - `IAP_KEY_P8`: the whole `.p8` file, including the BEGIN and END lines
4. **Database and function.** Apply `supabase/migrations/0032_team_pass.sql` and deploy `team-pass` (verify_jwt on).
5. **Try it on TestFlight.** TestFlight purchases are free (Apple's sandbox). Turn on Settings → Experimental, open the Team page, Chip in. A purchase made before step 3 or 4 is kept on the phone and counts by itself the next time Gaffer opens.

Sandbox purchases (TestFlight, and Apple's reviewers) count too, as Apple requires; each one is marked `environment = 'Sandbox'` in `pass_purchases`. `ios/App/App/Gaffer.storekit` describes the same two products for testing in Xcode on a Mac (Xcode purchases can't be checked by Apple, so the server turns them down with a reason).

## Android app (for players)

The Android app is the same web app in Capacitor's Android shell, cut down for players: the team, its highlights, the
polls for games and the squad chat. Nothing a gaffer does is in it, and it never changes the team.

- `android/` is the Android project. `npx cap sync android` copies the web app into it.
- `.github/workflows/android.yml` tests and builds it on every push. To try it: GitHub → Actions → Android → the latest
  run → Artifacts → `gaffer-android-<number>`, unzip it and open the `.apk` on the phone (Android asks to allow installs
  from that app the first time). Until the app has its Google Play upload key, each build is signed with a different
  throwaway key, so uninstall the old one first.
- Notifications come through Google's Firebase. Once, in the Firebase console: add Firebase to the Google Cloud project the
  AI voice uses, add an Android app `com.randomedp.aipoweredtactics`, download its `google-services.json` and paste it whole
  into the repository secret `GOOGLE_SERVICES_JSON`; then in Google Cloud → IAM, give the voice's service account the role
  "Firebase Cloud Messaging API Admin". Every Android build after that has notifications.
- Not yet: Google Play itself.

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
cd tests && npm ci && npx playwright install chromium   # once
node tests/run.mjs                                      # everything; needs swiftc on the path for the watch parts
node tests/run.mjs link                                 # just the suites whose name contains "link"
```

They also run on GitHub on every push, and a TestFlight build only goes ahead once they pass.

| What | Where | How it checks |
|---|---|---|
| The watch's decisions on their own | `tests/watch/main.swift` | Plays games through `ios/App/Watch/MatchLogic.swift` with a made-up clock and a phone that goes quiet, repeats itself or wakes up confused |
| Phone and watch together | `tests/link.test.mjs` | Whole games between the real phone app and the real watch logic over a stand-in for the link: phone frozen in a pocket, watch out of reach, the watch app restarted, clocks apart. Checked second by second |
| The phone's store of the watch's presses | `tests/plugin/main.swift` | The real plugin source built off-phone: every press kept on disk until the app has dealt with it, never twice, from several threads at once |
| The phone running a game | `tests/match.test.mjs`, `tests/watchlink.test.mjs` | Clock, changes that wait to be confirmed, injuries, whistles; presses from the watch arriving late, twice or out of order |
| Several phones on one team | `tests/sync.test.mjs`, `tests/join.test.mjs` | Gaffer, followers and a second gaffer, no signal, the app closed with changes not yet uploaded, signing out |
| The database | `tests/db.test.mjs` | Every migration loaded into a real Postgres in memory, then the functions and security rules used as a gaffer, a player, a stranger and someone not signed in. Elo sums included |
| Highlights | `tests/cuttiming.test.mjs`, `tests/reels.test.mjs` | Lining the video up from marked moments, the score box, clock and captions sent to the phone's video maker, commentary copies, reels anyone can make, putting a goal right afterwards (stats, and only that clip made again) |
| Clips in Cloudflare R2 | `tests/r2.test.mjs` | The real clip-store function: upload links signed as S3 checks them (Amazon's worked example), gaffers only and only the team's folder, old clips moved across with both copies before the old files go |
| Games among the squad | `tests/house.test.mjs` | Two sides with guests, goals for either side from the gaffer's and a teammate's phone, what's saved, the guests' link and what it opens |
| Profiles and following | `tests/people.test.mjs` | Usernames at sign-up and the pop-up for older accounts, names kept back, public and private profiles, requests, search, the feed (without your own teams' games), picking clips, report and block |
| Home, posts and the profile | `tests/posts.test.mjs` | The bottom bar (Home, Team, Games, Chat, Profile), posting your own clip or reel with a caption from Home's +, the feed, likes, reporting and deleting posts, the Instagram-style profile with its grid, and Settings behind the profile's gear |
| Signing in and making an account | `tests/signin.test.mjs` | Sign in and Create account are separate pages from the welcome screen; making an account moves on to Sign in; Forgot your password? sends a reset link, and the link opens a page to choose a new one |
| Deleting your account | `tests/account.test.mjs` | Settings (the gear on your profile, or Team settings) has Your account with Delete my account; two taps delete it, the phone is signed out and keeps nothing, a team you ran alone goes with it |
| Terms, the word filter, blocking and reports | `tests/safety.test.mjs` | A new account needs the Terms of use agreed; slurs, hate and threats are stopped everywhere and the strongest swearing in anything public, without stopping real names; Block in the chat; every report tells Gaffer straight away; AI commentary allowed or stopped in Settings |
| Teammates, names and tags | `tests/social.test.mjs` | Joining a squad follows everyone on it (and they follow you), names on the Team page, Stats, Insights, Highlights and chat open profiles, tagging people in a post, the Tagged tab, and taking yourself off a post |
| A game of just me | `tests/solo.test.mjs` | A game with no line-up or subs: goals for and against straight away, a goal from the watch, no notifications to the team, saved as a friendly outside the record |
| Whose highlight | `tests/hltag.test.mjs` | Marking a highlight asks whose (the outfield players on the pitch, or No one), timed from the tap; changing it later; a player taking a clip out of their own highlights, which stays in the game's, survives a re-cut and can be put back |
| App and database agree | `tests/contract.test.mjs` | Every function the app calls exists with those arguments; every row the app writes fits the real tables |
| Walk-throughs of each screen | `tests/*.mjs` (no `.test`) | Print what they see; compared with `tests/golden/`. After an intended change: `node tests/run.mjs --update` and read the diff |

`node tests/shots.mjs shots light` takes screenshots of every screen, for checking the design (serve the repo root on port 8766 first: `python3 -m http.server 8766`).

## Copyright

Copyright © 2026 Ethan Davison-Pearce. All rights reserved. The code is public only so the web app can be served from GitHub Pages; it is not open source. See [LICENSE](LICENSE).
