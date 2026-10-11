-- kidTracker reports (design doc §5.7). Run once in the Supabase SQL editor,
-- after 0001_init.sql. Safe to re-run.
--
-- Views are the single definition of every derived number (nap vs. night,
-- daily totals). The app's Reports tab, CSV exports, and any ad-hoc SQL all
-- read these. They are security_invoker, so row-level security still applies.

alter table public.babies add column if not exists sex text check (sex in ('female','male'));
-- IANA time zone used to split days (e.g. 'America/Chicago'). The app sets it
-- from the phone's time zone.
alter table public.household_settings add column if not exists timezone text not null default 'UTC';

create or replace function public.household_tz() returns text
language sql stable as $$
  select coalesce((select timezone from public.household_settings limit 1), 'UTC');
$$;

-- Nap vs. night rule, defined once. Night = a sleep that starts between
-- 19:00 and 05:59 local time. Change the rule here; every report follows.
create or replace function public.sleep_kind(started_local timestamp) returns text
language sql immutable as $$
  select case when extract(hour from started_local) >= 19 or extract(hour from started_local) < 6
              then 'night' else 'nap' end;
$$;

-- ───────────── Flat per-category views (CSV-friendly) ─────────────

create or replace view public.v_sleep with (security_invoker = true) as
select e.id, e.baby_id,
       e.started_at, e.ended_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       public.sleep_kind(e.started_at at time zone public.household_tz()) as kind,
       e.notes, e.created_by
  from public.events e
 where e.type = 'sleep' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_feeds with (security_invoker = true) as
select e.id, e.baby_id, e.type::text as feed_type,
       e.started_at, e.ended_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       e.bottle_ml, e.bottle_contents,
       s.left_min, s.right_min,
       e.notes, e.created_by
  from public.events e
  left join lateral (
    select round(sum(extract(epoch from coalesce(ns.ended_at, ns.started_at) - ns.started_at)) filter (where ns.side = 'left') / 60)::int as left_min,
           round(sum(extract(epoch from coalesce(ns.ended_at, ns.started_at) - ns.started_at)) filter (where ns.side = 'right') / 60)::int as right_min
      from public.nursing_segments ns where ns.event_id = e.id
  ) s on true
 where e.type in ('nursing','bottle') and e.deleted_at is null
   and (e.type = 'bottle' or e.ended_at is not null);

create or replace view public.v_diapers with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       coalesce(e.diaper_wet, false) as wet, coalesce(e.diaper_dirty, false) as dirty,
       e.poop_color, e.poop_consistency, coalesce(e.diaper_rash, false) as rash,
       e.notes, e.created_by
  from public.events e
 where e.type = 'diaper' and e.deleted_at is null;

create or replace view public.v_pumps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at, e.ended_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       e.pump_side, e.pump_left_ml, e.pump_right_ml,
       coalesce(e.pump_left_ml, 0) + coalesce(e.pump_right_ml, 0) as total_ml,
       e.notes, e.created_by
  from public.events e
 where e.type = 'pump' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_meds with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       m.name as medication, e.dose_amount, e.dose_unit, e.notes, e.created_by
  from public.events e
  left join public.medications m on m.id = e.medication_id
 where e.type = 'medicine' and e.deleted_at is null;

create or replace view public.v_temps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       (e.started_at at time zone public.household_tz())::date as start_date,
       e.temp_c, e.temp_method, e.notes, e.created_by
  from public.events e
 where e.type = 'temperature' and e.deleted_at is null;

create or replace view public.v_growth with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       (e.started_at at time zone public.household_tz())::date as measured_on,
       e.weight_g, e.length_cm, e.head_cm, e.notes, e.created_by
  from public.events e
 where e.type = 'growth' and e.deleted_at is null;

-- ───────────── Daily summary ─────────────
-- One row per baby per local day. Sleep and tummy-time minutes are split at
-- local midnight, so an overnight sleep counts toward both days.

create or replace view public.v_daily_summary with (security_invoker = true) as
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

-- Make views reachable through the API (Supabase grants these by default for
-- new objects; repeated here so the script is self-contained).
grant select on public.v_sleep, public.v_feeds, public.v_diapers, public.v_pumps,
  public.v_meds, public.v_temps, public.v_growth, public.v_daily_summary to authenticated;
