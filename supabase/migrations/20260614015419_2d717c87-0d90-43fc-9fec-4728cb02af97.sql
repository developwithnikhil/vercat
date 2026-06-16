-- Username availability check callable by anon (for pre-signup validation)
CREATE OR REPLACE FUNCTION public.username_available(_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = lower(_username));
$$;

GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

-- Stop silently appending suffix — raise so the client sees "username already exists"
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uname TEXT;
BEGIN
  uname := lower(COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8)));

  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = uname) THEN
    RAISE EXCEPTION 'username_taken' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    uname,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', uname)
  );
  RETURN NEW;
END;
$$;