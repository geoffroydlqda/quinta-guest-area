-- Create guest_profiles table (1:1 with auth user)
CREATE TABLE public.guest_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  check_in_date DATE,
  check_out_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for guest_profiles
ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for guest_profiles
CREATE POLICY "Users can view their own profile" ON public.guest_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own profile" ON public.guest_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.guest_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add user_id unique constraint to room_setups if not exists and update schema
ALTER TABLE public.room_setups 
  ADD COLUMN IF NOT EXISTS status_roomsetup TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS remarks_roomsetup TEXT;

-- Create transportation_requests table
CREATE TABLE public.transportation_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status_transportation TEXT NOT NULL DEFAULT 'draft',
  notes_transportation TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for transportation_requests
ALTER TABLE public.transportation_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies for transportation_requests
CREATE POLICY "Users can view their own transportation" ON public.transportation_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transportation" ON public.transportation_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transportation" ON public.transportation_requests
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transportation" ON public.transportation_requests
  FOR DELETE USING (auth.uid() = user_id);

-- Create transportation_trips table
CREATE TABLE public.transportation_trips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_direction TEXT NOT NULL CHECK (trip_direction IN ('To Quinta', 'From Quinta')),
  pickup_location TEXT NOT NULL,
  dropoff_location TEXT NOT NULL,
  trip_date DATE NOT NULL,
  trip_time TIME NOT NULL,
  passengers_count INTEGER NOT NULL DEFAULT 1,
  taxi_size TEXT NOT NULL CHECK (taxi_size IN ('4 seats', '6 seats')),
  price_estimate TEXT NOT NULL DEFAULT 'Custom offer',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for transportation_trips
ALTER TABLE public.transportation_trips ENABLE ROW LEVEL SECURITY;

-- RLS policies for transportation_trips
CREATE POLICY "Users can view their own trips" ON public.transportation_trips
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own trips" ON public.transportation_trips
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own trips" ON public.transportation_trips
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own trips" ON public.transportation_trips
  FOR DELETE USING (auth.uid() = user_id);

-- Create transportation_passengers table
CREATE TABLE public.transportation_passengers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.transportation_trips(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  flight_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for transportation_passengers
ALTER TABLE public.transportation_passengers ENABLE ROW LEVEL SECURITY;

-- RLS policies for transportation_passengers
CREATE POLICY "Users can view their own passengers" ON public.transportation_passengers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own passengers" ON public.transportation_passengers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own passengers" ON public.transportation_passengers
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own passengers" ON public.transportation_passengers
  FOR DELETE USING (auth.uid() = user_id);

-- Create food_plans table
CREATE TABLE public.food_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status_food TEXT NOT NULL DEFAULT 'draft',
  notes_food TEXT,
  selections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for food_plans
ALTER TABLE public.food_plans ENABLE ROW LEVEL SECURITY;

-- RLS policies for food_plans
CREATE POLICY "Users can view their own food plan" ON public.food_plans
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own food plan" ON public.food_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own food plan" ON public.food_plans
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create docs_ack table
CREATE TABLE public.docs_ack (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for docs_ack
ALTER TABLE public.docs_ack ENABLE ROW LEVEL SECURITY;

-- RLS policies for docs_ack
CREATE POLICY "Users can view their own docs ack" ON public.docs_ack
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own docs ack" ON public.docs_ack
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own docs ack" ON public.docs_ack
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add unique constraint on room_setups.user_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'room_setups_user_id_key'
  ) THEN
    ALTER TABLE public.room_setups ADD CONSTRAINT room_setups_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Create triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_guest_profiles_updated_at
  BEFORE UPDATE ON public.guest_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transportation_requests_updated_at
  BEFORE UPDATE ON public.transportation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transportation_trips_updated_at
  BEFORE UPDATE ON public.transportation_trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_food_plans_updated_at
  BEFORE UPDATE ON public.food_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();