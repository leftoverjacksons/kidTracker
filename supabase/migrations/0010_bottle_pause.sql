-- LakTrak 0010: pause a bottle feed (burping, a diaper) without counting the pause
-- toward the feed's time, so flow rate reflects drinking time (design doc §8a K3).
-- Run once in the Supabase SQL editor, after 0009. Safe to re-run. Then run 0009 again so
-- guests' view of the data includes the new columns. Until it runs, the Pause button is hidden.

alter table public.events add column if not exists paused_at timestamptz;          -- paused since (null = not paused)
alter table public.events add column if not exists paused_s  int not null default 0 -- total paused seconds so far
  check (paused_s >= 0);

-- Pause / resume a running timer. Both are no-ops when already in that state, so two
-- phones tapping at once can't double-count. Row security applies (caregivers only).
create or replace function public.pause_timer(p_id uuid, p_at timestamptz) returns public.events
language sql as $$
  update public.events set paused_at = greatest(p_at, started_at)
   where id = p_id and ended_at is null and paused_at is null
  returning *;
$$;
create or replace function public.resume_timer(p_id uuid, p_at timestamptz) returns public.events
language sql as $$
  update public.events
     set paused_s = paused_s + greatest(0, round(extract(epoch from p_at - paused_at)))::int, paused_at = null
   where id = p_id and paused_at is not null
  returning *;
$$;
grant execute on function public.pause_timer(uuid, timestamptz), public.resume_timer(uuid, timestamptz) to authenticated;

-- Reads what the database actually has, so migrations can run in any order (or again).
create or replace function public.app_features() returns text[]
language sql stable as $$
  select array_remove(array[
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'start_timer'
                         and pg_get_functiondef(p.oid) like '%''bottle''%') then 'bottle_timer' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'bottle_start_ml') then 'bottle_start' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'bottle_brand') then 'bottle_brand' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'paused_s') then 'bottle_pause' end
  ], null);
$$;
grant execute on function public.app_features() to authenticated;
