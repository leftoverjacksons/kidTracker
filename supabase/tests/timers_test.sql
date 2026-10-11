\set ON_ERROR_STOP 1
-- Two caregivers and one outsider
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'parent.a@example.com', '{"full_name":"Parent A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'parent.b@example.com', '{}');
-- Outsider: an auth user with no caregiver row
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com');
alter table auth.users enable trigger on_auth_user_created;

insert into public.babies (id, name) values ('00000000-0000-0000-0000-0000000000b1', 'Baby');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- caregiver auto-created with names
do $$ begin
  assert (select display_name from caregivers where email='parent.a@example.com') = 'Parent A';
  assert (select display_name from caregivers where email='parent.b@example.com') = 'parent.b';
end $$;

-- A starts sleep; B "starts" sleep too -> same row comes back, only one exists
select (start_timer('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','sleep', now() - interval '1 hour')).id as a_id \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select (start_timer('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','sleep', now())).id as b_id \gset
do $$ begin
  assert (select count(*) from events where type='sleep') = 1, 'duplicate running sleep';
end $$;
select :'a_id' = :'b_id' as same_timer_returned \gset
\if :same_timer_returned
\else
  \echo 'FAIL: second start did not return running timer' \quit
\endif

-- B stops; A stops later -> first end time kept
select stop_timer(:'a_id', now() - interval '10 minutes');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select stop_timer(:'a_id', now());
do $$ begin
  assert (select ended_at < now() - interval '9 minutes' from events where type='sleep'), 'second stop overwrote end time';
  assert (select updated_by from events where type='sleep') = '00000000-0000-0000-0000-00000000000b', 'updated_by wrong';
  assert (select created_by from events where type='sleep') = '00000000-0000-0000-0000-00000000000a', 'created_by wrong';
end $$;

-- After stopping, a new sleep can start
select start_timer('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1','sleep', now());
do $$ begin assert (select count(*) from events where type='sleep') = 2; end $$;

-- Nursing: L, switch R, tap R again (no-op), pause, L, finish
select start_timer('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','nursing', now() - interval '20 minutes');
select count(*) from nursing_set_side('20000000-0000-0000-0000-000000000001','left',  now() - interval '20 minutes');
select count(*) from nursing_set_side('20000000-0000-0000-0000-000000000001','right', now() - interval '12 minutes');
select count(*) from nursing_set_side('20000000-0000-0000-0000-000000000001','right', now() - interval '11 minutes');
select count(*) from nursing_set_side('20000000-0000-0000-0000-000000000001', null,   now() - interval '6 minutes');
select count(*) from nursing_set_side('20000000-0000-0000-0000-000000000001','left',  now() - interval '4 minutes');
select stop_timer('20000000-0000-0000-0000-000000000001', now());
do $$ begin
  assert (select count(*) from nursing_segments) = 3, 'segment count';
  assert (select count(*) from nursing_segments where ended_at is null) = 0, 'open segment after finish';
  assert (select round(extract(epoch from sum(ended_at-started_at))/60) from nursing_segments where side='left') = 12, 'left minutes';
  assert (select round(extract(epoch from sum(ended_at-started_at))/60) from nursing_segments where side='right') = 6, 'right minutes';
end $$;

-- Non-timer type rejected
do $$ begin
  begin
    perform start_timer(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','diaper', now());
    raise exception 'diaper timer allowed';
  exception when raise_exception then
    if sqlerrm = 'diaper timer allowed' then raise; end if;
  end;
end $$;

-- Outsider sees nothing and cannot write
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$ begin
  assert (select count(*) from events) = 0, 'outsider can read events';
  assert (select count(*) from babies) = 0, 'outsider can read babies';
  begin
    insert into events (baby_id, type, started_at) values ('00000000-0000-0000-0000-0000000000b1','diaper', now());
    raise exception 'outsider insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'ALL TIMER/RLS TESTS PASSED'
