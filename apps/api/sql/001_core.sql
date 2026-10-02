-- Mello core schema. Portable Postgres: runs on Supabase and on PGlite (local dev + tests).
-- Supabase-only pieces (RLS, grants, the auth.users link) live in 002_supabase.sql.

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  pairing_code text not null unique check (pairing_code ~ '^[0-9]{6}$'),
  -- scrypt "salt:hash" of the password a kid's phone needs to sign out
  parent_password text,
  created_at timestamptz not null default now()
);

-- Parents are Supabase Auth users. A family can have several parents.
create table if not exists family_members (
  family_id uuid not null references families (id) on delete cascade,
  user_id uuid not null,
  role text not null default 'parent' check (role in ('parent')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists family_members_user_id_idx on family_members (user_id);

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  title text not null,
  author text,
  age_level int check (age_level between 3 and 18),
  text text not null,
  source text not null default 'pasted' check (source in ('pasted', 'file', 'sample')),
  created_at timestamptz not null default now()
);
create index if not exists books_family_id_idx on books (family_id);

create table if not exists kids (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  -- sha256 of the device token; the token itself only lives on the kid's phone
  device_token_hash text not null unique,
  push_token text,
  installed_apps jsonb not null default '[]',
  current_book_id uuid references books (id) on delete set null,
  -- opt-in extras the parent turns on per kid (location, camera proof, sensors)
  settings jsonb not null default '{}',
  -- last report from the phone: gate/overlay/admin permissions, battery, location, …
  device_status jsonb not null default '{}',
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unpair_failures int not null default 0,
  unpair_locked_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists kids_family_id_idx on kids (family_id);
create index if not exists kids_current_book_id_idx on kids (current_book_id);

-- Activities a parent assigns: listen to audio, watch a video, read an article or a book.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  kind text not null check (kind in ('audio', 'video', 'article', 'reading')),
  title text not null,
  -- audio: our /audio URL or any https audio; video: YouTube URL; article: https page; reading: null
  url text,
  book_id uuid references books (id) on delete set null,
  required_minutes int not null check (required_minutes between 1 and 180),
  -- 'once' = done after one completion, 'daily' = resets every day
  repeat text not null default 'daily' check (repeat in ('once', 'daily')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists tasks_kid_id_idx on tasks (kid_id);
create index if not exists tasks_book_id_idx on tasks (book_id);

create table if not exists task_progress (
  task_id uuid not null references tasks (id) on delete cascade,
  kid_id uuid not null references kids (id) on delete cascade,
  day date not null,
  seconds int not null default 0 check (seconds >= 0),
  completed_at timestamptz,
  primary key (task_id, day)
);
create index if not exists task_progress_kid_id_idx on task_progress (kid_id);

-- "To open these apps, first do this": reading N minutes, or finish a task.
create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  apps text[] not null check (cardinality(apps) > 0),
  activity text not null default 'reading' check (activity in ('reading', 'task')),
  task_id uuid references tasks (id) on delete cascade,
  minutes_required int not null check (minutes_required between 1 and 120),
  unlock_minutes int not null check (unlock_minutes between 1 and 240),
  enabled boolean not null default true,
  check (activity = 'reading' or task_id is not null)
);
create index if not exists rules_kid_id_idx on rules (kid_id);
create index if not exists rules_task_id_idx on rules (task_id);

-- Daily screen-time budget per app, measured on the phone with UsageStats.
create table if not exists app_limits (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  package_name text not null,
  daily_minutes int not null check (daily_minutes between 0 and 1440),
  unique (kid_id, package_name)
);

-- Bedtime: only allowed apps work between start and end (minutes after midnight, phone's local time).
create table if not exists quiet_hours (
  kid_id uuid primary key references kids (id) on delete cascade,
  enabled boolean not null default true,
  start_minute int not null check (start_minute between 0 and 1439),
  end_minute int not null check (end_minute between 0 and 1439),
  allowed_apps text[] not null default '{}'
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  book_id uuid references books (id) on delete set null,
  questions jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists challenges_kid_id_idx on challenges (kid_id);
create index if not exists challenges_book_id_idx on challenges (book_id);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  book_id uuid references books (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,
  seconds int not null check (seconds >= 0),
  from_page int,
  to_page int,
  app_package text,
  challenge_id uuid references challenges (id) on delete set null,
  passed boolean,
  created_at timestamptz not null default now()
);
create index if not exists sessions_kid_created_idx on sessions (kid_id, created_at);
create index if not exists sessions_book_id_idx on sessions (book_id);
create index if not exists sessions_task_id_idx on sessions (task_id);
create index if not exists sessions_challenge_id_idx on sessions (challenge_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  kind text not null check (kind in ('audio', 'tts')),
  text text,
  audio_file text,
  created_at timestamptz not null default now(),
  played_at timestamptz
);
create index if not exists messages_kid_created_idx on messages (kid_id, created_at desc);

create table if not exists unpair_requests (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists unpair_requests_kid_id_idx on unpair_requests (kid_id);

-- Things the parent should know about: gate switched off, admin removed, quiet-hours attempts, …
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids (id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists alerts_kid_created_idx on alerts (kid_id, created_at desc);

-- Opt-in (kids.settings.location = true) location history.
create table if not exists locations (
  id bigint generated always as identity primary key,
  kid_id uuid not null references kids (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m real,
  recorded_at timestamptz not null default now()
);
create index if not exists locations_kid_recorded_idx on locations (kid_id, recorded_at desc);

-- JSON columns must hold the right shape. Catches a driver double-encoding JSON into a string.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kids_json_shapes') then
    alter table kids add constraint kids_json_shapes check (
      jsonb_typeof(installed_apps) = 'array'
      and jsonb_typeof(settings) = 'object'
      and jsonb_typeof(device_status) = 'object'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_detail_object') then
    alter table alerts add constraint alerts_detail_object check (jsonb_typeof(detail) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_questions_object') then
    alter table challenges add constraint challenges_questions_object check (jsonb_typeof(questions) = 'object');
  end if;
end $$;
