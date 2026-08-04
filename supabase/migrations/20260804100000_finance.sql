-- ---------------------------------------------------------------------------
-- Finance (4 août 2026) — socle Expenses / P&L / Cash flow.
-- fin_transactions : UNE ligne = UN mouvement bancaire (Revolut) ou une
-- dépense manuelle (cash). La classification "kind" est le garde-fou
-- anti-double comptage :
--   expense        -> P&L (HT via vat_rate) + trésorerie
--   guest_payment  -> trésorerie seulement (le revenu vit dans les échéances)
--   bar_payout     -> trésorerie seulement (les ventes bar vivent dans bar_sales)
--   internal       -> exclu des deux (transferts entre comptes propres)
--   vat_payment    -> trésorerie seulement (la TVA n'est pas une charge)
--   other_income   -> trésorerie + P&L autres revenus (rare, ex. remboursement)
--   review         -> pas encore classé
-- Reconnaissance P&L : dépense liée à un booking -> mois du check-in (matching
-- avec les revenus de l'événement) ; sinon date de la transaction.
-- ---------------------------------------------------------------------------
create table if not exists public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'revolut',        -- 'revolut' | 'manual'
  dedup_key text unique,                          -- id transaction API ou hash CSV
  date date not null,
  description text,
  amount numeric not null,                        -- signé, TTC (négatif = sortie)
  currency text not null default 'EUR',
  kind text not null default 'review',
  category text,                                  -- nomenclature Financial Model
  vat_rate numeric,                               -- 23 / 13 / 6 / 0
  amount_net numeric,                             -- HT (P&L)
  booking_id uuid references public.bookings(id) on delete set null,
  notes text,
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists fin_tx_date_idx on public.fin_transactions (date desc);
create index if not exists fin_tx_booking_idx on public.fin_transactions (booking_id);
create index if not exists fin_tx_kind_idx on public.fin_transactions (kind);

alter table public.fin_transactions enable row level security;
drop policy if exists "fin_transactions admin all" on public.fin_transactions;
create policy "fin_transactions admin all" on public.fin_transactions
  for all using (public.is_admin()) with check (public.is_admin());

-- Règles apprenantes : "CONTINENTE" -> Retreat — catering / food, TVA 6…
create table if not exists public.fin_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,                          -- substring insensible à la casse
  kind text not null default 'expense',
  category text,
  vat_rate numeric,
  created_at timestamptz not null default now()
);

alter table public.fin_rules enable row level security;
drop policy if exists "fin_rules admin all" on public.fin_rules;
create policy "fin_rules admin all" on public.fin_rules
  for all using (public.is_admin()) with check (public.is_admin());
