# Supabase to-do (things only you can do)

A running checklist of database steps waiting for you. Updated whenever a change needs one.
Each step is a SQL file: open it on GitHub, **copy raw file**, then in Supabase go to **SQL Editor → New query**, paste it, and click **Run**.
Run them **in order**. Every script is safe to run twice.

## Waiting

Nothing right now.

## Done

- [x] `0004_feed_sessions.sql`: feeds grouped into sessions, time between feeds, day-start hour (run 2026-10-18)
- [x] `0003_temperature_precision.sql`: temperatures saved to 0.01 °C (run 2026-10-18). Re-save older temperatures by hand.
- [x] `0001_init.sql`: tables, security rules, timer functions
- [x] `0002_reports.sql`: report views (Reports tab, CSV, pediatrician summary)
- [x] Backup login + Google Apps Script nightly backup (SETUP.md §6)

## Good to know

- After running a script, pull down on the Reports tab (or reopen the app) to refresh.
- The nightly backup to Google Drive needs no changes when scripts are added.
