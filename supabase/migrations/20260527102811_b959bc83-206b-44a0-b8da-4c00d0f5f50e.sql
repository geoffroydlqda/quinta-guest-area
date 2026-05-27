
-- 1. invoices: add amount, paid, paid_at
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at date;

-- 2. bookings: payment_status_override
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status_override text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_status_override_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_payment_status_override_check
      CHECK (payment_status_override IS NULL OR payment_status_override IN ('pending','deposit_paid','paid_in_full','overdue'));
  END IF;
END $$;

-- 3. updated_at trigger on payment_installments (idempotent)
DROP TRIGGER IF EXISTS trg_payment_installments_updated_at ON public.payment_installments;
CREATE TRIGGER trg_payment_installments_updated_at
  BEFORE UPDATE ON public.payment_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
