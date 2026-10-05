-- A job created from an approved quote that has no visit yet. In its own
-- migration: a new enum value cannot be used in the transaction that adds it.
alter type public.job_status add value if not exists 'pending_schedule' before 'scheduled';
