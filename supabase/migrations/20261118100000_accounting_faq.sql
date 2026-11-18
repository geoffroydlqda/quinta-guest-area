-- FAQ comptable (18 nov 2026, demande Geoffroy) : onglet Accounting > FAQ.
-- Chaque question posée au bureau comptable (Joongle, BDO...) et sa réponse,
-- pour que l'info ne se perde pas dans les emails.
create table if not exists public.accounting_faq (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text,
  topic text,                 -- VAT, IRS / retention, Invoicing, Expenses, Assets, Intercompany, Payroll, Other
  status text not null default 'to_ask' check (status in ('to_ask', 'asked', 'answered')),
  asked_to text,              -- Joongle, BDO...
  asked_on date,
  answered_on date,
  source text,                -- lien vers l'email / le doc
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.accounting_faq enable row level security;
revoke all on public.accounting_faq from anon;
create policy "accounting_faq admin all" on public.accounting_faq
  for all using (is_admin()) with check (is_admin());
create index if not exists accounting_faq_status_idx on public.accounting_faq (status);

-- Questions comptables déjà ouvertes (relevées dans CLAUDE.md et le suivi Finance)
insert into public.accounting_faq (question, topic, status) values
 ('Fatura-recibo mensuelle du honesty bar au client « Consumidor Final » (NIF 999999990) : est-ce le bon mode de facturation ?', 'Invoicing', 'to_ask'),
 ('Lignes isentas (indemnités type « Broken items ») : le code d''exonération M19 est-il correct, ou faut-il M99 ?', 'VAT', 'to_ask'),
 ('4 faturas bar du 1er sept 2026 émises avec la taxe Moloni 1923 à 1 % au lieu de 23 % (~157 € de TVA sous-déclarée) : comment régulariser ?', 'VAT', 'to_ask'),
 ('Frais retenus sur une annulation (ex. 500 € à 23 %, NC2026/4) : une indemnité de résiliation est-elle hors champ TVA ?', 'VAT', 'to_ask'),
 ('Factures EDP au nom de Thomas Querton (NIF 307749584) et non de Grupo OHM : la TVA est-elle récupérable ? Faut-il changer le titulaire du contrat ?', 'VAT', 'to_ask'),
 ('Retenção na fonte IRS sur les recibos verdes (Loïs, Luis) : est-elle bien reversée à l''AT par Grupo OHM, et comment la déclarer ?', 'IRS / retention', 'to_ask'),
 ('Immobilisations (Siali, Music Store, Youbuy, Hipermercado ; 7 609,65 € HT) : quelle durée d''amortissement fiscale retenir (5 ans dans l''admin, mobilier souvent 8 ans) ?', 'Assets', 'to_ask'),
 ('Dépenses payées par Grupo OHM pour le compte de Surreal Estate (assurances, travaux) : refacturation ou conta corrente en fin d''année ?', 'Intercompany', 'to_ask'),
 ('Petits travaux d''amélioration du bâti (benfeitorias) : traitement comptable et clause d''indemnisation en fin de bail ?', 'Assets', 'to_ask');
