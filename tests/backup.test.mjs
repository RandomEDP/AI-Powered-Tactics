// The nightly database backup (scripts/db-backup.sh, .github/workflows/db-backup.yml) run for real: a Postgres made
// here with every migration and some awkward rows stands in for Supabase, and a folder stands in for the R2 bucket
// (a pretend `aws` on PATH). It dumps, restores into an empty database and checks every row, encrypts, uploads, clears
// out old copies, and fetches one back; and the logs never show the data. Needs Postgres's own programs (initdb,
// pg_ctl, pg_dump), which the ubuntu runners have; ALLOW_NO_POSTGRES=1 skips it on a machine without them.
import { suite, ROOT } from './lib.mjs';
import { SUPABASE } from './pg.mjs';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { check, eq, done } = suite('database backup');

const bins = fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort((a, b) => b - a).map((v) => `/usr/lib/postgresql/${v}/bin`).filter((d) => fs.existsSync(`${d}/initdb`)) : [];
if (!bins.length) {
  console.log('SKIPPED: no Postgres programs (initdb) on this machine' + (process.env.ALLOW_NO_POSTGRES ? '' : '; set ALLOW_NO_POSTGRES=1 to allow this'));
  if (!process.env.ALLOW_NO_POSTGRES) process.exitCode = 1;
} else {
  const bin = bins[0], root = process.getuid?.() === 0;
  const tmp = fs.mkdtempSync(path.join(root ? '/var/tmp' : os.tmpdir(), 'gaffer-backup-'));
  fs.chmodSync(tmp, 0o777);
  // As root, Postgres has to run as its own user.
  const as = (cmd, args) => (root ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' }) : spawnSync(cmd, args, { encoding: 'utf8' }));
  const data = path.join(tmp, 'data'), sock = tmp, port = String(56000 + Math.floor(Math.random() * 1000));
  const url = (db) => `postgresql://postgres@localhost:${port}/${db}?host=${sock}`;
  let r = as(`${bin}/initdb`, ['-D', data, '-A', 'trust', '-U', 'postgres']);
  check(r.status === 0, 'a stand-in Postgres starts: ' + r.stderr);
  r = as(`${bin}/pg_ctl`, ['-D', data, '-o', `-p ${port} -k ${sock} -c listen_addresses=`, '-l', path.join(tmp, 'log'), '-w', 'start']);
  check(r.status === 0, 'it runs: ' + r.stderr);
  const env = { ...process.env, PATH: `${path.join(tmp, 'fakebin')}:${bin}:${process.env.PATH}` };
  const psql = (db, sql) => spawnSync(`${bin}/psql`, ['-XAtq', '-v', 'ON_ERROR_STOP=1', url(db)], { input: sql, encoding: 'utf8' });
  const sh = (args, extra = {}) => { const x = spawnSync(path.join(ROOT, 'scripts/db-backup.sh'), args, { encoding: 'utf8', env: { ...env, ...extra } }); return { ...x, out: x.stdout + x.stderr }; };
  try {
    // "Supabase": its roles and schemas, every migration, and rows with tabs, newlines, backslashes, quotes and emoji in.
    psql('postgres', 'create database live; create database restored; create database spoilt; create database fresh;');
    const live = psql('live', `${SUPABASE}
      create extension pgcrypto schema extensions;
      create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key);
      create schema realtime; create schema vault;
      set search_path = public, extensions;
      ${fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')).join('\n;\n')}
      ;
      insert into auth.users (email) select 'person' || g || '@example.com' from generate_series(1, 12) g;
      insert into public.teams (code, organiser_code, name, created_by)
        select 'BKUP0' || g, 'BKUPORG00' || g, 'Backup Rovers ' || g || E' tab\\there\\nnew line \\\\ ''quote'' ⚽', (select id from auth.users order by email limit 1) from generate_series(1, 3) g;
      insert into public.players (team_id, pid, name, user_id) select t.id, g, 'Squaddie ' || g, (select id from auth.users order by email offset g limit 1) from public.teams t, generate_series(1, 8) g;
      insert into supabase_migrations.schema_migrations values ('0001'), ('0002');
      insert into storage.objects (bucket_id, name) values ('clips', 'BKUP01/game/01.mp4');
      select count(*) from public.players;`);
    eq(live.stdout.trim().split('\n').pop(), '24', 'the stand-in database has every migration and some rows: ' + live.stderr.slice(0, 300));
    const secret = /Backup Rovers|person\d+@example|Squaddie|BKUPORG/;

    // 1. The dump
    const dump = path.join(tmp, 'gaffer.dump');
    let x = sh(['dump', dump], { SUPABASE_DB_URL: url('live') });
    check(x.status === 0 && /Dump made: \d+ tables/.test(x.out), 'it makes a dump: ' + x.out);
    check(!secret.test(x.out), 'and says nothing about what is in it');
    const toc = spawnSync(`${bin}/pg_restore`, ['--list', dump], { encoding: 'utf8' }).stdout;
    for (const t of ['public teams', 'public players', 'auth users', 'storage objects', 'supabase_migrations schema_migrations']) check(toc.includes(`TABLE DATA ${t} `), `it has ${t.replace(' ', '.')}'s rows`);
    check(/POLICY public /.test(toc) && /FUNCTION private /.test(toc), 'and the security rules and private functions');
    check(!/ (realtime|vault) /.test(toc), 'but not Supabase\'s own schemas');
    x = sh(['dump', dump]);
    check(x.status !== 0 && /SUPABASE_DB_URL secret isn't set/.test(x.out), 'with no connection string it says which secret is missing');
    psql('live', 'create schema newstuff;');
    x = sh(['dump', path.join(tmp, 'other.dump')], { SUPABASE_DB_URL: url('live') });
    check(x.status !== 0 && /schemas the backup doesn't cover: newstuff/.test(x.out), 'a schema it would miss stops the backup and is named');
    psql('live', 'drop schema newstuff;');

    // 2. The restore check
    x = sh(['check', dump, url('restored')]);
    check(x.status === 0 && /all \d+ tables came back with every row/.test(x.out), 'it restores into an empty Postgres with every row: ' + x.out);
    check(!secret.test(x.out), 'without printing any of it');
    const same = (q) => eq(psql('restored', q).stdout, psql('live', q).stdout, `restored the same as live: ${q}`);
    same('select string_agg(name, \'|\' order by code) from public.teams');
    same('select string_agg(email || id, \'|\' order by email) from auth.users');
    same('select count(*) from pg_policies where schemaname = \'public\'');
    same('select string_agg(proname, \',\' order by proname) from pg_proc where pronamespace = \'private\'::regnamespace');
    psql('spoilt', 'create table public.teams (id int);');
    x = sh(['check', dump, url('spoilt')]);
    check(x.status !== 0 && /public\.teams came back with 0 rows instead of 3/.test(x.out), 'a restore that loses rows fails and names the table: ' + x.out.slice(-300));

    // 3. Restoring into a new Supabase project: its own auth and storage tables are there, nothing of ours.
    psql('fresh', `${SUPABASE.replace(/create role [^;]*;/g, '')} create extension pgcrypto schema extensions;`); // (roles belong to the whole server, so they're there already)
    const defaults = psql('fresh', 'select string_agg(defaclobjtype || array_to_string(defaclacl, \' \'), \',\' order by defaclobjtype) from pg_default_acl').stdout;
    x = sh(['restore', dump, url('fresh')]);
    check(x.status === 0 && /Restored: \d+ tables/.test(x.out), 'a copy restores into a new Supabase project: ' + x.out.slice(-400));
    const fresh = (what, q) => { const a = psql('fresh', q), b = psql('live', q); check(a.stdout === b.stdout && b.stdout.trim() !== '', `the new project has the same ${what} as live` + (a.stderr ? ': ' + a.stderr.slice(0, 200) : '')); };
    fresh('teams', 'select string_agg(name, \'|\' order by code) from public.teams');
    fresh('players, linked to the same accounts', 'select string_agg(t.code || p.pid || p.name || coalesce(u.email, \'\'), \'|\' order by t.code, p.pid) from public.players p join public.teams t on t.id = p.team_id left join auth.users u on u.id = p.user_id');
    fresh('accounts', 'select string_agg(email || id, \'|\' order by email) from auth.users');
    fresh('security rules, the storage ones too', 'select string_agg(schemaname || tablename || policyname || coalesce(qual, \'\') || coalesce(with_check, \'\'), \',\' order by schemaname, tablename, policyname) from pg_policies');
    fresh('triggers', 'select string_agg(tgname, \',\' order by tgname) from pg_trigger where not tgisinternal');
    // (A new project lets anon, authenticated and service_role call anything made in public; restored naively, functions
    // only the server may call, such as ad_grant, could be called by anyone.)
    fresh('functions, with exactly who may call each', 'select string_agg(p.oid::regprocedure::text || coalesce(array_to_string(p.proacl, \' \'), \'\'), \',\' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace in (\'public\'::regnamespace, \'private\'::regnamespace)');
    fresh('tables, with exactly who may use each', 'select string_agg(c.oid::regclass::text || coalesce(array_to_string(c.relacl, \' \'), \'\') || c.relrowsecurity, \',\' order by c.oid::regclass::text) from pg_class c where c.relkind in (\'r\', \'S\', \'v\') and c.relnamespace in (\'public\'::regnamespace, \'private\'::regnamespace)');
    eq(psql('fresh', 'select count(*) from pg_proc where proname = \'ad_grant\' and has_function_privilege(\'anon\', oid, \'execute\')').stdout.trim(), '0', 'anon still can\'t call ad_grant');
    eq(psql('fresh', 'select string_agg(defaclobjtype || array_to_string(defaclacl, \' \'), \',\' order by defaclobjtype) from pg_default_acl').stdout, defaults, 'and the new project\'s own defaults are put back as they were');
    fresh('migration list', 'select string_agg(version, \',\' order by version) from supabase_migrations.schema_migrations');
    fresh('storage file list', 'select count(*) from storage.objects');
    x = sh(['restore', dump, url('fresh')]);
    check(x.status !== 0 && /already has Gaffer's tables/.test(x.out), 'a second go is refused rather than mixing the two');
    x = sh(['restore', dump, url('live')]);
    check(x.status !== 0 && /already has Gaffer's tables/.test(x.out), 'and it can never be pointed at the live database');
    eq(psql('live', 'select count(*) from public.teams').stdout.trim(), '3', 'which is left as it was');

    // 4. Encrypt, upload, keep 30 days and one a month, fetch back. The bucket is a folder; `aws` is pretend.
    const bucket = path.join(tmp, 'r2'), fake = path.join(tmp, 'fakebin');
    fs.mkdirSync(fake); fs.mkdirSync(path.join(bucket, 'gaffer-backups'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'aws'), `#!/usr/bin/env bash
# Enough of the aws command for db-backup.sh, against a folder.
set -e; B=${JSON.stringify(bucket)}; echo "$*" >> "$B/calls"
args=(); for a in "$@"; do [ "$a" = --only-show-errors ] || args+=("$a"); done; set -- "\${args[@]}"
while [ "\${1#--}" != "$1" ]; do shift 2; done
p() { echo "$B/\${1#s3://}"; }
case "$1 $2" in
  "s3 cp") a=$3; b=$4; [ "\${a#s3://}" != "$a" ] && a=$(p "$a"); [ "\${b#s3://}" != "$b" ] && b=$(p "$b"); mkdir -p "$(dirname "$b")"; cp "$a" "$b" ;;
  "s3 rm") rm "$(p "$3")" ;;
  "s3 ls") if [ "$3" = --recursive ]; then (cd "$(p "$4")" && find . -type f | sed 's#^./##'); else ls "$(p "$3")"* >/dev/null 2>&1; fi ;;
  "s3api head-object") stat -c %s "$B/$4/$6" ;;
  "s3api list-objects-v2") (cd "$B/$4" && ls $6* 2>/dev/null | tr '\\n' '\\t'); echo ;;
  *) echo "pretend aws can't: $*" >&2; exit 2 ;;
esac
`, { mode: 0o755 });
    const keys = () => (function walk(d, pre = '') { return fs.readdirSync(d).flatMap((f) => (fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f), pre + f + '/') : [pre + f])); })(path.join(bucket, 'gaffer-backups')).sort();
    const put = (k) => { fs.mkdirSync(path.dirname(path.join(bucket, 'gaffer-backups', k)), { recursive: true }); fs.writeFileSync(path.join(bucket, 'gaffer-backups', k), 'old'); };
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    put(`daily/gaffer-db-${day(45)}T0317Z.dump.gpg`); put(`daily/gaffer-db-${day(31)}T0317Z.dump.gpg`); put(`daily/gaffer-db-${day(29)}T0317Z.dump.gpg`);
    put(`monthly/gaffer-db-${day(400).slice(0, 8)}01T0317Z.dump.gpg`); put(`monthly/gaffer-db-${day(300).slice(0, 8)}01T0317Z.dump.gpg`);
    const r2 = { BACKUP_R2_ENDPOINT: 'https://r2.invalid', BACKUP_R2_ACCESS_KEY_ID: 'id', BACKUP_R2_SECRET_ACCESS_KEY: 'key', BACKUP_PASSPHRASE: 'a long test passphrase' };
    x = sh(['send', dump], { ...r2, BACKUP_PASSPHRASE: '' });
    check(x.status !== 0 && /BACKUP_PASSPHRASE secret isn't set/.test(x.out), 'it never uploads a copy it couldn\'t encrypt');
    x = sh(['send', dump], r2);
    check(x.status === 0 && /Uploaded daily\/gaffer-db-/.test(x.out), 'it uploads the copy: ' + x.out);
    const today = new Date().toISOString().slice(0, 10);
    const daily = keys().filter((k) => k.startsWith('daily/')), monthly = keys().filter((k) => k.startsWith('monthly/'));
    eq(daily.length, 2, 'nightly copies over 30 days old are cleared, newer ones kept');
    check(daily.some((k) => k.includes(day(29))) && daily.some((k) => k.includes(today)), 'the one from 29 days ago is kept, and today\'s is there');
    check(monthly.some((k) => k.includes(today)) && monthly.some((k) => k.includes(day(300).slice(0, 7))) && monthly.length === 2, 'the month\'s first copy is kept as a monthly one; a monthly over a year old goes');
    const sent = fs.readFileSync(path.join(bucket, 'gaffer-backups', daily.find((k) => k.includes(today))));
    check(!secret.test(sent.toString('latin1')) && !sent.subarray(0, 5).equals(Buffer.from('PGDMP')), 'what goes to R2 is encrypted');
    check(/--endpoint-url https:\/\/r2\.invalid --region auto/.test(fs.readFileSync(path.join(bucket, 'calls'), 'utf8')), 'it talks to the R2 address it was given');
    x = sh(['send', dump], r2);
    eq(keys().filter((k) => k.startsWith('monthly/')).length, 2, 'a second copy in the same month isn\'t kept as another monthly one');
    const back = path.join(tmp, 'back.dump');
    x = sh(['fetch', path.basename(daily.find((k) => k.includes(today))), back], r2);
    check(x.status === 0 && fs.readFileSync(back).equals(fs.readFileSync(dump)), 'a copy fetched back from R2 is exactly the dump: ' + x.out);
    x = sh(['fetch', path.basename(daily.find((k) => k.includes(today))), path.join(tmp, 'bad.dump')], { ...r2, BACKUP_PASSPHRASE: 'wrong' });
    check(x.status !== 0, 'and the wrong passphrase can\'t open it');

    // 5. The workflows
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/db-backup.yml'), 'utf8');
    check(/schedule:\s*\n\s*- cron: '\d+ \d+ \* \* \*'/.test(wf) && /workflow_dispatch:/.test(wf), 'it runs every night and can be run by hand');
    const pgv = (wf.match(/postgresql-client-(\d+)/) || [])[1];
    check(pgv && wf.includes(`image: postgres:${pgv}`), 'its pg_dump and the Postgres it restores into are the same version');
    for (const s of ['SUPABASE_DB_URL', 'BACKUP_R2_ENDPOINT', 'BACKUP_R2_ACCESS_KEY_ID', 'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_PASSPHRASE']) check(wf.includes(`secrets.${s}`), `it gets ${s} from the repository secrets`);
    check(!/upload-artifact/.test(wf), 'it never keeps the dump as a run artifact (the repo is public)');
    check(/continue-on-error: true/.test(wf) && /steps\.check\.outcome != 'success'/.test(wf), 'a copy that fails the restore check is still kept, and the run goes red');
    const rwf = fs.readFileSync(path.join(ROOT, '.github/workflows/db-restore.yml'), 'utf8');
    check(!/schedule:/.test(rwf) && /inputs\.confirm != 'restore'/.test(rwf), 'the restore only runs by hand, with restore typed in');
    check(/secrets\.RESTORE_DB_URL/.test(rwf) && !/secrets\.SUPABASE_DB_URL/.test(rwf), 'and only into the RESTORE_DB_URL database, never the live one\'s');
    check(!/\$\{\{ inputs\.backup \}\}"?\s*"?\$RUNNER/.test(rwf) && /WHICH: \$\{\{ inputs\.backup \}\}/.test(rwf), 'the name typed in goes through an environment variable, not into the script');
    const doc = fs.readFileSync(path.join(ROOT, 'supabase/BACKUPS.md'), 'utf8');
    for (const s of ['SUPABASE_DB_URL', 'BACKUP_R2_ENDPOINT', 'BACKUP_R2_ACCESS_KEY_ID', 'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_PASSPHRASE', 'RESTORE_DB_URL']) check(doc.includes(s), `BACKUPS.md says where ${s} comes from`);
  } finally {
    as(`${bin}/pg_ctl`, ['-D', data, '-m', 'immediate', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
done();
