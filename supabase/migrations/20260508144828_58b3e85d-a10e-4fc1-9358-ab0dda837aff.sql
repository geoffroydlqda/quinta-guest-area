CREATE TABLE public.deleted_entries_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deleted_guest_id UUID NOT NULL,
  deleted_guest_email TEXT,
  deleted_by_admin TEXT NOT NULL,
  also_deleted_auth_user BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.deleted_entries_log ENABLE ROW LEVEL SECURITY;

-- Only admins (matched by email) may read the log.
CREATE POLICY "Admins can view deletion log"
ON public.deleted_entries_log
FOR SELECT
TO authenticated
USING (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = 'hello@quintamor.com'
);

-- No client INSERT/UPDATE/DELETE policies; service role bypasses RLS.
