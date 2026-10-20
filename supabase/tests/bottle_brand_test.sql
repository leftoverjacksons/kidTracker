\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert 'bottle_brand' = any(app_features()) and 'bottle_timer' = any(app_features()), 'features';
  update events set bottle_brand = 'Comotomo' where id = '60000000-0000-0000-0000-000000000001';
  assert (select bottle_brand from events where id = '60000000-0000-0000-0000-000000000001') = 'Comotomo';
end $$;
reset role;
-- Re-running 0007 after 0008 must not hide the brand feature.
\i ../migrations/0007_bottle_timer.sql
set role authenticated;
do $$ begin assert 'bottle_brand' = any(app_features()) and 'bottle_start' = any(app_features()) and 'bottle_timer' = any(app_features()), format('features after re-running 0007: %s', app_features()); end $$;
reset role;
\echo 'BOTTLE BRAND TEST PASSED'
