-- LakTrak: run the push-tick function every minute (Supabase only; needs pg_cron + pg_net).
-- Run in the SQL editor AFTER 0006_push.sql and after deploying the push-tick function.
--
-- BEFORE RUNNING: replace PASTE_ANON_KEY_HERE below with your project's public anon key
-- (the same value as the VITE_SUPABASE_ANON_KEY variable in GitHub; in Supabase it's under
-- Project Settings → API Keys). It is a public key, so it's fine in this script.
--
-- Safe to re-run: the schedule is replaced, not duplicated. To stop notifications:
--   select cron.unschedule('laktrak-push');
-- To check it's working, a minute after running this:
--   select status_code, left(content::text, 200) from net._http_response order by created desc limit 3;
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('laktrak-push', '* * * * *', $$
  select net.http_post(
    url := 'https://lusbippzmyvukzpswxxr.supabase.co/functions/v1/push-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer PASTE_ANON_KEY_HERE'),
    body := '{}'::jsonb
  );
  delete from public.push_log where sent_at < now() - interval '7 days';
$$);
