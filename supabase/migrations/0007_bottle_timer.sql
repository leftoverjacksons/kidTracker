-- LakTrak 0007: bottle feeds can be timed, for flow rate (design doc §8a K).
-- Run once in the Supabase SQL editor. Safe to re-run (also after an earlier version of
-- this file: it adds what's missing). Until it runs the app works as
-- before; the bottle timer simply isn't offered.
--
-- Until now a bottle was an instant with no end time. A missing end time means "timer
-- running", so existing bottles get end = start (zero length) first.

begin;

-- How much was in the bottle at the start; bottle_ml stays the amount actually drunk.
alter table public.events add column if not exists bottle_start_ml numeric(7,2)
  check (bottle_start_ml is null or bottle_start_ml >= 0);

update public.events set ended_at = started_at
 where type = 'bottle' and ended_at is null;

-- One running timer per type and baby, now including bottles.
drop index if exists public.one_running_timer;
create unique index one_running_timer
  on public.events (baby_id, type)
  where ended_at is null and deleted_at is null
    and type in ('sleep','nursing','pump','tummy_time','bottle');

create or replace function public.start_timer(
  p_id uuid, p_baby_id uuid, p_type public.event_type, p_started_at timestamptz,
  p_pump_side text default null
) returns public.events
language plpgsql as $$
declare r public.events;
begin
  if p_type not in ('sleep','nursing','pump','tummy_time','bottle') then
    raise exception 'event type % has no timer', p_type;
  end if;

  insert into public.events (id, baby_id, type, started_at, pump_side)
  values (p_id, p_baby_id, p_type, p_started_at, p_pump_side)
  on conflict do nothing;

  select * into r from public.events
   where baby_id = p_baby_id and type = p_type
     and ended_at is null and deleted_at is null;
  if not found then
    -- Same id was already inserted and stopped (a stale retry).
    select * into r from public.events where id = p_id;
  end if;
  return r;
end $$;

-- Which optional database features exist, so the app can switch them on (it treats a
-- missing function as "none").
-- Reads what the database actually has, so running 0007 and 0008 in any order (or again) is fine.
create or replace function public.app_features() returns text[]
language sql stable as $$
  select array_remove(array[
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'start_timer'
                         and pg_get_functiondef(p.oid) like '%''bottle''%') then 'bottle_timer' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'bottle_start_ml') then 'bottle_start' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'bottle_brand') then 'bottle_brand' end
  ], null);
$$;
grant execute on function public.app_features() to authenticated;

commit;
