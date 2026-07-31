-- ---------------------------------------------------------------------------
-- Honesty bar (31 juil. 2026) — ventes Revolut Merchant (QR à montant libre).
-- Chaque paiement Revolut est enregistré ici, classé par décomposition du
-- montant (vin 22 € / coconut water 4 € / bière & why not 3 €), rattaché au
-- booking dont le séjour couvre la date, puis agrégé en 2 échéances "bar"
-- déjà payées (TVA 23 % : vin+bières+sodas — prudence AT ; TVA 6 % : coconut).
-- ---------------------------------------------------------------------------
create table if not exists public.bar_sales (
  id uuid primary key default gen_random_uuid(),
  revolut_order_id text not null unique,
  paid_at timestamptz not null,
  amount numeric not null,
  currency text not null default 'EUR',
  -- Classement (null tant que non classé) : quantités par produit
  qty_wine integer,
  qty_coconut integer,
  qty_soft integer,
  state text not null default 'ambiguous', -- 'classified' | 'ambiguous'
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bar_sales_booking_idx on public.bar_sales (booking_id);
create index if not exists bar_sales_paid_idx on public.bar_sales (paid_at desc);

alter table public.bar_sales enable row level security;

drop policy if exists "bar_sales admin all" on public.bar_sales;
create policy "bar_sales admin all" on public.bar_sales
  for all using (public.is_admin()) with check (public.is_admin());

-- Cron quotidien (04:40 UTC) -> Edge Function revolut-bar-sync
do $$
begin
  perform cron.unschedule('revolut-bar-sync-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'revolut-bar-sync-daily',
  '40 4 * * *',
  $CRON$
  select net.http_post(
    url := 'https://fnlgeeuohvethmfpsxpf.supabase.co/functions/v1/revolut-bar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select value->>'cron_key' from public.app_settings where key = 'internal'), '')
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $CRON$
);
