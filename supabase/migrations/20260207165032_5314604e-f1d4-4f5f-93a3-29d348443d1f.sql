-- Add new fields to guest_profiles
ALTER TABLE public.guest_profiles 
ADD COLUMN IF NOT EXISTS guests_count integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS status_overall text NOT NULL DEFAULT 'draft';

-- Add constraint for guests_count
ALTER TABLE public.guest_profiles
ADD CONSTRAINT guests_count_range CHECK (guests_count >= 1 AND guests_count <= 21);

-- Add diet_preference to food_plans
ALTER TABLE public.food_plans
ADD COLUMN IF NOT EXISTS diet_preference text;

-- Remove tool-specific status columns that are no longer needed (we use global status)
-- But keep them for now as they may still be useful for tracking

-- Update transportation pricing: add check for 6-seat pricing
-- The pricing logic is handled in code, but let's ensure the price_estimate can store the new 80€ value