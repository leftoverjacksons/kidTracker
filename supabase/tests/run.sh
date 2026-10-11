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
