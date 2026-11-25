-- Toolbox (25 nov 2026, demande Geoffroy) : annuaire des fournisseurs /
-- prestataires + coffre à documents importants (assurances, contrats…).
create table if not exists public.toolbox_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  category text, -- Plumber, Electrician, Pool, Catering supplier… (datalist)
  phone text,
  email text,
  notes text,
  preferred boolean not null default false, -- ⭐ fournisseur de référence
  property text not null default 'shared' check (property in ('quinta','terra','shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.toolbox_contacts enable row level security;
drop policy if exists "toolbox_contacts admin all" on public.toolbox_contacts;
create policy "toolbox_contacts admin all" on public.toolbox_contacts
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.toolbox_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text, -- Insurance, Contract, License, Certificate, Manual, Legal…
  property text not null default 'shared' check (property in ('quinta','terra','shared')),
  storage_path text not null,
  file_name text,
  mime_type text,
  valid_until date, -- échéance (assurance, licence…) → alerte d'expiration UI
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.toolbox_documents enable row level security;
drop policy if exists "toolbox_documents admin all" on public.toolbox_documents;
create policy "toolbox_documents admin all" on public.toolbox_documents
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists toolbox_documents_valid_idx on public.toolbox_documents (valid_until);

-- Bucket privé (PDF, images, docs bureautique — 25 Mo max)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('toolbox', 'toolbox', false, 26214400, array[
  'application/pdf','image/jpeg','image/png','image/webp',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins read toolbox docs" on storage.objects;
create policy "Admins read toolbox docs"
  on storage.objects for select to authenticated
  using (bucket_id = 'toolbox' and public.is_admin_email());

drop policy if exists "Admins write toolbox docs" on storage.objects;
create policy "Admins write toolbox docs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'toolbox' and public.is_admin_email());

drop policy if exists "Admins delete toolbox docs" on storage.objects;
create policy "Admins delete toolbox docs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'toolbox' and public.is_admin_email());
