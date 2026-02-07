-- Create room_setups table for storing room configuration submissions
CREATE TABLE public.room_setups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  edit_token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  remarks TEXT,
  queen_shared_qty INTEGER NOT NULL DEFAULT 0,
  twins_shared_qty INTEGER NOT NULL DEFAULT 0,
  queen_ensuite_qty INTEGER NOT NULL DEFAULT 0,
  twins_ensuite_qty INTEGER NOT NULL DEFAULT 0,
  room_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.room_setups ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone can insert new records (no auth required)
CREATE POLICY "Anyone can create room setups"
ON public.room_setups
FOR INSERT
WITH CHECK (true);

-- RLS Policy: Anyone can read records if they have the edit_token
CREATE POLICY "Anyone can read room setups with edit token"
ON public.room_setups
FOR SELECT
USING (true);

-- RLS Policy: Anyone can update records if they have the edit_token
CREATE POLICY "Anyone can update room setups with edit token"
ON public.room_setups
FOR UPDATE
USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_room_setups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_room_setups_updated_at
BEFORE UPDATE ON public.room_setups
FOR EACH ROW
EXECUTE FUNCTION public.update_room_setups_updated_at();

-- Create index on edit_token for faster lookups
CREATE INDEX idx_room_setups_edit_token ON public.room_setups(edit_token);