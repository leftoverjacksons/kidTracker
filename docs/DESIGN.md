# kidTracker — Design Document

Status: **v0.4**. Phases 0–2 implemented (logging, shared timers, history); decisions recorded in §7.1.
Last updated: 2026-10-11

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
| Home-screen widget | No | Yes |

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
- Backups: Supabase free tier has no point-in-time recovery. Mitigation: a nightly GitHub Action running `pg_dump` to a private location.

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

Charting library: to be chosen at that phase (e.g. Chart.js or Recharts).

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
| Supabase free project pauses after 7 days idle | Daily use prevents it; a weekly keep-alive ping from GitHub Actions as a backstop. |
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
| **4. Analytics + export** | SQL views, Reports dashboard, WHO growth percentiles, CSV export, pediatrician summary | A two-week report can be exported and printed |
| **5. Optional** | Reminders, solids, milk stash, Capacitor wrapper (persistent timer notification) | As chosen |

### Testing strategy

- Unit tests for duration and summary math (segment sums, overnight sleeps that cross midnight, DST transitions).
- Database tests for the constraints: concurrent `INSERT` of running timers, double `Stop`, side-switch RPC.
- An end-to-end test (`e2e/`) that drives the built app in two headless browsers ("Parent A" and "Parent B") against a local Postgres + PostgREST running the real migration. It covers every logging screen, start-on-one-phone/stop-on-the-other, simultaneous Start, editing, and delete-with-undo. Supabase Realtime is not emulated there; the test uses the app's refresh-on-wake path instead. It runs in CI on every push.

---

## 9. Sources consulted

- Huckleberry App Store listing: https://apps.apple.com/us/app/huckleberry-baby-tracker/id1169136078
- Glow Baby comparison: https://marlvel.ai/apps/com-glowing-noah/vs
- Baby tracking app roundup: https://mobileappdaily.com/products/best-baby-tracking-apps
- Supabase free-tier figures (secondary sources): https://automationatlas.io/answers/supabase-free-tier-limits-2026/ , https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ . Re-check at setup, because free-tier terms change.
