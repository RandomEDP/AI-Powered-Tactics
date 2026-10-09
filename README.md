# AI Powered Tactics

Line-ups, sub rotations, live scores, stats and highlight reels for small-sided football teams.
A single-page web app backed by Supabase, installable on a phone's home screen and usable offline at the pitch.

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
| `tests/` | Browser test against an in-memory stand-in for Supabase |

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
python3 -m http.server 8765        # from the repo root
cd tests && npm i playwright && node flow.mjs
```
