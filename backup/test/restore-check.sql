\set ON_ERROR_STOP 1
-- Compares the restored database (current) with the source via dblink-free checks on expected values.
do $$ begin
  assert (select count(*) from events) = 1508, 'event count after restore';
  assert (select count(*) from events where deleted_at is not null) = 1, 'soft-deleted row restored';
  assert (select count(*) from nursing_segments) = 2, 'segments restored';
  assert (select name from babies) = 'Test', 'baby restored, junk removed';
  assert (select timezone from household_settings) = 'America/Chicago', 'settings restored';
  assert (select bottle_ml from events where type = 'bottle') = 118.3, 'bottle volume';
  assert (select notes from events where poop_color = 'yellow') = 'note with, comma "quote"', 'notes with quotes';
end $$;
-- Report views show data to people on the caregiver list (0009), so check as a caregiver.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \g /dev/null
do $$ begin
  assert (select sleep_min from v_daily_summary where day = '2026-10-11') = 390, 'views work on restored data';
end $$;
reset role;
\echo 'RESTORE TEST PASSED'
