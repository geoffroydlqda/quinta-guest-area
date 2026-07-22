import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveBooking } from "@/contexts/BookingContext";
import { isAdminEmail } from "@/lib/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Status = "loading" | "needs_auth" | "claiming" | "success" | "error";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { refresh, setActiveBookingId } = useActiveBooking();

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setStatus("error");
      setErrorMsg("Invalid invitation link.");
      return;
    }
    if (!user) {
      // Mémorise l'invitation : si la connexion (Google notamment) ne revient
      // pas sur cette page, Auth/Dashboard reprendront le claim automatiquement.
      localStorage.setItem("qda_pending_invite", token);
      setStatus("needs_auth");
      return;
    }
    localStorage.removeItem("qda_pending_invite");

    if (isAdminEmail(user.email)) {
      setStatus("error");
      setErrorMsg(
        "You are signed in as an admin. To view or edit this booking, use \"Open as guest\" from the Admin page instead of claiming the invitation."
      );
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus("claiming");
      try {
        const { data, error } = await supabase.functions.invoke("claim-booking", {
          body: { token },
        });
        if (cancelled) return;

        if (error) {
          const ctx: any = (error as any).context;
          let payload: any = null;
          try {
            payload = ctx ? await ctx.json() : null;
          } catch {
            /* noop */
          }
          const rawMsg = payload?.message || payload?.error || error.message || "Failed to claim invitation.";
          if (typeof rawMsg === "string" && rawMsg.toLowerCase().includes("already claimed")) {
            setErrorMsg(
              "This booking has already been claimed by another account. If you think this is a mistake, contact hello@quintamor.com."
            );
          } else {
            setErrorMsg(rawMsg);
          }
          setStatus("error");
          return;
        }

        if (data?.ok) {
          await refresh();
          if (data.booking_id) setActiveBookingId(data.booking_id);
          setStatus("success");
          setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
        } else {
          setErrorMsg(data?.error || "Unexpected response.");
          setStatus("error");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message || String(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, token, navigate, refresh, setActiveBookingId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Your invitation</CardTitle>
          <CardDescription>Claim your retreat booking</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {status === "needs_auth" && (
            <>
              <p className="text-sm text-muted-foreground">
                Please sign in or create an account to claim this invitation.
              </p>
              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <Link to={`/auth?mode=login&redirectTo=/invite/${token}`}>Sign in</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link to={`/auth?mode=signup&redirectTo=/invite/${token}`}>Sign up</Link>
                </Button>
              </div>
            </>
          )}

          {status === "claiming" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Claiming your booking…
            </div>
          )}

          {status === "success" && (
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Booking claimed! Redirecting…
            </div>
          )}

          {status === "error" && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Couldn't claim invitation</p>
                  <p className="text-muted-foreground">{errorMsg}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1">
                  <Link to="/dashboard">Go to dashboard</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
