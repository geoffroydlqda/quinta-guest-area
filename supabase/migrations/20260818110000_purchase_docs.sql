-- Justificatifs d'achat (18 aout 2026) : photos/PDF de factures fournisseurs,
-- lies aux fin_transactions. Extraction (fournisseur, date, TTC, TVA, NIF)
-- par l'Edge Function receipt-extract, matching auto sur les depenses.
create table public.purchase_docs (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  file_name text,
  mime_type text,
  status text not null default 'inbox'
    check (status in ('inbox','extracting','review','matched','no_match','error')),
  tx_id uuid references public.fin_transactions(id) on delete set null,
  vendor text,
  doc_date date,
  total_ttc numeric,
  nif text,
  vat_breakdown jsonb,
  currency text default 'EUR',
  candidates jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchase_docs enable row level security;
create policy "Admins manage purchase docs" on public.purchase_docs
  for all to authenticated
  using (public.is_admin_email()) with check (public.is_admin_email());
revoke all on public.purchase_docs from anon;
create index purchase_docs_tx_idx on public.purchase_docs (tx_id);
create index purchase_docs_status_idx on public.purchase_docs (status);

-- Bucket prive pour les fichiers
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-docs', 'purchase-docs', false, 20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins read purchase docs files" on storage.objects for select to authenticated
  using (bucket_id = 'purchase-docs' and public.is_admin_email());
create policy "Admins write purchase docs files" on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-docs' and public.is_admin_email());
create policy "Admins update purchase docs files" on storage.objects for update to authenticated
  using (bucket_id = 'purchase-docs' and public.is_admin_email())
  with check (bucket_id = 'purchase-docs' and public.is_admin_email());
create policy "Admins delete purchase docs files" on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-docs' and public.is_admin_email());
