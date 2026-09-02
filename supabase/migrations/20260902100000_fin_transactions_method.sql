-- Bills vs expenses (2 sept 2026) : type Revolut brut stocke par la synchro
-- (card_payment -> card, transfer -> transfer dont Bill Pay, topup, ...).
-- Backfill heuristique : carte = payer non nul (nom du porteur).
alter table public.fin_transactions add column if not exists method text;
comment on column public.fin_transactions.method is 'Type Revolut brut : card (card_payment) / transfer (virement, dont Bill Pay) / topup / direct_debit / fee / exchange... Sert a distinguer les bills (virements) des expenses (carte).';
update public.fin_transactions set method = case when payer is not null then 'card' else 'transfer' end
where source = 'revolut' and method is null;
