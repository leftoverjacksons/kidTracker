-- LakTrak 0009: guest (viewer) accounts — read-only, no notes, no medicines for Mom
-- (design doc §8a M). Run once in the Supabase SQL editor, after 0008. Safe to re-run.
--
-- * caregivers.role: 'caregiver' (you two; the default) or 'viewer'.
-- * The database refuses every change from a viewer (insert/update/delete, timers).
-- * Viewers read events through public.events_visible: notes are blanked and Mom's
--   medicines left out. All report views now read through it too, so caregivers see the
--   same as before and viewers get reports without the hidden parts.
--
-- To add a guest: Authentication → Add user (email + password, Auto Confirm), then run
--   update public.caregivers set role = 'viewer' where email = 'their@email';

begin;

alter table public.caregivers add column if not exists role text not null default 'caregiver'
  check (role in ('caregiver', 'viewer'));

-- Only a full caregiver may change data. Anyone on the list may read.
create or replace function public.is_caregiver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.caregivers where id = auth.uid() and role = 'caregiver');
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.caregivers where id = auth.uid());
$$;
grant execute on function public.is_member() to authenticated;

-- People can't change their own role from the app (the SQL editor, where auth.uid() is null, can).
create or replace function public.protect_role() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role can only be changed by the owner in Supabase';
  end if;
  return new;
end $$;
drop trigger if exists caregivers_protect_role on public.caregivers;
create trigger caregivers_protect_role before update on public.caregivers
  for each row execute function public.protect_role();

-- Reading: everyone on the list. Writing stays caregiver-only (the *_all policies from 0001).
drop policy if exists caregivers_read on public.caregivers;
create policy caregivers_read on public.caregivers for select to authenticated using (public.is_member());
drop policy if exists settings_read on public.household_settings;
create policy settings_read on public.household_settings for select to authenticated using (public.is_member());
drop policy if exists babies_view on public.babies;
create policy babies_view on public.babies for select to authenticated using (public.is_member());
drop policy if exists segments_view on public.nursing_segments;
create policy segments_view on public.nursing_segments for select to authenticated using (public.is_member());
drop policy if exists medications_view on public.medications;
create policy medications_view on public.medications for select to authenticated
  using (public.is_caregiver() or (public.is_member() and for_whom <> 'mom'));
-- (No viewer policy on events itself: viewers read events_visible.)

-- Events as the current person may see them: same columns as events, notes blanked for
-- viewers, Mom's medicines left out for viewers. Built from the live column list so any
-- columns added by earlier migrations are included.
do $$
declare cols text;
begin
  select string_agg(case when column_name = 'notes'
                         then 'case when public.is_caregiver() then e.notes end as notes'
                         else 'e.' || quote_ident(column_name) end, ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'events';
  execute 'drop view if exists public.events_visible cascade';
  execute format($v$
    create view public.events_visible with (security_barrier = true) as
    select %s
      from public.events e
     where public.is_member()
       and (public.is_caregiver() or e.type <> 'medicine'
            or coalesce((select m.for_whom from public.medications m where m.id = e.medication_id), 'baby') <> 'mom')
  $v$, cols);
end $$;
grant select on public.events_visible to authenticated;

-- Report views, unchanged except that they read public.events_visible.
create or replace view public.v_sleep with (security_invoker = true) as
select e.id, e.baby_id,
       e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       public.sleep_kind(e.started_at at time zone public.household_tz()) as kind,
       e.notes, e.created_by
  from public.events_visible e
 where e.type = 'sleep' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_feeds with (security_invoker = true) as
select e.id, e.baby_id, e.type::text as feed_type,
       e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
       e.bottle_ml, e.bottle_contents,
       s.left_min, s.right_min,
       e.notes, e.created_by
  from public.events_visible e
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
  from public.events_visible e
 where e.type = 'diaper' and e.deleted_at is null;

create or replace view public.v_pumps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at, e.ended_at,
       public.local_day(e.started_at) as start_date,
       round(extract(epoch from e.ended_at - e.started_at) / 60)::int as duration_min,
       e.pump_side, e.pump_left_ml, e.pump_right_ml,
       coalesce(e.pump_left_ml, 0) + coalesce(e.pump_right_ml, 0) as total_ml,
       e.notes, e.created_by
  from public.events_visible e
 where e.type = 'pump' and e.deleted_at is null and e.ended_at is not null;

create or replace view public.v_temps with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as start_date,
       e.temp_c, e.temp_method, e.notes, e.created_by
  from public.events_visible e
 where e.type = 'temperature' and e.deleted_at is null;

create or replace view public.v_growth with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as measured_on,
       e.weight_g, e.length_cm, e.head_cm, e.notes, e.created_by
  from public.events_visible e
 where e.type = 'growth' and e.deleted_at is null;

create or replace view public.v_feed_sessions with (security_invoker = true) as
with f as (
  select e.id, e.baby_id, e.type, e.started_at,
         coalesce(e.ended_at, e.started_at) as ended_at,
         e.bottle_ml,
         coalesce(s.left_s, 0) as left_s, coalesce(s.right_s, 0) as right_s
    from public.events_visible e
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

create or replace view public.v_meds with (security_invoker = true) as
select e.id, e.baby_id, e.started_at,
       public.local_day(e.started_at) as start_date,
       m.name as medication, e.dose_amount, e.dose_unit, e.notes, e.created_by,
       coalesce(m.for_whom, 'baby') as for_whom
  from public.events_visible e
  left join public.medications m on m.id = e.medication_id
 where e.type = 'medicine' and e.deleted_at is null;

create or replace view public.v_daily_summary with (security_invoker = true) as
with tz as (select public.household_tz() as tz, make_interval(hours => public.day_start_hour()) as shift),
timed as (   -- sleep / tummy time cut into per-day pieces at the day-start hour
  select e.baby_id, e.type,
         public.sleep_kind(e.started_at at time zone tz.tz) as kind,
         d::date as day,
         extract(epoch from
           least((e.ended_at at time zone tz.tz) - tz.shift, d + interval '1 day')
           - greatest((e.started_at at time zone tz.tz) - tz.shift, d)) / 60 as minutes
    from public.events_visible e cross join tz
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
    join public.events_visible e on e.id = ns.event_id
   where e.deleted_at is null and ns.ended_at is not null
),
ev as (
  select e.*, public.local_day(e.started_at) as day
    from public.events_visible e
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

grant select on public.v_sleep, public.v_feeds, public.v_diapers, public.v_pumps, public.v_meds,
  public.v_temps, public.v_growth, public.v_feed_sessions, public.v_daily_summary to authenticated;

commit;
