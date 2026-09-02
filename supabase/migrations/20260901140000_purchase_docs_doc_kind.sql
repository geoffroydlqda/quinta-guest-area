-- Tri strict des PJ Gmail (1er sept 2026) : l'extraction classe chaque
-- document (invoice / outgoing_invoice / payment_proof / other). Les PJ
-- venant de Gmail (storage_path email/...) qui ne sont pas de vraies
-- factures fournisseurs passent en status 'discarded' (invisibles dans
-- Receipts). Les uploads manuels restent permissifs.
alter table public.purchase_docs add column if not exists doc_kind text;
comment on column public.purchase_docs.doc_kind is 'Classification par l extraction : invoice / outgoing_invoice / payment_proof / other. Les PJ Gmail non-invoice passent en status discarded.';
