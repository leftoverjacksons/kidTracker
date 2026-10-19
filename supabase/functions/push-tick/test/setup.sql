-- Supabase's service role (bypasses RLS), which the function uses.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant service_role to authenticator;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
insert into caregivers (id, email, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'parent.a@example.com', 'Parent A'),
  ('00000000-0000-0000-0000-00000000000b', 'parent.b@example.com', 'Parent B') on conflict do nothing;
insert into babies (id, name) values ('00000000-0000-0000-0000-0000000000b1', 'L') on conflict do nothing;
