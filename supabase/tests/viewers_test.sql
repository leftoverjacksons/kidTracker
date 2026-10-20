\set ON_ERROR_STOP 1
-- 0009: a guest (viewer) reads without notes or Mom's medicines and can't change anything.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'guest@example.com', '{"full_name":"Grandma"}');
update caregivers set role = 'viewer' where email = 'guest@example.com';   -- SQL editor: allowed
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into events (baby_id, type, started_at, diaper_wet, notes) values
  ('00000000-0000-0000-0000-0000000000b2', 'diaper', '2026-10-11 21:00Z', true, 'private note');
do $$ begin
  assert (select count(*) from events_visible where notes = 'private note') = 1, 'caregiver sees notes';
  assert (select count(*) from v_meds where for_whom = 'mom') = 2, 'caregiver sees Mom''s doses';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$
declare ok boolean;
begin
  assert is_member() and not is_caregiver(), 'viewer flags';
  assert (select count(*) from events) = 0, 'viewer must not read the events table directly';
  assert (select count(*) from events_visible) > 0, 'viewer reads events_visible';
  assert not exists (select 1 from events_visible where notes is not null), 'notes hidden from viewer';
  assert not exists (select 1 from events_visible ev join medications m on m.id = ev.medication_id where m.for_whom = 'mom'), 'Mom meds hidden';
  assert (select count(*) from events_visible where type = 'medicine') >= 1, 'baby medicine still visible';
  assert not exists (select 1 from medications where for_whom = 'mom'), 'Mom medication list hidden';
  assert (select count(*) from v_meds where for_whom = 'mom') = 0, 'v_meds hides Mom doses';
  assert (select sleep_min from v_daily_summary where baby_id = '00000000-0000-0000-0000-0000000000b2' and day = '2026-10-11') = 480, 'reports work for viewer';
  assert (select count(*) from v_feed_sessions) > 0, 'feed sessions visible';
  assert (select count(*) from nursing_segments) > 0 and (select count(*) from babies) > 0 and (select count(*) from caregivers) >= 3;
  -- Writes are refused.
  begin
    insert into events (baby_id, type, started_at) values ('00000000-0000-0000-0000-0000000000b2', 'diaper', now());
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'viewer insert must fail';
  update events set notes = 'x' where true;            -- matches no rows for a viewer
  assert (select count(*) from events_visible where notes = 'x') = 0;
  begin
    perform start_timer(gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 'sleep', now());
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'viewer start_timer must fail';
  begin
    update caregivers set role = 'caregiver' where id = '00000000-0000-0000-0000-00000000000c';
    ok := false;
  exception when raise_exception then ok := true; end;
  assert ok, 'viewer must not promote themselves';
  begin
    insert into push_subscriptions (endpoint, p256dh, auth) values ('https://x', 'a', 'b');
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'viewer cannot sign up for notifications';
end $$;
reset role;
\echo 'VIEWERS TEST PASSED'
