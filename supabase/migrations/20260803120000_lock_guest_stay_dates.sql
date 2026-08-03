-- ---------------------------------------------------------------------------
-- Les guests ne peuvent plus changer leurs dates de séjour (3 août 2026).
-- check_in_date / check_out_date rejoignent les colonnes sensibles du trigger
-- prevent_booking_sensitive_update : silencieusement reverties pour les
-- non-admins. Ajout du garde-fou service_role/postgres (convention CLAUDE.md :
-- les Edge Functions et pg_cron doivent passer, sinon écritures annulées
-- en silence).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_booking_sensitive_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Service role / connexions internes (Edge Functions, pg_cron) : passage libre
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_admin_email() THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status      IS DISTINCT FROM OLD.payment_status      THEN NEW.payment_status      := OLD.payment_status;      END IF;
  IF NEW.deposit_amount      IS DISTINCT FROM OLD.deposit_amount      THEN NEW.deposit_amount      := OLD.deposit_amount;      END IF;
  IF NEW.remaining_balance   IS DISTINCT FROM OLD.remaining_balance   THEN NEW.remaining_balance   := OLD.remaining_balance;   END IF;
  IF NEW.invitation_token    IS DISTINCT FROM OLD.invitation_token    THEN NEW.invitation_token    := OLD.invitation_token;    END IF;
  IF NEW.invitation_claimed  IS DISTINCT FROM OLD.invitation_claimed  THEN NEW.invitation_claimed  := OLD.invitation_claimed;  END IF;
  IF NEW.invitation_expires_at IS DISTINCT FROM OLD.invitation_expires_at THEN NEW.invitation_expires_at := OLD.invitation_expires_at; END IF;
  IF NEW.created_by_admin    IS DISTINCT FROM OLD.created_by_admin    THEN NEW.created_by_admin    := OLD.created_by_admin;    END IF;
  IF NEW.internal_notes      IS DISTINCT FROM OLD.internal_notes      THEN NEW.internal_notes      := OLD.internal_notes;      END IF;
  IF NEW.email               IS DISTINCT FROM OLD.email               THEN NEW.email               := OLD.email;               END IF;
  IF NEW.user_id             IS DISTINCT FROM OLD.user_id             THEN NEW.user_id             := OLD.user_id;             END IF;
  -- Dates de séjour : fixées par la quinta, modifiables uniquement côté admin
  IF NEW.check_in_date       IS DISTINCT FROM OLD.check_in_date       THEN NEW.check_in_date       := OLD.check_in_date;       END IF;
  IF NEW.check_out_date      IS DISTINCT FROM OLD.check_out_date      THEN NEW.check_out_date      := OLD.check_out_date;      END IF;

  RETURN NEW;
END;
$$;
