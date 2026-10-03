-- A sent quote that was replaced by a newer revision. In its own migration:
-- a new enum value cannot be used in the transaction that adds it.
alter type public.quote_status add value if not exists 'superseded';
