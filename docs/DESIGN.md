# kidTracker — Design Document

Status: **Draft v0.1** (for review before implementation)
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
| G1 | Log sleep, nursing, bottle, diaper, pumping, and medicine events with as few taps as possible. |
| G2 | Shared timers: either caregiver can start a timer, and either can stop it from their own phone. |
| G3 | Concurrent use: both phones can read and write at the same time with no data loss and no duplicate entries. |
| G4 | Owners have full, direct access to the raw data (SQL and/or spreadsheet export). |
| G5 | Every entry can be created manually after the fact and edited later (start, end, and all fields). |
| G6 | Usable one-handed, at night, half-asleep: large touch targets, dark mode, little text input. |

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
| **Sleep** | Start/stop timer; manual entry; naps vs. night sleep; daily totals; sleep location; wake-window display | **Yes** (*requested*) |
| **Breastfeeding** | Per-side timers (L/R), switch sides mid-session, pause, "last side" indicator | **Yes** (*requested*) |
| **Bottle** | Volume (ml/oz), contents (breast milk / formula / mixed) | **Yes** (*requested*) |
| **Solids** | Food name, amount, reaction/allergen flag | Later |
| **Diaper** | Wet / dirty / mixed / dry; poop color & consistency; rash flag; notes | **Yes** (*requested*) |
| **Pumping** | L/R/both, timer, volume per side; milk-stash inventory | **Yes** (*requested*); stash later |
| **Medicine** | Med name, dose, unit; reminders; time since last dose | **Yes** (*requested*) |
| Temperature | Value + method | Proposed v1 (small, pairs with meds) |
| Growth | Weight, length, head circumference; WHO percentile charts | Later |
| Activities | Tummy time, bath, outdoor time, etc. (timed or instant) | Later (the generic event model supports it cheaply) |
| Milestones / photos | First smile, rolling, etc. | No |
| Potty training | — | No (age-inappropriate for now) |
| Summary / dashboard | "Time since last feed/diaper/sleep", daily totals, timeline | **Yes** |
| Reports / charts | Daily/weekly bars, trends | Basic in v1; more later |
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

- One tile per category: Sleep, Nurse, Bottle, Diaper, Pump, Meds.
- Each tile shows the time since the last event of that type and a one-line summary (e.g. "Nursed 1h 42m ago · last side **R**").
- A tile with a running timer shows a live elapsed counter and a **Stop** button. The timer is visible to both phones.
- Below the tiles: a reverse-chronological timeline for today, with daily totals (sleep hours, feed count, ml taken, wet/dirty counts).

### 3.2 Sleep

- **Timer mode:** tap *Start*; a running sleep is created. Either phone can tap *Stop*.
- **Manual mode:** pick start and end date/times.
- Optional fields: notes. Sleep type (nap vs. night) is derived from start time by a configurable rule (e.g. night if it starts between 19:00 and 06:00), and can be overridden.
- Only one running sleep per child. If the second phone taps *Start* while one is running, the app shows the existing timer instead of creating a second one.

### 3.3 Nursing (breastfeeding)

- Two large buttons, **L** and **R**. Tapping one starts timing that side.
- Tapping the other side switches: the current side's segment closes and a new one opens.
- **Pause** closes the open segment without ending the session; **Finish** ends the session.
- The session stores per-side durations, so a feed of "L 8 min, R 6 min, L 3 min" is recorded faithfully.
- Manual entry: start time, plus L and R minutes (and optionally which side was first).
- The home tile shows "last side", meaning the side of the most recent segment.

### 3.4 Bottle

- Volume with a numeric keypad and quick-pick chips (e.g. 30 / 60 / 90 / 120 ml). Unit is a household setting (ml or oz); data is always **stored in ml**.
- Contents: breast milk / formula / mixed.
- Time defaults to now and can be edited. Notes are optional.

### 3.5 Diaper

- Icon buttons: 💧 **Wet**, 💩 **Dirty**, 💧💩 **Both**, ⭕ **Dry**. One tap logs the change at the current time.
- Optional expansion: poop color (icon palette), consistency (watery / seedy / soft / formed / hard), rash flag, free-text notes.
- Time is editable.

### 3.6 Pumping

