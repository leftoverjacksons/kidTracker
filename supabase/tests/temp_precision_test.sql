\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into events (baby_id, type, started_at, temp_c) values ('00000000-0000-0000-0000-0000000000b2', 'temperature', now(), 36.67);
do $$ begin
  assert (select temp_c from v_temps where temp_c is not null order by started_at desc limit 1) = 36.67, 'temperature lost precision';
  -- 98.0 °F round-trips exactly at 0.01 °C
  assert round(((select temp_c from events where type = 'temperature' order by started_at desc limit 1) * 9 / 5 + 32)::numeric, 1) = 98.0;
  -- v_daily_summary was rebuilt by 0003 and must give the same numbers as before
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-11') = 480, 'daily summary changed after 0003';
end $$;
reset role;
\echo 'TEMPERATURE PRECISION TEST PASSED'
