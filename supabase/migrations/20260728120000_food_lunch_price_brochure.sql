-- Aligne le prix du lunch sur la brochure 2026 (23 € -> 25 € pour Vegetarian
-- et Meat/fish for dinner ; Meat lunch+dinner reste à 30 €).
update public.pricing_settings
set value = jsonb_set(
  jsonb_set(value, '{vegetarian,lunch}', '25'),
  '{meat_dinner,lunch}', '25'
), updated_at = now()
where key = 'food';