- Side selector: **L**, **R**, **Both**.
- Timer (start/stop, shared like sleep) or manual start/end.
- Volume: per side (L ml, R ml) or a single total; the app computes the total.
- Notes are optional. A milk-stash inventory is deferred.

### 3.7 Medicine

- **Medication catalog** (configured once): name, default dose, unit (ml, mg, drops, tablet), and an optional *minimum interval* and *max doses per 24 h* that the user enters from a pediatrician's or label instructions.
- **Log a dose:** pick a medication; the default dose is prefilled and editable; time defaults to now.
- The home tile shows the last dose time per medication and, if an interval is configured, "next allowed at HH:MM". This is arithmetic on the user's own settings, not advice.
- (Proposed) **Temperature** entry on the same screen: value, unit, method (rectal / axillary / temporal / ear).

### 3.8 Editing and history

- Every event can be opened, edited, or deleted. Deletion is a soft delete (`deleted_at`), so it can be undone.
- Each row records `created_by` and `updated_by` (which parent).
- A history view per category, filterable by date.

---

## 4. Backend options

The deciding requirements are G2 and G3 (shared live timers, concurrent
writes) together with G4 (direct data access).

### 4.1 Options evaluated

| Option | Real-time sync | Concurrency safety | Direct data access | Cost | Ops burden | Assessment |
|---|---|---|---|---|---|---|
| **A. Google Sheets** via Apps Script web app | No push: clients poll (e.g. every 5–10 s); writes take ~1–3 s | Weak: needs `LockService` around every write; no transactions, no unique constraints | Excellent (it is a spreadsheet) | Free | Low | Workable for logging. Shared timers would be laggy and race-prone. Sheets API quotas apply. |
| **B. Supabase** (hosted Postgres + realtime + auth) | Yes (Postgres change subscriptions over websocket) | Strong: transactions, unique/partial indexes, row-level security | Excellent: SQL editor, direct Postgres connection string, CSV export | Free tier is sufficient (500 MB DB; projects pause after 7 days with no activity, which daily use prevents) | Low (managed) | **Recommended.** |
| **C. Firebase Firestore** | Yes | Good (transactions) | Medium: NoSQL documents; queries are less flexible; export through tooling | Free tier is sufficient | Low | Good offline support, but you asked for SQL-style access, and it is weaker there. |
| **D. Self-hosted** (PocketBase/SQLite or Postgres on a home server/VPS) | Yes (PocketBase has realtime) | Strong | Excellent (you own the file or server) | ~$0–5/mo | Medium: TLS, backups, uptime are your job | A good fallback if you want zero third-party dependency. |

### 4.2 Recommendation

**Supabase (Postgres)** as the system of record, plus an **optional one-way
export to Google Sheets** (scheduled job or on-demand button) for casual
browsing and charting.

Rationale:

- Postgres constraints solve the "both of us pressed Start" problem in the database (§5.3), which is not possible in Sheets.
- Realtime subscriptions make a timer started on one phone appear on the other within about a second.
- "Total access" holds: the data is ordinary SQL tables, reachable from the Supabase dashboard, `psql`, Python, a BI tool, or the Sheets export.
- Moving away later is cheap. The schema is plain Postgres; `pg_dump` moves it anywhere (including option D).

If you would rather avoid any third-party service, option D (PocketBase on
a small VPS or home machine) keeps the same architecture with a different
client SDK.

---

## 5. Architecture

### 5.1 Client: Progressive Web App (PWA)

```
 ┌──────────── Android phone (×2) ────────────┐
 │  PWA (installed to home screen)            │
 │   ├─ UI (React or Svelte + TypeScript)     │
 │   ├─ Local cache + outbox (IndexedDB)      │
 │   └─ Supabase JS client                    │
 └───────────────┬────────────────────────────┘
                 │ HTTPS (REST) + WebSocket (realtime)
 ┌───────────────▼────────────────────────────┐
 │  Supabase                                  │
 │   ├─ Auth (Google sign-in, 2-email allowlist)│
 │   ├─ Postgres (events, meds, babies…)      │
 │   ├─ Row-Level Security policies           │
 │   └─ Realtime (change feed)                │
 └───────────────┬────────────────────────────┘
                 │ (optional, scheduled)
          Google Sheets export
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

Hosting the static front end: GitHub Pages, Cloudflare Pages, or Vercel (all free).

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
  ('sleep','nursing','bottle','diaper','pump','medicine','temperature','note');

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

  -- sleep
  sleep_kind    text check (sleep_kind in ('nap','night')),

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
    and type in ('sleep','nursing','pump');

-- At most one open segment per nursing session
create unique index one_open_segment
  on nursing_segments (event_id) where ended_at is null;
```

