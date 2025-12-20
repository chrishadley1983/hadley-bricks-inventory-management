-- Fix profiles table RLS for trigger-based inserts
-- Migration: 20241219000003_fix_profiles_insert

-- The handle_new_user trigger runs as SECURITY DEFINER, but to be safe
-- and ensure profile creation works, we add an explicit policy that allows
-- the auth system to insert profiles

-- Allow the service role and triggers to insert profiles
-- This policy allows a user to have their own profile inserted
CREATE POLICY "Allow profile creation during signup"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Also ensure the trigger function has proper search_path set for security
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
