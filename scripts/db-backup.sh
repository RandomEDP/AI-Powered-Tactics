#!/usr/bin/env bash
# Gaffer's own copy of the database, made every night by .github/workflows/db-backup.yml (or by hand from there).
# Supabase Pro keeps its own daily backups for 7 days; this one is ours: a pg_dump of everything the app keeps (teams,
# games, chat, posts, accounts), encrypted, in a private Cloudflare R2 bucket, kept for 30 days plus one a month for a
# year. supabase/BACKUPS.md says how to restore one.
#
#   scripts/db-backup.sh dump  <file>          make the dump (needs SUPABASE_DB_URL)
#   scripts/db-backup.sh check <file> <db url> restore it into an empty Postgres and check every row came back
#   scripts/db-backup.sh send  <file>          encrypt, upload to R2 and clear out old copies
#   scripts/db-backup.sh list                  what's in the bucket
#   scripts/db-backup.sh fetch <name> <file>   download one (a name from list, or "latest") and decrypt it
#   scripts/db-backup.sh restore <file> <db url> put it into a new, empty Supabase project
#
# The repo is public, so its Actions logs are too: nothing here prints a row, an address or a count of people.
set -euo pipefail

# The schemas the app's data lives in. The others belong to Supabase itself (realtime, vault, graphql, net, ...) and
# come with any new project.
SCHEMAS=${BACKUP_SCHEMAS:-"public private auth storage supabase_migrations"}
SUPABASE_OWN="extensions graphql graphql_public net realtime vault pgbouncer pgsodium pgsodium_masks supabase_functions cron pgtle _realtime _analytics _supavisor information_schema"
BUCKET=${BACKUP_R2_BUCKET:-gaffer-backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
KEEP_MONTHS=${BACKUP_KEEP_MONTHS:-12}

say() { echo "$*"; }
die() { echo "::error::$*" >&2; exit 1; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || die "The $v secret isn't set. supabase/BACKUPS.md says where to get it and where it goes."; done; }
s3() { aws --endpoint-url "$BACKUP_R2_ENDPOINT" --region auto "$@"; }

dump() {
  local out=$1
  need SUPABASE_DB_URL
  # A schema made by a new migration would otherwise be missed without anyone noticing.
  local missing
  missing=$(psql "$SUPABASE_DB_URL" -XAtq -v ON_ERROR_STOP=1 -c "select nspname from pg_namespace where nspname not like 'pg\_%' order by 1" \
    | while read -r s; do case " $SCHEMAS $SUPABASE_OWN " in *" $s "*) ;; *) echo "$s";; esac; done)
  [ -z "$missing" ] || die "The database has schemas the backup doesn't cover: $(echo $missing). Add them to SCHEMAS in scripts/db-backup.sh."
  local args=()
  for s in $SCHEMAS; do args+=(--schema="$s"); done
  pg_dump --dbname="$SUPABASE_DB_URL" --format=custom --compress=9 --no-subscriptions --no-publications "${args[@]}" --file="$out"
  local tables
  tables=$(pg_restore --list "$out" | grep -c ' TABLE DATA ' || true)
  [ "$tables" -gt 0 ] || die "The dump has no tables in it."
  say "Dump made: $tables tables, $(du -h "$out" | cut -f1)."
}

# Rows per table as written in the dump (COPY text has one line per row).
dump_counts() {
  pg_restore --data-only --file=- "$1" | awk '
    /^COPY / { t = $2; n = 0; on = 1; next }
    on && /^\\\.$/ { print t, n; on = 0; next }
    on { n++ }' | sort
}

