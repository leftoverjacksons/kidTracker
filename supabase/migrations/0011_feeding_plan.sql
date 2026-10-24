-- LakTrak 0011: the household's feeding plan (design doc §8a Q), shared by both phones.
-- Run once in the Supabase SQL editor. Safe to re-run. Until it runs the app uses the
-- defaults (target by age, nursing counted as 2.1 ml per minute, a feed every 3 hours)
-- and Settings shows the plan read-only.
--
-- feeding_plan holds, for example:
--   {"target": "age", "nursing_ml_per_min": 2.1, "every_min": 180}
--   {"target": {"min_ml": 75, "max_ml": 90}, "nursing_ml_per_min": 3, "every_min": 180}
alter table public.household_settings add column if not exists feeding_plan jsonb
  check (feeding_plan is null or jsonb_typeof(feeding_plan) = 'object');
