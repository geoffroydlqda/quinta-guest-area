-- Amortissements dans le P&L (1er sept 2026) : une depense immobilisee
-- (bouton "Amort." sur la ligne) sort de l'EBITDA et s'etale en lineaire
-- HT/mois sur amortize_months a partir du mois d'achat (ligne D&A -> EBIT).
-- Le cash flow reste inchange (sortie TTC a la date de paiement).
alter table public.fin_transactions add column if not exists amortize_months integer;
comment on column public.fin_transactions.amortize_months is 'Immobilisation : duree d amortissement en mois (60 = 5 ans). La depense sort de l EBITDA du P&L et s etale en ligne Amortissements (EBIT). Null = charge normale.';
