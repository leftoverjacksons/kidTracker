# kidTracker — Design Document

Status: **v0.6**. Phases 0–2 and 4 implemented (logging, shared timers, history, reports/export, backups); Phase 3 (offline queue) pending. Decisions recorded in §7.1; real-use backlog in §8a.
Last updated: 2026-10-16

---

## 1. Purpose

A minimal baby-care logging app for two caregivers on Android phones. It
covers the core functions of commercial trackers (Huckleberry, Baby Tracker
by Nighp, Glow Baby, Baby Connect) and leaves out the rest: no ads, no
subscription upsells, no AI coaching, no community feed. All data lives in a
store the owners control and can query directly.

### 1.1 Goals

| ID | Goal |
|----|------|
| G1 | Log sleep, nursing, bottle, diaper, pumping, medicine, temperature, growth, tummy time, and bath events with as few taps as possible. |
| G2 | Shared timers: either caregiver can start a timer, and either can stop it from their own phone. |
| G3 | Concurrent use: both phones can read and write at the same time with no data loss and no duplicate entries. |
| G4 | Owners have full, direct access to the raw data (SQL and/or spreadsheet export). |
| G5 | Every entry can be created manually after the fact and edited later (start, end, and all fields). |
| G6 | Usable one-handed, at night, half-asleep: large touch targets, dark mode, little text input. |
| G7 | Analytics dashboards over the full history, and export of CSVs and a printable summary for the pediatrician. |

### 1.2 Non-goals (v1)

- Sleep-window prediction (Huckleberry "SweetSpot"), schedule generation, AI insights.
- Medical advice. The medicine module records what was given; it does not recommend doses.
- iOS-specific work (the PWA will probably work on iOS but will not be tested there).
- Public multi-tenant use. This is one household's app.

---

## 2. Survey of existing trackers

Feature set compiled from public descriptions of Huckleberry, Baby Tracker
(Nighp), Glow Baby, and Baby Connect. The **v1** column is the proposed scope;
the items marked *requested* are the ones you asked for.

| Category | Typical features in commercial apps | v1? |
|---|---|---|
| **Sleep** | Start/stop timer; manual entry; naps vs. night sleep; daily totals; sleep location; wake-window display | **Yes** (*requested*). Nap/night is derived later in analytics, not entered (§3.2). |
| **Breastfeeding** | Per-side timers (L/R), switch sides mid-session, pause, "last side" indicator | **Yes** (*requested*) |
| **Bottle** | Volume (ml/oz), contents (breast milk / formula / mixed) | **Yes** (*requested*) |
| **Solids** | Food name, amount, reaction/allergen flag | Later |
| **Diaper** | Wet / dirty / mixed / dry; poop color & consistency; rash flag; notes | **Yes** (*requested*) |
| **Pumping** | L/R/both, timer, volume per side; milk-stash inventory | **Yes** (*requested*); stash later |
| **Medicine** | Med name, dose, unit; reminders; time since last dose | **Yes** (*requested*) |
| Temperature | Value + method | **Yes** |
| Growth | Weight, length, head circumference; WHO percentile charts | **Yes** (entry in v1; percentile chart with analytics) |
| Activities | Tummy time, bath, outdoor time, etc. (timed or instant) | **Tummy time and bath: yes.** Others later. |
| Milestones / photos | First smile, rolling, etc. | No |
| Potty training | — | No (age-inappropriate for now) |
| Summary / dashboard | "Time since last feed/diaper/sleep", daily totals, timeline | **Yes** |
| Reports / charts | Daily/weekly bars, trends | Daily summary in v1; dashboards + CSV/pediatrician export in a later phase (§5.7) |
| Reminders | Feed / med reminders | Later (see §7.4 on PWA notification limits) |
| Multi-caregiver sync | Real-time shared log | **Yes** (core requirement) |
| Multiple children | Profiles per child | Schema supports it; UI single-child in v1 |

Things commercial apps get right that we should copy:

1. **"Last side" indicator** for nursing. This is the most-used piece of information at 3 a.m.
2. **"Time since last X"** tiles on the home screen.
3. **Timers that survive app closure.** The timer is a timestamp in the database, not a running process on the phone.
4. **Back-dated entry**: every timer screen also offers "enter manually".

---

## 3. Functional specification

### 3.1 Home screen

- One tile per category: Sleep, Nurse, Bottle, Diaper, Pump, Meds. A secondary row (or "More" tile) holds Temp, Growth, Tummy time, Bath.
- Each tile shows the time since the last event of that type and a one-line summary (e.g. "Nursed 1h 42m ago · last side **R**").
- A tile with a running timer shows a live elapsed counter and a **Stop** button. The timer is visible to both phones.
- Below the tiles: a reverse-chronological timeline for today, with daily totals (sleep hours, feed count, oz taken, wet/dirty counts).

### 3.2 Sleep

- **Timer mode:** tap *Start*; a running sleep is created. Either phone can tap *Stop*.
- **Manual mode:** pick start and end date/times.
- Optional fields: notes.
- **No nap/night field is entered.** A sleep is stored only as start, end, and notes. Nap vs. night is a classification computed in analytics views (§5.7), so the rule can change as a schedule forms and is re-applied to all past data without editing it. The first rule will be simple (e.g. a sleep that starts in an evening window, or is the longest of a 24 h period, counts as night). It is not decided now.
- Only one running sleep per child. If the second phone taps *Start* while one is running, the app shows the existing timer instead of creating a second one.

