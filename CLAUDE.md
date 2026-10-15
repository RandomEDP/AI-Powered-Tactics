# CLAUDE.md: working on Gaffer

This file is the handover for any Claude session working in this repo. Read it all before changing anything.
The README covers the features, the one-time Apple setup and the test table in more detail. This file holds the
rules, the routine, how things fit together, and what's in flight.

**This repo is public** (GitHub Pages serves it at https://randomedp.github.io/AI-Powered-Tactics/). Nothing private
goes in it, this file included.

---

## 1. Who and what

- **Owner:** Ethan (GitHub `RandomEDP`). He is the gaffer (team admin) of his own small-sided (5-a-side) team, Sons of Pitches FC
  ("SOP FC"). They have a purple kit and a crowned-eagle crest. The squad is 8 including the keeper, the keeper stays on,
  games are 2 × 15 min with 5-minute subs, and everyone should play about the same. The team uses the app every week.
  Games are filmed on a GoPro mounted on the cage, running through half time, and/or on phones.
- **The app:** "Gaffer: Small-Sided Football" (`APP_NAME` near the top of the script in `index.html`, also passed to the
  reels' end card as `outro.app`). Never call it a "5-a-side" app (Ethan, October 2026; `tests/wording.test.mjs` checks):
  "5-a-side" only names the game format. Before that it was "Gaffer: 5-a-Side Team Manager", and before that it was called "AI Powered Tactics", which is why the repo, bundle ID and
  package names still say that.
  - It's an iPhone app (Capacitor wrapper), plus an Apple Watch companion, plus the same web app on GitHub Pages.
  - It's on TestFlight and has been submitted to App Store review.
  - There's also an **Android app for players** (chat, polls and highlights, nothing a gaffer does), from the same
    `index.html` in Capacitor's Android shell. Not on Google Play yet (see "The Android app" in section 6).
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
- **Footage wording:** say "GoPro or iPhone footage". Recommend one continuous video, or at least one per half.
- **Every time GoPro is mentioned, say an iPhone works too** (Ethan's rule), in the app, the store pictures, the pages and
  messages to him. `tests/wording.test.mjs` checks the app, the store text and the pages for it. Streaming from an iPhone
  is through a free RTMP app such as Larix Broadcaster with the same camera link; Gaffer also streams from the
  iPhone's own camera ("Film with this iPhone").
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
- Every push also builds the Android app (`android.yml`: the `android` tests, then an `.apk` and `.aab` kept as the run's
  artifacts). Nothing to kick off by hand for it.
- `ios/App/App/capacitor.config.json` (the native plugin list) is git-ignored and regenerated by `npx cap sync ios`
  locally and on CI. A new Capacitor plugin class in `plugins/reel-cutter` is picked up automatically.

## 5. Map of the code

| Path | What |
|---|---|
| `index.html` | The whole app (about 6,800 lines: HTML, CSS, JS in one file). Sections are marked `// ---- name` and `// ================= name`; grep for them |
| `config.js` | Supabase URL, publishable key, `siteUrl` for confirmation emails |
| `sw.js` | Offline cache. **Bump `CACHE` on every web change** |
| `privacy.html`, `support.html` | App Store pages (linked from the listing). The privacy page must cover any new data (it covers squad chat, for example) |
| `vendor/` | Bundled Supabase JS and fonts, so the app works with no signal |
| `scripts/build-web.mjs` | Copies the web files into `www/` for Capacitor (`www/` isn't committed) |
| `scripts/asc-certs.mjs` | CI helper: lists and revokes the dev certificate each signed build creates (Apple caps them) |
| `ios/App/App/` | iPhone app shell: `AppDelegate.swift`, `Info.plist`, entitlements, `whistle.wav` (notification sound, registered in `project.pbxproj` Resources), `PhoneHighlight*.swift` ("Mark a highlight" in the iPhone's Shortcuts app) |
| `ios/App/Watch/` | Apple Watch app (SwiftUI). `MatchLogic.swift` is the pure, Codable "WatchBrain" with all the decisions; `ContentView.swift`, `MatchModel.swift` and `WatchApp.swift` are the UI and the WatchConnectivity glue; `HighlightIntent.swift` is the "Mark a highlight" App Intent (Action button, Siri, Shortcuts) |
| `plugins/reel-cutter/` | Local Capacitor plugin package (Swift). Several plugin classes live in it, listed in the next table |
| `supabase/migrations/` | `0001` … `0031` are applied to the live project; `0032` (rewarded ads) is waiting for Ethan's go-ahead. New ones are numbered on from there |
| `supabase/functions/` | `team-notify` (all push notifications), `reel-voice` (AI commentary), `live-stream` (live streaming through Cloudflare), `clip-store` (highlight clips in Cloudflare R2), `ad-reward` (AdMob's signed call when a rewarded ad was watched; not deployed yet), `game-started` (old kick-off-only push, kept for old builds; the current app doesn't call it) |
| `supabase/seed_sons_of_pitches.sql` | One-off import of the original team (already run) |
| `.github/workflows/ios.yml` | Tests, then the build check and the TestFlight upload (`-f testflight=true`; `-f force=true` builds even if tests fail, for emergencies only) |
| `.github/workflows/android.yml` | Every push: the `android` tests, then builds the Android app (`.apk` to install, `.aab` for Google Play) as the run's artifacts. Run by hand with "Upload to Google Play" for the internal testing track (needs the Android secrets, section 7) |
| `android/` | The Android app shell (Capacitor). `MainActivity.java` (the back button), icons and splash in `app/src/main/res`, signing and version in `app/build.gradle`. `app/src/main/assets/public` is git-ignored and filled by `npx cap sync android` |
| `.github/workflows/store-text.yml` | "Update App Store text and pictures" (run by hand): sends `store/text/*.txt` (name, subtitle, description, keywords, promotional text) to App Store Connect through `scripts/asc-text.mjs` with the `ASC_*` secrets; with "Pictures too" ticked, `scripts/asc-shots.mjs` also replaces the 6.9" iPhone pictures with `store/6 iPhone (6.9 inch)` (only on a version that can still be edited; new ones go up before the old ones are deleted). Unticked "Send it" only shows what would change. Tests: `storetext.test.mjs`, `storeshots.test.mjs` |
| `.github/workflows/watch-shots.yml` | Takes Apple Watch App Store screenshots in a simulator (run by hand) |
| `store/` | App Store pictures, in the folders App Store Connect wants, plus social pictures in `5 Social` (squares, stories, a wide one). `node store/capture.mjs` plays SOP FC 15–2 Dog Squad through the test harness and takes the redesigned app's screens (402×874 @3×, dark mode), then `node store/compose.mjs` lays them all out in the purple style. `store/src/footage/` holds stills from that game's real highlights (the score box and GOAL bar are Gaffer's own); the screens' videos show them. Nothing behind the Experimental switch goes in |
| `shots/` | Raw screenshots from `tests/shots.mjs`, for checking the design |
| `tests/` | Section 9 |

The plugin classes in `plugins/reel-cutter/ios/Sources/ReelCutterPlugin/`:

| Class | What it does |
|---|---|
| `ReelCutterPlugin` | `pickVideo({slot})`, `cut({clips:[{path,start,dur,caption,file,voice,voiceAt,bug,lower}], look, outro, …})`, `joinReel`, `share`, `shareText({text,url})`, `cleanup`. Uses AVFoundation. Footage from different cameras is turned upright and fitted to one frame. The graphics are in `ReelGraphics.swift` (see Highlights) |
| `WatchLinkPlugin` | The phone side of the watch link. It keeps a durable inbox of watch presses (UserDefaults `watchlink.inbox`), `push({state, seen})` and `pending()` |
| `ChatQuietPlugin` | Wraps the push notification handler so the open team chat's messages arrive without banner or sound, and so do the team's goals while its live stream is on screen. JS calls it as `ChatQuiet.quiet({code, live})` from `renderTabs()`/`renderLive()` via `chatQuiet()` |
| `GameCalendarPlugin` | The "add to calendar" sheet |
| `MatchVisionPlugin` | Experimental player tracking (YOLOX-S onnx plus Vision, reading shirt numbers) |
| `LiveCamPlugin` | "Film with this iPhone": `start({url,title})`, `show()`, `stop()`, `state()`, event `state`. Streams the iPhone's camera over RTMPS to the camera link (HaishinKit 2.2.5, 720p ~2.5 Mbps, adaptive) and records 1080p HEVC to Photos at the same time (`CamRecorder`, its own AVAssetWriter, stamped with the start time). Native full-screen `CamScreen`, laid out for a phone on its side (the app stays portrait; the screen turns its contents by the accelerometer) |

**Identifiers:**
- Bundle ID: `com.randomedp.aipoweredtactics`. That is also the APNs topic.
- Supabase project ref: `kvefpqigpqprxfelesrb`.
- Clips: Cloudflare R2 bucket `gaffer-clips`, played from its public address (`config.js` `clipsUrl`, an r2.dev address).
  The old Supabase bucket `clips` (public read) only holds clips not yet moved across.

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
- **Action button / Siri:** `MarkHighlightIntent` (`HighlightIntent.swift`) runs `MatchModel.shared.highlightFromButton()`, which can
  run with the app closed: it waits up to 5 s for WatchConnectivity, presses through the same brain, and sends the press
  both by `sendMessage` and `transferUserInfo`; the phone deals with each press id once (`watchSeen`, kept across restarts).
  What it says back comes from `WatchBrain.highlightSaid` (tested in `tests/watch/main.swift`).
- **The iPhone has "Mark a highlight" too** (`ios/App/App/PhoneHighlightIntent.swift`, logic in `PhoneHighlight.swift`).
  The Action button's Shortcut list only offers shortcuts from the user's Shortcuts library, and those are made on the
  iPhone from iPhone apps' actions, so a watch-only intent never shows there (Ethan found this). Run from the watch, iOS
  runs it on the iPhone. It makes the same `hl` press from `watchlink.latest` (the last state sent to the watch) and posts
  `gaffer.phonePress`; `WatchLinkPlugin` takes it like a watch press, or, if the app was started just for the shortcut,
  it goes straight into `watchlink.inbox`. Tested in `tests/plugin/main.swift`.
  Setting it up: Shortcuts app → Gaffer → "Mark a highlight" → add it to My Shortcuts, with "Show on Apple Watch" on;
  then Watch app → Action Button → Shortcut → pick it.
- The watch buzzes for subs by its own clock. Changes wait for the gaffer to confirm (the subs pop-up on the phone and
  the watch).
- **Match-day timing** (Ethan, after a real game where the ref called changes early and halves weren't exactly 15):
  - **The 30 seconds before a change** (`subSoon`, `SOON_MS`; watch `MatchState.changeSoon`): the change is picked out
    (`#swapCard.soon`, "Subs coming up at 5:00"; on the watch "Subs coming up") with Subs done, and a light tap, no alarm.
    Subs done then makes it early: `m.ok` is set to the coming block, and `curSeg` treats `m.ok > clockSeg` (same half) as
    the block being played, so nothing is asked at the minute. An early Subs done from the watch is taken the same way
    (the `subs` press when `subSoon` matches its change). The watch's `pressSubsDone` allows it in that window too.
    `takeOut` keeps an early change (`Math.max(m.ok, clockSeg)`).
  - **The bench at kick-off**: a sheet before kick-off (`#benchSheet`, `renderBench`, once a game, `m.benchSeen`) with who
    starts on the bench, who's in goal and the first change; Got it or Kick off closes it. It sits over the dock, clear of
    Kick off. The watch's glance shows "Bench: …" before kick-off (`MatchState.benchNames`).
  - **A goal is timed from the tap on Goal** (`pick.at` → `stampAt`/`addGoal(ev, at)`; followers' `ts`; the watch's
    `goalTapped()`/`pressGoal(at:)`, believed for two minutes), not from when the scorer was picked.
  - **Undo of a goal unlocks the score** straight away (`lockUntil = 0`), so the right goal can go in.
  - Tests: `matchday.test.mjs`, `tests/watch/main.swift` (27).
- This is the most safety-critical code in the app. Any change needs `node tests/run.mjs watch link plugin match
  watchlink sync` to pass.

### Push notifications
- They are sent by the `team-notify` edge function using an APNs JWT. Secrets: `APNS_KEY_P8`, `APNS_KEY_ID`,
  `APPLE_TEAM_ID`.
- **Kinds:** kickoff, goal, poll, highlights, nudge (only to players who haven't answered the poll), claimed, chat,
  challenge, join, live, report (to Gaffer's moderators, see "Looking after what people share").
  - The function writes the wording for claimed, chat, challenge, join and live itself; the others come from the caller.
- **Sound:** the payload uses `whistle.wav` (a synthesised referee's pea whistle bundled in the app) for everything
  except chat, which uses `default`. Phones on builds without the file fall back to the default sound.
  - Lock-screen game alerts (`syncAlerts`, LocalNotifications) also use `whistle.wav`.
  - The watch's own alerts are haptics.
- **Turning them on:** iOS only lists Gaffer under Settings → Notifications once the app has asked. Settings in Gaffer
  always has a Notifications section (`renderNotes`, `#ntfSec`) saying where things stand, with "Turn on notifications"
  that has iOS ask there and then, or, if they were refused, exactly where in iOS Settings to switch them on. Josh
  couldn't before (he'd said "Not now" to the pop-up). Test: `notify.test.mjs`.
- **When notifications are off:** `pushCheck`/`pushOff` unregister the phone (delete its `push_tokens` row) if
  notifications are switched off in iOS Settings, so the nudge count stays honest.
  - The nudge response returns `people` and `sent`, and the UI shows a red mark next to players with no phone.
- **Chat:** while a team's chat is open on screen, its chat pushes are silent (`ChatQuietPlugin`). The app still
  receives them and pulls the message in.
- **Tapping a notification** routes by kind: chat → chat, challenge → rivals, poll/nudge → games, highlights →
  highlights, join → home, live → the stream.

### Signing in and making an account (two pages; Ethan asked)
- The welcome screen's Account card has **Sign in** (`#acctBtn`) and **Create account** (`#acctNew`); Create a team when
  signed out opens Create account. Both are the one `v-account` view in a mode (`AM`, `acctOpen(mode)`, `renderAccount`):
  `in` (email, password, Sign in, Forgot your password?), `up` (email, password, username, the terms box, Create account),
  `forgot` (email, Send me a reset link: `resetPasswordForEmail`, back to the website) and `new` (choose a new password,
  `updateUser({password})`). Opening the reset link signs them in for it and Supabase says `PASSWORD_RECOVERY`, which
  opens `new`. After making an account (email still to confirm) it moves on to Sign in with the email kept.
- The reset email is Supabase's own template and goes out through Supabase's mail, which has a small hourly limit on the
  free plan (shared with confirmation emails). Tests: `signin.test.mjs`; the mock has `resetPasswordForEmail` and
  `window.__recover(email)` for the link being opened.
- **Signing back in** (Ethan: it asked him to make a team when he already had one): signing out leaves no teams on the
  phone, so until `my_teams` answers the welcome screen says "Getting your teams…" (`#wLoad`, `myTeamsBusy`) instead of
  showing Got a team code? and Start a team (`#wJoin`, `#wStart`); then the account's teams come first, under "Your
  teams" (`#wLead`). Test: `signback.test.mjs` (it holds `my_teams` back to see the screen in the meantime).

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
  3. **Line up the video** (one camera at a time, tabs if several): the list has kick-off, the second-half kick-off and
     every moment. The gaffer picks one, drags the video (`#cutPrev`, through `convertFileSrc`) to it (a goal: when the
     ball hits the net) and taps "It happens here"; the next unmarked one is picked. `k.marks` ('ko', 'h2', 'e:<at>' →
     seconds in its video). `camAt` works out every moment: kick-off sets the first half's clock and the second-half
     kick-off the second's (they differ if the recording paused, or the second half is its own video); until marked, the
     recording's start time stands in (`sync`/`sync2`). Marked moments give how late moments were logged (the middle
     value, same half first), applied to every moment not marked; a marked moment is used exactly. A mark more than a
     minute from where the others put it is questioned; Clear removes one. Ethan asked for this after his first real
     cut came out late. `cuttiming.test.mjs` covers it.
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
  outro card that stays on the phone for sharing. The reel is joined from the finished clips (their watermark, captions
  and commentary already in; `Segment.voiced`), not cut again from the game's video, which was slow enough to look stuck.
  An export that makes no progress for 3 minutes is stopped; if the reel fails the clips are still uploaded and the done
  screen says why (`reelError`).
- **Reading the video:** with full Photos access (asked once, before the picker) the picked video is used where it is in
  the library (`inPlace`, `PHImageManager`, the version as it looks in Photos, else the original), so nothing is copied;
  otherwise it's copied into the working folder as before.
  iOS only lets the app read such a file while Photos' own `AVURLAsset` for it is kept, so the plugin keeps it
  (`picked`, by path) and the cut uses that asset. Letting go of it gave Ethan "That file has no video in it" after the
  commentary had been recorded (build 128). Before cutting, JS asks `readable({paths})` and, if a video can't be opened,
  says to choose it again (Change video keeps the marks when it's the same video, `sameVideo`) without recording anything.
- **Timing:** each clip runs from `PRE` (8 s) before its moment to `POST` (6 s) after (Ethan cut it from 15 s before).
- **Size:** every clip is re-encoded to about 2 Mbps H.264 after export (`shrink`).
- **Where clips live: Cloudflare R2** (`0021_clips_in_r2.sql`, `clip-store`). The Supabase free plan's 1 GB of storage
  and 5 GB a month of downloads were filling up; R2 is free to 10 GB and free to watch. The cut asks `clip-store` for
  upload links (`upload {paths}`: presigned S3 PUTs, an hour each, only in the team's folder, gaffers only) and the phone
  PUTs each file straight to R2; rows get `store: 'r2'`, and `clipUrl` plays them from `CFG.clipsUrl`. If R2 isn't set up
  (`reason: 'not_configured'`) or refuses a file, that clip goes to the old Supabase bucket instead and the done screen
  says so. Clips cut before R2 are moved by the gaffer's app by itself (`clipsMove`, after a pull: `adopt {game_id, seq}`,
  one at a time, each once a session): the function copies both files to R2, marks the row, and only then deletes the
  old files. Deleting a game's highlights calls `remove`. Secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (plus `CLOUDFLARE_ACCOUNT_ID`). The bucket's CORS allows GET/PUT/HEAD from anywhere (uploads come from the app's web
  view). Tests: `r2.test.mjs` (the real function; its signing is checked against Amazon's worked example), and
  `cuttiming`, `reels`, `house` for the app.
- **Commentary** (in the highlight maker for gaffers, `hasGaffer()`; no longer experimental): an iPhone won't play a
  second sound over a video, so a clip cut with commentary is kept twice: `path` without it and `vpath` (`<nn>v.mp4`,
  `0019_clip_commentary.sql`) with it. "Commentary on/off" (`sayOn`, `apt-say` per phone) swaps which copy plays
  (`clipSrc`). The phone never speaks over a clip itself.
- **Graphics, as on the telly** (`ReelGraphics.swift`, Core Animation layers drawn onto each clip): a score box top left
  (crest on the team colour, short names from `abbr`, the score, which changes as the ball goes in, and the match clock
  ticking a second at a time, carrying on through the second half), a bar along the bottom ("GOAL", the scorer, the minute
  and who set it up) that slides in just after the moment, Gaffer's mark top right, and the end card (kicker "FULL TIME",
  the result, the crest, then Gaffer's icon, the app's name (`outro.app`) and a "Download on the App Store" badge drawn
  with the phone's Apple logo symbol). JS works out each clip's `bug {clock, us, them, changes}` and `lower {at, tag, title,
  sub}` in `clipLook`; the clock comes from the video once kick-off is marked (`cutPlan` sets `c.clock`). The cut screen
  shows the same design in HTML ("How the clips look", `lookPreview`) with a switch for the score box (`CUT.bug`). The app
  icon is read from the bundled web files (`public/icons`). Only the per-clip export draws the score box and bar; reels
  are joined from finished clips, so nothing is drawn twice. The Swift can be type-checked off-Mac against stand-ins for
  UIKit (see section 10).
- **Whose highlight** (Ethan asked): "Mark a highlight" on the phone stamps the moment at the tap, then asks "Whose
  highlight?" with the outfield players on the pitch (in a game among the squad, everyone on it) and No one (`hlCands`,
  `pick.step 'hl'`). Closing it leaves the highlight under nobody; a highlight in the game's list can be tapped to change
  whose it is (`data-hlwho`), e.g. one marked on the watch. The watch does the same: Highlight → "Whose highlight?"
  (`HighlightList`), timed from the tap; the press carries `pick: true` and `p` (none for No one). The Action button can't
  ask, so it sends neither and the phone puts it under the wearer as before. Keeper save stays its own button.
  Tests: `hltag.test.mjs`, `watchlink.test.mjs`, `tests/watch/main.swift` (22c).
- **Remove from my highlights** (`0022_remove_from_my_highlights.sql`): on their own card (Highlights → By player), a
  claimed player can take the clip they're watching out from under their name (`hideClips`, RPC `hide_clip`). The clip
  stays in the game's highlights for everyone; `get_team` leaves them out of the clip's `pids` and lists them in `off`.
  Kept in `clip_hides` by game and moment (`clips.at`), so it lasts through a re-cut. "Put them back" undoes it.
  Tests: `hltag.test.mjs`, `db.test.mjs`.
- **The game's whole reel in Highlights** (`0025_game_reels.sql`, Ethan asked): the reel the cut joins (ending on the
  full-time card) is shrunk and uploaded with the clips (`<team>/<game folder>/reel.mp4`, and `reelv.mp4` with commentary;
  with commentary the plugin makes the reel twice, `reelCleanFile`). The plugin returns `marks` (where each clip starts in
  the reel); the game gets `games.reel {path, vpath?, store}` (written straight, not through the game row) and each clip
  `clips.reel_at`. By game then shows one video (`reelPlayer`, `.reelp`) with the moments underneath: tapping one skips
  the reel to it (`data-seek`), the one playing is picked out as it goes, and Commentary on/off swaps the reel. A game
  without a reel (cut before this, or the reel failed) plays its clips one by one as before (`clipPlayer`). Test: `reels`.
- **Watch the whole match highlights** (Ethan: "a big obvious button … with the time of them"): every cut game's card
  in By game starts with `.mhbtn` (`mhButton`: how many moments and how long, from the clips' `dur`), which opens a full
  screen player (`#mhPop`, `mhOpen`/`mhLoad`/`mhDraw`). It plays the uploaded reel when the game has one (moments skip
  to `reel_at`), and otherwise every clip back to back (`ended` loads the next), so games cut before reels were kept
  (SOP's 15–2 v Dog Squad) still get it. The inline reel or clips are folded under it (`details.allclips`, kept open
  across redraws in `HLOPEN`). Test: `reels.test.mjs`.
- **One video for games without one** (Ethan: "play the whole 6 mins in one video"): when a gaffer's iPhone opens the
  whole-match player on a game with no reel, it makes one (`mhMake`, `MK`): `joinReel` of the clips with the full-time
  card and `shrink: true` (the plugin shrinks it like the cut's reel), without commentary and with it if any clip has
  it, uploads both to the game's folder (`clip-store` upload links, or the old storage), writes `games.reel` and each
  clip's `reel_at`, and switches the player to it. Until then the clips play one after another (a follower is told the
  gaffer's phone will make it). **Save or share** in the player (`mhExport`, `EX`): the one video fetched onto the phone
  (`joinReel` of the reel's address, no extra card), or the clips joined, then the share sheet; a second tap reuses it.
  On the web it opens the reel's address. Test: `reels.test.mjs`.
- **It all carries on in the background** (Ethan: "really annoying to wait and just watch a progress bar"; his first try
  failed with "Load failed" when the 6-minute video went up from the web view). Opening Highlights on a gaffer's iPhone
  starts making a missing one video by itself (`MKTRIED`, newest game first), with a line on the game's card
  (`[data-mkline]`, `mkShow`) instead of a screen to watch. Uploads go through iOS's background transfer service
  (`BackgroundUploads.swift`, plugin `upload({path, url})`, "upload" progress events; `upFile` in JS, and the cut's own
  `up`), which carries on with the app put away or closed. A made video is noted on the phone first (`apt-mk-pending`)
  and handed to the team (`mkFinish`) when its upload answers, or, if Gaffer was closed, the next time the team loads
  and its public address answers a HEAD (`mkResume`). `joinReel` asks iOS for background time like the cut; if iOS
  stops it anyway (put away too long), it says "Paused…" and starts again by itself when Gaffer is back
  (`visibilitychange`, `MK.again`). Not used: iOS 26's continued-processing tasks (reported not to fire on release).
- **Fix a goal** (Ethan: "pressed it wrong in the heat of the moment"; game card, gaffers, `fixOpen`/`renderFix`/`fixApply`,
  `#fixPop`): pick the goal (`fixGoals`: ours, or both sides among the squad), then who scored and set it up (`fixCands`:
  those in the game's `per`, on that side). It moves the goal and assist in `r.per` and the event, and `syncAll` rewrites
  `game_players`/`game_events`; the clip's `label` and `pids` follow. On the iPhone the clip that moment leads is made again
  by the plugin's `relabel({url, lower, look, voice, voiceAt, file})`: the clean copy is fetched and the new bar along the
  bottom drawn over the old one (`lower.over` is the old bar; `ReelGraphics.lowerThird` makes the new one at least as big
  and solid, with the same slide-in, so none of the old shows), with a new commentary line for the voiced copy (asks
  `aiAsk` first). Nothing is cut from the match video and no other clip is touched. The new copies go up under a new name
  (`01-<stamp>.mp4`, so no phone keeps the old one), the row points at them and the old files go. The game's one video is
  cleared and joined again from the clips (`mhMake` with `MKVER`, `reel-<stamp>.mp4`). On the web only the stats and
  caption change, and it says to fix it again on the iPhone. Making the clip again can take minutes (Ethan's took 20 with
  Gaffer put away) and coming back re-reads the team, so every change lands on whichever copy of the clip and game is
  current (`mark`, `gameNow`), the phone's saved clips are rewritten (`clipsKeep`) and an open whole-match player moves
  onto the new clip (`mhRebind`, also after every pull; a clip that won't load re-reads the team once). Before this the
  phone kept playing the old file it had just deleted. Test: `reels.test.mjs`.
- **Delete these highlights** (game card, two taps) deletes the game's `clips` rows and files (both copies) and its reel,
  to cut again from scratch.
- **Reels for everyone** (iPhone app, anyone in the team): "Download the reel" on a game card and "Make a reel" on each
  player's card (Highlights → By player: untick clips, preview, Goals only; gaffers and claimed players can add an AI
  voice). Both are joined on that phone by `ReelCutter.joinReel({items:[{url,voice,voiceAt}], …})` from the clips'
  public links, then the share sheet, so nothing extra is stored. Code: `gameReel`, `rbOpen`/`renderRB`/`rbMake`,
  `clipRole`. Test: `reels.test.mjs`.
- **A player's reel on their card** (`0026_player_reels.sql`, Ethan asked): when the player themselves or a gaffer makes
  a player's reel (`canKeepReel`), it is also uploaded (`keepPlayerReel`: `<team>/players/<pid>/reel-<time>.mp4`, which
  `clip-store` lets that player write) and kept with `save_player_reel` (one per player, a new one replaces it and the
  old file goes; `p_path` null takes it off). `joinReel` returns `marks`, saved as `[{t, label}]`. By player then plays it
  (`playerReelPlayer`, the same `.reelp`/`data-seek` as a game's reel), with the clips one by one folded away underneath.
  Anyone else can still make and share one; it just isn't put on the card. `get_team` returns `reels`.
- The old screens (the computer ffmpeg script, the season reels, watch-timecode import) are gone. A result's Highlights
  button opens Highlights with that game picked out (`hlShow`).

### Profiles and following (`0023_profiles_and_following.sql`; free for everyone)
- **Usernames:** every account has one (`profiles.username`, 3–20 letters, numbers or _, unique whatever the capitals).
  New accounts pick one on the sign-up form (`#aUser`, `#jUser`; checked first with `username_status`, which anon can
  call; kept as `A.wantName` and in the sign-up metadata, then claimed by `profileCheck` on first sign-in). Accounts from
  before get the pop-up (`#unamePop`, `unameOpen`) each time the app opens until they pick one ("Not now" puts it off).
- **Kept-back names** are in `reserved_usernames`: `edp`, `ethan`, `ethandp`, `e_d_p_1` belong to Ethan's account
  (the `user_id` is set in the live database only, never in a file); `gaffer`, `admin`, `support`, `official` nobody can have.
- **Profiles** (the Profile tab for your own, `openMe`; a name anywhere for someone else's; `v-profile`, `renderProfile`,
  RPCs `get_profile` and `user_posts`), laid out like Instagram's: a big letter avatar (`avatar`) with posts, followers
  and following, the name, their teams, a stats line (games, wins, goals, assists), Edit profile (yours) or Follow
  (theirs), then tabs: Posts (a 3-wide grid, `.pgrid`; a tile opens the post, `#postView`), Pinned (up to 3 clips they
  choose from all their teams, `my_clips`, `set_pins`, kept by game and moment like `clip_hides`) and Results (the last
  10). **Never upcoming games.** Public: anyone signed in sees it all. Private (`profiles.private`): only the name and
  counts until they accept you.
- **Following** (`follows`, `pending`/`accepted`): `follow` is straight away for public, a request for private;
  `answer_follow` accepts, declines or removes a follower; going public accepts everyone waiting. A gold badge on the heart at
  the top of Home (`#fdReq`, `.pplBadge`) shows requests waiting. No push for requests yet.
- **Find people** (`v-people`, `renderPeople`, the search icon on Home `#fdFind`): requests, search (`find_people`, by
  username or name, 2+ letters), following/followers lists, blocked list. Back goes to Home.
- **Game cards in the feed** (`my_feed`): games from the last 60 days played by people you follow, one card a game with
  their goals, assists and clips, mixed into Home with the posts. Teams you're in are left out on the server, and teams this phone follows are left out in the app
  (`A.teams` codes), because you've seen those. "New" marks games since you last looked (`apt-feed-seen`).
- **Block and report** (Apple needs both for anything between strangers): `block_user` hides you from each other
  everywhere and ends following both ways; `my_blocks` lists them to unblock. `report_user` stores one report per person
  with a reason in `profile_reports`, for Ethan to read in the dashboard.
- The team's own Highlights stay per team (Ethan: "when you're selected on a team only show that team's clips").
- **Finding teams** (`0024_finding_teams.sql`): the People search also finds teams (`search_teams`), and a team on a
  profile is a link while it's listed. Either opens `v-teamview` (`renderTeamView`, RPC `view_team(id)`): record, last
  20 results with scorers, the squad with totals (tap a player with a profile), the latest 12 clips. **Never the team's
  code** (Ethan: to join you still need it from the gaffer), nor upcoming games, chat, the live game or guests' names.
  `teams.listed` (default true) is the gaffer's switch in Options, "Let people find this team" (`#oFind`, `S.listed`,
  written with the team row); an unlisted team only opens for its own squad and gaffers.
- Tests: `people.test.mjs`, `posts.test.mjs`, `social.test.mjs` and `db.test.mjs`. The mock has all of it (`tests/mock-supabase.js`, `PEOPLE`).
- Applying it live: the Supabase MCP `apply_migration` times out (asking for a confirmation nobody sees) on anything
  containing `delete`, so `unfollow`, `answer_follow` and `block_user` went in through the SQL editor.

### The bottom bar, Home and posts (`0027_posts.sql`; like Instagram, Ethan asked)
- **The bar** (`#tabs`, `renderTabs`): Home (`feed`), Team (`home`, the team page, or the welcome screen with no team
  open), Games, Chat, Profile. Games and Chat only show with a team open. Tactics board (`#mBoard`) and Team settings
  (`#mOptions`) are on the Team page now; Settings also opens from the gear on your own profile (`#prGear`), and its back
  button (`#optBack`) goes back to wherever it came from (`optFrom`). Without a team open, the gear opens Account.
- **Home** (`v-feed`, `fdLoad`, `renderFeed`): the brand and three icons at the top: + (new post, `#fdNew`), the heart
  (follow requests, `#fdReq`) and search (Find people, `#fdFind`). Underneath, posts from people you follow and your own
  (`get_feed`, 20 at a time, newest first, blocked people left out) mixed with the game cards above.
- **Posting** (`#postPop`, `postOpen`, `renderNP`): pick one of your own clips (Your clips: clips you're tagged in, from
  `my_clips`) or one of your player reels (Your reels, `my_reels`), add a caption (300 characters), Share
  (`create_post(p_kind, p_team, p_game, p_at, p_caption)`; `kind` clip or reel). The server checks it's yours
  (`not_yours`), you have a username (`no_profile`) and you haven't posted 30 in the last day (`too_many`). A post points at
  the clip or reel; nothing is copied (`private.post_json` builds the video link). A posted player reel isn't deleted
  when a new one replaces it (`save_player_reel` leaves the file).
- **Videos in the feed play like Instagram** (`AUTO`, `autoScan`, `feedPick`): each shows its first frame (`#t=0.1` on
  the address), muted and looping with no controls; an IntersectionObserver plays the top one at least 60% on screen and
  pauses the rest, so scrolling hands over to the next; leaving Home or the app stops it. One tap on the video that's
  playing pauses it (▶ over it, `.held`) and it stays paused until tapped again or scrolled away (`AUTO.held`); a tap on
  another video plays that one and stops the first (`AUTO.chosen`), both kept by post id as the feed can be redrawn.
  Sound is only the "Sound off" pill (`data-snd`), for that video and the ones after. Liking redraws only the heart (`likeDraw`) so
  a playing video carries on. Test: `posts.test.mjs`.
- **Every video stops once it's off screen** (Ethan): any video that starts playing is watched by `OFFIO` (an
  IntersectionObserver) and paused when under 20% is on screen, which includes its screen being hidden; `go()` to a
  different screen also closes the full-screen highlights and an open post and pauses everything (`vidsStop`), and so
  does putting the app away. The feed's own autoplay videos are handled by `feedPick`. Test: `posts.test.mjs`.
- Watch out for function names: index.html is one scope, so a second `function x()` silently replaces the first (a new
  `autoPick` once replaced the bench picker's, and a new `mmss` was replaced by the clock's). Grep before naming.
- **Post cards** (`postCard`): name (opens their profile), the video, like (`like_post`, a `liked` flag rather than
  deleting a row), the caption, and ⋯: Delete for your own (two taps, `remove_post`, which sets `removed_at`) or Report
  with a reason (`report_post`, `post_reports`). Who can see a post follows who can see the profile (`can_see`).
- No comments or photo avatars yet (letters on the team colour instead).
- **Teammates follow each other** (`0028_teammates_and_tags.sql`, Ethan asked): a trigger on `players` (insert, or
  `user_id` changing) and `team_members` (insert) runs `private.follow_teammates`, so whoever joins or claims their player
  follows everyone on the team and they follow them, accepted even for a private profile; the migration did it once for
  everyone already on a team. Unfollowing a teammate sticks (only a new join re-runs it). Blocked pairs are left alone.
- **Names open profiles** (Ethan: "pretty much anywhere that makes sense"): `team_people(code)` gives the squad's
  usernames (signed in only, never anyone blocked with you), loaded after each pull (`tpLoad`, `TP`, at most once a
  minute). `plink(pid, html)` turns a name into a `.plink` button (`data-plink`, looks like plain text), handled by one
  capture-phase listener that opens the profile with Back returning to where you were. Used on the Team page squad list,
  polls, Stats, Insights, Highlights by player, and chat senders. Not in the live game, pickers or the subs screens.
- **Tags** (`post_tags`): the composer's "Tag people" (`#npTagQ`, `renderTags`) suggests everyone you follow (teammates
  among them) and finds anyone else with `find_people`; up to 10. Share calls `create_post`, then `tag_post(id, usernames)`
  (author only; not yourself, not anyone blocked; unknown names skipped). Post cards show "With @…" (`.ptags`, each a
  `.plink`); `post_json` returns `tags` and `tagged_me`. Profiles have a Tagged tab (`user_tagged`). Someone tagged can
  take themselves off (⋯ → Remove me from this post, `untag_post`, sets `removed`). `create_post` was left as it was:
  changing its arguments needs a `drop function`, which the MCP won't run. Tests: `social.test.mjs`, `db.test.mjs`.
- Applying 0028 live: `drop trigger` also waits for the confirmation nobody sees, so it uses `create or replace trigger`.
- Applying it live: soft-delete and the `liked` flag keep `delete` out of the SQL, so it all went through the MCP (in
  three parts).

### Looking after what people share (Apple's 1.2) and asking before AI (5.1.2) (`0029_moderation.sql`, `terms.html`)
- Apple turns down apps with posts, chat or streams between people unless they have: terms everyone agrees to with zero
  tolerance for abuse, a filter, reporting, blocking, and the developer acting on reports quickly. Gaffer has all five.
- **Terms of use** (`terms.html`, bundled and on the website; linked from the Account page, Settings and the pages): a
  new account needs the box ticked (`#aTerms` on the Account page, `#jTerms` when joining a team, `termsBox`); the
  agreement goes in the sign-up metadata (`terms: TERMS_V`). An account from before gets `#termsPop` on sign-in
  (`termsCheck`, `termsMine`) until it agrees (`updateUser`, also remembered on the phone in `apt-terms`) or signs out.
  Raise `TERMS_V` to ask everyone again after a real change.
- **The word filter** (`rude(text, strict)`, lists in `RUDE`, ROT13'd so the source isn't a page of slurs; tests call
  `window.gafferRude`): hate, slurs, sexual words and threats are stopped everywhere, chat included; with `strict` the
  strongest swearing is also stopped (usernames, profile names, captions, team and short names, join-request names). The
  squad chat can still swear about the football. It matches through accents, l33t, spaced letters and stretching, and
  whole words or prefixes so real names pass (Scunthorpe, Cockney, Nazir, Greg Dyke, Hancock are tested). It runs in the
  app only; the server doesn't check it.
- **Reporting:** posts, profiles, chat messages and now live streams (Report this stream under the stream, two taps,
  `report_stream`, `stream_reports`). Every report calls `reported(what)` → `team-notify` kind `report`, which checks the
  caller really reported something in the last 10 minutes and pushes "Something was reported in Gaffer" to everyone in
  `moderators` (Ethan's account; the row was added in the live database by his kept-back username, never an id in a
  file). Reports are read in the dashboard tables (`post_reports`, `profile_reports`, `message_reports`,
  `stream_reports`); act within 24 hours (the terms promise it): remove the content and, if needed, the account.
- **Blocking:** from a profile (as before), and now from any chat message: Block hides their messages on this phone
  (the old Mute) and, if they have a profile, calls `block_user` (`chUser` asks `team_people` for the username if the
  phone doesn't know it; it's kept in `chatMutedU` because the server won't say who a blocked person is). Unblock undoes both.
- **AI commentary asks first** (`aiAsk`, `#aiPop`, `apt-ai` per phone): before any line goes to `reel-voice` (cutting
  with commentary, a reel with a voice, Hear this voice), saying what is sent (first names, team names, score, minute),
  to Google, and that it isn't used for training. Not now: nothing is sent and it's made without commentary (`AI_NO`).
  Settings → AI commentary (`#optAI`) shows where it stands and allows or stops it. The privacy page covers Google.
- Tests: `safety.test.mjs`, `reels.test.mjs` (the ask), `live.test.mjs` (stream reports), `stream.test.mjs` (kind
  `report`), `db.test.mjs` (`report_stream`), `people.test.mjs` (an older account agreeing).

### The Android app (players only; Ethan: "ignore anything gaffer related, just have it have the chat feature, respond to polls, watch highlights")
- The same `index.html` in Capacitor's Android shell (`android/`). `DROID` (`Capacitor.getPlatform() === 'android'`, set
  near the top of the script) puts `droid` on `<html>`; the CSS hides everything else with `html.droid …` and `go()` only
  allows `DROID_VIEWS` (welcome, join, account, home, games, chat, highlights), so a link or a saved screen can't reach
  the rest.
- **It never runs the team:** `setRole` always makes it a `viewer`, and `pull`/`openTeam` treat a gaffer's own account as
  a follower (`!DROID && d.is_organiser`), so an Android phone never writes the team, its games or polls, even signed in
  as a gaffer. Followers can't log goals from it either, and there's no game screen, kick-off pop-up or live stream.
- **The bar** is Team, Highlights (`.droidtab`, only shown on Android), Games, Chat and Account (the Profile tab opens the
  Account page there: sign out, delete my account). No feed, profiles, usernames pop-up (`plink` gives plain names) or
  intro swipe-through.
- **Plugins:** Haptics, PushNotifications and the app's own `GafferAndroid` (`DROID_PLUGINS` in `plugin()`, and
  `capacitor.config.json` `android.includePlugins`), so the iPhone-only parts (watch, cutting, filming, calendar sheet)
  fall back to what the website does. Add to calendar opens
  Google Calendar with the game filled in (Android's web view can't save an `.ics`).
- **The back button:** `MainActivity` asks `window.gafferBack()` first (closes the whole-match player or a pop-up, else the
  screen's Back, else the team page); false puts the app away.
- The app is served from `https://localhost`, so confirmation and reset emails use `CFG.siteUrl` (`NATIVE_SITE`), pages
  open on the website (`siteHref`), and the service worker isn't registered in the apps.
- **Notifications** (`0030_android_push.sql`): through Google's Firebase Cloud Messaging. A build only has them if it was
  made with the team's Firebase file (`android.yml` writes the `GOOGLE_SERVICES_JSON` secret to
  `android/app/google-services.json`, git-ignored). The app asks `GafferAndroid.pushReady()` (true when the build has the
  `google_app_id` resource) before using `PushNotifications`, because asking Firebase for an address without it crashes
  the app; without it there's no Notifications section and no pop-up. When ready it makes two channels (`game` with
  `res/raw/whistle.wav`, `chat` with the phone's usual sound), then the usual `pushSetup`; `register_push(p_token,
  p_platform: 'android')` marks the phone (the iPhone still calls the one-argument version, which means `ios`). Settings
  isn't on Android, so `#ntfSec` is moved onto the Account page (`renderNotes`, worded for a phone). `team-notify` sends
  Android phones only the players' kinds (`DROID_KINDS`: kickoff, goal, poll, nudge, highlights, chat), signed in to Google
  as `GOOGLE_SERVICE_ACCOUNT` (or `FCM_SERVICE_ACCOUNT`) with the `firebase.messaging` scope, to that account's
  `project_id`; addresses Google says are gone are deleted like Apple's. The status-bar icon is
  `res/drawable/ic_stat_gaffer.xml`. Tests: `android.test.mjs` (`firebase: true` in `tests/lib.mjs`), `stream.test.mjs`
  (the real function against a stand-in Google), `db.test.mjs`.
- **Setting up Firebase (Ethan's, once):** Firebase console, Add project, pick the existing Google Cloud project the voice
  uses; add an Android app `com.randomedp.aipoweredtactics`; download `google-services.json` and paste it whole into the
  GitHub secret `GOOGLE_SERVICES_JSON`; in Google Cloud, IAM, give the voice's service account the role "Firebase Cloud
  Messaging API Admin". The next Android build then has notifications.
- **Not yet:** Google Play (see section 11).
- Version: `package.json` `version`; build number: the Android workflow's run number.
- Test: `android.test.mjs` (a gaffer on the iPhone and a player on Android through a week: join, poll, chat, highlights,
  the back button; a gaffer's account on Android writes nothing; no iPhone plugin is asked for). `tests/lib.mjs`
  `android: true` stands in for Capacitor's Android bridge.

### Playing another team on Gaffer (`0031_linked_games.sql`; Ethan asked)
- New game → the opponent's name also searches Gaffer's teams (`oppFind`, `search_teams`, `#oppFind`); picking one sets
  `D.link` (`#oppLink` says so; changing the name unlinks). Setting the game up puts `m.linkTo` on the match and
  `linkSend` calls `link_game` (`game_links`, status `proposed`), sets `m.link`/`m.linkTeam` and calls `team-notify` kind
  `link` (the other team's gaffers; again on accepting, to the asking team's). No signal: it's sent on the next pull.
- **Nothing is shared until the team asked accepts** (`#linkCard` on their Home, `link_answer` accept/decline; either
  side can `cancel`, "Unlink" on the game screen; scrapping a game takes back an unanswered request, `linkDrop`).
  Accepting attaches a game against them already going, puts their finished game straight into the results, or opens
  New game already linked (`D.linked`). Picking a team that has an accepted, unused link uses it.
- `team_links(code)` (anyone with the code, like `get_team`; requests to the team only for its gaffers) gives each
  accepted link's other side (`private.link_side`): its own goals (scorers' names), goals it logged against itself, its
  squad's names, and its clips once finished. From its live game while on (`state.link`), else its game with `games.link`.
  Goals a side only took from the other (`lk` / `game_events.from_link`) are never sent back.
- **One score** (`linkView`, inside `tally`, so the watch and followers agree): each side's own goals, plus the other side's
  that it didn't log itself, matched one to one by time within `LINK_WIN` (90 s). Both teams' phones work it out the same
  way. The game screen lists their goals with their scorer (`linkLine` says where the link stands and their squad).
  Updates: a broadcast `changed` on `link:<id>` after each save of the live game (`linkPing`), and every 20 s.
- **Full time** (`linkFinal`): the other side's extra goals go into the result as `lk` events (minute by our clock, who was
  on), `r.link` kept. `linkRefold` (gaffers, after each `team_links`) redoes them when theirs change (their game finishing
  later, a goal fixed); not while their side shows `phase: 'none'`. Fix a goal skips `lk` goals.
- Their clips show under the game in Highlights ("From <team>'s video", `linkClipsHtml`); our own clips, cutting, reels
  and their writes never touch theirs.
- Tests: `linked.test.mjs` (two gaffers, a follower and the watch), `linkdb.test.mjs`, `stream.test.mjs` (kind `link`).

### Games among the squad, with guests (`0020_games_among_the_squad.sql`)
- New game → "Among ourselves" (`#gKind`, `D.kind = 'house'`, `renderHouse`): two named sides (Bibs and Shirts to start),
  any size, at least 2 a side, no fixed keeper and no subs plan. Squad players are set to a side or Out; guests are added
  by name to either side (ids from 1001 up, `guestId`; names through `guestName`, which `nm` falls back to).
- The game is an ordinary match with `m.house = {a, b, side: {id: 'a'|'b'}, guests: [{id, name}]}`: "us" is side a and
  `opp` is side b's name, one segment per half, everyone on (`sideOf`, `usOf`, `vs`, `scoreLine`). A goal for either side
  only offers that side's players (`pickOrder(m, assist, side)`), scorers are kept for both sides (an `against` event with a
  `pid`), and followers can log for either side. It's `friendly: true` and never counts in the team's record. The watch
  gets the sides' names and side a's players.
- Finishing it keeps `house` with the result (`games.house` jsonb, returned by `get_team`), gives squad players goals for
  and against by side, and, if there were guests, opens the game's highlights with **Send the guests a link**
  (`shareGuests`, native `shareText`): `<siteUrl>?team=<follow code>&game=<id>`. Opening that link follows the team and
  shows the game's highlights with a welcome (`guestCard`): get the app (`config.js` `appStore`, empty until the App Store
  page is live), make an account, join or start a team. The link uses the 6-character follow code, never the organiser code.
- Test: `house.test.mjs`. Guests' names are covered on the privacy page.

### A game of just me (Ethan asked, for playing on his own)
- New game → "Just me" (`#gKind` `data-kind="solo"`, `D.solo`, `renderSolo`, `soloKick`): an optional opponent (else
  "Them"), the length and one or two halves, then straight to kick-off. `m.solo = true`, `order: []`, no keeper, one
  segment per half, `friendly: true` (never in the record, no `game_players`).
- The game screen hides the line-up, subs card, rota and Save (`#nowSec`, `#swapCard`, `#rotaSec`, `#svBtn`); Goal for us
  logs straight away (no scorer picker); a highlight never asks whose. No kick-off or goal notifications or pings
  (`announceGame`, `addGoal`), so the team isn't told about it.
- The watch gets `players: []` and `changes: []`: no subs buzzes, Highlight logs at once, and Goal for us asks only
  "Goal for …? Log the goal" (`MatchState.asksScorer`, `confirmUs` in `ContentView.swift`) instead of who scored.
- Tests: `solo.test.mjs` (phone, watch presses, no notifications, kept out of the record), `tests/watch/main.swift` (25).

### Live streaming (Gaffer tier; behind the experimental switch for gaffers) (`0017_live_streams.sql`, `live-stream`)
- The GoPro (through GoPro Quik) or an iPhone (through a streaming app such as Larix Broadcaster) streams over RTMPS
  straight to **Cloudflare Stream**. The app never handles the video
  going up; it only plays it.
- Each team has one Cloudflare live input (its "camera link"), made the first time a gaffer asks for it and kept, so it's
  pasted into Quik once. It is **switched off except while the team is live**, so a leaked link can't put anything in front
  of the team. "Make a new link" replaces it.
- **Opening "Stream this game" gets the link ready** (calls `start` for the game) — there's no separate Go live to
  remember before starting the camera (Ethan's first try failed because the camera was started first).
- `live-stream` actions (gaffers only): `link`, `start {gid}`, `status`, `stop`, `renew`. It writes `team_streams`
  (service role); the stream key is never stored in the database. Everyone reads `team_stream(code)` (anon allowed):
  `{hls, gid, started, on_air}` or null. A stream nobody ended counts as over after 4 hours.
- **Every phone checks** whether the picture has got through (5 s until it has, then 30 s): gaffers through `status`,
  everyone else straight from Cloudflare's public `<hls>/lifecycle` (CORS open). The gaffer's phone is often away in
  GoPro Quik or an iPhone streaming app, so it can't be the only one. The first team member's phone to see it calls
  `team-notify` kind `live`; the server checks the lifecycle itself, words it and sends it once per stream
  (`team_streams.notified_at`, `0018`). Followers see the card only once the picture is through (`liveSeen`); gaffers
  from the moment it's ready (`liveShown`).
- **Film with this iPhone** (`LiveCamPlugin`, only on the iPhone app): the sheet's first option. It gets the link ready, then
  `LiveCam.start({url})` opens the native camera screen, which streams through the same link and records to Photos. The
  recording doesn't depend on the stream (no signal, still recorded), and a file left by an app closed mid-game goes to
  Photos on the next launch. Back to Gaffer leaves it filming (`filming()`, "Show the camera" on the game screen and
  Home card). End on the camera screen sends `{state:'ended', by:'user'}` and JS calls `liveEnd()`; ending in Gaffer
  (or finishing the game) calls `LiveCam.stop()` first. Tests: `livecam.test.mjs` (with a stand-in camera). The native
  code can only be compiled on CI ("Check it builds").
- If Quik says "We're having trouble connecting to your GoPro", that's Quik failing to reach the camera (pairing, Bluetooth,
  or the hotspot: Maximise Compatibility). The sheet says so. Test the link with Larix Broadcaster on an iPhone to tell
  a GoPro problem from a Gaffer one.
- Viewers: Home card (`#liveCard`) and the `live` view. On the iPhone the HLS plays in the app's `<video>`; elsewhere in
  Cloudflare's iframe player. **The score overlay is held back** by the picture's delay (from the stream's own clock when
  the player knows it, else 15 s; `seenGame`), and goal banners are quiet while watching (`ChatQuietPlugin`).
- Finishing or scrapping the game ends its stream. Recordings are kept 30 days (`deleteRecordingAfterDays`).
- `hasGaffer()` is the one check for the paid tier; it returns true during early access.
- Secrets (Ethan sets them): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN` (API token with Stream: Edit).
  Until they're set the app says "Live streaming isn't set up on Gaffer's server yet."

### AI commentary (Gaffer tier, in the highlight maker and the reel builder)
- `reel-voice` edge function, for the team's gaffers and claimed players. Each team has a monthly character allowance in `voice_usage` (40,000).
- **Engines:**
  - "Live commentator" uses Gemini TTS (`gemini-2.5-flash-tts`). It needs the `GOOGLE_SERVICE_ACCOUNT` secret: the
    whole JSON key of a service account with the **Vertex AI User** role. Plain API keys are refused for this model.
  - "Read it straight" uses Chirp 3 HD with `GOOGLE_TTS_KEY`.
  - **"Sweary, 18+"** (Ethan asked for it, after a sweary meme reel): the app writes the lines with swearing in
    (`swearyLine`, the sweary intro and sign-off; swearing at the football, never at anyone for who they are), and the
    function performs them with its `SWEARY` prompt (a foul-mouthed pub commentator in a broad East London Cockney
    accent, spelt out because it first came out Australian; the lines have some Cockney in too: "my son", "Blimey", "Leave it out"). Off unless chosen; the choice is
    kept per phone (`apt-voice`). The App Store age rating has to allow for it (Ethan's to set in App Store Connect).
  - If the performed line fails, the function falls back to Chirp and returns a plain-English `note` saying why.
  - Google's project has a small per-minute limit for `gemini-2.5-flash-tts` ("Quota exceeded ... per_minute_per_project_per_base_model",
    seen in the function logs). The function asks one line at a time and, when told to slow down, waits and retries
    (about 90 s in all; the rest are read straight). Ethan can raise the limit: Google Cloud, IAM & Admin, Quotas,
    gemini-2.5-flash-tts.
- Ethan funds the Google usage himself.

### The look (the redesign, October 2026; Ethan asked for it after a review against Apple's design guidelines)
- **Text follows the iPhone's text size.** Every `font-size` is a token on one scale (`--t-large` 1.75rem, `--t-title`,
  `--t-head`, `--t-body` 1rem, `--t-sub`, `--t-foot`, `--t-cap` .75rem) or a rem value; never px (the clip preview
  `.lk-*` is the one exception: it's a drawing of a video frame). `textSize()` (top of the script, `window.gafferTextSize`)
  sets the root from WebKit's `-apple-system-body` on an iPhone (17px standard), kept between 15 and 26px; 17px elsewhere.
- **Colours mean one thing each:** the kit colour (`--on`) for the main action and what's selected; orange (`--bib`,
  #b03f08, 5.2:1) only for bibs: the bench, coming off, side B in a game among the squad; red (`--danger`, = `--agg`) for
  errors and anything that deletes or can't be undone; goals against are plain ink.
- **Buttons:** `.plain.primary` (one per screen), `.plain.tint` (secondary), `.plain` (a set of choices), `.plain.quiet`
  (text only), `.danger` (red text). All 44 points tall at least.
- **Match mode** (the game screen): the score is in the clock panel (`.pscore`, `#usN`/`#themN`); Goal for us, Goal
  against, Highlight, Keeper save and Undo are in `#dock`, fixed along the bottom (frosted; solid with Reduce
  Transparency), with the lock note (`#goalMsg`) and the 8-second lock drawn as a sweep (`.dock.locked`). The rota is
  folded (`details.fold`). The tab bar doesn't show on the game screen, so the dock sits at the very bottom.
- **Pickers are sheets** (`.pickpop .picker`): from the bottom, a grabber, two even columns, Cancel at the top, and a
  pull down closes them.
- **Navigation:** `.back` is the kit-coloured chevron and the previous screen's name; the `h1` under it is a large title.
  `#topbar` (`topbarWatch`/`topbarShow`, state in `NAVB`) shows the title small once it scrolls away, with the same back.
  A swipe in from the left edge (within 24px, more than 80px across) taps the screen's back button. The tab bar floats.
- **Team page:** Team settings is the gear in the header (`#mOptions`, `.herogear`); the header has the form guide
  (`#homeForm`, last five league results, oldest first); each tile has a fact (`#mStatsSub`, `#mHlSub`, `#mInsSub`).
- **The score box** (`scoreBug(x)`, `.sbug`), like the reels' graphics, on feed game cards and Highlights game cards. Its
  text reads like `scoreText` ("SOP FC 1–0 Dog Squad").
- **Settings:** grouped cards; on/off settings are switches (`.check.tgl`, `role="switch"`); the crest has a "Choose a
  picture" button (the file input is visually hidden, `.vh`); Experimental comes last. Report and Block on someone's
  profile are under ⋯ in the bar (`#prMore`, `PF.more`). Games is a list. The chat box is fixed above the tab bar.
- **The watch** (watchOS 10+; the old single scroll stays for watchOS 9): three pages turned with the crown
  (`MatchPages`: the clock, score and Highlight; the 2 × 2 buttons, `LogButtons`; the changes to come). A goal turns
  back to the score. Double tap marks a highlight (`DoubleTapPrimary`, `handGestureShortcut(.primaryAction)`, watchOS 11,
  Series 9 / Ultra 2 and later). Goal for us wears the kit: the phone sends `color` in the watch state, `MatchState.kit`
  and `kitIsLight` (tested in `tests/watch/main.swift`, 26). The clock is `@ScaledMetric`.
- Test: `design.test.mjs` (and the ⋯ menu in `people.test.mjs`).

### Rewarded ads (the free tier; `0032_rewarded_ads.sql`, `ad-reward`; Ethan's idea instead of banners)
- No banners. On the free tier someone chooses to watch a short ad (Google AdMob rewarded, `@capacitor-community/admob`
  8.2.1, iPhone app only) to unlock one thing: an older game's highlights (the newest cut game's are free; per person, for
  good), AI commentary on one cut or reel (per person, one use, **free voice only**: `AD_VOICE`/`adVoice`, the other
  voices are paid one-offs), or one more cut for the team (gaffers; after the team's one free try; one a calendar month).
- **Never during a game** (`adWatch` refuses while `S.match` is set) and **never for a paid team**: `adFree()` is the one
  check (`teamPaid()` from the team pass, else `hasGaffer()`). Early access: everyone has Gaffer, so ads only show with
  Experimental on and "Try the free tier" (`#expAds`, `A.exp.ads`). `freeTier()` = not ad-free and an ad can be shown
  here; on the web and Android the limits don't apply (no ad to lift them).
- **Server-side grant:** `ad_ticket` makes a ticket; the ad is loaded with `ssv {userId, customData: ticket}`; AdMob
  calls `ad-reward` (deployed `--no-verify-jwt`; Google's ECDSA signature checked against its published keys), which calls
  `ad_grant` (service role only). The app polls `ad_claim`. Google's test ads never call the server, so while
  `ad_settings.trust_app` is true `ad_claim(p_app_says)` takes the app's word. Unlocks are used by `use_unlock` as the
  cut/commentary starts; `my_unlocks` says what's left. Table `unlocks` (RLS, no policies).
- First ad of a session: `initialize`, Google's consent form where the law needs it (UK/EU; Settings → Ads → Ad choices
  reopens it), then Apple's tracking question (`NSUserTrackingUsageDescription`). Either answer still unlocks.
- Test ads now: `config.js` `ads` (Google's test rewarded unit), `Info.plist` `GADApplicationIdentifier` (Google's test
  app id) and `SKAdNetworkItems` (Google's own id only; add Google's full list before going live).
- **Going live (Ethan's steps):** make an AdMob account and the iOS app and a rewarded unit; put the unit id in `config.js`
  (`test: false`) and the app id in `Info.plist`; turn on server-side verification on the unit with the callback
  `https://kvefpqigpqprxfelesrb.supabase.co/functions/v1/ad-reward`; set the secret `ADMOB_AD_UNITS`; then
  `update public.ad_settings set trust_app = false`; update the App Privacy labels (Identifiers: device ID; Usage data;
  coarse location; used for third-party advertising, tracking if allowed) and set up the UK/EU consent message in AdMob
  (Privacy & messaging). Before the store build shows ads, App Review needs to see the tracking prompt: say where in the notes.
- Tests: `ads.test.mjs` (the database, the real function with a stand-in Google key, and the phones).

### Other features (all in `index.html`)
- Polls, the Games screen, game modes and tournaments, and the minutes planner (Aggressive ↔ Fairness).
- Injuries and leaving, insights (ratings, MOTM, chemistry), and squad chat.
- Rivals: home grounds, nearby teams, challenges and Elo.
- Tactics board (self-contained, phone-only).
- Player tracking (experimental, phone-only results), shirt numbers, and the intro swipe-through.

## 7. Supabase (live project `kvefpqigpqprxfelesrb`)

- **Migrations:** `0001`–`0031` are applied live (0031 went in as two parts, `0031a`/`0031b`, through the MCP). Add new ones as `supabase/migrations/0032_<name>.sql` and apply them to
  the live project in the same piece of work. Use the Supabase MCP server's `apply_migration` if it's connected, or the
  dashboard SQL editor, or `supabase db push` with the CLI linked to the project.
  - Every new table gets RLS.
  - Functions are `security definer` with `set search_path = ''`, and their grants are revoked from public and anon.
    Follow the patterns in the existing files.
- **Edge functions:** all five are deployed with **verify_jwt = true**. Deploy with the Supabase MCP
  `deploy_edge_function`, or with the CLI:
  `supabase functions deploy team-notify --project-ref kvefpqigpqprxfelesrb`.
  - Deployed now: `team-notify` v23 (kind `live` from any team member, sent once; kind `report` tells the moderators; kind `link` for linked games; Android phones through Firebase; same as the repo), `live-stream` v5,
    `reel-voice` v17 (players allowed too; Sweary delivery in a Cockney accent; paced for Google's per-minute limit), `clip-store` v2 (players may upload/remove in their own `players/<pid>/` folder), `game-started` v9 (old). Setting secrets bumps every version number without changing the code.
  - Keep the repo copy identical to what's deployed. If you change one locally, deploy it, and don't leave local edits
    you haven't deployed.
- **Edge Function secrets (names only):** `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `GOOGLE_TTS_KEY`,
  `GOOGLE_SERVICE_ACCOUNT`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (all set by Ethan), and `ADMOB_AD_UNITS` (optional, once real ads are on).
- **GitHub repository secrets:** `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`. For Android notifications:
  `GOOGLE_SERVICES_JSON` (the Firebase file; Ethan's to add). For Google Play (not set yet; Ethan's to make): `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
  `PLAY_SERVICE_ACCOUNT_JSON`.
- **Auth:** email and password. Site URL and redirect go to the GitHub Pages address.
- **Any Google API key used by `reel-voice`** is server-side. Don't give it an iOS-app restriction (requests come from
  Supabase, not the phone). Restrict it by API instead.

## 8. Apple / App Store

- **App Store review:**
  - The name is "Gaffer: 5-a-Side Team Manager" in App Store Connect until Ethan changes it there; the repo now says
    "Gaffer: Small-Sided Football" (28 of the 30 characters allowed).
  - **The store text lives in `store/text/`** and goes to App Store Connect with the "Update App Store text and pictures" workflow,
    never by hand from chat. Apple only takes the name, subtitle, description and keywords on a version that can still be
    edited; while one waits for review or is live, only the promotional text changes (the log says which). Subtitle
    "Your team, sorted" (the tagline isn't final; the watch is a feature, never the headline).
  - Apple asked for information under Guideline 2.1; a reply was drafted and Ethan has dealt with it.
  - The reviewer demo account is his.
  - **Account deletion (Guideline 5.1.1(v)):** Apple turned a build down for having no way to delete an account. It
    existed (`delete_my_account`, `0003`) but only on the Account page, which only the welcome screen led to, so with a
    team open it couldn't be found. Settings (the gear on your profile, or Team settings) now starts with **Your account**
    (`#optAccount`: who you're signed in as, Sign out, Delete my account `#oDelete`, two taps, `deleteMe`), and the
    Account page keeps its own. After deleting, the phone is signed out and keeps nothing (`signOutAll`). Every table
    pointing at `auth.users` cascades or sets null (checked live). Test: `account.test.mjs`. Keep it easy to find.
  - Checked against the guidelines (October 2026) before resubmitting: user content (1.2) and AI data to Google (5.1.2(i))
    are handled (see "Looking after what people share"). Still open: Plans "£4.99 coming soon" and "What's being worked
    on" behind the Experimental switch (2.1/2.2/2.3.1 risk: hide them in the store build), the hand-drawn App Store badge
    with the Apple logo on the reel end card (use Apple's badge or drop the logo), and in App Store Connect the age rating
    (Sweary 18+, chat, posts, streams), the privacy labels (now including Google for the voice) and specific review notes.
- **Version and build:** the marketing version comes from `package.json` `version`. The build number is the GitHub
  Actions run number.
- **Builds:**
  - 86/87: match-day sync fixes and the notifications-off nudge fix.
  - 88: ask to join.
  - 95: whistle and quiet chat.
  - 97: multi-camera highlights.
  - 112: live streaming, with "Film with this iPhone" (streams and records to Photos).
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
     - `link` (phone + watch whole games over a bad link), `sync`, `db`, `contract`, `join`, `match`, `watchlink`,
       `live` (streaming on the phones), `stream` (the real `live-stream` and `team-notify` source run under Node with
       stand-ins for Deno, the database, Cloudflare and APNs; Node 22 runs the TypeScript directly).
     - `db.test.mjs` loads every migration into PGlite (real Postgres in memory) via `tests/pg.mjs`.
     - `contract.test.mjs` checks that every RPC and insert the app makes matches the real schema.
  3. Walk-throughs (`tests/*.mjs` without `.test`) print what they see and are compared with `tests/golden/*.txt`.
     - `tests/pinned.mjs` freezes the clock at 2026-10-10 17:00 London.
     - `run.mjs` masks times and ids before comparing.
- **Swift:** the Swift parts need `swiftc` (5.9+). On a machine without it they are skipped loudly; set
  `ALLOW_NO_SWIFT=1` to not fail the run. CI (ubuntu) always runs them. In a cloud session you can install it: download
  `swift-6.0.3-RELEASE-ubuntu24.04.tar.gz` from download.swift.org, unpack, and put its `usr/bin` on `PATH`.
- **Chromium:** the tests use `/opt/pw-browsers/chromium` if it exists, otherwise Playwright's own Chromium, or the
  `CHROMIUM` env var.
- **Supabase mock:** `tests/mock-supabase.js` stands in for supabase-js in the walk-throughs. When you add an RPC, add it
  there too (`contract.test.mjs` will tell you).
- **Screenshots:** `node tests/shots.mjs <outdir> light` with the repo root served on port 8766
  (`python -m http.server 8766`). Individual walk-throughs take an output dir too, e.g. `node tests/video.mjs out/`.
  **Look at the screenshots** after any UI change.

## 10. Gotchas learned the hard way

- Anything `position: fixed` inside a screen (the dock, the chat box, pop-ups) is pinned to the page, not the phone's
  screen, while the screen has a transform, even during an animation. `.view`'s entrance is a fade only (no slide) and
  `backwards` for that reason; don't animate a screen's transform. `html` has `scroll-padding` so anything scrolled into
  view clears the small title bar and the tab bar.
- CSS class names share one file too: a new `.sw` once collided with the colour swatches' `.sw` and squashed every
  setting to nothing. Grep for a class before naming it, as for functions.

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
- Picking a video: Photos can refuse a video as a plain "movie" ("Cannot load representation of type public.movie"),
  for example one kept in iCloud or one written by Gaffer's own camera. `pickVideo` tries each video type the item
  offers (most particular first), then fetches it from the library by its Photos id (`PHImageManager`, downloading from
  iCloud), which needs Photos read access; each failure is worded for the gaffer.
- The Linux test environment can't compile anything that imports UIKit or AVFoundation. The only full compile check for
  that is CI's "Check it builds" step, so read its output after pushing native changes. For a quicker check of a
  self-contained file (like `ReelGraphics.swift`), strip its UIKit/QuartzCore/AVFoundation imports, add `import Foundation`
  and run `swiftc -typecheck` with a small file of stand-in types for what it uses; it catches most mistakes before CI.
- The Supabase MCP's `apply_migration` and `execute_sql` wait for a confirmation on SQL containing `delete` and time out
  after 60 s with nothing applied. Apply everything else through the MCP and give Ethan the rest to paste into the SQL
  editor. A timeout means nothing was applied: check before retrying.
- Never run `git checkout <file>` (or `git restore`) to undo a failed scripted edit: a script that fails part-way hasn't
  written anything, and checking out throws away all the uncommitted work in that file. Commit work in progress locally
  as you go instead.

## 11. In flight / next up

- **Android (players' app, first build October 2026):** Ethan to install the `.apk` from the Android workflow's artifacts
  on an Android phone and check joining, polls, chat and highlights. Notifications are built and live on the server; they
  wait for Ethan's Firebase setup (section 6, "The Android app"), then a new Android build to send the player. Only one
  player has Android, so Google Play waits; when it's wanted:
  a Play developer account ($25, Ethan's), an upload key (the secrets in section 7), and a new personal account must run a
  closed test with at least 12 testers for 14 days before going public. The store listing needs the Data safety form and
  a web link for deleting an account.

- **Check on a real phone (build 95 onwards):**
  - chat messages are silent while that chat is open;
  - the whistle plays for nudges, polls, goals and kick-off;
  - a reel cut from two different cameras (for example a GoPro and an iPhone) joins cleanly.
- **Live streaming:** the Cloudflare side works (Ethan's secrets are set). His HERO13 Black couldn't get online through
  Quik (it won't join his iPhone's hotspot). So Gaffer now films with the iPhone itself ("Film with this iPhone",
  `LiveCamPlugin`): check on a real phone that it streams, the team sees it, End saves the recording to Photos, and a
  reel can be cut from that recording.
- **Action button** (Ethan has an Ultra): the watch app's shortcut didn't show in the Action button list (it only offers
  your own Shortcuts library). Builds after 112 have "Mark a highlight" in the iPhone's Shortcuts app; check it can be
  added, shows on the watch, and marks a highlight mid-game (see Phone ↔ Apple Watch).
- **Voice:** the `GOOGLE_SERVICE_ACCOUNT` secret is set and works; the commentator voice was being refused by Google's
  per-minute limit. Ethan to ask Google for a higher limit (see AI commentary); then check "Hear this voice" says Playing.
- **Profiles:** check the username pop-up on the phone, follow someone private and accept it, pick clips, and that the
  feed leaves out SOP's own games. Push notifications for follow requests aren't built yet.
- **Copyright:** `LICENSE` says all rights reserved (with third-party licences kept). The repo stays public for GitHub
  Pages; going private means moving the website first (Cloudflare Pages), best after App Store approval.
- **Match fees (Ethan likes it; parked until he comes back to it):** players pay their match fee in Gaffer and Gaffer
  takes a small cut. Plan put to him: Stripe Connect (each gaffer signs up once to connect their bank; Stripe does the
  ID checks and holds no money of ours; Apple takes nothing because it's a real-world game), Apple Pay or card, the
  gaffer sees who's paid, nudges for anyone who owes. Fees are roughly 1.5% + 20p a card payment (check current prices),
  so about 28p of £5: suggest adding ~50p, letting players top up (say £20 for 4 games, one fee), and the paid tier
  fee-free. Two steps: (1) no money handled: "who's paid" on each game, "I've paid" for players, reminders, the gaffer's
  own payment link (Monzo/PayPal); (2) real payments through Stripe with the cut (Ethan makes the Stripe account; its
  keys go in Supabase secrets, never chat). **His four answers are needed first:** who pays the fee (player £5 + 50p,
  or gaffer gets £5 minus it); the cut (50p or a percentage); when players are charged (on "I'm in" or after the game)
  and what happens if a game's called off (refund or credit); and whether to start step 1.
- **Rewarded ads:** built and tested with Google's test ads; `0032` and `ad-reward` not applied/deployed until Ethan says
  so. Then his AdMob steps in section 6, "Rewarded ads".
- **Ideas he has raised but not built yet:**
  - ads in the free tier and the £4.99 Gaffer subscription (in-app purchase). Advice given: ads in the feed only once
    lots of people post (then about 1 in 8, never first); better: rewarded ads to unlock things (another game's
    highlights, AI commentary on a reel), a short ad before a game's reel, one full-screen ad at full time; never during
    a live game or near the watch, subs or scoring. Other money: match fees (above), team-priced subscription, team
    sponsors on reels and the end card, pitch-booking referrals, paid one-offs like a season reel;
  - MOTM and ratings from video;
  - full-game commentary;
  - a leaderboard for team Elo by area.
