#!/usr/bin/env bash
# Backup round trip: run the Apps Script (Google services stubbed) against a seeded
# local database, then restore its snapshot into a fresh database and verify it.
# Needs: Postgres (PG* env vars), `postgrest` (or POSTGREST=...), node, curl.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=kidtracker_backup_src; DST=kidtracker_backup_dst
SECRET=local-test-secret-local-test-secret-123
SNAP=$(mktemp); SQL=$(mktemp)
for db in $SRC $DST; do dropdb --if-exists $db; createdb $db
  psql -q -v ON_ERROR_STOP=1 -d $db -f supabase/tests/supabase_stub.sql -f supabase/migrations/0001_init.sql \
    -f supabase/migrations/0002_reports.sql -f supabase/migrations/0003_temperature_precision.sql -f supabase/migrations/0004_feed_sessions.sql -f supabase/migrations/0005_mom_meds.sql -f supabase/migrations/0006_push.sql -f supabase/migrations/0007_bottle_timer.sql -f supabase/tests/post_grants.sql -f e2e/seed.sql 2>&1 | grep -v NOTICE || true
done
psql -q -v ON_ERROR_STOP=1 -d $SRC -f backup/test/seed.sql
psql -q -v ON_ERROR_STOP=1 -d $DST -c "insert into babies(name) values ('junk')"

PGRST_DB_URI="postgres://authenticator:auth@${PGHOST:-localhost}:${PGPORT:-5432}/$SRC" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET=$SECRET PGRST_SERVER_PORT=3001 \
  "${POSTGREST:-postgrest}" > /tmp/postgrest-backup.log 2>&1 &
P1=$!
node backup/test/supabase-stub.mjs > /tmp/supabase-stub.log 2>&1 &
P2=$!
trap 'kill $P1 $P2 2>/dev/null; dropdb --if-exists $SRC; dropdb --if-exists $DST; rm -f $SNAP $SQL' EXIT
sleep 2

SNAPSHOT_OUT=$SNAP node backup/test/apps-script.test-harness.mjs
node -e "import('./public/restore.js').then(m => process.stdout.write(m.buildRestoreSql(JSON.parse(require('fs').readFileSync('$SNAP','utf8')))))" > $SQL
psql -q -v ON_ERROR_STOP=1 -d $DST -f $SQL > /dev/null
psql -q -v ON_ERROR_STOP=1 -d $DST -f backup/test/restore-check.sql
