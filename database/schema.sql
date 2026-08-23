create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  phone text,
  password_hash text not null,
  role text not null default 'patient' check (role in ('patient','clinic','admin')),
  birth_date date,
  address text,
  medical_info text,
  created_at timestamptz not null default now()
);

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users(id) on delete cascade,
  name text not null,
  specialty text not null default '',
  address text not null default '',
  description text not null default '',
  doctor text not null default '',
  lat numeric(10,7),
  lng numeric(10,7),
  verified boolean not null default false,
  active boolean not null default false,
  subscription_status text not null default 'inactive',
  subscription_expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists working_hours (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('mon','tue','wed','thu','fri','sat','sun')),
  enabled boolean not null default true,
  from_time time not null default '09:00',
  to_time time not null default '18:00',
  unique(clinic_id, day_of_week)
);

create table if not exists clinic_images (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  url text not null,
  path text,
  created_at timestamptz not null default now()
);

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text not null default '',
  phone text,
  available boolean not null default true
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  price numeric(10,2),
  duration_minutes integer
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references users(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  appointment_date date not null,
  appointment_time time not null,
  service text not null default 'Consultation',
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_clinics_active on clinics(active, subscription_status, subscription_expires_at);
create index if not exists idx_appointments_patient on appointments(patient_id, appointment_date);
create index if not exists idx_appointments_clinic on appointments(clinic_id, appointment_date);
create index if not exists idx_notifications_user on notifications(user_id, created_at desc);
create index if not exists idx_reviews_clinic on reviews(clinic_id, created_at desc);


-- Remote application state for legacy/mobile modules that are not yet represented by relational tables.
-- This is per-user and never stored in browser localStorage.
create table if not exists user_app_state (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
