\set ON_ERROR_STOP 1
-- 0007: bottle timers. Earlier bottles (instants) were given end = start.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare r events; r2 events;
begin
  assert not exists (select 1 from events where type = 'bottle' and ended_at is null), 'old bottles still open';
  assert (select ended_at = started_at from events where type = 'bottle' and baby_id = '00000000-0000-0000-0000-0000000000b2' limit 1), 'old bottle not zero-length';
  -- Start from two phones at once → one timer.
  r := start_timer('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'bottle', now() - interval '12 minutes');
  r2 := start_timer('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b3', 'bottle', now());
  assert r2.id = r.id, 'second start made a second bottle timer';
  r := stop_timer(r.id, now());
  assert r.ended_at is not null and r.ended_at - r.started_at between interval '11 minutes' and interval '13 minutes';
  assert 'bottle_timer' = any(app_features()) and 'bottle_start' = any(app_features());
  update events set bottle_start_ml = 88.7, bottle_ml = 59.1 where id = r.id;
  assert (select bottle_start_ml - bottle_ml from events where id = r.id) = 29.6, 'start volume column';
  -- An earlier feed's day still counts this bottle once.
  assert (select count(*) from v_feed_sessions where id = '60000000-0000-0000-0000-000000000001') = 1;
end $$;
reset role;
\echo 'BOTTLE TIMER TEST PASSED'
