import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { isAdminEmail, normalizeEmail } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";

type AdminGuardProps = {
  children: React.ReactNode;
};

export function useAdminAccess() {
  const { user, session, isLoading } = useAuth();
  const isMobile = useIsMobile();

  const normalizedEmail = useMemo(() => normalizeEmail(user?.email), [user?.email]);
  const isStaticAdmin = useMemo(() => isAdminEmail(user?.email), [user?.email]);
  // Repli sur la source de vérité (table admin_users, via RPC SECURITY DEFINER)
  // pour les admins ajoutés en base mais pas encore dans la liste front.
  const [dbAdmin, setDbAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!user?.email || isStaticAdmin) { setDbAdmin(null); return; }
    supabase.rpc("check_is_admin_email", { check_email: normalizedEmail })
      .then(({ data, error }) => { if (!cancelled) setDbAdmin(error ? false : data === true); });
    return () => { cancelled = true; };
  }, [user?.email, isStaticAdmin, normalizedEmail]);
  const isAdmin = isStaticAdmin || dbAdmin === true;
  const isResolved = !isLoading && (isStaticAdmin || !user || dbAdmin !== null);

  if (import.meta.env.DEV) {
    console.log("[Admin access]", {
      authState: isLoading ? "loading" : user ? "authenticated" : "anonymous",
      profileLoaded: Boolean(user),
      email: user?.email ?? null,
      normalizedEmail,
      adminResult: isAdmin,
      redirectReason: isResolved && !user ? "missing-user" : isResolved && user && !isAdmin ? "not-admin" : null,
      deviceType: isMobile ? "mobile" : "desktop",
      hasSession: Boolean(session),
    });
  }

  return {
    user,
    isAdmin,
    isResolved,
    isLoading,
    isMobile,
    normalizedEmail,
  };
}

function AdminAccessLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading admin access…</p>
    </div>
  );
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { user, isAdmin, isResolved } = useAdminAccess();

  if (!isResolved) {
    return <AdminAccessLoader />;
  }

  if (!user) {
    return <Navigate to="/auth?mode=login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}