check() {
  local file=$1 db=$2
  # What a Supabase database has before any of ours goes in: its roles and the extensions schema.
  psql "$db" -Xq -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin', 'supabase_auth_admin',
    'supabase_storage_admin', 'supabase_realtime_admin', 'dashboard_user', 'pgbouncer'] loop
    if not exists (select from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
SQL
  local errs
  errs=$(mktemp)
  pg_restore --dbname="$db" --no-owner --no-privileges "$file" 2>"$errs" || true
  # Only the first line of each error: DETAIL and CONTEXT lines can quote a row.
  local n
  # A new database already has a public schema, so that one's left out.
  sed -i '/schema "public" already exists/d' "$errs"
  n=$(grep -c 'ERROR: ' "$errs" || true)
  if [ "$n" -gt 0 ]; then
    say "pg_restore reported $n problem(s) (expected ones are Supabase's own extensions and functions a plain Postgres hasn't got):"
    grep -o 'ERROR: .*' "$errs" | cut -c1-120 | sort | uniq -c | sort -rn | awk 'NR <= 20' || true
  fi
  local bad=0 tables=0 t want got
  while read -r t want; do
    tables=$((tables + 1))
    got=$(psql "$db" -XAtq -c "select count(*) from $t" 2>/dev/null || echo missing)
    if [ "$got" != "$want" ]; then echo "::error::$t came back with $got rows instead of $want."; bad=$((bad + 1)); fi
  done < <(dump_counts "$file")
  [ "$tables" -gt 0 ] || die "Nothing to check: the dump has no rows."
  [ "$bad" -eq 0 ] || die "$bad of $tables tables didn't restore properly."
  # Rows the app can't do without, so an empty dump can't pass.
  for t in public.teams public.players; do
    got=$(psql "$db" -XAtq -c "select count(*) > 0 from $t")
    [ "$got" = t ] || die "$t is empty after the restore."
  done
  say "Restore checked: all $tables tables came back with every row."
}

send() {
  local file=$1
  need BACKUP_R2_ENDPOINT BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_PASSPHRASE
  export AWS_ACCESS_KEY_ID=$BACKUP_R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$BACKUP_R2_SECRET_ACCESS_KEY
  local name day month enc
  day=$(date -u +%Y-%m-%d); month=$(date -u +%Y-%m)
  name="gaffer-db-$(date -u +%Y-%m-%dT%H%MZ).dump.gpg"
  enc="$file.gpg"
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 3 --output "$enc" "$file" 3<<<"$BACKUP_PASSPHRASE"
  s3 s3 cp --only-show-errors "$enc" "s3://$BUCKET/daily/$name"
  local size
  size=$(s3 s3api head-object --bucket "$BUCKET" --key "daily/$name" --query ContentLength --output text)
  [ "$size" = "$(stat -c %s "$enc")" ] || die "The upload to R2 didn't arrive whole."
  say "Uploaded daily/$name ($(du -h "$enc" | cut -f1))."
  # The first backup of each month is also kept as that month's.
  if ! s3 s3 ls "s3://$BUCKET/monthly/gaffer-db-$month" >/dev/null 2>&1; then
    s3 s3 cp --only-show-errors "s3://$BUCKET/daily/$name" "s3://$BUCKET/monthly/$name"
    say "Kept as $month's monthly copy."
  fi
  prune daily "$(date -u -d "$day - $KEEP_DAYS days" +%Y-%m-%d)"
  prune monthly "$(date -u -d "$month-01 - $KEEP_MONTHS months" +%Y-%m-%d)"
}

