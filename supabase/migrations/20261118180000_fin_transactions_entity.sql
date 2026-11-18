-- Multi-lieux P1 Finance (18 nov 2026) : chaque transaction bancaire porte son
-- entité (quinta = poches QUINTA DO AMOR ; terra = poches TERRA DA PAZ +
-- EQUILIBRIO — Equilibrio est le festival organisé à Terra). Les purchase_docs
-- héritent de l'entité via leur transaction liée (tx_id), pas de colonne à eux.
-- account_id = sous-compte Revolut du leg retenu (traçabilité, volet 1 oct).
alter table public.fin_transactions add column if not exists entity text not null default 'quinta';
alter table public.fin_transactions drop constraint if exists fin_transactions_entity_check;
alter table public.fin_transactions add constraint fin_transactions_entity_check check (entity in ('quinta','terra'));
create index if not exists fin_transactions_entity_idx on public.fin_transactions (entity);
alter table public.fin_transactions add column if not exists account_id text;
