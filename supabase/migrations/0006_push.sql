-- LakTrak 0006: phone notifications (design doc §8a E5 Phase 2 and I).
-- Run once in the Supabase SQL editor. Safe to re-run. The app keeps working without it;
-- notifications just stay "not set up". The schedule that triggers sending is a separate
-- step: supabase/push_schedule.sql, run after the push-tick function is deployed.

-- One row per phone that has turned notifications on (a Web Push subscription).
create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  caregiver_id   uuid not null references public.caregivers(id) on delete cascade default auth.uid(),
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  pump_every_min int check (pump_every_min between 30 and 600),  -- null = no pumping reminders on this phone
  still_running  boolean not null default true,                    -- "Sleep has been running 4h" checks
  created_at     timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- Each person manages only their own phones. The sender reads all rows with the service role.
drop policy if exists push_own_select on public.push_subscriptions;
drop policy if exists push_own_insert on public.push_subscriptions;
drop policy if exists push_own_update on public.push_subscriptions;
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions for select to authenticated using (caregiver_id = auth.uid());
create policy push_own_insert on public.push_subscriptions for insert to authenticated with check (caregiver_id = auth.uid() and public.is_caregiver());
create policy push_own_update on public.push_subscriptions for update to authenticated using (caregiver_id = auth.uid()) with check (caregiver_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (caregiver_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Notifications already sent, so each goes out once. Only the sender (service role) uses it.
create table if not exists public.push_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
