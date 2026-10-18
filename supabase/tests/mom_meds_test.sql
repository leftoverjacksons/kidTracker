\set ON_ERROR_STOP 1
-- 0005: medicines for Mom are kept out of the baby's daily medicine count.
reset role;
insert into medications (id, name, min_interval_hours, for_whom) values
  ('50000000-0000-0000-0000-000000000001', 'Ibuprofen', 6, 'mom');
insert into medications (id, name) values ('50000000-0000-0000-0000-000000000002', 'Vitamin D');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into events (baby_id, type, started_at, medication_id) values
  ('00000000-0000-0000-0000-0000000000b3', 'medicine', '2026-10-15 15:00Z', '50000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b3', 'medicine', '2026-10-15 21:00Z', '50000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b3', 'medicine', '2026-10-15 16:00Z', '50000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select med_doses from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-15') = 1, 'mom doses counted for baby';
  assert (select count(*) from v_meds where baby_id = '00000000-0000-0000-0000-0000000000b3' and for_whom = 'mom') = 2;
  assert (select for_whom from medications where name = 'Vitamin D') = 'baby', 'default is baby';
  -- 0004 behaviour unchanged
  assert (select feeds from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b3' and day = '2026-10-12') = 3;
end $$;
reset role;
\echo 'MOM MEDS TEST PASSED'
