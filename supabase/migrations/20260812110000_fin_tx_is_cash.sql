-- Caisse espèces (12 août 2026) : is_cash marque les mouvements en espèces.
-- Solde caisse = échéances is_cash payées (entrées) + fin_transactions
-- is_cash (sorties/ajustements). Les ajustements caisse (dépôt banque…)
-- sont kind='internal' + is_cash : comptés dans la caisse uniquement,
-- jamais dans le cash flow bancaire ni le P&L.
alter table public.fin_transactions
  add column if not exists is_cash boolean not null default false;

-- Backfill : paiements staff catering en cash (créés par l'onglet Catering)
update public.fin_transactions set is_cash = true
where dedup_key like 'eventstaff|%';
