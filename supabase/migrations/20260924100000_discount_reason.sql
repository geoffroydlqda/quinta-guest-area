-- Raison des remises (24 sept 2026, demande Geoffroy) : chaque échéance de
-- catégorie 'discount' peut porter une raison (negotiation / internal / other)
-- — la note libre associée vit dans la colonne notes existante. Sert à
-- ventiler le manque à gagner (prix brochure vs prix vendu) dans le P&L.
alter table public.payment_installments
  add column if not exists discount_reason text
  check (discount_reason is null or discount_reason in ('negotiation','internal','other'));
