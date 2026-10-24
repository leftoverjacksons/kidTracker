\set ON_ERROR_STOP 1
-- A caregiver can save the plan; a guest can't change it.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update household_settings set feeding_plan = '{"target": {"min_ml": 75, "max_ml": 90}, "nursing_ml_per_min": 3, "every_min": 180}';
do $$ begin
  assert (select feeding_plan->'target'->>'max_ml' from household_settings) = '90', 'caregiver saved the plan';
end $$;
do $$ begin
  update household_settings set feeding_plan = '[]';
  raise exception 'a non-object plan was accepted';
exception when check_violation then null;
end $$;
reset role;
update household_settings set feeding_plan = null;
