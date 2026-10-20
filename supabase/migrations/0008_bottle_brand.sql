-- LakTrak 0008: which bottle was used, to compare flow by brand (design doc §8a L).
-- Run once in the Supabase SQL editor, after 0007. Safe to re-run. Until it runs the app
-- simply doesn't show the bottle picker.

alter table public.events add column if not exists bottle_brand text
  check (bottle_brand is null or length(bottle_brand) between 1 and 40);

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
                       where table_schema = 'public' and table_name = 'events' and column_name = 'bottle_brand') then 'bottle_brand' end,
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'events' and column_name = 'paused_s') then 'bottle_pause' end
  ], null);
$$;
grant execute on function public.app_features() to authenticated;
