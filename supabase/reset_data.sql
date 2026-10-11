-- Wipe all logged data, e.g. after test-driving the app before the baby arrives.
-- Run in the Supabase SQL Editor. THIS CANNOT BE UNDONE.
--
-- Deleted: every event, nursing segment, medication, and the baby profile.
-- Kept:    your two sign-in accounts, display names, passwords, and unit settings.
--
-- Next time the app opens it asks for the baby's name and birth date again.

begin;
delete from public.nursing_segments;
delete from public.events;
delete from public.medications;
delete from public.babies;
commit;
