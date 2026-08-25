-- Contenu des emails envoyes (25 aout 2026) : on stocke le HTML de chaque
-- email dans le journal pour pouvoir l'ouvrir depuis le feed de la fiche
-- booking (les emails anterieurs n'ont pas de contenu stocke).

alter table public.reminder_log add column if not exists body_html text;
alter table public.email_rule_log add column if not exists body_html text;
