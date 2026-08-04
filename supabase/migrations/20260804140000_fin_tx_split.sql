-- Ventilation d'une transaction sur plusieurs événements (4 août 2026).
-- Cas : une facture staff couvre 2-3 retraites. La transaction parent passe
-- en kind='split' (exclue du P&L ET de la trésorerie) ; ses enfants
-- (parent_id) portent chacun montant / catégorie / TVA / booking et somment
-- exactement au montant du parent — la trésorerie reste juste, le P&L est
-- ventilé par événement.
alter table public.fin_transactions
  add column if not exists parent_id uuid references public.fin_transactions(id) on delete cascade;
create index if not exists fin_tx_parent_idx on public.fin_transactions (parent_id);