### 3.3 Nursing (breastfeeding)

- Two large buttons, **L** and **R**. Tapping one starts timing that side.
- Tapping the other side switches: the current side's segment closes and a new one opens.
- **Pause** closes the open segment without ending the session; **Finish** ends the session.
- The session stores per-side durations, so a feed of "L 8 min, R 6 min, L 3 min" is recorded faithfully.
- Manual entry: start time, plus L and R minutes (and optionally which side was first).
- The home tile shows "last side", meaning the side of the most recent segment.

### 3.4 Bottle

- Volume with a numeric keypad and quick-pick chips (e.g. 1 / 2 / 3 / 4 / 5 oz). The display unit is a household setting, **default oz**; data is always **stored in ml**, so switching units later changes no data.
- Contents: breast milk / formula / mixed.
- Time defaults to now and can be edited. Notes are optional.

### 3.5 Diaper

- Icon buttons: 💧 **Wet**, 💩 **Dirty**, 💧💩 **Both**, ⭕ **Dry**. One tap logs the change at the current time.
- Optional expansion: poop color (icon palette), consistency (watery / seedy / soft / formed / hard), rash flag, free-text notes.
- Time is editable.

### 3.6 Pumping

- Side selector: **L**, **R**, **Both**.
- Timer (start/stop, shared like sleep) or manual start/end.
- Volume: per side (L oz, R oz) or a single total; the app computes the total.
- Notes are optional. A milk-stash inventory is deferred.

### 3.7 Medicine

- **Medication catalog** (configured once): name, default dose, unit (ml, mg, drops, tablet), and an optional *minimum interval* and *max doses per 24 h* that the user enters from a pediatrician's or label instructions.
- **Log a dose:** pick a medication; the default dose is prefilled and editable; time defaults to now.
- The home tile shows the last dose time per medication and, if an interval is configured, "next allowed at HH:MM". This is arithmetic on the user's own settings, not advice.

### 3.8 Temperature

- Value (°F by default; stored in °C), method (rectal / axillary / temporal / ear), time, notes.
- Shown on the Meds screen as well, since the two are usually read together.

### 3.9 Growth

- Weight (lb + oz), length (in), head circumference (in), any subset; date; notes. Stored metric (g, cm).
- Typically entered from pediatrician visits or a home scale.
- Later (analytics phase): plotted against WHO growth-standard percentile curves.

### 3.10 Tummy time

- A shared timer exactly like sleep (start on one phone, stop on either), or manual start/end.
- Daily total minutes on the home screen.

### 3.11 Bath

- One tap logs a bath at the current time; optional duration and notes.

### 3.12 Editing and history

- Every event can be opened, edited, or deleted. Deletion is a soft delete (`deleted_at`), so it can be undone.
- Implementation note (Phase 1): one-tap logging (diaper, bath, "Give" for meds) shows a 5-second **Undo** toast. Bottle quick-picks are 1–5 oz (30–150 ml when set to ml).
- Each row records `created_by` and `updated_by`: which parent logged or last changed it. The name shown comes from that parent's Google account (editable in settings) and appears in the timeline and on running timers ("started by …").
- A history view per category, filterable by date.

---

## 4. Backend options

The deciding requirements are G2 and G3 (shared live timers, concurrent
writes) together with G4 (direct data access).

### 4.1 Options evaluated

| Option | Real-time sync | Concurrency safety | Direct data access | Cost | Ops burden | Assessment |
|---|---|---|---|---|---|---|
| **A. Google Sheets** via Apps Script web app | No push: clients poll (e.g. every 5–10 s); writes take ~1–3 s | Weak: needs `LockService` around every write; no transactions, no unique constraints | Excellent (it is a spreadsheet) | Free | Low | Workable for logging. Shared timers would be laggy and race-prone. Sheets API quotas apply. |
| **B. Supabase** (hosted Postgres + realtime + auth) | Yes (Postgres change subscriptions over websocket) | Strong: transactions, unique/partial indexes, row-level security | Excellent: SQL editor, direct Postgres connection string, CSV export | Free tier is sufficient (§4.3) | Low (managed) | **Recommended.** |
| **C. Firebase Firestore** | Yes | Good (transactions) | Medium: NoSQL documents; queries are less flexible; export through tooling | Free tier is sufficient | Low | Good offline support, but you asked for SQL-style access, and it is weaker there. |
| **D. Self-hosted** (PocketBase/SQLite or Postgres on a home server/VPS) | Yes (PocketBase has realtime) | Strong | Excellent (you own the file or server) | ~$0–5/mo | Medium: TLS, backups, uptime are your job | A good fallback if you want zero third-party dependency. |

### 4.2 Recommendation

**Supabase (Postgres)** as the system of record. A Google Sheets export is
not planned; CSV export (§5.7) covers the same need.

Rationale:

- Postgres constraints solve the "both of us pressed Start" problem in the database (§5.3), which is not possible in Sheets.
- Realtime subscriptions make a timer started on one phone appear on the other within about a second.
- "Total access" holds: the data is ordinary SQL tables, reachable from the Supabase dashboard, `psql`, Python, a BI tool, or CSV export.
- Moving away later is cheap. The schema is plain Postgres; `pg_dump` moves it anywhere (including option D).

