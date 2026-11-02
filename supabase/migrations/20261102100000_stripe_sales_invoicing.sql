-- Ventes Stripe hors bookings (tickets festival, events, add-ons) -> faturas-recibo Moloni serie TERRA.
-- Une ligne par charge Stripe reussie non liee a une echeance de booking.
create table public.stripe_sales (
  id uuid primary key default gen_random_uuid(),
  account text not null default 'quinta' check (account in ('quinta','terra')),
  charge_id text not null unique,
  payment_intent text,
  session_id text,
  paid_at timestamptz not null,
  amount numeric not null,
  currency text not null default 'eur',
  email text,
  customer_name text,
  nif text,
  country text,
  line_items jsonb,           -- [{name, qty, unit_ttc, kind: 'ticket'|'standard'}]
  status text not null default 'pending_review' check (status in ('pending_review','invoiced','skipped','error')),
  skip_reason text,
  moloni_document_id bigint,
  invoice_number text,
  invoice_pdf_path text,
  error text,
  livemode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stripe_sales_status_idx on public.stripe_sales (status);
create index stripe_sales_paid_at_idx on public.stripe_sales (paid_at);
alter table public.stripe_sales enable row level security;
create policy "stripe_sales admin all" on public.stripe_sales for all using (is_admin());

-- Config facturation ventes Stripe (serie TERRA 6083 + produits ticket 6% / standard 23%)
insert into public.app_settings (key, value)
values ('stripe_sales', jsonb_build_object(
  'document_set_id', 6083,
  'payment_method_id', 1530,
  'products', jsonb_build_object('ticket', 403148, 'standard', 403149),
  'ticket_patterns', jsonb_build_array('ticket', 'bilhete', 'festival', 'pass', 'entrada')
))
on conflict (key) do update set value = excluded.value;
