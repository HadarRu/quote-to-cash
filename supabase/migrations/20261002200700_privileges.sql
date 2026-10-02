-- Privilege hardening. Supabase grants ALL on public tables to anon and
-- authenticated by default. TRUNCATE bypasses RLS, and rows are only ever
-- soft-deleted, so neither role gets TRUNCATE or DELETE, now or on future tables.

revoke truncate, delete on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, delete on tables from anon, authenticated;
