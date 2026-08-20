-- Tarifs catering millesime 2027 (20 aout 2026) : les sejours dont le check-in
-- est en 2027+ utilisent la cle 'food_2027' ; les sejours 2026 gardent 'food'.
-- Front : src/lib/pricing.ts (getDietPricing(stayYear)).
insert into public.pricing_settings (key, value)
values ('food_2027', '{
  "vegetarian":        {"fullBoard": 77, "breakfast": 22, "lunch": 27, "dinner": 34},
  "meat_dinner":       {"fullBoard": 82, "breakfast": 22, "lunch": 27, "dinner": 39},
  "meat_lunch_dinner": {"fullBoard": 87, "breakfast": 22, "lunch": 32, "dinner": 39}
}'::jsonb)
on conflict (key) do update set value = excluded.value;
