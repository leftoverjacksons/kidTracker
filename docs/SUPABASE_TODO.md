# Supabase to-do (things only you can do)

A running checklist of database steps waiting for you. Updated whenever a change needs one.
Each step is a SQL file: open it on GitHub, **copy raw file**, then in Supabase go to **SQL Editor → New query**, paste it, and click **Run**.
Run them **in order**. Every script is safe to run twice.

## Waiting

- [ ] **`supabase/migrations/0003_temperature_precision.sql`**: stop temperatures shifting (98.0 °F showing as 98.1 °F).
  - Afterwards: re-save any temperature logged before the script (open it → Edit → Save), so it shows the exact value.
  - Urgency: low. Nothing gets worse before it runs.

## Planned, not written yet (I'll add the file when we build it)

- [ ] **`0004_feed_sessions.sql`**: group nursing entries less than 20 minutes apart into one feed for all reports, CSVs, the pediatrician summary and the Google Sheet. It also covers time between feeds, and the daily charts following the timeline's day cutoff. See design doc §8a A and C.

## Done

- [x] `0001_init.sql`: tables, security rules, timer functions
- [x] `0002_reports.sql`: report views (Reports tab, CSV, pediatrician summary)
- [x] Backup login + Google Apps Script nightly backup (SETUP.md §6)

## Good to know

- After running a script, pull down on the Reports tab (or reopen the app) to refresh.
- The nightly backup to Google Drive needs no changes when scripts are added.
