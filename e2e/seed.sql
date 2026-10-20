-- Login role for PostgREST and the two test caregivers.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'auth' noinherit;
  end if;
end $$;
grant anon, authenticated to authenticator;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'parent.a@example.com', '{"full_name":"Parent A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'parent.b@example.com', '{"full_name":"Parent B"}'),
  ('00000000-0000-0000-0000-00000000000c', 'grandma@example.com', '{"full_name":"Grandma"}');
-- A guest (read-only) account, as the owner would set up in Supabase (migration 0009).
update public.caregivers set role = 'viewer' where email = 'grandma@example.com';
