-- Test data for the backup tests (on top of e2e/seed.sql).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cc', 'backup@example.com');
update household_settings set timezone = 'America/Chicago';
insert into babies (id, name, birth_date, sex) values ('00000000-0000-0000-0000-0000000000b1', 'Test', '2026-09-20', 'female');
insert into medications (id, name, default_dose, unit) values ('00000000-0000-0000-0000-0000000000d1', 'Vitamin D', 1, 'drop');
insert into events (baby_id, type, started_at, ended_at, created_by) values
  ('00000000-0000-0000-0000-0000000000b1','sleep','2026-10-11 02:00Z','2026-10-11 11:30Z','00000000-0000-0000-0000-00000000000a');
insert into events (baby_id, type, started_at, bottle_ml, bottle_contents, created_by) values
  ('00000000-0000-0000-0000-0000000000b1','bottle','2026-10-11 15:00Z', 118.294, 'formula','00000000-0000-0000-0000-00000000000b');
insert into events (baby_id, type, started_at, diaper_wet, diaper_dirty, poop_color, notes) values
  ('00000000-0000-0000-0000-0000000000b1','diaper','2026-10-11 16:00Z', true, true, 'yellow', 'note with, comma "quote"');
insert into events (baby_id, type, started_at, medication_id, dose_amount, dose_unit) values
  ('00000000-0000-0000-0000-0000000000b1','medicine','2026-10-11 17:00Z','00000000-0000-0000-0000-0000000000d1',1,'drop');
insert into events (baby_id, type, started_at, temp_c, temp_method) values ('00000000-0000-0000-0000-0000000000b1','temperature','2026-10-11 18:00Z', 37.2, 'axillary');
insert into events (baby_id, type, started_at, weight_g, length_cm) values ('00000000-0000-0000-0000-0000000000b1','growth','2026-10-11 19:00Z', 3402, 50.8);
insert into events (baby_id, type, started_at, deleted_at) values ('00000000-0000-0000-0000-0000000000b1','bath','2026-10-11 19:30Z', now());
insert into events (id, baby_id, type, started_at, ended_at) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','nursing','2026-10-11 20:00Z','2026-10-11 20:15Z');
insert into nursing_segments (event_id, side, started_at, ended_at) values
  ('30000000-0000-0000-0000-000000000001','left','2026-10-11 20:00Z','2026-10-11 20:10Z'),
  ('30000000-0000-0000-0000-000000000001','right','2026-10-11 20:10Z','2026-10-11 20:15Z');
-- 1500 diapers to exercise pagination (> 1000 rows)
insert into events (baby_id, type, started_at, diaper_wet, diaper_dirty)
select '00000000-0000-0000-0000-0000000000b1','diaper', '2026-09-21 00:00Z'::timestamptz + (g || ' minutes')::interval, true, false
from generate_series(1, 1500) g;
