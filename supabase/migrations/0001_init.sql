-- kidTracker initial schema (design doc §5.2–§5.5).
-- Run once in the Supabase SQL editor. Storage is metric (ml, °C, g, cm);
-- display units are converted in the app.

-- ───────────────────────── Tables ─────────────────────────

create table public.caregivers (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- Single-row household settings (display units).
create table public.household_settings (
  id           boolean primary key default true check (id),
  volume_unit  text not null default 'oz'    check (volume_unit in ('oz','ml')),
  temp_unit    text not null default 'F'     check (temp_unit in ('F','C')),
  weight_unit  text not null default 'lb_oz' check (weight_unit in ('lb_oz','kg')),
  length_unit  text not null default 'in'    check (length_unit in ('in','cm'))
);
insert into public.household_settings default values;

create table public.babies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  birth_date  date,
  created_at  timestamptz not null default now()
);

create table public.medications (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  default_dose       numeric(8,2),
  unit               text,
  min_interval_hours numeric(4,1),
  max_doses_per_24h  int,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create type public.event_type as enum
  ('sleep','nursing','bottle','diaper','pump','medicine','temperature',
   'growth','tummy_time','bath','note');

create table public.events (
  id            uuid primary key default gen_random_uuid(),  -- normally generated on the client
  baby_id       uuid not null references public.babies(id),
  type          public.event_type not null,
  started_at    timestamptz not null,
  ended_at      timestamptz,                                -- NULL = timer running
  notes         text,

  -- bottle
  bottle_ml       numeric(6,1) check (bottle_ml >= 0),
  bottle_contents text check (bottle_contents in ('breast_milk','formula','mixed')),

  -- diaper
  diaper_wet       boolean,
  diaper_dirty     boolean,
  poop_color       text,
  poop_consistency text,
  diaper_rash      boolean,

  -- pump
  pump_side     text check (pump_side in ('left','right','both')),
  pump_left_ml  numeric(6,1) check (pump_left_ml >= 0),
  pump_right_ml numeric(6,1) check (pump_right_ml >= 0),

  -- medicine
  medication_id uuid references public.medications(id),
  dose_amount   numeric(8,2),
  dose_unit     text,

  -- temperature
  temp_c        numeric(4,1),
  temp_method   text check (temp_method in ('rectal','axillary','temporal','ear','oral')),

  -- growth
  weight_g      numeric(7,1) check (weight_g > 0),
  length_cm     numeric(5,1) check (length_cm > 0),
  head_cm       numeric(5,1) check (head_cm > 0),

  -- audit
  created_by    uuid references public.caregivers(id) default auth.uid(),
  updated_by    uuid references public.caregivers(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint ended_after_started check (ended_at is null or ended_at >= started_at)
);

create index events_baby_type_time on public.events (baby_id, type, started_at desc);
create index events_baby_time      on public.events (baby_id, started_at desc);

-- At most ONE running timer per baby per timed type (design doc §5.3).
create unique index one_running_timer
  on public.events (baby_id, type)
  where ended_at is null and deleted_at is null
    and type in ('sleep','nursing','pump','tummy_time');

create table public.nursing_segments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  side        text not null check (side in ('left','right')),
  started_at  timestamptz not null,
  ended_at    timestamptz,                                  -- NULL = side active
  constraint seg_ended_after_started check (ended_at is null or ended_at >= started_at)
);
create index nursing_segments_event on public.nursing_segments (event_id, started_at);

-- At most one open segment per nursing session.
create unique index one_open_segment
  on public.nursing_segments (event_id) where ended_at is null;

-- ───────────────────────── Triggers ─────────────────────────

-- Every new auth user (created by you in the dashboard; public sign-up is off)
-- becomes a caregiver.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.caregivers (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_event() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger events_touch
  before update on public.events
  for each row execute function public.touch_event();

-- ───────────────────────── Access control (RLS) ─────────────────────────

create function public.is_caregiver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.caregivers where id = auth.uid());
$$;

alter table public.caregivers         enable row level security;
alter table public.household_settings enable row level security;
alter table public.babies             enable row level security;
alter table public.medications        enable row level security;
alter table public.events             enable row level security;
alter table public.nursing_segments   enable row level security;

create policy caregivers_read on public.caregivers
  for select to authenticated using (public.is_caregiver());
create policy caregivers_update_self on public.caregivers
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy settings_read on public.household_settings
  for select to authenticated using (public.is_caregiver());
create policy settings_update on public.household_settings
  for update to authenticated using (public.is_caregiver()) with check (public.is_caregiver());

create policy babies_all on public.babies
  for all to authenticated using (public.is_caregiver()) with check (public.is_caregiver());
create policy medications_all on public.medications
  for all to authenticated using (public.is_caregiver()) with check (public.is_caregiver());
create policy events_all on public.events
  for all to authenticated using (public.is_caregiver()) with check (public.is_caregiver());
create policy segments_all on public.nursing_segments
  for all to authenticated using (public.is_caregiver()) with check (public.is_caregiver());

-- ───────────────────────── Timer functions (design doc §5.3) ─────────────────────────
-- These run with the caller's permissions (RLS applies).

-- Start a timer. If one of this type is already running for the baby (the
-- other phone started it first), no new row is created and the running one
-- is returned instead. Retrying with the same id is harmless.
create function public.start_timer(
  p_id uuid, p_baby_id uuid, p_type public.event_type, p_started_at timestamptz,
  p_pump_side text default null
) returns public.events
language plpgsql as $$
declare r public.events;
begin
  if p_type not in ('sleep','nursing','pump','tummy_time') then
    raise exception 'event type % has no timer', p_type;
  end if;

  insert into public.events (id, baby_id, type, started_at, pump_side)
  values (p_id, p_baby_id, p_type, p_started_at, p_pump_side)
  on conflict do nothing;

  select * into r from public.events
   where baby_id = p_baby_id and type = p_type
     and ended_at is null and deleted_at is null;
  if not found then
    -- Same id was already inserted and stopped (a stale retry).
    select * into r from public.events where id = p_id;
  end if;
  return r;
end $$;

-- Stop a timer. Only the first stop sets ended_at; later stops change nothing.
-- Any open nursing segment is closed at the same instant.
create function public.stop_timer(p_id uuid, p_ended_at timestamptz)
returns public.events
language plpgsql as $$
declare r public.events;
begin
  update public.events set ended_at = greatest(p_ended_at, started_at)
   where id = p_id and ended_at is null
  returning * into r;

  if found then
    update public.nursing_segments set ended_at = greatest(r.ended_at, started_at)
     where event_id = p_id and ended_at is null;
  else
    select * into r from public.events where id = p_id;
  end if;
  return r;
end $$;

-- Nursing: start timing a side (closing the other side if open). p_side null = pause.
create function public.nursing_set_side(p_event_id uuid, p_side text, p_at timestamptz)
returns setof public.nursing_segments
language plpgsql as $$
declare ev public.events;
begin
  -- Lock the session so simultaneous taps from two phones run one after the other.
  select * into ev from public.events
   where id = p_event_id and type = 'nursing' for update;
  if not found then raise exception 'nursing session % not found', p_event_id; end if;
  if ev.ended_at is not null then raise exception 'nursing session already finished'; end if;

  -- Tapping the side that is already running is a no-op.
  if p_side is null or not exists (
       select 1 from public.nursing_segments
        where event_id = p_event_id and ended_at is null and side = p_side) then
    update public.nursing_segments set ended_at = greatest(p_at, started_at)
     where event_id = p_event_id and ended_at is null;
    if p_side is not null then
      insert into public.nursing_segments (event_id, side, started_at)
      values (p_event_id, p_side, greatest(p_at, ev.started_at));
    end if;
  end if;

  return query select * from public.nursing_segments
                where event_id = p_event_id order by started_at;
end $$;

-- ───────────────────────── Realtime ─────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.events, public.nursing_segments, public.babies,
                public.medications, public.household_settings, public.caregivers;
  end if;
end $$;
