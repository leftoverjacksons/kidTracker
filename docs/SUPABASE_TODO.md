# Supabase to-do (things only you can do) — LakTrak

A running checklist of database steps waiting for you. Updated whenever a change needs one.
Each step is a SQL file: open it on GitHub, **copy raw file**, then in Supabase go to **SQL Editor → New query**, paste it, and click **Run**.
Run them **in order**. Every script is safe to run twice.

## Waiting

### Phone notifications (pumping reminders + "still running?" checks)

Steps 1–5 are done (the push-tick function exists and was updated 2026-10-24). Step 6 is per phone; tick it once both phones show notifications as on.

Do these in order, about 15–20 minutes in all. Until they're done, the app works as before:
reminders show inside the app, and Settings says notifications are "not set up".

- [x] **1. Run `supabase/migrations/0006_push.sql`** (copy raw file → SQL Editor → New query → Run).
- [x] **2. Make the notification keys.** On a computer or phone, open
      https://leftoverjacksons.github.io/kidTracker/vapid.html and leave the tab open.
- [x] **3. Save the keys as secrets.** In Supabase, open **Edge Functions → Secrets**
      (https://supabase.com/dashboard/project/lusbippzmyvukzpswxxr/functions/secrets). Add two secrets, with names exactly as written:
  - `VAPID_PUBLIC_KEY`: the first value from the page
  - `VAPID_PRIVATE_KEY`: the second value. Keep it private: don't paste it anywhere else.
- [x] **4. Create the function.** In **Edge Functions**, click **Deploy a new function → Via Editor**.
  - Name it exactly `push-tick`.
  - Delete the sample code. Paste the whole of `supabase/functions/push-tick/index.ts` (open it on GitHub → copy raw file).
  - Click **Deploy function**.
- [x] **5. Start the every-minute timer.** Open `supabase/push_schedule.sql` on GitHub and copy it into a new SQL Editor query.
  - Replace `PASTE_ANON_KEY_HERE` with your public key: the one starting `sb_publishable_`. It's the `VITE_SUPABASE_ANON_KEY` variable in GitHub (Settings → Secrets and variables → Actions → Variables); in Supabase it's under Project Settings → API Keys.
  - Click **Run**.
- [ ] **6. Turn it on, on each phone.** Open LakTrak → **Settings → Reminders → Phone notifications → Turn on**, and allow notifications when the phone asks.
  - On iPhone, LakTrak must be added to the Home Screen first.
  - Each phone chooses its own pumping interval (or Off), and whether it gets "still running?" checks.

**If notifications don't arrive,** run this in the SQL Editor a couple of minutes after step 5 and send me the result:
`select status_code, left(content::text, 200) from net._http_response order by created desc limit 3;`

## Done

- [x] Update the `push-tick` function to the feed-aligned version (2026-10-24)
- [x] `0011_feeding_plan.sql`: shared feeding plan in Settings (2026-10-24)
- [x] `0010_bottle_pause.sql`, then `0009_viewers.sql` again: bottle Pause (2026-10-24)
- [x] `0009_viewers.sql`: guest (view-only) accounts (2026-10-20; re-run 2026-10-24)
- [x] `0008_bottle_brand.sql`: bottle brand picker (by 2026-10-24)
- [x] `0007_bottle_timer.sql`: bottle timer and flow rate (by 2026-10-24)
- [x] `0006_push.sql` and the every-minute schedule: phone notifications (2026-10-20)
- [x] `0005_mom_meds.sql`: medicines for Mom (run by 2026-10-20; Mom's doses are showing in the app)
- [x] `0004_feed_sessions.sql`: feeds grouped into sessions, time between feeds, day-start hour (run 2026-10-18)
- [x] `0003_temperature_precision.sql`: temperatures saved to 0.01 °C (run 2026-10-18). Re-save older temperatures by hand.
- [x] `0001_init.sql`: tables, security rules, timer functions
- [x] `0002_reports.sql`: report views (Reports tab, CSV, pediatrician summary)
- [x] Backup login + Google Apps Script nightly backup (SETUP.md §6)

## Good to know

### Guest (view-only) accounts: how to add or remove one

- **To add a guest** (any time after that):
  1. In Supabase, go to **Authentication → Users → Add user → Create new user**. Enter their email and a password, and tick **Auto Confirm User**.
  2. In the **SQL Editor**, run (change the email):
     `update public.caregivers set role = 'viewer' where email = 'grandma@example.com';`
  3. Send them the app link and their password. They sign in and can look but not change anything.
- **To remove a guest:** Authentication → Users → delete them.
- **To check who's who:** `select email, role from public.caregivers;`


- After running a script, pull down on the Reports tab (or reopen the app) to refresh.
- The nightly backup to Google Drive needs no changes when scripts are added.
