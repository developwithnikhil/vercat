ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size integer,
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_has_body CHECK (
    (content IS NOT NULL AND length(content) > 0) OR attachment_url IS NOT NULL
  );