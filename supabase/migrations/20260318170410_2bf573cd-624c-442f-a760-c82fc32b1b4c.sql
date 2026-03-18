
-- Delete orphan room_setup rows with no owner, then enforce NOT NULL
DELETE FROM public.room_setups WHERE user_id IS NULL;
ALTER TABLE public.room_setups ALTER COLUMN user_id SET NOT NULL;