### 4.3 Supabase free tier

Figures below are from secondary sources (2026) and must be re-checked on
supabase.com/pricing at setup.

| Resource | Free limit | Expected use |
|---|---|---|
| Database | 500 MB per project | About 30–50 events/day at under 1 KB per row comes to roughly 5–15 MB per year. |
| Auth users | 50,000 MAU | 2 |
| Egress | ~2–5 GB/month (sources disagree) | Well under 100 MB/month for two phones syncing text rows |
| Projects | 2 free per organization | 1 |
| Inactivity | Paused after 7 days without activity; data is retained, restore is manual | Daily use prevents this; a weekly keep-alive job is a backstop |
| Backups | No point-in-time recovery | Nightly `pg_dump` via GitHub Actions (§5.5) |

Expected cost: **$0**. The next tier (Pro, ~$25/month) is needed only if the
pause or backup limits become a problem, and neither is expected to.

If you would rather avoid any third-party service, option D (PocketBase on
a small VPS or home machine) keeps the same architecture with a different
client SDK.

---

## 5. Architecture

### 5.1 Client: Progressive Web App (PWA)

```
 ┌──────────── Android phone (×2) ────────────┐
 │  PWA (installed to home screen)            │
 │   ├─ UI (React + Ionic + TypeScript)       │
 │   ├─ Local cache + outbox (IndexedDB)      │
 │   └─ Supabase JS client                    │
 └───────────────┬────────────────────────────┘
                 │ HTTPS (REST) + WebSocket (realtime)
 ┌───────────────▼────────────────────────────┐
 │  Supabase                                  │
 │   ├─ Auth (email code, sign-up disabled)   │
 │   ├─ Postgres (events, meds, babies…)      │
 │   ├─ Row-Level Security policies           │
 │   └─ Realtime (change feed)                │
 └───────────────┬────────────────────────────┘
                 │ SQL views
          Analytics dashboard · CSV / PDF export
```

**Why a PWA rather than a native Android app:**

| | PWA | Native (Kotlin) / wrapped (Capacitor) |
|---|---|---|
| Install | "Add to Home Screen"; no Play Store | APK sideload or Play Console |
| Updates | Instant on next open | Rebuild and reinstall |
| One codebase for both phones and a desktop browser | Yes | Partial |
| Persistent "timer running" notification with a Stop button | **Limited** (§7.4) | Yes |
| Home-screen widget | No (manifest **shortcuts** instead: long-press icon → Diaper/Bottle/Nurse/Sleep, each pinnable) | Yes |

Recommendation: **start with a PWA.** If the persistent-notification or widget
gap turns out to matter, wrap the same code with Capacitor later. That is
additive and requires no rewrite.

Hosting the static front end: **GitHub Pages**, deployed by GitHub Actions on every push (the repository is public, so Pages is free).

**Front-end stack (decided):** React 18 + **Ionic 8** (mobile UI components; Material Design styling on Android) + TypeScript, built with Vite and `vite-plugin-pwa`. Reasons:

