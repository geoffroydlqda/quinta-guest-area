-- ---------------------------------------------------------------------------
-- Housekeeping — suivi incidents / dégâts (1 août 2026).
-- Par booking : description + photos (bucket privé "incidents", admin only).
-- Utile face au deposit de €1000 — signalé après le ménage.
-- ---------------------------------------------------------------------------
create table if not exists public.hk_incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  description text,
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists hk_incidents_booking_idx on public.hk_incidents (booking_id);

alter table public.hk_incidents enable row level security;

drop policy if exists "hk_incidents admin all" on public.hk_incidents;
create policy "hk_incidents admin all" on public.hk_incidents
  for all using (public.is_admin()) with check (public.is_admin());

-- Bucket photos (privé, images uniquement, 20 Mo max)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incidents', 'incidents', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins read incident photos" on storage.objects;
create policy "Admins read incident photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'incidents' and public.is_admin_email());

drop policy if exists "Admins write incident photos" on storage.objects;
create policy "Admins write incident photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'incidents' and public.is_admin_email());

drop policy if exists "Admins delete incident photos" on storage.objects;
create policy "Admins delete incident photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'incidents' and public.is_admin_email());