# Deletes the copies in <folder> from before <date> (by the date in the name), never the newest one.
prune() {
  local folder=$1 before=$2 keys newest k d gone=0
  keys=$(s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$folder/" --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -v '^None$' | sort || true)
  newest=$(echo "$keys" | tail -1)
  for k in $keys; do
    d=$(echo "$k" | sed -nE 's#.*gaffer-db-([0-9]{4}-[0-9]{2}-[0-9]{2}).*#\1#p')
    [ -n "$d" ] && [ "$k" != "$newest" ] && [[ "$d" < "$before" ]] || continue
    s3 s3 rm --only-show-errors "s3://$BUCKET/$k"; gone=$((gone + 1))
  done
  [ "$gone" -eq 0 ] || say "Cleared $gone old $folder copies (from before $before)."
}

list() {
  need BACKUP_R2_ENDPOINT BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY
  export AWS_ACCESS_KEY_ID=$BACKUP_R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$BACKUP_R2_SECRET_ACCESS_KEY
  s3 s3 ls --recursive "s3://$BUCKET/"
}

fetch() {
  local name=$1 out=$2
  need BACKUP_R2_ENDPOINT BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_PASSPHRASE
  export AWS_ACCESS_KEY_ID=$BACKUP_R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$BACKUP_R2_SECRET_ACCESS_KEY
  if [ "$name" = latest ]; then
    name=$(s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix daily/ --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -v '^None$' | sort | tail -1)
    [ -n "$name" ] || die "There are no copies in the bucket yet."
  fi
  case $name in */*) ;; *) name="daily/$name";; esac
  s3 s3 cp --only-show-errors "s3://$BUCKET/$name" "$out.gpg"
  gpg --batch --yes --quiet --pinentry-mode loopback --decrypt --passphrase-fd 3 --output "$out" "$out.gpg" 3<<<"$BACKUP_PASSPHRASE"
  rm -f "$out.gpg"
  say "Saved $out ($(pg_restore --list "$out" | grep -c ' TABLE DATA ') tables)."
}

# A new Supabase project gives anon, authenticated and service_role every right on anything made in public (its
# "default privileges"). A dump's grants assume Postgres's own defaults, so restored as they are, functions only the
# server may call (ad_grant, pass_credit, ...) could be called by anyone. So the project's defaults are put aside
# while ours go in (revoke), then put back as they were (grant), all in the restore's one transaction.
default_privileges() {
  if [ "$1" = revoke ]; then
    cat <<'SQL'
create temp table restore_defaults on commit drop as
  select n.nspname, d.defaclobjtype, a.grantee, a.privilege_type, a.is_grantable
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
  where d.defaclrole = current_user::regrole;
SQL
  fi
  cat <<SQL
do \$\$ declare r record; begin
  for r in select * from restore_defaults loop
    execute format('alter default privileges for role %I in schema %I $1 %s on %s %s %s %s', current_user, r.nspname,
      r.privilege_type,
      case r.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end,
      case when '$1' = 'grant' then 'to' else 'from' end,
      case when r.grantee = 0 then 'public' else r.grantee::regrole::text end,
      case when '$1' = 'grant' and r.is_grantable then 'with grant option' else '' end);
  end loop; end \$\$;
SQL
}

# Into a new Supabase project (Supabase's own auth and storage tables already there, nothing of ours yet): first the
# accounts and storage rows, then our schemas with their rules and data, all in one go so a failure leaves nothing
# half done. Triggers and foreign keys are held off while the rows go in (session_replication_role), as Supabase's
# own guide does. Refuses a database that already has the app's tables, so it can't be pointed at the live one.
restore() {
  local file=$1 db=$2 list
  local have
  have=$(psql "$db" -XAtq -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname = 'public' and tablename in ('teams', 'players', 'games')")
  [ "$have" = 0 ] || die "That database already has Gaffer's tables in it. Restore into a new, empty Supabase project."
  list=$(mktemp)
  # Supabase's own bookkeeping rows (which version of auth and storage it runs) come with the new project.
  pg_restore --list "$file" | grep -E ' TABLE DATA (auth|storage) ' | grep -vE ' TABLE DATA (auth|storage) (schema_migrations|migrations) ' > "$list"
  { echo 'set session_replication_role = replica;'
    pg_restore --data-only --use-list="$list" --file=- "$file"
    # Then ours, minus the public schema itself (every database has one, and a project made with
    # Supabase's tools has supabase_migrations). Of auth's and storage's own
    # objects only our rules on storage.objects (the old clips bucket's) are ours; the rest come with the project.
    echo 'create schema if not exists supabase_migrations;'
    default_privileges revoke
    pg_restore --list "$file" | grep -vE ' SCHEMA - (public|supabase_migrations) | COMMENT - SCHEMA public ' \
      | awk '/ POLICY storage / || !/ (auth|storage) /' > "$list"
    pg_restore --no-owner --use-list="$list" --file=- "$file"
    default_privileges grant
  } | psql "$db" -Xq --single-transaction -v ON_ERROR_STOP=1 >/dev/null
  rm -f "$list"
  local got want
  got=$(psql "$db" -XAtq -c "select count(*) from pg_tables where schemaname in ('public', 'private')")
  want=$(pg_restore --list "$file" | grep -cE ' TABLE (public|private) ' || true)
  [ "$got" = "$want" ] || die "Only $got of $want tables are there after the restore."
  say "Restored: $want tables, with their rows, rules and functions, and the accounts."
}

cmd=${1:-}; shift || true
case $cmd in
  dump|check|send|list|fetch|restore) "$cmd" "$@" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
