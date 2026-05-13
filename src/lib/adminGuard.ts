import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { isAdminEmail, normalizeEmail } from "@/lib/admin";

type AdminGuardProps = {
  children: React.ReactNode;
};

export function useAdminAccess() {
  const { user, session, isLoading } = useAuth();
  const isMobile = useIsMobile();

  const normalizedEmail = useMemo(() => normalizeEmail(user?.email), [user?.email]);
  const isAdmin = useMemo(() => isAdminEmail(user?.email), [user?.email]);
  const isResolved = !isLoading;

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