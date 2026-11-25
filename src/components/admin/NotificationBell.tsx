import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEmail } from "@/lib/admin";
import { Bell } from "lucide-react";

/**
 * Centre de notifications admin (25 nov 2026) — cloche + badge non-lus dans
 * la sidebar. Les notifications naissent côté client (fan-out, voir
 * lib/notifications.ts) : création/assignation/complétion de tâches pour
 * commencer, extensible à d'autres types. Rafraîchi à l'ouverture + toutes
 * les 60 s (pas de realtime — simple et suffisant).
 */

type Notif = {
  id: string; message: string; type: string; task_id: string | null;
  created_at: string; read_at: string | null;
};

const relTime = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
};

export function NotificationBell({ align = "left" }: { align?: "left" | "right" } = {}) {
  const { user } = useAuth();
  const email = normalizeEmail(user?.email) ?? "";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!email) return;
    const { data } = await supabase.from("admin_notifications")
      .select("id,message,type,task_id,created_at,read_at")
      .eq("recipient_email", email)
      .order("created_at", { ascending: false })
      .limit(30);
    const list = (data as Notif[] | null) ?? [];
    setItems(list);
    setUnread(list.filter((n) => !n.read_at).length);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    setItems((arr) => arr.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    await supabase.from("admin_notifications").update({ read_at: now }).in("id", ids);
  };

  if (!email) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        title="Notifications"
        className="relative p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-[#F36F63] text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 z-50 w-[300px] max-w-[88vw] max-h-[380px] overflow-y-auto rounded-xl border border-border bg-card shadow-xl`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 sticky top-0 bg-card">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-muted-foreground hover:text-foreground">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground italic">Nothing yet.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`px-3 py-2.5 border-b border-border/40 last:border-0 text-sm ${n.read_at ? "text-muted-foreground" : "font-medium"}`}>
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#79B84B] mt-1.5 shrink-0" />}
                  <span className="flex-1">{n.message}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{relTime(n.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
