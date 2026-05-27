
-- 1. Add total_rental_price to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS total_rental_price numeric(10,2);

-- 2. payment_installments
CREATE TABLE public.payment_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount_due numeric(10,2) NOT NULL,
  due_date date,
  amount_paid numeric(10,2) NOT NULL DEFAULT 0,
  paid_at date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','partial')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_installments TO authenticated;
GRANT ALL ON public.payment_installments TO service_role;

ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own installments"
  ON public.payment_installments FOR SELECT TO authenticated
  USING (
    booking_id IN (SELECT id FROM public.bookings WHERE user_id = auth.uid())
    OR public.is_admin_email()
  );

CREATE POLICY "Admins insert installments"
  ON public.payment_installments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_email());

CREATE POLICY "Admins update installments"
  ON public.payment_installments FOR UPDATE TO authenticated
  USING (public.is_admin_email())
  WITH CHECK (public.is_admin_email());

CREATE POLICY "Admins delete installments"
  ON public.payment_installments FOR DELETE TO authenticated
  USING (public.is_admin_email());

CREATE INDEX idx_payment_installments_booking ON public.payment_installments(booking_id);

CREATE TRIGGER trg_payment_installments_updated_at
  BEFORE UPDATE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. invoices
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('rental','food','transport')),
  period text NOT NULL DEFAULT 'pre' CHECK (period IN ('pre','post')),
  label text,
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    booking_id IN (SELECT id FROM public.bookings WHERE user_id = auth.uid())
    OR public.is_admin_email()
  );

CREATE POLICY "Admins insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_email());

CREATE POLICY "Admins update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (public.is_admin_email())
  WITH CHECK (public.is_admin_email());

CREATE POLICY "Admins delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.is_admin_email());

CREATE INDEX idx_invoices_booking ON public.invoices(booking_id);

-- 4. Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: guests read files under their booking folder; admins full access
CREATE POLICY "Users read own booking invoices"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (
      public.is_admin_email()
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.bookings WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Admins write invoice files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin_email());

CREATE POLICY "Admins update invoice files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin_email())
  WITH CHECK (bucket_id = 'invoices' AND public.is_admin_email());

CREATE POLICY "Admins delete invoice files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'invoices' AND public.is_admin_email());
