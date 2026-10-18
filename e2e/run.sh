#!/usr/bin/env bash
# End-to-end test. Needs: a reachable Postgres (PG* env vars), the `postgrest`
# binary (or POSTGREST=/path/to/postgrest), and Playwright's Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=kidtracker_e2e
SECRET=local-test-secret-local-test-secret-123

dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" \
  -f supabase/tests/supabase_stub.sql -f supabase/migrations/0001_init.sql -f supabase/migrations/0002_reports.sql -f supabase/migrations/0003_temperature_precision.sql -f supabase/migrations/0004_feed_sessions.sql \
  -f supabase/tests/post_grants.sql -f e2e/seed.sql

PGRST_DB_URI="postgres://authenticator:auth@${PGHOST:-localhost}:${PGPORT:-5432}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET=$SECRET PGRST_SERVER_PORT=3001 \
  "${POSTGREST:-postgrest}" > /tmp/postgrest-e2e.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; dropdb --if-exists "$DB"' EXIT

VITE_SUPABASE_URL=https://abcdefgh.supabase.co VITE_SUPABASE_ANON_KEY=e2e VITE_BASE=/ \
  npx vite build --outDir e2e/dist --emptyOutDir > /dev/null
mkdir -p e2e/screenshots
node e2e/e2e.mjs e2e/dist e2e/screenshots
