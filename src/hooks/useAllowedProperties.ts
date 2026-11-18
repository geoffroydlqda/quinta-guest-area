import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEmail } from "@/lib/admin";
import type { Property } from "@/lib/property";

const OWNER_EMAIL = "hello@quintamor.com";

/**
 * Lieux (QDA/TDP) accessibles à l'admin connecté, d'après
 * staff_profiles.allowed_properties (onglet Staff, P0b multi-lieux 18 nov
 * 2026). null = tous les lieux. Le owner voit toujours tout. Comme
 * allowed_tabs : contrôle d'INTERFACE — les policies RLS restent au niveau
 * "admin ou pas".
 */
export function useAllowedProperties(): { allowed: Set<Property> | null; loaded: boolean } {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState<Set<Property> | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const email = normalizeEmail(user?.email);
    if (!email || email === OWNER_EMAIL) { setAllowed(null); setLoaded(true); return; }
    supabase
      .from("staff_profiles")
      .select("allowed_properties")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const props = (data?.allowed_properties ?? []).filter(
          (p): p is Property => p === "quinta" || p === "terra"
        );
        setAllowed(props.length > 0 ? new Set(props) : null);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [user?.email]);

  return { allowed, loaded };
}
