-- LakTrak 0012: the bottle nipple logged as "Lansinoh SS" was always a Pigeon SS (owner, 2026-11-03).
-- Renames those entries. Run once in the Supabase SQL editor; safe to re-run (it finds nothing the second time).
update public.events set bottle_brand = 'Pigeon SS' where bottle_brand = 'Lansinoh SS';
