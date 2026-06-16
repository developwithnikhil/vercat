DROP POLICY IF EXISTS "participants read chat attachments" ON storage.objects;
CREATE POLICY "participants read chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.messages m
      WHERE (m.attachment_url = name OR m.attachment_url LIKE '%/' || name)
        AND (m.sender_id = auth.uid() OR m.recipient_id = auth.uid())
    )
  )
);