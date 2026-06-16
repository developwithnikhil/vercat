
CREATE OR REPLACE FUNCTION public.guard_messages_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.attachment_url IS DISTINCT FROM OLD.attachment_url
     OR NEW.attachment_type IS DISTINCT FROM OLD.attachment_type
     OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name
     OR NEW.attachment_size IS DISTINCT FROM OLD.attachment_size
  THEN
    RAISE EXCEPTION 'Only message content or read receipt can be updated';
  END IF;

  IF auth.uid() = OLD.sender_id THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
      RAISE EXCEPTION 'Senders cannot change read receipts';
    END IF;
  ELSIF auth.uid() = OLD.recipient_id THEN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      RAISE EXCEPTION 'Recipients cannot edit message content';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_messages_update_trg ON public.messages;
CREATE TRIGGER guard_messages_update_trg
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.guard_messages_update();
