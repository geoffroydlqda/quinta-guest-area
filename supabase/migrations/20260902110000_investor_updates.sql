-- Investor update editable + statut reviewed (2 sept 2026) : le brouillon du
-- mois s'edite directement dans l'onglet et Geoffroy peut le marquer
-- "reviewed" pour signaler a l'admin que les chiffres sont valides avant
-- envoi aux investisseurs. Toute modification repasse le statut en draft.
create table if not exists public.investor_updates (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  content text not null,
  status text not null default 'draft' check (status in ('draft','reviewed')),
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.investor_updates enable row level security;
drop policy if exists "investor_updates admin" on public.investor_updates;
create policy "investor_updates admin" on public.investor_updates
  for all using (public.is_admin()) with check (public.is_admin());
comment on table public.investor_updates is 'Brouillons mensuels de l investor update : contenu edite dans l onglet + statut reviewed (valide par Geoffroy avant envoi aux investisseurs).';
