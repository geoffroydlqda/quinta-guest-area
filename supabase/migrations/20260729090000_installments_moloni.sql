-- Facturation Moloni ON (step 1, juillet 2026) : chaque échéance peut porter
-- le document Moloni généré (fatura-recibo FR2026) et son numéro officiel.
alter table public.payment_installments
  add column if not exists moloni_document_id bigint,
  add column if not exists invoice_number text;
