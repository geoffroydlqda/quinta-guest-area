-- Add first_name and last_name fields to guest_profiles
ALTER TABLE public.guest_profiles 
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text;

-- Update full_name to be computed from first_name + last_name if they exist
-- (We'll handle this in app logic)