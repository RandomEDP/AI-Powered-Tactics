# CLAUDE.md: working on Gaffer

This file is the handover for any Claude session working in this repo. Read it all before changing anything.
The README covers the features, the one-time Apple setup and the test table in more detail. This file holds the
rules, the routine, how things fit together, and what's in flight.

**This repo is public** (GitHub Pages serves it at https://randomedp.github.io/AI-Powered-Tactics/). Nothing private
goes in it, this file included.

---

## 1. Who and what

- **Owner:** Ethan (GitHub `RandomEDP`). He is the gaffer (team admin) of his own 5-a-side team, Sons of Pitches FC
  ("SOP FC"). They have a purple kit and a crowned-eagle crest. The squad is 8 including the keeper, the keeper stays on,
  games are 2 × 15 min with 5-minute subs, and everyone should play about the same. The team uses the app every week.
  Games are filmed on a GoPro mounted on the cage, running through half time, and/or on phones.
- **The app:** "Gaffer: 5-a-Side Team Manager". It was called "AI Powered Tactics", which is why the repo, bundle ID and
  package names still say that.
  - It's an iPhone app (Capacitor wrapper), plus an Apple Watch companion, plus the same web app on GitHub Pages.
  - It's on TestFlight and has been submitted to App Store review.
- **Ethan has no Mac.** All iOS building, signing and uploading happens on GitHub Actions (macOS runners). Don't suggest
  Xcode steps he would have to do himself. Find a way through CI.
- **Monetisation plan:**
  - Free tier with ads: everything except highlights, with one free try of the highlights feature.
  - Paid "Gaffer" tier at £4.99/month (shown as coming soon): everything, plus AI voiceovers on reels.
  - Team Elo and leaderboards (play nearby teams).
  - Plans and coming-soon screens only show when the experimental switch is on.
- **Big ambitions:** AI insights, chemistry, ratings, man of the match (eventually from video), commentary for full games
  and highlights, and computer-vision player tracking.

## 2. Hard rules (never break these)

1. **No secrets in the repo or in chat. Ever.**
   - Secrets live only in GitHub repository secrets (Apple signing) or Supabase Edge Function secrets (APNs, Google).
   - If Ethan is about to paste a key into chat, stop him and point him at the right secrets page.
   - `config.js` holds only the Supabase URL and the **publishable** key, which are public by design. Never put a
     `service_role` / secret key or the database password anywhere in the repo.
2. **Team organiser codes never go in the repo.** That includes Sons of Pitches FC's own 10-character organiser code.
   Each team's organiser code lets anyone become a gaffer of that team. Follow codes (6 characters) are fine.
3. **Never use or store the App Store Connect key file `AuthKey_CPB27TYJU9.p8`.** Ethan was advised to revoke and replace
   it. The build uses the `ASC_*` repository secrets only.
4. **Never put Ethan's home address in anything:** drafts, documents, the privacy page, App Store text, or test data.
5. **Don't create accounts or type passwords for him.** For example, the App Store reviewer demo account is his to
   create.
6. **Google service-account JSON:** it goes into the Supabase secret `GOOGLE_SERVICE_ACCOUNT` by Ethan himself. Never ask
   for it in chat.
7. Personal or contact details for correspondence (Apple replies and so on) come from Ethan when needed. Don't commit
   them.

## 3. How Ethan wants the work done

- **Standing instruction: when you commit, also kick off a TestFlight build.** Don't wait for it to finish. Just say it
  was kicked off (the run number is the build number).
- **Fix things now, properly, and test them.** He prefers a real fix today over a note for later. Before match days he has
  said, more than once, "I CANNOT have any bugs on the watch or the phone app. I need them to sync perfectly."
  Treat watch/phone sync as safety-critical: add tests that prove it.
- **Lots of tests.** Every fix comes with a test that would have caught it. Run the relevant suites before committing,
  and the whole lot for anything touching sync, the watch link or the database.
- **Plain, friendly British English** in the UI, in messages to him, and in code comments.
  - No jargon in user-facing text.
  - Say exactly what went wrong and what to do. For example, an early voice error said "the key isn't allowed to use
    it", which hid the real cause; he wanted the specific reason.
- **Footage wording:** say "GoPro or phone footage". Recommend one continuous video, or at least one per half.
- Keep replies to him short: what changed, what to check on his phone, and that the TestFlight build was kicked off.
- When he reports a bug from a screenshot, reproduce it in a test first, then fix it.

## 4. The routine for every change

```bash
# 1. make the change (most app work is in index.html)
# 2. bump the service-worker cache name in sw.js, e.g. apt-v43 -> apt-v44 (any change to the web app needs this)
# 3. build the web app and sync it into the iOS project
npm run build:web && npx cap sync ios
# 4. test (see section 9); after an intended change to what a walk-through prints:
node tests/run.mjs <name> --update   # then read the golden diff in git
# 5. commit to main and push
git push origin HEAD:main
# 6. kick off TestFlight (standing instruction), don't wait
gh workflow run ios.yml -R RandomEDP/AI-Powered-Tactics --ref main -f testflight=true
```

- Work straight on `main` (that is how this repo has always been run). Commit messages are plain-English summaries,
  for example "Highlights from several cameras, each moment from the best one", with a body explaining why.
- **Supabase changes are not deployed by a push.** Migrations and edge functions have to be applied to the live
  project separately (section 7). Do it in the same piece of work, and keep the repo files identical to what's deployed.
- The push itself runs CI (tests, then an unsigned simulator build). The TestFlight run does the same, then signs and
  uploads. A failing `tests` job blocks the iOS job. Walk-throughs are only warnings on CI (`WALKS=warn`), because they
  run in real time.
- `ios/App/App/capacitor.config.json` (the native plugin list) is git-ignored and regenerated by `npx cap sync ios`
  locally and on CI. A new Capacitor plugin class in `plugins/reel-cutter` is picked up automatically.

## 5. Map of the code

| Path | What |
|---|---|
| `index.html` | The whole app (about 4,800 lines: HTML, CSS, JS in one file). Sections are marked `// ---- name` and `// ================= name`; grep for them |
| `config.js` | Supabase URL, publishable key, `siteUrl` for confirmation emails |
| `sw.js` | Offline cache. **Bump `CACHE` on every web change** |
| `privacy.html`, `support.html` | App Store pages (linked from the listing). The privacy page must cover any new data (it covers squad chat, for example) |
| `vendor/` | Bundled Supabase JS and fonts, so the app works with no signal |
| `scripts/build-web.mjs` | Copies the web files into `www/` for Capacitor (`www/` isn't committed) |
| `scripts/asc-certs.mjs` | CI helper: lists and revokes the dev certificate each signed build creates (Apple caps them) |
| `ios/App/App/` | iPhone app shell: `AppDelegate.swift`, `Info.plist`, entitlements, `whistle.wav` (notification sound, registered in `project.pbxproj` Resources) |
| `ios/App/Watch/` | Apple Watch app (SwiftUI). `MatchLogic.swift` is the pure, Codable "WatchBrain" with all the decisions; `ContentView.swift`, `MatchModel.swift` and `WatchApp.swift` are the UI and the WatchConnectivity glue |
| `plugins/reel-cutter/` | Local Capacitor plugin package (Swift). Several plugin classes live in it, listed in the next table |
| `supabase/migrations/` | `0001` … `0016`, **all applied to the live project**. New ones are numbered on from there |
| `supabase/functions/` | `team-notify` (all push notifications), `reel-voice` (AI commentary), `game-started` (old kick-off-only push, kept for old builds; the current app doesn't call it) |
| `supabase/seed_sons_of_pitches.sql` | One-off import of the original team (already run) |
| `.github/workflows/ios.yml` | Tests, then the build check and the TestFlight upload (`-f testflight=true`; `-f force=true` builds even if tests fail, for emergencies only) |
| `.github/workflows/watch-shots.yml` | Takes Apple Watch App Store screenshots in a simulator (run by hand) |
| `store/`, `shots/` | App Store listing material and screenshots |
| `tests/` | Section 9 |

The plugin classes in `plugins/reel-cutter/ios/Sources/ReelCutterPlugin/`:

| Class | What it does |
|---|---|
| `ReelCutterPlugin` | `pickVideo({slot})`, `cut({clips:[{path,start,dur,caption,file,voice,voiceAt}], …})`, `share`, `cleanup`. Uses AVFoundation, a watermark, captions and an outro card. Footage from different cameras is turned upright and fitted to one frame |
| `WatchLinkPlugin` | The phone side of the watch link. It keeps a durable inbox of watch presses (UserDefaults `watchlink.inbox`), `push({state, seen})` and `pending()` |
| `ChatQuietPlugin` | Wraps the push notification handler so the open team chat's messages arrive without banner or sound. JS calls it as `ChatQuiet.quiet({code})` from `renderTabs()` via `chatQuiet()` |
| `GameCalendarPlugin` | The "add to calendar" sheet |
| `MatchVisionPlugin` | Experimental player tracking (YOLOX-S onnx plus Vision, reading shirt numbers) |

**Identifiers:**
- Bundle ID: `com.randomedp.aipoweredtactics`. That is also the APNs topic.
- Supabase project ref: `kvefpqigpqprxfelesrb`.
- Clips storage bucket: `clips` (public read).

## 6. How the important parts work

### Data and sync between phones
- A team lives in Supabase. Each phone also keeps a local copy (`localStorage` `apt-app`, `apt-team-<code>`), so the app
  works offline at the pitch.
- **Gaffers write.** Changes go up a moment after each edit, and only the parts that changed (`save()` → `syncAll()`).
  The live game is upserted into `live_matches`.
- **Everyone else reads.**
  - A Supabase Realtime broadcast channel `team:<code>` carries only "something changed" signals: `changed`,
    `kickoff`, `goal`, `chat`. Clients then re-read through RPCs such as `get_team(code)`.
  - **Nothing is peer-to-peer.**
- **Followers logging goals:** they go through `queue_goal` into `goal_queue`, and the gaffer's app folds them in.
  The score locks on every phone for 8 s after a goal, so a goal is never counted twice.
- **A second gaffer's stale phone must never undo the game:**
  - Time-up (`etKey`) is not saved to the team.
  - On wake, `awake()` marks the phone `stale` and pulls before any save. `pullGoals` is skipped while stale.
  - Tests for this are in `sync.test.mjs` and `link.test.mjs`. Don't weaken them.

### Phone ↔ Apple Watch
- The watch's brain is `ios/App/Watch/MatchLogic.swift`: pure and persisted, so it survives restarts.
- **Phone → watch:** the phone's state carries `gid` (game id) and `acks` (watch presses the phone has dealt with).
- **Watch → phone (presses):** start, end, resume, subs, goal, hl. Each press carries `id`, `at`, `gid` and
  `to`/`from`.
  - The watch shows its own claim on top until the phone acks the press.
  - It resends every 30 s and gives up after 3 h.
- **On the phone:**
  - `WatchLinkPlugin` keeps every press on disk until the web app says it's been dealt with.
  - JS `watchKeep`/`watchDrain` apply presses in `at` order, never twice.
  - `watchFetch` runs on wake and every 5 s.
- The watch buzzes for subs by its own clock. Changes wait for the gaffer to confirm (the subs pop-up on the phone and
  the watch).
- This is the most safety-critical code in the app. Any change needs `node tests/run.mjs watch link plugin match
  watchlink sync` to pass.

### Push notifications
- They are sent by the `team-notify` edge function using an APNs JWT. Secrets: `APNS_KEY_P8`, `APNS_KEY_ID`,
  `APPLE_TEAM_ID`.
- **Kinds:** kickoff, goal, poll, highlights, nudge (only to players who haven't answered the poll), claimed, chat,
  challenge, join.
  - The function writes the wording for claimed, chat, challenge and join itself; the others come from the caller.
- **Sound:** the payload uses `whistle.wav` (a synthesised referee's pea whistle bundled in the app) for everything
  except chat, which uses `default`. Phones on builds without the file fall back to the default sound.
  - Lock-screen game alerts (`syncAlerts`, LocalNotifications) also use `whistle.wav`.
  - The watch's own alerts are haptics.
- **When notifications are off:** `pushCheck`/`pushOff` unregister the phone (delete its `push_tokens` row) if
  notifications are switched off in iOS Settings, so the nudge count stays honest.
  - The nudge response returns `people` and `sent`, and the UI shows a red mark next to players with no phone.
- **Chat:** while a team's chat is open on screen, its chat pushes are silent (`ChatQuietPlugin`). The app still
  receives them and pulls the message in.
- **Tapping a notification** routes by kind: chat → chat, challenge → rivals, poll/nudge → games, highlights →
  highlights, join → home.

### Ask to join (`0016_join_requests.sql`)
- Someone with the team code whose name isn't in the squad still makes an account and fills in their details.
  `request_join` creates a pending request, and `team-notify` kind `join` tells the gaffers once per request.
- Gaffers see the requests on Home (`#askCard`, `renderAsks`) with or without the notification, and allow or deny them
  with `decide_join`. Allowing one adds a player that is already linked to that account.
- Someone who was denied can't ask again for 7 days.

### Highlights (cut on the phone)
- Every logged event is timestamped. Cutting is gaffer-only and needs the iPhone app.
- **The flow:**
  1. The gaffer marks on a pitch drawing where each camera stood (up to 4, draggable). The positions are remembered per
     team in `localStorage` `apt-cams:<code>`.
  2. They pick each camera's video, from Photos, with an optional separate second-half video.
  3. They confirm each camera's kick-off time, which is auto-guessed from the recording's creation time.
  4. The phone cuts.
- **Which camera each moment comes from:**
  - our goals: nearest the opposition goal;
  - goals against: nearest our goal;
  - saves: nearest our goal;
  - other highlights: nearest the opposition goal;
  - with "Teams swapped ends at half time" ticked (the default), second-half moments flip ends;
  - a camera whose video doesn't cover the moment is passed over for the next nearest.
  - The code is `cutPlan`, `camOrder` and `camSeg` in `index.html`.
- **Slots:** camera `id` uses `pickVideo` slots `id*2+1` (main) and `id*2+2` (second half).
- **Output:** one clip per moment, uploaded to the `clips` bucket and the `clips` table, plus a joined reel with an
  outro card that stays on the phone for sharing.
- On a computer, the same screen writes an ffmpeg script instead (`reelScript`). That path is single-video.

### AI commentary (experimental, behind the experimental switch `A.exp.track`)
- `reel-voice` edge function. Each team has a monthly character allowance in `voice_usage` (40,000).
- **Engines:**
  - "Live commentator" uses Gemini TTS (`gemini-2.5-flash-tts`). It needs the `GOOGLE_SERVICE_ACCOUNT` secret: the
    whole JSON key of a service account with the **Vertex AI User** role. Plain API keys are refused for this model.
  - "Read it straight" uses Chirp 3 HD with `GOOGLE_TTS_KEY`.
  - If the performed line fails, the function falls back to Chirp and returns a plain-English `note` saying why.
- Ethan funds the Google usage himself.

### Other features (all in `index.html`)
- Polls, the Games screen, game modes and tournaments, and the minutes planner (Aggressive ↔ Fairness).
- Injuries and leaving, insights (ratings, MOTM, chemistry), and squad chat.
- Rivals: home grounds, nearby teams, challenges and Elo.
- Tactics board (self-contained, phone-only).
- Player tracking (experimental, phone-only results), shirt numbers, and the intro swipe-through.

## 7. Supabase (live project `kvefpqigpqprxfelesrb`)

- **Migrations:** `0001`–`0016` are applied live. Add new ones as `supabase/migrations/0017_<name>.sql` and apply them to
  the live project in the same piece of work. Use the Supabase MCP server's `apply_migration` if it's connected, or the
  dashboard SQL editor, or `supabase db push` with the CLI linked to the project.
  - Every new table gets RLS.
  - Functions are `security definer` with `set search_path = ''`, and their grants are revoked from public and anon.
    Follow the patterns in the existing files.
- **Edge functions:** all three are deployed with **verify_jwt = true**. Deploy with the Supabase MCP
  `deploy_edge_function`, or with the CLI:
  `supabase functions deploy team-notify --project-ref kvefpqigpqprxfelesrb`.
  - Deployed now: `team-notify` v12 (whistle sound; same as the repo), `reel-voice` v7, `game-started` v6 (old).
  - Keep the repo copy identical to what's deployed. If you change one locally, deploy it, and don't leave local edits
    you haven't deployed.
- **Edge Function secrets (names only):** `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `GOOGLE_TTS_KEY`,
  `GOOGLE_SERVICE_ACCOUNT` (Ethan is setting this one up).
- **GitHub repository secrets:** `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`.
- **Auth:** email and password. Site URL and redirect go to the GitHub Pages address.
- **Any Google API key used by `reel-voice`** is server-side. Don't give it an iOS-app restriction (requests come from
  Supabase, not the phone). Restrict it by API instead.

## 8. Apple / App Store

- **App Store review:**
  - The name is "Gaffer: 5-a-Side Team Manager".
  - Apple asked for information under Guideline 2.1; a reply was drafted and Ethan has dealt with it.
  - The reviewer demo account is his.
- **Version and build:** the marketing version comes from `package.json` `version`. The build number is the GitHub
  Actions run number.
- **Builds:**
  - 86/87: match-day sync fixes and the notifications-off nudge fix.
  - 88: ask to join.
  - 95: whistle and quiet chat.
  - 97: multi-camera highlights.
  - All recent runs passed.
- **Watch app install problems:** the TestFlight job prints the watch app's Info.plist and architectures from the
  archive. Look there first.

## 9. Tests

```bash
cd tests && npm ci && npx playwright install chromium   # once
node tests/run.mjs                    # everything (about 15-20 min)
node tests/run.mjs link sync          # only suites whose name contains these words
node tests/run.mjs video --update     # accept a walk-through's new output, then review the golden diff
```

- **Three kinds of test:**
  1. Swift checks:
     - `tests/watch/main.swift` plays whole games through the real `MatchLogic.swift`.
     - `tests/plugin/main.swift` runs the real `WatchLinkPlugin.swift`, built off-phone against stand-ins in
       `tests/plugin/stubs.swift`.
     - `tests/plugin/quiet/` does the same for `ChatQuietPlugin.swift`.
  2. `*.test.mjs` suites that check as they go:
     - `link` (phone + watch whole games over a bad link), `sync`, `db`, `contract`, `join`, `match`, `watchlink`.
     - `db.test.mjs` loads every migration into PGlite (real Postgres in memory) via `tests/pg.mjs`.
     - `contract.test.mjs` checks that every RPC and insert the app makes matches the real schema.
  3. Walk-throughs (`tests/*.mjs` without `.test`) print what they see and are compared with `tests/golden/*.txt`.
     - `tests/pinned.mjs` freezes the clock at 2026-10-10 17:00 London.
     - `run.mjs` masks times and ids before comparing.
- **Swift:** the Swift parts need `swiftc` (5.9+). On a machine without it they are skipped loudly; set
  `ALLOW_NO_SWIFT=1` to not fail the run. CI (ubuntu) always runs them.
- **Chromium:** the tests use `/opt/pw-browsers/chromium` if it exists, otherwise Playwright's own Chromium, or the
  `CHROMIUM` env var.
- **Supabase mock:** `tests/mock-supabase.js` stands in for supabase-js in the walk-throughs. When you add an RPC, add it
  there too (`contract.test.mjs` will tell you).
- **Screenshots:** `node tests/shots.mjs <outdir> light` with the repo root served on port 8766
  (`python -m http.server 8766`). Individual walk-throughs take an output dir too, e.g. `node tests/video.mjs out/`.
  **Look at the screenshots** after any UI change.

## 10. Gotchas learned the hard way

- Don't `pkill -f` a pattern that also matches your own shell command (it killed the session once).
- Walk-throughs run in real time and can print a value a second out. CI treats them as warnings for that reason. Locally,
  rerun before believing a one-second diff.
- Squad sizes and other numbers in tests change when features add players or rows. Update the expectations
  deliberately, not blindly.
- A new Capacitor plugin class needs no manual registration (cap sync finds it), but the JS side should treat it as
  possibly missing. `plugin(name)` returns null off-native.
- Notification presentation in the foreground comes from `capacitor.config.json` `PushNotifications.presentationOptions`.
  `ChatQuietPlugin` sits in front of the push plugin's handler; keep forwarding `willPresent`/`didReceive` to it.
- Custom notification sounds must be bundled in the app (wav/caf/aiff, under 30 s) and named in `aps.sound`.
- AVFoundation reel joining:
  - all segments go into one composition track;
  - when the cameras differ, `ReelCutterPlugin.export` sets per-segment layer transforms (`fit`, `upright`);
  - the video composition instruction must cover the whole composition duration.
- The Linux test environment can't compile anything that imports UIKit or AVFoundation. The only compile check for that
  is CI's "Check it builds" step, so read its output after pushing native changes.

## 11. In flight / next up

- **Check on a real phone (build 95 onwards):**
  - chat messages are silent while that chat is open;
  - the whistle plays for nudges, polls, goals and kick-off;
  - a reel cut from two different cameras (for example a GoPro and an iPhone) joins cleanly.
- **Voice:** Ethan is setting up the Google service account (Vertex AI User) and the `GOOGLE_SERVICE_ACCOUNT` secret.
  Then "Hear this voice" should say "Playing." rather than falling back to read-it-straight.
- **Ideas he has raised but not built yet:**
  - ads in the free tier and the £4.99 Gaffer subscription (in-app purchase);
  - MOTM and ratings from video;
  - full-game commentary;
  - a leaderboard for team Elo by area.
