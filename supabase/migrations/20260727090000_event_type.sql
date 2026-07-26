-- Type d'événement par booking (demande produit) : retreat / wedding / other /
-- day_retreat. Sert au dashboard (catering attendu = uniquement les retreats
-- à venir) et au reporting par segment (P&L : Location Retraites vs Mariages).
alter table public.bookings
  add column if not exists event_type text not null default 'retreat'
  check (event_type in ('retreat', 'wedding', 'other', 'day_retreat'));

-- Backfill (liste fournie par Geoffroy, juillet 2026)
update public.bookings set event_type = 'wedding' where id::text like any (array[
  'e1335d0c%',  -- Michael Burge & Grace Bourne
  'd6f5da6a%',  -- Nick & Amy Charlier
  'a9a0d9f4%',  -- Luis son wedding
  '9b17f9c8%',  -- Mark & Philine
  'b72d6d6f%',  -- Edgar & Helena
  '34e714d3%'   -- Hanne Claes & Max Staples
]);

update public.bookings set event_type = 'other' where id::text like any (array[
  '52ca0714%',  -- Tommy & friends
  'dc6682de%',  -- Tommys week
  '3cd34bd0%',  -- Tommy Roch
  '57075164%',  -- Loïs & family
  'a8bb1f82%'   -- Oli, Stefie & friends
]);

update public.bookings set event_type = 'day_retreat'
where id::text like 'a0cdd458%'  -- Dia do amor
   or email = 'internal+marie-keutler@quintamor.com';
