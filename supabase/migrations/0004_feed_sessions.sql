-- kidTracker 0004: feeds grouped into sessions, time between feeds, and an
-- optional household day-start hour for the report views (design doc §8a A, C).
-- Run once in the Supabase SQL editor AFTER 0003. Safe to re-run.
--
-- * Nursing entries (and bottles) that start within `feed_gap_min` (default 20)
--   minutes of the previous one's end are ONE feed. Raw entries are untouched;
--   grouping happens when reading, so past days are corrected too.
-- * `day_start_hour` (default 0 = midnight, i.e. no change) moves where report
--   days begin, e.g. 19 to match the timeline's 7 pm. Changing it re-buckets all history.

alter table public.household_settings add column if not exists feed_gap_min int not null default 20
  check (feed_gap_min between 1 and 120);
alter table public.household_settings add column if not exists day_start_hour int not null default 0
  check (day_start_hour between 0 and 23);

create or replace function public.feed_gap_min() returns int
language sql stable as $$ select coalesce((select feed_gap_min from public.household_settings limit 1), 20); $$;

create or replace function public.day_start_hour() returns int
language sql stable as $$ select coalesce((select day_start_hour from public.household_settings limit 1), 0); $$;

-- The report day a moment belongs to (household time zone, day starting at day_start_hour).
create or replace function public.local_day(t timestamptz) returns date
language sql stable as $$
  select ((t at time zone public.household_tz()) - make_interval(hours => public.day_start_hour()))::date;
$$;

-- ───────────── Per-category views, now bucketed with local_day() ─────────────

create or replace view public.v_sleep with (security_invoker = true) as
select e.id, e.baby_id,
       e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       public.sleep_kind(e.started_at at time zone public.household_tz()) as kind,
       e.notes, e.created_by
  from public.events e
 where e.type = 'sleep' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_feeds with (security_invoker = true) as
select e.id, e.baby_id, e.type::text as feed_type,
       e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
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
       public.local_day(e.started_at) as start_date,
       coalesce(e.diaper_wet, false) as wet, coalesce(e.diaper_dirty, false) as dirty,
       e.poop_color, e.poop_consistency, coalesce(e.diaper_rash, false) as rash,
       e.notes, e.created_by
  from public.events e
 where e.type = 'diaper' and e.deleted_at is null;

create or replace view public.v_pumps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       e.pump_side, e.pump_left_ml, e.pump_right_ml,
       coalesce(e.pump_left_ml, 0) + coalesce(e.pump_right_ml, 0) as total_ml,
       e.notes, e.created_by
  from public.events e
 where e.type = 'pump' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_meds with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as start_date,
       m.name as medication, e.dose_amount, e.dose_unit, e.notes, e.created_by
  from public.events e
  left join public.medications m on m.id = e.medication_id
 where e.type = 'medicine' and e.deleted_at is null;

create or replace view public.v_temps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as start_date,
       e.temp_c, e.temp_method, e.notes, e.created_by
  from public.events e
 where e.type = 'temperature' and e.deleted_at is null;

create or replace view public.v_growth with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as measured_on,
       e.weight_g, e.length_cm, e.head_cm, e.notes, e.created_by
  from public.events e
 where e.type = 'growth' and e.deleted_at is null;

-- ───────────── Feed sessions ─────────────
-- One row per feed. A new feed starts when an entry begins more than feed_gap_min
-- minutes after everything before it has ended.

create or replace view public.v_feed_sessions with (security_invoker = true) as
with f as (
  select e.id, e.baby_id, e.type, e.started_at,
         coalesce(e.ended_at, e.started_at) as ended_at,
         e.bottle_ml,
         coalesce(s.left_s, 0) as left_s, coalesce(s.right_s, 0) as right_s
    from public.events e
    left join lateral (
      select sum(extract(epoch from ns.ended_at - ns.started_at)) filter (where ns.side = 'left') as left_s,
             sum(extract(epoch from ns.ended_at - ns.started_at)) filter (where ns.side = 'right') as right_s
        from public.nursing_segments ns where ns.event_id = e.id and ns.ended_at is not null
    ) s on true
   where e.deleted_at is null and e.type in ('nursing', 'bottle')
     and (e.type = 'bottle' or e.ended_at is not null)
),
g as (
  select f.*, max(f.ended_at) over w as prev_end
    from f
  window w as (partition by f.baby_id order by f.started_at, f.id rows between unbounded preceding and 1 preceding)
),
h as (
  select g.*,
         sum(case when g.prev_end is null
                    or g.started_at - g.prev_end > make_interval(mins => public.feed_gap_min())
                  then 1 else 0 end)
           over (partition by g.baby_id order by g.started_at, g.id) as session_no
    from g
),
s as (
  select (array_agg(h.id order by h.started_at, h.id))[1] as id,
         h.baby_id,
         min(h.started_at) as started_at,
         max(h.ended_at) as ended_at,
         count(*) filter (where h.type = 'nursing')::int as nursing_entries,
         count(*) filter (where h.type = 'bottle')::int as bottles,
         coalesce(sum(h.bottle_ml), 0) as bottle_ml,
         round(sum(h.left_s) / 60)::int as left_min,
         round(sum(h.right_s) / 60)::int as right_min
    from h
   group by h.baby_id, h.session_no
)
select s.*,
       public.local_day(s.started_at) as day,
       round(extract(epoch from s.ended_at - s.started_at) / 60)::int as duration_min,
       -- start-to-start time since the previous feed ("feeding every 3 hours")
       round(extract(epoch from s.started_at - lag(s.started_at) over (partition by s.baby_id order by s.started_at)) / 60)::int
         as minutes_since_prev
  from s;

-- ───────────── Daily summary ─────────────
-- Same columns as before (feeds now counts FEEDS, not entries), plus three at the end.

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
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type = 'medicine')::int as med_doses,
  -- new in 0004
  (select count(*) from ev where ev.baby_id = d.baby_id and ev.day = d.day and ev.type in ('nursing','bottle'))::int as feed_entries,
  (select round(avg(minutes_since_prev))::int from fs where fs.baby_id = d.baby_id and fs.day = d.day) as avg_feed_interval_min,
  (select max(minutes_since_prev) from fs where fs.baby_id = d.baby_id and fs.day = d.day) as longest_feed_interval_min
from days d;

grant select on public.v_sleep, public.v_feeds, public.v_diapers, public.v_pumps, public.v_meds,
  public.v_temps, public.v_growth, public.v_feed_sessions, public.v_daily_summary to authenticated;
