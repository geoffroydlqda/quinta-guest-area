-- 1er sept. 2026 — la contrainte category n'autorisait pas 'bar' : le rollup
-- du honesty bar (revolut-bar-sync) echouait en silence depuis juillet.
alter table public.payment_installments drop constraint payment_installments_category_check;
alter table public.payment_installments add constraint payment_installments_category_check
  check (category = any (array['rental'::text, 'catering'::text, 'extra'::text, 'discount'::text, 'bar'::text]));
