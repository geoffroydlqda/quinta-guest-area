-- Alias de payers (18 nov 2026, demande Geoffroy) : la carte •5673 est celle
-- de Geoffroy, mais l'API Revolut ne renvoie que le numéro masqué pour elle
-- (revolut-sync retombe alors sur "Card •5673"). Plusieurs graphies de son nom
-- coexistaient aussi. app_settings.payer_aliases = { "<alias>": "<nom>" }
-- (comparaison insensible à la casse) ; un trigger normalise le payer à
-- l'insert et à chaque mise à jour du champ. Ajouter une carte = ajouter une
-- clé dans app_settings, sans redéployer revolut-sync.
insert into public.app_settings (key, value) values ('payer_aliases', jsonb_build_object(
  'Card •5673', 'Geoffroy de Lichtervelde',
  'Geoffroy Desire M De Lichtervelde', 'Geoffroy de Lichtervelde',
  'GEOFFROY DE LICHTERVELDE', 'Geoffroy de Lichtervelde',
  'Geoffroy de Lichtervelde + GEOFFROY DE LICHTERVELDE', 'Geoffroy de Lichtervelde'
)) on conflict (key) do update set value = excluded.value;

create or replace function public.fin_tx_payer_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapped text;
begin
  if new.payer is null then return new; end if;
  select e.value into mapped
  from public.app_settings s, jsonb_each_text(s.value) e
  where s.key = 'payer_aliases' and lower(e.key) = lower(trim(new.payer))
  limit 1;
  if mapped is not null then new.payer := mapped; end if;
  return new;
end;
$$;
revoke all on function public.fin_tx_payer_alias() from public, anon, authenticated;

create trigger fin_tx_payer_alias
  before insert or update of payer on public.fin_transactions
  for each row execute function public.fin_tx_payer_alias();

-- Lignes existantes
update public.fin_transactions set payer = payer
where lower(payer) in (select lower(e.key) from public.app_settings s, jsonb_each_text(s.value) e where s.key = 'payer_aliases');
