-- Accès admin pour Thomas Querton (demande Geoffroy, 27 juillet 2026).
-- lois@quintamor.com est déjà présent depuis la migration initiale.
insert into public.admin_users (email)
values ('thomasquerton@gmail.com')
on conflict (email) do nothing;
