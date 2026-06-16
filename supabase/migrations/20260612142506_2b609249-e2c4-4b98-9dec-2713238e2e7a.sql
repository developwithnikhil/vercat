-- Upload: only into a folder named after your own user id
CREATE POLICY "users upload own chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Read: either you uploaded it, or there's a message referencing this object
-- where you are sender or recipient.
CREATE POLICY "participants read chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.attachment_url LIKE '%/' || name
        AND (m.sender_id = auth.uid() OR m.recipient_id = auth.uid())
    )
  )
);

CREATE POLICY "users delete own chat attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);