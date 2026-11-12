-- Anti-doublons des justificatifs d'achat (12 nov 2026, demande Geoffroy).
-- Cause : un meme fichier importe deux fois (double execution de l'import des
-- bills Revolut le 11 nov, PJ Amazon recue par email ET par Revolut, photos
-- renvoyees deux fois) creait deux purchase_docs lies a la meme transaction,
-- donc deux fichiers dans Purchase invoices et dans le zip envoye au comptable.
--
-- Regle (trigger, couvre TOUS les canaux d'entree : Gmail, Revolut, bills,
-- trombone, onglet Receipts) : on compare l'empreinte du fichier (eTag MD5 du
-- bucket purchase-docs). Si un autre justificatif non ecarte a le meme contenu
--   - et est lie a la MEME transaction, ou
--   - le nouveau n'est lie a aucune transaction (import auto),
-- alors le nouveau passe en status 'discarded', tx_id null,
-- error = 'duplicate of <id>'. Rien n'est supprime.
-- Cas legitime d'un meme PDF pour deux paiements (facture reglee en deux fois) :
-- l'attacher a la 2e transaction via le trombone (tx_id renseigne a l'insert,
-- transaction differente => accepte).

alter table public.purchase_docs add column if not exists content_etag text;

create or replace function public.purchase_docs_dedupe()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  dup uuid;
begin
  select o.metadata->>'eTag' into new.content_etag
  from storage.objects o
  where o.bucket_id = 'purchase-docs' and o.name = new.storage_path;

  if new.content_etag is null or new.status = 'discarded' then
    return new;
  end if;

  select p.id into dup
  from public.purchase_docs p
  where p.content_etag = new.content_etag
    and p.id <> new.id
    and p.status <> 'discarded'
    and (new.tx_id is null or p.tx_id = new.tx_id)
  order by p.created_at
  limit 1;

  if dup is not null then
    new.error := 'duplicate of ' || dup || coalesce(' (tx ' || new.tx_id || ')', '');
    new.status := 'discarded';
    new.tx_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_docs_dedupe() from public, anon, authenticated;

-- (pas de "drop trigger if exists" : via MCP il declenche une confirmation destructive qui pend)
create trigger purchase_docs_dedupe
  before insert or update of storage_path, tx_id, status on public.purchase_docs
  for each row execute function public.purchase_docs_dedupe();

-- Backfill de l'empreinte (sans declencher la regle sur l'existant).
update public.purchase_docs p
set content_etag = o.metadata->>'eTag'
from storage.objects o
where o.bucket_id = 'purchase-docs' and o.name = p.storage_path and p.content_etag is null;

create index if not exists purchase_docs_content_etag_idx on public.purchase_docs (content_etag);
