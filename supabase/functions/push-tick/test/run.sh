#!/usr/bin/env bash
# Integration test for the push-tick function: local Postgres + PostgREST (standing in for
# Supabase) and a fake push service that decrypts what it receives.
# Needs PG* env vars and the postgrest binary (POSTGREST=/path/to/postgrest).
set -euo pipefail
cd "$(dirname "$0")/../../../.."
DB=laktrak_push_$$
SECRET=local-test-secret-local-test-secret-123
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" \
  -f supabase/tests/supabase_stub.sql -f supabase/migrations/0001_init.sql -f supabase/migrations/0002_reports.sql \
  -f supabase/migrations/0003_temperature_precision.sql -f supabase/migrations/0004_feed_sessions.sql \
  -f supabase/migrations/0005_mom_meds.sql -f supabase/migrations/0006_push.sql -f supabase/migrations/0007_bottle_timer.sql -f supabase/migrations/0008_bottle_brand.sql -f supabase/migrations/0009_viewers.sql -f supabase/migrations/0010_bottle_pause.sql -f supabase/migrations/0009_viewers.sql -f supabase/migrations/0011_feeding_plan.sql -f supabase/migrations/0006_push.sql \
  -f supabase/tests/post_grants.sql -f e2e/seed.sql -f supabase/functions/push-tick/test/setup.sql
PGRST_DB_URI="postgres://authenticator:auth@${PGHOST:-localhost}:${PGPORT:-5432}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET=$SECRET PGRST_SERVER_PORT=3002 \
  "${POSTGREST:-postgrest}" > /tmp/postgrest-push.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; dropdb --if-exists "$DB"' EXIT
sleep 1.5
DB="$DB" node supabase/functions/push-tick/test/integration.mjs
