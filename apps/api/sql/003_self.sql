-- Self mode: someone coaching their own phone. The phone is a "subject" row in kids with kind = 'self',
-- inside a family the user owns, so rules, limits, tasks and the gate work exactly as for a kid.

alter table kids add column if not exists kind text not null default 'kid';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kids_kind_check') then
    alter table kids add constraint kids_kind_check check (kind in ('kid', 'self'));
  end if;
end $$;

-- 'app' tasks: spend N minutes inside another app (ReadEra, Audible, …).
alter table tasks add column if not exists app_package text;
alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks add constraint tasks_kind_check check (kind in ('audio', 'video', 'article', 'reading', 'app'));

create table if not exists self_profiles (
  user_id uuid primary key,
  subject_id uuid not null unique references kids (id) on delete cascade,
  interests text[] not null default '{}',
  always_suggest boolean not null default true,
  created_at timestamptz not null default now()
);

-- Daily aggregates the phone uploads (top apps, category minutes, unlocks, guard-on share). Kept 30 days.
create table if not exists usage_days (
  subject_id uuid not null references kids (id) on delete cascade,
  day date not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (subject_id, day)
);

-- Answers to the reflection questions after a focus session.
create table if not exists reflections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references kids (id) on delete cascade,
  title text,
  questions jsonb not null default '[]',
  answers jsonb not null default '[]',
  reply text,
  created_at timestamptz not null default now()
);
create index if not exists reflections_subject_created_idx on reflections (subject_id, created_at desc);
