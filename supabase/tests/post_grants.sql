-- Supabase grants these by default; replicate locally.
grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
