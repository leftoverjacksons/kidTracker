#!/usr/bin/env bash
# Runs the migration plus tests against a throwaway local Postgres database.
# Usage: supabase/tests/run.sh   (needs a reachable Postgres; set PG* env vars)
set -euo pipefail
cd "$(dirname "$0")"
DB=kidtracker_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0001_init.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f timers_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0002_reports.sql -f ../migrations/0002_reports.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f reports_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0003_temperature_precision.sql -f ../migrations/0003_temperature_precision.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f temp_precision_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0004_feed_sessions.sql -f ../migrations/0004_feed_sessions.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f feed_sessions_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0005_mom_meds.sql -f ../migrations/0005_mom_meds.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f mom_meds_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0006_push.sql -f ../migrations/0006_push.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0007_bottle_timer.sql -f ../migrations/0007_bottle_timer.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f bottle_timer_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0008_bottle_brand.sql -f ../migrations/0008_bottle_brand.sql -f post_grants.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f bottle_brand_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../reset_data.sql
test "$(psql -qtA -d "$DB" -c 'select (select count(*) from events) + (select count(*) from babies) + (select count(*) from nursing_segments)')" = 0
test "$(psql -qtA -d "$DB" -c 'select count(*) from caregivers')" = 2
echo 'RESET SCRIPT TEST PASSED'
