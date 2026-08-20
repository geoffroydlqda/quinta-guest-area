-- Preuve d'acceptation des CGV au moment du paiement (clickwrap Stripe, 20 aout 2026).
-- stripe-checkout demande consent_collection[terms_of_service]=required (case a
-- cocher obligatoire sur la page Stripe, lien vers les CGV configurees dans le
-- dashboard Stripe) ; stripe-webhook enregistre ici session.consent comme preuve
-- horodatee (session id, email, montant, livemode).
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  installment_ids text,
  stripe_session_id text not null unique,
  email text,
  consent jsonb,
  amount_total numeric,
  currency text,
  livemode boolean,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;
revoke all on public.terms_acceptances from anon, authenticated;
create policy "admin read terms_acceptances" on public.terms_acceptances
  for select to authenticated using (public.is_admin());
grant select on public.terms_acceptances to authenticated;
