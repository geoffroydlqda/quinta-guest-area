import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEmail } from "@/lib/admin";

const OWNER_EMAIL = "hello@quintamor.com";

/**
 * Onglets admin visibles pour l'utilisateur connecté, d'après
 * staff_profiles.allowed_tabs (onglet Staff). null = tous les onglets.
 * Le owner voit toujours tout. NB : contrôle d'interface — les données
 * restent protégées au niveau "admin ou pas" par les policies RLS.
 */
export function useAllowedTabs(): { allowed: Set<string> | null; loaded: boolean } {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState<Set<string> | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const email = normalizeEmail(user?.email);
    if (!email || email === OWNER_EMAIL) { setAllowed(null); setLoaded(true); return; }
    supabase
      .from("staff_profiles")
      .select("allowed_tabs")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const tabs = data?.allowed_tabs;
        setAllowed(Array.isArray(tabs) && tabs.length > 0 ? new Set(tabs) : null);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [user?.email]);

  return { allowed, loaded };
}
