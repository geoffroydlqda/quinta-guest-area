ALTER TABLE public.food_plans
  ADD COLUMN IF NOT EXISTS meal_times jsonb NOT NULL
  DEFAULT '{"breakfast_time": null, "lunch_time": null, "dinner_time": null}'::jsonb;