-- Option "cash" par échéance : payé en liquide, pas de TVA (TVAC = HT),
-- pas de facture. Demande produit juillet 2026.
alter table public.payment_installments
  add column if not exists is_cash boolean not null default false;
