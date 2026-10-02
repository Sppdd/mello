-- Supabase-only hardening for the Mello schema.
-- The Mello API is the only way in: it connects with the database role and enforces family scoping
-- itself. The public Data API (anon/authenticated) gets no access to any table, and RLS is on
-- everywhere as a second lock, with no policies, so even an accidental grant exposes nothing.

alter table public.family_members
  add constraint family_members_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

do $$
declare t text;
begin
  foreach t in array array[
    'families', 'family_members', 'books', 'kids', 'tasks', 'task_progress', 'rules', 'app_limits',
    'quiet_hours', 'challenges', 'sessions', 'messages', 'unpair_requests', 'alerts', 'locations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke usage, select on sequence public.locations_id_seq from anon, authenticated;
