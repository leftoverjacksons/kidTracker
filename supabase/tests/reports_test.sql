\set ON_ERROR_STOP 1
-- Uses the caregivers from timers_test.sql. Fresh baby so counts are exact.
reset role;
update household_settings set timezone = 'America/Chicago';
insert into babies (id, name, sex) values ('00000000-0000-0000-0000-0000000000b2', 'R', 'female');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- Overnight sleep 2026-10-10 21:00 → 2026-10-11 06:30 Chicago (CDT, UTC-5)
insert into events (baby_id, type, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000b2','sleep','2026-10-11 02:00Z','2026-10-11 11:30Z'),
-- Nap 2026-10-11 13:00 → 14:30
  ('00000000-0000-0000-0000-0000000000b2','sleep','2026-10-11 18:00Z','2026-10-11 19:30Z'),
-- Bottle 3 oz, two diapers, a deleted diaper that must not count
  ('00000000-0000-0000-0000-0000000000b2','bottle','2026-10-11 15:00Z', null);
update events set bottle_ml = 88.7 where type = 'bottle' and baby_id = '00000000-0000-0000-0000-0000000000b2';
insert into events (baby_id, type, started_at, diaper_wet, diaper_dirty, deleted_at) values
  ('00000000-0000-0000-0000-0000000000b2','diaper','2026-10-11 16:00Z', true, false, null),
  ('00000000-0000-0000-0000-0000000000b2','diaper','2026-10-11 17:00Z', true, true, null),
  ('00000000-0000-0000-0000-0000000000b2','diaper','2026-10-11 17:30Z', true, true, now());
-- Nursing 10 min left + 5 right
insert into events (id, baby_id, type, started_at, ended_at) values
  ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','nursing','2026-10-11 20:00Z','2026-10-11 20:15Z');
insert into nursing_segments (event_id, side, started_at, ended_at) values
  ('30000000-0000-0000-0000-000000000001','left','2026-10-11 20:00Z','2026-10-11 20:10Z'),
  ('30000000-0000-0000-0000-000000000001','right','2026-10-11 20:10Z','2026-10-11 20:15Z');

do $$
declare d10 record; d11 record;
begin
  select * into d10 from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-10';
  select * into d11 from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-11';
  assert d10.sleep_min = 180, format('oct10 sleep %s', d10.sleep_min);          -- 21:00–24:00
  assert d10.night_sleep_min = 180;
  assert d11.sleep_min = 390 + 90, format('oct11 sleep %s', d11.sleep_min);     -- 00:00–06:30 + nap
  assert d11.night_sleep_min = 390 and d11.nap_sleep_min = 90, 'night/nap split';
  assert d11.sleeps = 1, 'overnight sleep counted on its start day only';
  assert d11.bottle_ml = 88.7 and d11.bottles = 1;
  assert d11.diapers = 2 and d11.wet_diapers = 2 and d11.dirty_diapers = 1, 'deleted diaper excluded';
  assert d11.nursing_left_min = 10 and d11.nursing_right_min = 5 and d11.feeds = 2;
  assert (select kind from v_sleep where started_at = '2026-10-11 02:00Z') = 'night';
  assert (select kind from v_sleep where started_at = '2026-10-11 18:00Z') = 'nap';
  assert (select left_min from v_feeds where id = '30000000-0000-0000-0000-000000000001') = 10;
end $$;

-- Outsider sees no report rows
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$ begin
  assert (select count(*) from v_daily_summary) = 0, 'outsider can read v_daily_summary';
  assert (select count(*) from v_sleep) = 0, 'outsider can read v_sleep';
end $$;
reset role;
\echo 'REPORT VIEW TESTS PASSED'