Units: volumes are stored in **ml** and temperatures in **°C**. Conversion
happens only in the UI, according to a household setting.

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

- Sign-in with Google through Supabase Auth.
- Row-Level Security: every table allows access only when `auth.uid()` is in `caregivers`. Only your two accounts are inserted there, so anyone else who signs in sees nothing.
- The public anon key in the front end is safe under RLS. The service-role key is never shipped to the client.
- Backups: Supabase free tier has no point-in-time recovery. Mitigation: a nightly GitHub Action running `pg_dump` to a private location, and/or the Sheets export.

### 5.6 Data access for you

- Supabase dashboard: table editor and SQL editor.
- Direct Postgres connection string (psql, DBeaver, Python/pandas, Metabase, Grafana).
- Views such as `v_sleep`, `v_feeds`, `v_diapers`, `v_pumps`, `v_meds`, and `v_daily_summary`.
- Optional: a Google Sheets mirror, refreshed on a schedule. This is read-only, so the database remains the single source of truth.

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

1. **Backend:** Supabase (recommended), self-hosted PocketBase, or Google Sheets despite the timer/concurrency limits?
2. **Units:** ml or oz in the UI?
3. **Extra modules for v1:** temperature? growth (weight/length)? solids? tummy time / bath?
4. **Sleep classification:** auto nap/night by clock window, or always manual?
5. **Naming:** what display names should caregivers have (shown as "started by …")?
6. **Google Sheets export:** wanted in v1, or later?

### 7.2 Known risks

| Risk | Mitigation |
|---|---|
| Supabase free project pauses after 7 days idle | Daily use prevents it; a weekly keep-alive ping from GitHub Actions as a backstop. |
| Vendor dependency | Plain Postgres schema; `pg_dump` migrates to any Postgres or self-host. |
| Phone clock skew | Android NTP sync keeps it to well under a second; acceptable for this domain. |
| Accidental deletes | Soft delete plus undo toast. |

### 7.3 Things deliberately left simple

- No user roles. Both caregivers have identical permissions.
- No per-event edit history table (audit columns only). Can be added with a trigger if wanted.

### 7.4 PWA notification limitation

A web app cannot reliably keep an **ongoing** Android notification with a
live counter and Stop button while the app is closed. The timer itself is
unaffected (it lives in the database), but it is only visible when the app is
opened. If an always-visible timer turns out to be needed, the planned path is
a Capacitor wrapper with a native foreground notification (Phase 4).

---

## 8. Implementation plan

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Setup** | Repo scaffolding, Supabase project, schema migration, RLS, auth with both accounts | Both phones can sign in; SQL editor shows tables |
| **1. Core logging** | Home tiles, diaper, bottle, medicine (catalog + dose), manual entry for all types, edit/delete, timeline | A full day can be logged by both parents |
| **2. Shared timers** | Sleep timer, nursing L/R with segments, pump timer; realtime sync; conflict handling | Start on one phone, stop on the other, verified under simultaneous taps |
| **3. Offline + polish** | Outbox, PWA install, dark mode, undo, daily summary, ml/oz setting | Works in airplane mode and syncs on reconnect |
| **4. Optional** | Sheets export, charts, reminders, growth/solids, Capacitor wrapper | As chosen |

### Testing strategy

- Unit tests for duration and summary math (segment sums, overnight sleeps that cross midnight, DST transitions).
- Database tests for the constraints: concurrent `INSERT` of running timers, double `Stop`, side-switch RPC.
- A two-browser manual test script for the concurrency scenarios in §5.3.

---

## 9. Sources consulted

- Huckleberry App Store listing: https://apps.apple.com/us/app/huckleberry-baby-tracker/id1169136078
- Glow Baby comparison: https://marlvel.ai/apps/com-glowing-noah/vs
- Baby tracking app roundup: https://mobileappdaily.com/products/best-baby-tracking-apps
- Supabase pricing and limits should be re-checked at setup time, because free-tier terms change.
