-- Groupage de paiements (31 juil. 2026) : des échéances regroupées dans
-- l'admin partagent un group_id. Le groupe est purement organisationnel :
-- l'email de demande envoie un lien Stripe couvrant les membres non payés,
-- et la fatura-recibo multi-lignes se fait déjà via stripe_session_id.
alter table public.payment_installments
  add column if not exists group_id uuid;
