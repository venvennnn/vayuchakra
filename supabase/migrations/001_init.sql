create extension if not exists pgcrypto;

create type report_status as enum ('draft', 'published', 'rejected');
create type confidence_band as enum ('corroborated', 'plausible', 'unverified');
create type claim_type as enum ('smoke', 'dust', 'traffic', 'construction', 'unsure');

create table reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status report_status not null default 'draft',
  claim claim_type not null,
  note text check (char_length(note) <= 240),
  lat double precision not null,
  lng double precision not null,
  place_name text,
  attempts_used int not null default 0 check (attempts_used between 0 and 3),
  published_attempt int,
  confidence int check (confidence between 0 and 100),
  band confidence_band,
  filer_token uuid not null,
  language text not null default 'en'
);

create table report_attempts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  attempt_no int not null check (attempt_no between 1 and 3),
  created_at timestamptz not null default now(),
  storage_path text not null,
  exif_lat double precision,
  exif_lng double precision,
  exif_taken_at timestamptz,
  gemini jsonb not null,
  hard_fail_reason text,
  confidence int,
  unique (report_id, attempt_no)
);

create table aqi_cache (
  cache_key text primary key,
  kind text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create table geocode_cache (
  cache_key text primary key,
  place_name text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create table fire_hotspots (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lng double precision not null,
  acq_at timestamptz not null,
  confidence text not null,
  frp double precision,
  satellite text,
  fetched_at timestamptz not null default now()
);

create table pm25_estimates (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lng double precision not null,
  observation_date date not null,
  predicted_pm25 double precision not null,
  model_version text not null,
  generated_at timestamptz not null default now()
);

create index reports_geo on reports (lat, lng) where status = 'published';
create index fire_acq on fire_hotspots (acq_at);
create index reports_filer on reports (filer_token, created_at);
create index fire_fetched on fire_hotspots (fetched_at);
create index pm25_estimates_date on pm25_estimates (observation_date, lat, lng);

-- RLS on every table, with no anon/authenticated policies. All access goes through
-- Next.js route handlers using the service role, which bypasses RLS.
alter table reports enable row level security;
alter table report_attempts enable row level security;
alter table aqi_cache enable row level security;
alter table geocode_cache enable row level security;
alter table fire_hotspots enable row level security;
alter table pm25_estimates enable row level security;

-- Private evidence bucket: 8 MB, jpeg/png/webp. No storage.objects policies, so only
-- the service role (and server-issued signed URLs) can read or write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
