\set ON_ERROR_STOP 1
-- 0004: feed sessions, time between feeds, day-start hour. Fresh baby b3, Chicago (CDT, UTC-5).
reset role;
insert into babies (id, name) values ('00000000-0000-0000-0000-0000000000b3', 'F');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- Oct 12 local: nursing 10:00–10:10, 10:20–10:30, 10:45–10:55, bottle 11:05 → ONE feed
insert into events (id, baby_id, type, started_at, ended_at) values
  ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 15:00Z','2026-10-12 15:10Z'),
  ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 15:20Z','2026-10-12 15:30Z'),
  ('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 15:45Z','2026-10-12 15:55Z');
insert into nursing_segments (event_id, side, started_at, ended_at) values
  ('40000000-0000-0000-0000-000000000001','left','2026-10-12 15:00Z','2026-10-12 15:10Z'),
  ('40000000-0000-0000-0000-000000000002','right','2026-10-12 15:20Z','2026-10-12 15:30Z'),
  ('40000000-0000-0000-0000-000000000003','left','2026-10-12 15:45Z','2026-10-12 15:55Z');
insert into events (baby_id, type, started_at, bottle_ml) values
  ('00000000-0000-0000-0000-0000000000b3','bottle','2026-10-12 16:05Z', 30);
-- 13:00–13:15 → second feed (180 min after 10:00); 13:36 (21-min gap) → third feed
insert into events (baby_id, type, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 18:00Z','2026-10-12 18:15Z'),
  ('00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 18:36Z','2026-10-12 18:50Z');
-- A deleted nursing entry must not count
insert into events (baby_id, type, started_at, ended_at, deleted_at) values
  ('00000000-0000-0000-0000-0000000000b3','nursing','2026-10-12 20:00Z','2026-10-12 20:10Z', now());

do $$
declare f record; d record;
begin
  assert (select count(*) from v_feed_sessions where baby_id = '00000000-0000-0000-0000-0000000000b3') = 3, 'three feeds';
  select * into f from v_feed_sessions where baby_id = '00000000-0000-0000-0000-0000000000b3' order by started_at limit 1;
  assert f.id = '40000000-0000-0000-0000-000000000001', 'feed id = first entry';
  assert f.nursing_entries = 3 and f.bottles = 1 and f.bottle_ml = 30, format('first feed %s', f);
  assert f.left_min = 20 and f.right_min = 10, 'segment minutes';
  assert f.ended_at = '2026-10-12 16:05Z' and f.duration_min = 65 and f.minutes_since_prev is null;
  assert f.day = '2026-10-12';
  assert (select array_agg(minutes_since_prev order by started_at) from v_feed_sessions
           where baby_id = '00000000-0000-0000-0000-0000000000b3') = array[null, 180, 36]::int[], 'intervals';
  select * into d from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-12';
  assert d.feeds = 3 and d.feed_entries = 6 and d.nursing_sessions = 5, format('daily feeds %s', d);
  assert d.avg_feed_interval_min = 108 and d.longest_feed_interval_min = 180, 'daily intervals';
  -- earlier baby unchanged
  assert (select feeds from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-11') = 2;
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-11') = 480;
end $$;

-- A wider gap setting merges the 21-min gap
reset role;
update household_settings set feed_gap_min = 30;
set role authenticated;
do $$ begin
  assert (select count(*) from v_feed_sessions where baby_id = '00000000-0000-0000-0000-0000000000b3') = 2, 'gap setting';
end $$;

-- Day starting at 7 pm: sleep Oct 13 18:00–20:00 local splits 60 / 60
reset role;
update household_settings set feed_gap_min = 20, day_start_hour = 19;
set role authenticated;
insert into events (baby_id, type, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000b3','sleep','2026-10-13 23:00Z','2026-10-14 01:00Z');
do $$ begin
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-12') = 60, 'before 7 pm';
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-13') = 60, 'after 7 pm';
  assert (select start_date from v_sleep where baby_id = '00000000-0000-0000-0000-0000000000b3') = '2026-10-12';
  -- an 8 pm diaper belongs to the next report day
  assert public.local_day('2026-10-14 01:00Z') = '2026-10-13';
end $$;
reset role;
update household_settings set day_start_hour = 0;
set role authenticated;
do $$ begin
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-13') = 120, 'midnight default';
end $$;
reset role;
\echo 'FEED SESSIONS TEST PASSED'
