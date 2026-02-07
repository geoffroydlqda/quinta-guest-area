-- Add user_id column to room_setups table
ALTER TABLE public.room_setups 
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Remove the edit_token column as it's no longer needed
-- First, drop the unique index on edit_token if it exists
DROP INDEX IF EXISTS idx_room_setups_edit_token;

-- Make user_id NOT NULL for new records and add unique constraint
-- Note: we'll need to handle existing records, but for new user-based system this is correct
CREATE UNIQUE INDEX idx_room_setups_user_id ON public.room_setups(user_id);

-- Drop existing permissive RLS policies
DROP POLICY IF EXISTS "Anyone can create room setups" ON public.room_setups;
DROP POLICY IF EXISTS "Anyone can read room setups with edit token" ON public.room_setups;
DROP POLICY IF EXISTS "Anyone can update room setups with edit token" ON public.room_setups;

-- Create new user-based RLS policies
CREATE POLICY "Users can view their own room setups"
ON public.room_setups
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own room setups"
ON public.room_setups
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own room setups"
ON public.room_setups
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own room setups"
ON public.room_setups
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);