- Ionic provides native-looking mobile building blocks (bottom tab bar, sheets, transitions, swipe actions). Without it these would be hand-built.
- Ionic's sibling project Capacitor can later wrap the same code as an Android app (persistent timer notification; §7.4) with no rewrite.
- React has the largest ecosystem and the most documentation (including Supabase's), which matters for long-term maintenance by non-specialists.

Alternatives considered: Svelte (smaller, but fewer mobile components), React + MUI (desktop-oriented), Flutter/Kotlin (native, but heavier to distribute and change).

Theme: light/dark follows the phone's system setting.

### 5.2 Data model (Postgres)

There is a single `events` table with typed, nullable columns, chosen over
one table per category. The reasons: the timeline and "time since last"
queries become one `SELECT`, the shared-timer logic is uniform, and the table
exports to one sheet cleanly. Per-category SQL **views** give spreadsheet-like
slices.

```sql
-- Household members (maps to Supabase auth users)
create table caregivers (
  id          uuid primary key references auth.users(id),
  display_name text not null
);

create table babies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  birth_date  date
);

create table medications (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  default_dose       numeric(8,2),
  unit               text,
  min_interval_hours numeric(4,1),
  max_doses_per_24h  int,
  active             boolean not null default true
);

create type event_type as enum
  ('sleep','nursing','bottle','diaper','pump','medicine','temperature',
   'growth','tummy_time','bath','note');

create table events (
  id            uuid primary key,              -- generated on the client (idempotent retries)
  baby_id       uuid not null references babies(id),
  type          event_type not null,
  started_at    timestamptz not null,
  ended_at      timestamptz,                   -- NULL = timer running (sleep/nursing/pump)
  notes         text,

  -- bottle
  bottle_ml     numeric(6,1),
  bottle_contents text check (bottle_contents in ('breast_milk','formula','mixed')),

  -- diaper
  diaper_wet    boolean,
  diaper_dirty  boolean,
  poop_color    text,
  poop_consistency text,
  diaper_rash   boolean,

  -- pump
  pump_side     text check (pump_side in ('left','right','both')),
  pump_left_ml  numeric(6,1),
  pump_right_ml numeric(6,1),

  -- medicine
  medication_id uuid references medications(id),
  dose_amount   numeric(8,2),
  dose_unit     text,

  -- temperature
  temp_c        numeric(4,1),
  temp_method   text,

  -- growth (any subset per measurement)
  weight_g      numeric(7,1),
  length_cm     numeric(5,1),
  head_cm       numeric(5,1),

  -- sleep, tummy_time, bath: no extra columns (started_at/ended_at/notes suffice;
  -- nap vs. night is computed in views, never stored)

  -- audit
  created_by    uuid references caregivers(id),
  updated_by    uuid references caregivers(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Breastfeeding per-side segments (one nursing event → many segments)
create table nursing_segments (
  id          uuid primary key,
  event_id    uuid not null references events(id) on delete cascade,
  side        text not null check (side in ('left','right')),
  started_at  timestamptz not null,
  ended_at    timestamptz                      -- NULL = this side currently active
);

-- At most ONE running timer per baby per timed type
create unique index one_running_timer
  on events (baby_id, type)
  where ended_at is null and deleted_at is null
    and type in ('sleep','nursing','pump','tummy_time');

-- At most one open segment per nursing session
create unique index one_open_segment
  on nursing_segments (event_id) where ended_at is null;
```

Units: storage is metric (ml, °C, g, cm). Display defaults to US units (oz,
°F, lb/oz, in), set per household. Conversion happens only in the UI and in
export, so the unit setting can be changed at any time without touching data.

### 5.3 Shared timers and concurrency

A timer **is** a row with `ended_at IS NULL`. No phone runs a clock that
matters; each phone renders `now() - started_at`. Consequences:

- **Closing the app, rebooting, or losing signal does not affect the timer.**
- **Start on phone A, stop on phone B** works by construction. B receives the new row through realtime and shows a Stop button.
- **Both press Start at once:** both send `INSERT`; the partial unique index `one_running_timer` lets exactly one succeed. The loser gets a constraint error, fetches the running row, and displays it. One timer results, not two.
- **Both press Stop at once:** `UPDATE events SET ended_at = now() WHERE id = $1 AND ended_at IS NULL`. The first update wins; the second matches zero rows and is a no-op. The end time is not overwritten.
- **Switching nursing sides** runs as one Postgres function (RPC) in a transaction: close the open segment, open the new one. Two phones tapping different sides simultaneously serialize; the last tap wins, with no orphaned segments.
- **Edits to the same completed entry:** last write wins on a per-field basis (the client sends only changed fields). For a two-person household this is sufficient; `updated_by`/`updated_at` show who changed what.

Timestamps: an event's `started_at` is the time of the tap, taken from the
phone's clock (which Android keeps NTP-synced), so offline taps keep their
true time. `created_at`/`updated_at` are server-assigned.

### 5.4 Offline behavior

- Every write first goes to an IndexedDB **outbox** with a client-generated UUID, then is sent to the server. Retries are therefore idempotent (`INSERT … ON CONFLICT (id) DO NOTHING`).
- Reads come from the local cache and are refreshed by realtime.
- A small indicator shows "pending sync" when the outbox is non-empty.
- Limitation: if both phones are offline and both start the same timer, the conflict is resolved at reconnect. The second insert fails the unique index, and the app offers to merge or discard.

### 5.5 Security and access

- Sign-in with **email + password** through Supabase Auth. Sessions persist, so each phone signs in once; each person can change their password in Settings.
  - Google sign-in was rejected because it needs a Google Cloud OAuth setup.
  - An emailed one-time code was tried first and rejected: Supabase's built-in email sender delivers only to members of the Supabase team and does not allow template edits without a custom SMTP server.
- Public sign-up is disabled. The two accounts are created in the Supabase dashboard; a database trigger adds each new auth user to `caregivers`.
- Row-Level Security: every table allows access only when `auth.uid()` is in `caregivers`, so a signed-in account not on that list sees nothing.
- The public anon key in the front end is safe under RLS. The service-role key is never shipped to the client.
- Backups: Supabase free tier has no point-in-time recovery. Mitigation: nightly snapshots to the owner's Google Drive (§5.7).

### 5.6 Data access for you

- Supabase dashboard: table editor and SQL editor.
- Direct Postgres connection string (psql, DBeaver, Python/pandas, Metabase, Grafana).
- Views such as `v_sleep`, `v_feeds`, `v_diapers`, `v_pumps`, `v_meds`, `v_growth`, and `v_daily_summary`.

### 5.7 Analytics and export

All analytics read from SQL views, not from app-side code. The app's charts,
the CSV exports, and any ad-hoc query you write therefore agree by
construction. Derived classifications (nap vs. night, feed count per day,
longest sleep stretch) are defined once, in the views.

**In-app dashboard** (a Reports screen; date-range picker, default last 14 days):

- Sleep: total hours per day, stacked nap/night; longest stretch per night; a 24 h timeline ("sleep map") of each day.
- Feeding: feeds per day; bottle oz per day; nursing minutes per day by side; time between feeds.
- Diapers: wet and dirty counts per day.
- Pumping: oz per day by side.
- Growth: weight, length, and head circumference over age, against WHO percentile curves.
- Meds and temperature: a timeline of doses with temperature readings overlaid.

**Export:**

- **CSV** per category and one combined file, for any date range, in display units with ISO-8601 local timestamps. Opens directly in Excel or Google Sheets.
- **Pediatrician summary**: a one-page printable view (browser *Print → Save as PDF*) for a chosen range. It shows daily averages for sleep, feeds, oz, and diapers; the growth table; and the medication and temperature log.

**Implementation (Phase 4):**

- Views live in `supabase/migrations/0002_reports.sql`: `v_daily_summary`, `v_sleep`, `v_feeds`, `v_diapers`, `v_pumps`, `v_meds`, `v_temps`, `v_growth`. They are `security_invoker`, so row-level security applies to them.
- Days are split in the household time zone (`household_settings.timezone`), which the app keeps equal to the phone's zone. Sleep and tummy-time minutes are split at local midnight.
- Nap vs. night is one SQL function, `sleep_kind()`. The current rule: a sleep that starts between 19:00 and 05:59 counts as night. Changing the function re-classifies all history.
- Averages and the pediatrician summary ignore the days in the range before the first entry, **and today's unfinished day**. Today's bar is drawn lighter and labeled "Today" ("so far" in tooltips and the summary).
- **Longest sleep stretch** per day: the longest single sleep that **started** that day, from `v_sleep`. It's shown on Reports and as a column and average in the pediatrician summary.
- **Diaper guide** (first 14 days of life, when the birth date is set): thin stepped lines behind the diaper bars show a common hospital/pediatric handout reference: wet ≈ days old up to 6+, dirty ≈ days old up to 3+, counting the birth date as **day 0** (the same convention as the weight chart; changed from day 1 at the user's request). It's labeled as a reference with "ask your pediatrician", not as a judgement.
- Hour-based charts put ticks on whole/half hours.
- **Weight vs. birth weight** (Reports → Growth; needs no WHO data):
  - a line of every weight at its exact timestamp. Days are counted from the birth date (day 0). Thin lines mark midnights, and each day's label ("10/14 / day 0") sits in the middle of its day, so an evening weigh-in reads as that day, not the next;
  - behind each point, a bar from the first weight to that weight, blue when above it and red when below (validated diverging pair, both themes);
  - one weight scale on the left, with the right edge labeling the same scale as % of the first weight at round values, so there are no independent dual axes;
  - direct labels on the latest and lowest %, and a thin −10% reference line, shown only once a loss of more than 5% appears;
  - a note giving the current weight and %, the lowest %, and the age when the first weight was regained.

  The baseline is called "Birth weight" when the first weight was logged within 2 days of the birth date, otherwise "First weight". Logic is in `src/lib/weight.ts` (tested).
- Growth percentiles use the WHO LMS tables (0–24 months; data from CDC/NCHS), interpolated to the exact age. They need the baby's birth date and sex.
- Charts use Chart.js, plus a hand-drawn SVG sleep map. Two-series charts use the validated categorical slots blue and orange (checked for colorblind separation and contrast on both themes); WHO curves are gray reference lines.
- The pediatrician summary is a plain HTML page (`#/print`) printed with the browser's *Print → Save as PDF*.
- **Backups (revised):** a Google Apps Script (`backup/Code.gs`) runs in the owner's Google account each night. It signs in to Supabase as a dedicated backup login and saves a JSON snapshot of every table (soft-deleted rows included) to a Drive folder, pruning snapshots after 365 days. It also rewrites a Google Sheet mirror with one tab per category, in display units. The nightly sign-in keeps the free project from pausing. Restore: `restore.html` (served with the app) converts a snapshot into SQL in the browser, which is run in the SQL editor. This replaced an earlier GitHub Actions `pg_dump` job; GitHub artifacts on a public repo needed encryption, expire after 90 days, and need command-line tools to restore. A round-trip test (`backup/test/`) runs the script with Google services stubbed against a local database, restores the snapshot into a fresh one, and checks it.

---

## 6. UI principles

- Dark theme by default. Large tap targets (≥ 56 dp). Primary actions in the bottom half of the screen for one-handed use.
- One tap to log the common case: Diaper → Wet logs it, with an "undo" toast for 5 seconds.
- Optional details are hidden behind an expand control, never required.
- Live timers use a monospace counter and show who started them ("started by Mom, 23 min").
- Numeric entry uses a custom large keypad, not the system keyboard.

---

## 7. Risks and open questions

### 7.1 Decisions needed from you

Resolved (2026-10-11):

| # | Question | Decision |
|---|---|---|
| 1 | Backend | **Supabase**, free tier (§4.3) |
| 2 | Units | **US units (oz, °F, lb/oz, in)** for display; metric storage keeps this changeable |
| 3 | Extra modules for v1 | **Temperature, growth, tummy time, bath.** Solids deferred. |
| 4 | Sleep classification | **Not entered.** Derived in analytics views once a schedule forms (§3.2, §5.7). |
| 5 | Caregiver names | Defaults to the part of the email address before the @; editable in Settings |
| 6 | Google Sheets export | **No.** Replaced by CSV export and the pediatrician summary (§5.7). |
| 7 | Front-end framework | **React + Ionic + TypeScript** (§5.1) |
| 8 | Sign-in method | **Email + password** (§5.5) |

The baby's name and birth date are entered in the app at first run.

### 7.2 Known risks

| Risk | Mitigation |
|---|---|
| Supabase free project pauses after 7 days idle | Daily use prevents it; the nightly Drive backup signs in every day as a backstop. |
| Vendor dependency | Plain Postgres schema; `pg_dump` migrates to any Postgres or self-host. |
| Phone clock skew | Android NTP sync keeps it to well under a second; acceptable for this domain. |
| Accidental deletes | Soft delete plus undo toast. |
| Forgotten password | Set a new one with one SQL statement in the Supabase SQL editor (SETUP.md, Notes). No email needed. |

### 7.3 Things deliberately left simple

- No user roles. Both caregivers have identical permissions.
- No per-event edit history table (audit columns only). Can be added with a trigger if wanted.

### 7.4 PWA notification limitation

A web app cannot reliably keep an **ongoing** Android notification with a
live counter and Stop button while the app is closed. The timer itself is
unaffected (it lives in the database), but it is only visible when the app is
opened. If an always-visible timer turns out to be needed, the planned path is
a Capacitor wrapper with a native foreground notification (Phase 5).

---

## 8. Implementation plan

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Setup** | Repo scaffolding, Supabase project, schema migration, RLS, auth with both accounts | Both phones can sign in; SQL editor shows tables |
| **1. Core logging** | Home tiles, diaper, bottle, medicine (catalog + dose), temperature, growth, bath, manual entry for all types, edit/delete, timeline | A full day can be logged by both parents |
| **2. Shared timers** | Sleep, tummy time, and pump timers; nursing L/R with segments; realtime sync; conflict handling | Start on one phone, stop on the other, verified under simultaneous taps |
| **3. Offline + polish** | Outbox, PWA install, dark mode, undo, daily summary, unit setting | Works in airplane mode and syncs on reconnect |
| **4. Analytics + export** ✅ | SQL views, Reports dashboard, WHO growth percentiles, CSV export, pediatrician summary, encrypted backups | A two-week report can be exported and printed |
| **5. Optional** | Reminders, solids, milk stash, Capacitor wrapper (persistent timer notification) | As chosen |

### Testing strategy

- Unit tests for duration and summary math (segment sums, overnight sleeps that cross midnight, DST transitions).
- Database tests for the constraints: concurrent `INSERT` of running timers, double `Stop`, side-switch RPC.
- An end-to-end test (`e2e/`) that drives the built app in two headless browsers ("Parent A" and "Parent B") against a local Postgres + PostgREST running the real migration. It covers every logging screen, start-on-one-phone/stop-on-the-other, simultaneous Start, editing, and delete-with-undo. Supabase Realtime is not emulated there; the test uses the app's refresh-on-wake path instead. It runs in CI on every push.

---

## 8a. Backlog from real use (first week, 2026-10)

Feedback after two days of use in the hospital. The items are recorded here to pick up at home.

### A. Group nursing entries into feeds — **agreed, shelved until home (needs one SQL migration)**

Problem: at first the Pause / switch-side controls were not obvious, so a single feed was often logged as several Finish → Start entries. Per-entry counts therefore overstate the number of feeds.

Agreed design:

1. **Raw data is never merged or edited.** Each entry stays as logged; grouping happens at read time, so it also fixes past data retroactively.
2. **Rule:** a nursing entry that starts within **20 minutes** of the previous nursing entry's **end** belongs to the same feed. The gap is configurable in one place.
3. **Bottles:** a bottle within 20 minutes of nursing (a top-up) counts as part of the same feed.
4. **Where:** the grouping is defined in a SQL view (a "gaps and islands" query, e.g. `v_feed_sessions`). `v_daily_summary.feeds`, the Reports feed chart, average time between feeds, CSV exports, the pediatrician summary and the Google Sheet all read from it. This needs migration `0004_feed_sessions.sql` (one paste in the Supabase SQL editor). **Written and tested (2026-10-18).** It adds `household_settings.feed_gap_min` (default 20) and `day_start_hour` (default 0), the helpers `feed_gap_min()`, `day_start_hour()` and `local_day()`, the view `v_feed_sessions` (one row per feed: entries, bottles, ml, L/R minutes, duration, `minutes_since_prev` start-to-start), and changes `v_daily_summary.feeds` to count feeds. It also appends `feed_entries`, `avg_feed_interval_min` and `longest_feed_interval_min`. All report views bucket days with `local_day()`. App-side charts for intervals are a follow-up.
5. **App-only follow-ups (no database change):**
   - Starting nursing within 20 min of the last feed offers **"Continue last feed"** (resume the previous entry) instead of creating a new one.
   - Make **Pause** and **switch side** more discoverable on the running-feed screen.
6. **Done already (2026-10-16):** the Nurse tile's "time since last feed" counts from the **start** of the most recent feed, applying the same 20-minute grouping on the phone (`lastFeedStart()` in `src/lib/nursing.ts`). Once the SQL view exists, the tile and the reports share that definition.

### B. Week timeline — **built (2026-10-16)**

Location: **History → List | Timeline** (the choice is remembered per phone). The small sleep map was removed from Reports, so there is one timeline.

- **Layout:** vertical, as in a calendar week view. Time runs top to bottom over one 24-hour day, with day columns newest on the right. A **Days 1–6** selector (default 6, saved per phone) sets how many columns are shown, so two days can be compared side by side. **‹ ›** pages back and forward by that many days; older entries load on demand. With 1–3 days showing, blocks also display their start time and length.
- **Zoom (time axis only):** a two-finger pinch on the grid stretches the time axis from 1× (24 h on screen) to 8×, keeping the time under the fingers in place. One finger still scrolls. **− 1× +** buttons do the same, and tapping the "1×" label resets. Column count and widths never change. Hour labels and gridlines get denser as you zoom, and taller blocks show their start time. A pinch never selects or moves a block.
- **Day cutoff:** adjustable, saved **per phone** (`localStorage`, default 7 pm; options midnight, 5–9 pm, 6 am). A column runs from the cutoff one day to the same time the next and is labeled by its **start day** ("Tue→"). Hour labels every 3 hours from the cutoff.
- **One track per day** (sleep and feeding do not overlap in reality):
  - sleep is a blue block at its real duration;
  - nursing is an orange block at its real duration, labeled L/R/LR when tall enough;
  - a bottle is an orange dot;
  - diapers are gray ticks on the column's right edge, with an on/off toggle (per phone).

  Colors are the validated categorical slots 1–2 used elsewhere.
- **Overlaps** (data-entry collisions, e.g. a sleep timer started before a feed was finished): the later-starting block is drawn narrower and on top, so both stay visible and can be fixed.
- **Running timers** extend to now. A **now line** marks the current time.
- **Entries are shown as recorded.** The 20-minute feed grouping (A) is not applied here; gaps between fragments stay visible.
- **Editing:**
  - Tap a block to select it. A card shows the times, the L/R split, the amount, and who logged it, with **Start/End −5/+5 min** buttons and **Edit** (the full edit sheet).
  - While a block is selected, drag its top or bottom handle to change start or end, or drag the block to move it. Changes snap to 5 minutes and a live time label is shown.
  - Each change saves on release with an **Undo** toast.
  - Limits: end ≥ start + 5 min; nothing later than now; a running timer's end can't be dragged; nursing start/end can't pass its first/last side segment. Moving a nursing block shifts all its side segments; resizing adjusts the first or last segment (`retime()` in `src/lib/data.tsx`).
- Layout logic is in `src/lib/timeline.ts` (unit-tested). The e2e test selects a feed, nudges it +5 min, and undoes it.

Possible later additions: a "last 24 h" strip on Home; tummy time as a block.

### D. Temperature precision fix (2026-10-16), migration `0003_temperature_precision.sql`

Bug: `temp_c` was `numeric(4,1)`, a resolution of 0.1 °C, which is 0.18 °F. So 98.0 °F was stored as 36.7 °C and displayed as 98.1 °F, and re-editing could not correct it. The app also rounded to 0.1 °C before saving.

Fix:
- The app now sends 0.01 °C.
- Migration 0003 widens the column to `numeric(5,2)`. It drops and recreates the two views that reference the column (`v_temps`, `v_daily_summary`; the latter copied unchanged from 0002).
- Existing readings keep their stored value; re-saving a reading after the migration corrects it.
- Other stored units were checked: ml, g and cm at 0.1 are finer than their display resolution.
- Tests: a database test (exact round-trip, daily view unchanged) and an e2e test (enter 98 → shows 98 °F).

### E. Interface requests (2026-10-18) — app-only, no Supabase step

**E1. Auto-stop conflicting timers — built (2026-10-18).** An action logged for **now** finishes any running timer it conflicts with, ending it at the action's time. Unrelated actions never interrupt each other (e.g. giving a bottle while pumping is fine).

| Action (now) | Ends |
|---|---|
| Start nursing (either side) | sleep; a pump on that side or "both" |
| Switch nursing to a side | a pump on that side or "both" |
| Log a bottle | sleep; nursing |
| Log a diaper | sleep |
| Start tummy time, log a bath | sleep |
| Start sleep | nursing; tummy time |
| Start pumping on a side (or both) | nursing whose **active** side is that side (a paused nursing session isn't using either breast) |
| Meds, temperature, growth | nothing |

- "Now" means the entry's time is within 5 minutes of the present. Back-dated entries never stop anything.
- A stop never ends a timer before it started.
- The toast names what was ended (e.g. "Bottle logged · Sleep ended"). **Undo** reverts the new entry and reopens what was ended, including the nursing side that was active.
- An auto-ended pump has no amounts; add them from History.
- Uses the same `stop_timer` as the Stop button, so it is safe when both phones act at once. Rules live in `src/lib/conflicts.ts` (unit-tested).

**E2. Home screen redesign — built (2026-10-18): "More" tile.** Six large tiles stay on Home: Sleep, Nurse, Bottle, Diaper, Pump (with gauges), **Growth** (latest weight · when; swapped with Meds on 2026-10-18). A **More** tile expands the rarely used ones (**Meds**, Temp, Tummy time, Bath) inline on the main screen, and tapping again collapses them. The open/closed state is remembered per phone. A running timer in a hidden category (e.g. tummy time) keeps the section open so it is never out of sight.

**E3. Pump gauges ("odometers") on the Pump tile — built (2026-10-18).** Replace the 🥛 icon with **two gauges, Left and Right**. Each shows how many pumping sessions of **at least 15 minutes** that side has had, against a **target band of 8–12**.
- A session counts for a side if `pump_side` is that side or `both` (decided: "both" counts for both).
- Counting window: **rolling last 24 hours** (decided).
- Design brief: functional first (needle or arc fill, target band marked, count shown as a number, readable at a glance), with a playful, tasteful nod to the shape. The two gauges sit side by side as a pair, each with a small round hub at the needle pivot.
- Tapping the tile still opens Pump logging.
- The **Pump screen** shows the same gauges large (140 px). Tapping a breast picks that side; tapping the other one too selects both; tapping a selected one when both are picked leaves only the other. The Left/Right/Both control stays as well.
- As built: each gauge is a 270° dial (blue below target, green once ≥ 8) with the 8–12 band marked in green on the outer edge. The count sits in a soft round warm centre, on a faint round warm backdrop, with L/R below. `pumpCounts()` in `src/lib/pump.ts` (tested): a running session counts once it reaches 15 min; deleted entries never count.

**E4. Visual style — built (2026-10-18): tinted cards (option B).** Each category has an accent colour, and tiles carry a soft diagonal wash of it, with tuned light and dark variants (`--acc-*` in `app.css`). Big tiles put the icon top-right and the label and status bottom-left. Logging-screen choice buttons wear their category's wash. Options A (soft accents) and C (minimal outline) were mocked up and not chosen.

**E4b. Illustrated icons — built (2026-10-18).** The emoji are replaced by a flat illustrated set (navy outline, periwinkle and mint fills) that the owner supplied as one image. Each icon was cut out to `src/assets/icons/*.webp` (192 px, transparent background). The set had no pump or note icon, so `pump.svg` and `note.svg` were drawn to match. Rendered by `TypeIcon`. In dark mode a faint light edge keeps the navy outlines visible.

**E4c. Charts and timeline match the tiles (2026-10-18).** Chart series use the Home tile accents: slot 1 is Sleep periwinkle (`#5b6fe0` light, `#6d7fec` dark) and slot 2 is Nurse rose (`#d9638e` / `#d9688f`). Both pairs were validated with the dataviz checker on the tinted card surfaces (`#eef1f8` / `#1c2438`). The weight-change bars use periwinkle above the reference and soft rose below it, replacing the hard red. Chart cards and timeline columns use the tile background, and grids and axes are navy-tinted. **App icon:** the owner's sleeping-baby-on-moon image, transparent and filling the icon square (no maskable icon, at the owner's request; Android may draw its own plate behind it). The apple-touch icon keeps the pale periwinkle background because iOS needs an opaque one. The long-press shortcut icons are rebuilt from the type icons. The service worker now precaches `.webp`.

**E5. "Still running?" check — Phase 1 built (2026-10-18).** When a timer runs unusually long, ask the person who started it whether it's still valid.
- **Phase 1, app-only:**
  - Show a banner on Home and on the running sheet once a timer passes a threshold, e.g. "Sleep has been running 5 h 10 m — still asleep?", with **Yes, still going** / **It ended at…** (time picker) / **Discard**.
  - Show it to everyone, but address the starter by name.
  - Snoozing hides it for another threshold interval.
- **Phase 2, needs Supabase (owner steps):**
  - Real push notifications to the starter's phone even when the app is closed: Web Push from a scheduled Supabase Edge Function (pg_cron), plus a `push_subscriptions` table.
  - Android Chrome supports this for installed PWAs.
- Thresholds (confirmed): sleep 4 h · nursing 60 min · pumping 30 min · tummy time 30 min (`src/lib/longRunning.ts`).
- As built: the card shows on Home and at the top of that timer's sheet, on both phones, with "Started … by <name / you>". **Yes, still going** snoozes on that phone only, for one more threshold interval. **It ended at…** stops the timer at the chosen time, with Undo. **Discard** deletes the entry, with Undo.

### C. Report ideas saved for later (2026-10-16)

- **Wake windows:** average awake time between sleeps per day (trend).
- **Growth charts in weeks** for the first 3 months (age axis currently in months).
- **Time between feeds** — built 2026-10-18: Reports chart (daily average and longest, start to start), typical interval in the chart note, columns in the daily CSV and pediatrician summary. Home's "Today · feeds" uses the same 20-min grouping (`countFeeds`).
- **Daily charts on the timeline's day cutoff** instead of midnight, so "sleep per day" means the same in both places. Needs a view change, so it also goes with 0004.
- **Pediatrician summary:** add weight-change numbers (birth weight, lowest %, regain age) and diapers by day of life.
- **Discoverability:** a "tap a bar for details" hint or a direct label on the latest bar.

## 9. Sources consulted

- Huckleberry App Store listing: https://apps.apple.com/us/app/huckleberry-baby-tracker/id1169136078
- Glow Baby comparison: https://marlvel.ai/apps/com-glowing-noah/vs
- Baby tracking app roundup: https://mobileappdaily.com/products/best-baby-tracking-apps
- Supabase free-tier figures (secondary sources): https://automationatlas.io/answers/supabase-free-tier-limits-2026/ , https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ . Re-check at setup, because free-tier terms change.
