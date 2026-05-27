
-- 1. Add new columns to payment_installments
ALTER TABLE public.payment_installments
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS invoice_file_url text,
  ADD COLUMN IF NOT EXISTS invoice_file_name text;

-- Category check constraint
ALTER TABLE public.payment_installments
  DROP CONSTRAINT IF EXISTS payment_installments_category_check;
ALTER TABLE public.payment_installments
  ADD CONSTRAINT payment_installments_category_check
  CHECK (category IN ('rental', 'extra'));

-- 2. Normalize status values before tightening constraint
UPDATE public.payment_installments SET status = 'pending' WHERE status IN ('overdue', 'partial');

-- Drop old status check, replace with stricter one
ALTER TABLE public.payment_installments
  DROP CONSTRAINT IF EXISTS payment_installments_status_check;
ALTER TABLE public.payment_installments
  ADD CONSTRAINT payment_installments_status_check
  CHECK (status IN ('pending', 'paid'));

-- Drop unused columns
ALTER TABLE public.payment_installments
  DROP COLUMN IF EXISTS amount_paid,
  DROP COLUMN IF EXISTS paid_at;

-- 3. Drop invoices table
DROP TABLE IF EXISTS public.invoices CASCADE;

-- 5. Storage RLS for invoices bucket (private)
UPDATE storage.buckets SET public = false WHERE id = 'invoices';

-- Drop any prior policies on storage.objects for invoices bucket (idempotent recreate)
DROP POLICY IF EXISTS "Invoices: owners read" ON storage.objects;
DROP POLICY IF EXISTS "Invoices: service role all" ON storage.objects;
DROP POLICY IF EXISTS "Invoices: admins all" ON storage.objects;

-- Owner read: first path segment = booking_id owned by auth.uid()
CREATE POLICY "Invoices: owners read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoices'
  AND (
    public.is_admin_email()
    OR (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.bookings b WHERE b.user_id = auth.uid()
    )
  )
);

-- Admins full write
CREATE POLICY "Invoices: admins all"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'invoices' AND public.is_admin_email())
WITH CHECK (bucket_id = 'invoices' AND public.is_admin_email());
