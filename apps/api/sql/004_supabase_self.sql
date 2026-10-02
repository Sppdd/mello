-- Supabase-only: the same lock-down as 002_supabase.sql for the self-mode tables in 003_self.sql.
do $$
declare t text;
begin
  foreach t in array array['self_profiles', 'usage_days', 'reflections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
