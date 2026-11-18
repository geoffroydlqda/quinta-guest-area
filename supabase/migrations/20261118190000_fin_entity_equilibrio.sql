-- Equilibrio = projet à part (décision Geoffroy, 18 nov 2026) : le festival
-- n'est plus fondu dans Terra da Paz. Troisième valeur d'entité ; les vues
-- QDA/TDP n'affichent que leur entité, Equilibrio n'apparaît que dans All
-- (consolidé Grupo OHM) en attendant son intégration comme projet propre.
alter table public.fin_transactions drop constraint if exists fin_transactions_entity_check;
alter table public.fin_transactions add constraint fin_transactions_entity_check check (entity in ('quinta','terra','equilibrio'));
