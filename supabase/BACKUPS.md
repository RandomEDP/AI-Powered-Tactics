# Backing up Gaffer's database

## What's covered

- **Supabase's own backups (Pro plan).** Supabase copies the whole database once a day and keeps the last 7. They're
  in the dashboard under Database, Backups, and a restore there puts the live project back to that day (everything
  since is lost). Point-in-time recovery (back to any minute) is a paid add-on and isn't on.
- **Gaffer's own copy (this).** Every night at 03:17 UK-ish time (UTC), the "Back up the database" workflow
  (`.github/workflows/db-backup.yml`, `scripts/db-backup.sh`):
  1. dumps everything the app keeps: `public` and `private` (teams, players, games, chat, posts, everything), `auth`
     (accounts and their password hashes), `storage` (the file list for the old Supabase buckets) and
     `supabase_migrations`. It stops if a new schema has appeared that it would miss;
  2. restores the dump into an empty Postgres on the runner and checks every table came back with every row (if not, the
     copy is still kept, but the run goes red and GitHub emails Ethan);
  3. encrypts it with a passphrase only Ethan has (AES-256, gpg) and uploads it to the private R2 bucket
     `gaffer-backups`;
  4. keeps 30 days of nightly copies, and the first copy of each month for 12 months.

  It is ours: it lives outside Supabase, so it survives the project being deleted, the account being locked, or a
  mistake noticed after 7 days.
- **Not covered:** the videos. Clips, reels and voice samples are files in R2 (and a few old ones in Supabase storage),
  not in the database. R2 itself keeps them safe from disk failure, but a deleted file is gone.

Nothing in the logs shows any data (the repo is public, so the run logs are too), and the dump is never kept as a run
artifact.

## The secrets (set once, by Ethan)

All five are **repository secrets**: GitHub, the repo, Settings, Secrets and variables, Actions, New repository secret.
Never paste them in chat.

| Secret | What it is and where to get it |
|---|---|
| `SUPABASE_DB_URL` | Supabase dashboard, the project, **Connect** (top of the page), Connection string, **Session pooler** (GitHub's machines can't reach the direct one), URI. Copy it and put the database password where it says `[YOUR-PASSWORD]`. Forgotten the password? Project Settings, Database, Reset database password (the app doesn't use it, so nothing else changes). |
| `BACKUP_R2_ENDPOINT` | Cloudflare dashboard, R2, **Create bucket** named `gaffer-backups` (leave it private; no public access, no custom domain). Its Settings page shows the **S3 API** address, `https://<account id>.r2.cloudflarestorage.com` (with `.eu.` in it for an EU bucket). Copy it without the `/gaffer-backups` on the end. |
| `BACKUP_R2_ACCESS_KEY_ID` | R2, **Manage API tokens**, Create API token: permission **Object Read & Write**, applied to **gaffer-backups only**, no expiry. It shows an Access Key ID ... |
| `BACKUP_R2_SECRET_ACCESS_KEY` | ... and a Secret Access Key (shown once). A separate token from the clips' one, so neither can touch the other's bucket. |
| `BACKUP_PASSPHRASE` | A long random password you make (a password manager's generator, 30+ characters). **Save it in your password manager too: without it no backup can be opened, by anyone, ever.** |

A sixth, `RESTORE_DB_URL`, is only added when a restore is needed (below).

Then: Actions, "Back up the database", **Run workflow**, to make the first copy straight away. The run's summary says
how many tables and how big; the step "Encrypt it and send it to R2" names the file.

## Restoring

**Lost something in the last 7 days, and the project is still there?** Use Supabase's own: Database, Backups, pick the
day, Restore. It's the quickest and puts everything back, including Supabase's settings.

**Otherwise, from Gaffer's copy** (it never touches the live project; it goes into a new one):

1. Make a new Supabase project (same region, eu-west-1), and copy its Session pooler connection string as above.
2. Add it as the repository secret `RESTORE_DB_URL`.
3. Actions, "Restore the database from a backup", Run workflow: `latest`, or a file's name (from the bucket in
   Cloudflare, R2, gaffer-backups, `daily/` or `monthly/`), and type `restore` in the confirm box.
4. It fetches the copy, decrypts it and puts it in: the accounts (with their passwords, so everyone signs in as before),
   then every table, row, security rule and function. It refuses a database that already has Gaffer's tables.
5. Then, in the new project: deploy the edge functions and set their secrets again (section 7 of CLAUDE.md lists
   them), set Auth's Site URL and redirects to `https://gaffermanager.app/`, and point `config.js` at the new project's
   URL and publishable key. That last one needs a new app build. Delete `RESTORE_DB_URL` afterwards.

From a computer with Postgres 17's tools, the same thing by hand (set the `BACKUP_*` values in the shell first):

```bash
scripts/db-backup.sh list
scripts/db-backup.sh fetch latest gaffer.dump
scripts/db-backup.sh restore gaffer.dump "<new project's connection string>"
# or just look inside: pg_restore --list gaffer.dump, or pg_restore -f gaffer.sql gaffer.dump
```

## Keeping it working

- GitHub turns off scheduled workflows in a public repo after 60 days with no commits. If that happens, the Actions page
  says so, with a button to turn it back on.
- `tests/backup.test.mjs` runs the script for real (a Postgres with every migration, a folder standing in for R2):
  dump, the restore check, encryption, the clear-out, fetching back, and restoring into a new project.
- A new schema in a migration needs adding to `SCHEMAS` in `scripts/db-backup.sh` (the backup stops and says so).
- Supabase moving to Postgres 18 means changing the `17`s in both workflows.
