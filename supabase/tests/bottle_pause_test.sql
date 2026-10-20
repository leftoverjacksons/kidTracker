\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare r events; t0 timestamptz := now() - interval '20 minutes';
begin
  assert 'bottle_pause' = any(app_features()), 'feature';
  r := start_timer('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'bottle', t0);
  r := pause_timer(r.id, t0 + interval '5 minutes');
  perform pause_timer(r.id, t0 + interval '6 minutes');            -- second phone: no-op
  r := resume_timer(r.id, t0 + interval '8 minutes');
  perform resume_timer(r.id, t0 + interval '9 minutes');           -- no-op
  assert r.paused_s = 180 and r.paused_at is null, format('paused %s', r.paused_s);
  r := pause_timer(r.id, t0 + interval '15 minutes');
  r := resume_timer(r.id, t0 + interval '16 minutes');
  assert r.paused_s = 240;
  r := stop_timer(r.id, t0 + interval '20 minutes');
  assert extract(epoch from r.ended_at - r.started_at) - r.paused_s = 960, 'net 16 minutes';
end $$;
-- Guests can't pause anything: the update matches no rows for them.
do $$ begin perform start_timer('61000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b3', 'bottle', now()); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select (pause_timer('61000000-0000-0000-0000-000000000002', now())).id) is null, 'guest paused a timer';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert (select paused_at from events where id = '61000000-0000-0000-0000-000000000002') is null, 'still running unpaused';
  perform stop_timer('61000000-0000-0000-0000-000000000002', now());
end $$;
reset role;
\echo 'BOTTLE PAUSE TEST PASSED'
