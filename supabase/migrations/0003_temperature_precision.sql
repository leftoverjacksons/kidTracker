-- Store temperatures with 0.01 °C precision (was 0.1 °C).
-- 0.1 °C is 0.18 °F, so a reading like 98.0 °F was saved as 36.7 °C and came back as 98.1 °F.
-- Run once in the Supabase SQL editor after 0001 and 0002. Safe to re-run.
-- Existing readings keep their stored value; re-save one to correct it.

begin;
-- Views that reference events.temp_c must be dropped and recreated around the type change.
drop view if exists public.v_temps;
drop view if exists public.v_daily_summary;
alter table public.events alter column temp_c type numeric(5,2);
create view public.v_temps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       e.temp_c, e.temp_method, e.notes, e.created_by
  from public.events e
 where e.type = 'temperature' and e.deleted_at is null;

-- Unchanged copy of v_daily_summary from 0002_reports.sql.
create view public.v_daily_summary with (security_invoker = true) as
with tz as (select public.household_tz() as tz),
timed as (   -- sleep / tummy time intervals cut into per-day pieces
  select e.baby_id, e.type,
         public.sleep_kind(e.started_at at time zone tz.tz) as kind,
         d::date as day,
         extract(epoch from
           least(e.ended_at at time zone tz.tz, d + interval '1 day')
           - greatest(e.started_at at time zone tz.tz, d)) / 60 as minutes
    from public.events e cross join tz
    cross join lateral generate_series(
      date_trunc('day', e.started_at at time zone tz.tz),
      date_trunc('day', e.ended_at at time zone tz.tz),
      interval '1 day') d
   where e.type in ('sleep','tummy_time') and e.deleted_at is null and e.ended_at is not null
),
seg as (
  select e.baby_id, ns.side,
         (ns.started_at at time zone tz.tz)::date as day,
         extract(epoch from ns.ended_at - ns.started_at) / 60 as minutes
    from public.nursing_segments ns
    join public.events e on e.id = ns.event_id
    cross join tz
   where e.deleted_at is null and ns.ended_at is not null
),
ev as (
  select e.*, (e.started_at at time zone tz.tz)::date as day
    from public.events e cross join tz
   where e.deleted_at is null
),
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
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type in ('nursing','bottle'))::int as feeds,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper')::int as diapers,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper' and ev.diaper_wet)::int as wet_diapers,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'diaper' and ev.diaper_dirty)::int as dirty_diapers,
  coalesce((select sum(coalesce(pump_left_ml,0) + coalesce(pump_right_ml,0)) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'pump' and ev.ended_at is not null), 0) as pump_ml,
  coalesce((select round(sum(minutes))::int from timed t where t.baby_id = d.baby_id and t.day = d.day and t.type = 'tummy_time'), 0) as tummy_min,
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'medicine')::int as med_doses
from days d;

grant select on public.v_temps, public.v_daily_summary to authenticated;
commit;
