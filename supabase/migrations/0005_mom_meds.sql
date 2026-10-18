-- kidTracker 0005: medicines for Mom (design doc §8a F).
-- Run once in the Supabase SQL editor AFTER 0004. Safe to re-run.
--
-- * medications.for_whom ('baby' | 'mom', default 'baby'). Mom's doses are logged as
--   ordinary medicine entries, but the baby's daily summary no longer counts them.
-- * v_meds gains a for_whom column (last), so exports and the pediatrician summary can
--   leave Mom's medicines out.

alter table public.medications add column if not exists for_whom text not null default 'baby'
  check (for_whom in ('baby', 'mom'));

create or replace view public.v_meds with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as start_date,
       m.name as medication, e.dose_amount, e.dose_unit, e.notes, e.created_by,
       coalesce(m.for_whom, 'baby') as for_whom
  from public.events e
  left join public.medications m on m.id = e.medication_id
 where e.type = 'medicine' and e.deleted_at is null;

-- Unchanged from 0004 except med_doses.
create or replace view public.v_daily_summary with (security_invoker = true) as
with tz as (select public.household_tz() as tz, make_interval(hours => public.day_start_hour()) as shift),
timed as (   -- sleep / tummy time cut into per-day pieces at the day-start hour
  select e.baby_id, e.type,
         public.sleep_kind(e.started_at at time zone tz.tz) as kind,
         d::date as day,
         extract(epoch from
           least((e.ended_at at time zone tz.tz) - tz.shift, d + interval '1 day')
           - greatest((e.started_at at time zone tz.tz) - tz.shift, d)) / 60 as minutes
    from public.events e cross join tz
    cross join lateral generate_series(
      date_trunc('day', (e.started_at at time zone tz.tz) - tz.shift),
      date_trunc('day', (e.ended_at at time zone tz.tz) - tz.shift),
      interval '1 day') d
   where e.type in ('sleep','tummy_time') and e.deleted_at is null and e.ended_at is not null
),
seg as (
  select e.baby_id, ns.side, public.local_day(ns.started_at) as day,
         extract(epoch from ns.ended_at - ns.started_at) / 60 as minutes
    from public.nursing_segments ns
    join public.events e on e.id = ns.event_id
   where e.deleted_at is null and ns.ended_at is not null
),
ev as (
  select e.*, public.local_day(e.started_at) as day
    from public.events e
   where e.deleted_at is null
),
fs as (select * from public.v_feed_sessions),
days as (
  select baby_id, day from timed union select baby_id, day from seg union select baby_id, day from ev
)
select d.baby_id, d.day,
  coalesce((select round(sum(minutes))::int from timed t where t.baby_id = d.baby_id and t.day = d.day and t.type = 'sleep'), 0) as sleep_min,
  coalesce((select round(sum(minutes))::int from timed t where t.baby_id = d.baby_id and t.day = d.day and t.type = 'sleep' and t.kind = 'night'), 0) as night_sleep_min,
  coalesce((select round(sum(minutes))::int from timed t where t.baby_id = d.baby_id and t.day = d.day and t.type = 'sleep' and t.kind = 'nap'), 0) as nap_sleep_min,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'sleep' and ev.ended_at is not null)::int as sleeps,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'nursing')::int as nursing_sessions,
  coalesce((select round(sum(minutes))::int from seg where seg.baby_id = d.baby_id and seg.day = d.day and seg.side = 'left'), 0) as nursing_left_min,
  coalesce((select round(sum(minutes))::int from seg where seg.baby_id = d.baby_id and seg.day = d.day and seg.side = 'right'), 0) as nursing_right_min,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'bottle')::int as bottles,
  coalesce((select sum(bottle_ml) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'bottle'), 0) as bottle_ml,
  (select count(*) from fs where fs.baby_id = d.baby_id and fs.day = d.day)::int as feeds,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper')::int as diapers,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper' and ev.diaper_wet)::int as wet_diapers,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper' and ev.diaper_dirty)::int as dirty_diapers,
  coalesce((select sum(coalesce(pump_left_ml,0) + coalesce(pump_right_ml,0)) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'pump' and ev.ended_at is not null), 0) as pump_ml,
  coalesce((select round(sum(minutes))::int from timed t where t.baby_id = d.baby_id and t.day = d.day and t.type = 'tummy_time'), 0) as tummy_min,
  -- baby's doses only: medicines marked for Mom are logged here too but are not the baby's (0005)
  (select count(*) from ev left join public.medications m on m.id = ev.medication_id
    where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'medicine' and coalesce(m.for_whom, 'baby') = 'baby')::int as med_doses,
  -- new in 0004
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type in ('nursing','bottle'))::int as feed_entries,
  (select round(avg(minutes_since_prev))::int from fs where fs.baby_id = d.baby_id and fs.day = d.day) as avg_feed_interval_min,
  (select max(minutes_since_prev) from fs where fs.baby_id = d.baby_id and fs.day = d.day) as longest_feed_interval_min
from days d;

grant select on public.v_meds, public.v_daily_summary to authenticated;
