-- Le tri strict des PJ Gmail écrivait status='discarded' mais la contrainte
-- ne le permettait pas (échec silencieux — la fonction ne vérifie pas
-- l'erreur d'update) : les docs restaient bloqués en 'extracting'.
alter table public.purchase_docs drop constraint if exists purchase_docs_status_check;
alter table public.purchase_docs add constraint purchase_docs_status_check
  check (status = any (array['inbox','extracting','review','matched','no_match','error','discarded']));
