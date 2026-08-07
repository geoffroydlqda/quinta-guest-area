import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, ShieldCheck, UserRound } from "lucide-react";
import { normalizeEmail } from "@/lib/admin";

/**
 * Onglet Staff (7 août 2026) — annuaire de l'équipe :
 * - fiche par personne (nom, rôle, équipe, email, téléphone)
 * - octroi/retrait de l'accès admin (via admin-staff-access -> admin_users)
 * - choix des onglets visibles dans l'espace admin (allowed_tabs ; vide = tous)
 * NB : le filtrage d'onglets est un contrôle d'INTERFACE. Toute personne avec
 * l'accès admin peut techniquement lire les données via l'API — pour un
 * cloisonnement dur il faudrait des policies RLS par domaine.
 */

const OWNER_EMAIL = "hello@quintamor.com";

export const ADMIN_TABS: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "bookings", label: "Bookings" },
  { key: "guests", label: "Guests" },
  { key: "payments", label: "Payments" },
  { key: "catering", label: "Catering" },
  { key: "transportation", label: "Transportation" },
  { key: "rooms", label: "Housekeeping" },
  { key: "finance", label: "Finance" },
  { key: "staff", label: "Staff" },
];

const TEAMS = ["kitchen", "housekeeping", "management", "transport", "other"] as const;
const TEAM_LABEL: Record<string, string> = {
  kitchen: "🍳 Kitchen", housekeeping: "🧹 Housekeeping", management: "🗂 Management",
  transport: "🚐 Transport", other: "✨ Other",
};

type Staff = {
  id: string; name: string; email: string | null; phone: string | null;
  role: string | null; team: string | null; allowed_tabs: string[] | null;
  active: boolean; notes: string | null;
};

export function StaffPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const myEmail = normalizeEmail(user?.email);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [admins, setAdmins] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", role: "", team: "kitchen" });

  const load = async () => {
    const [{ data: rows, error }, adminRes] = await Promise.all([
      supabase.from("staff_profiles").select("*").order("team").order("name"),
      supabase.functions.invoke("admin-staff-access", { body: { action: "list" } }),
    ]);
    if (error) toast({ title: "Failed to load staff", description: error.message, variant: "destructive" });
    setStaff((rows as Staff[] | null) ?? []);
    if (Array.isArray(adminRes.data?.admins)) setAdmins(new Set(adminRes.data.admins as string[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const patch = async (id: string, p: Partial<Staff>) => {
    setStaff((arr) => arr.map((s) => (s.id === id ? { ...s, ...p } : s)));
    const { error } = await supabase.from("staff_profiles")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const addStaff = async () => {
    if (!draft.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const email = draft.email.trim() ? normalizeEmail(draft.email) : null;
    const { error } = await supabase.from("staff_profiles").insert({
      name: draft.name.trim(), email, phone: draft.phone.trim() || null,
      role: draft.role.trim() || null, team: draft.team,
    });
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setDraft({ name: "", email: "", phone: "", role: "", team: "kitchen" });
    setShowAdd(false);
    load();
  };

  const setAdminAccess = async (s: Staff, grant: boolean) => {
    if (!s.email) {
      toast({ title: "Email required", description: "Add an email to this profile first — admin access is tied to the login email.", variant: "destructive" });
      return;
    }
    setBusyId(s.id);
    const { data, error } = await supabase.functions.invoke("admin-staff-access", {
      body: { action: grant ? "grant" : "revoke", email: s.email },
    });
    setBusyId(null);
    if (error || data?.error) {
      toast({ title: grant ? "Grant failed" : "Revoke failed", description: String(data?.error ?? error?.message), variant: "destructive" });
      return;
    }
    setAdmins(new Set((data?.admins as string[]) ?? []));
    toast({
      title: grant ? "Admin access granted" : "Admin access revoked",
      description: grant
        ? `${s.name} can now sign in to the admin at guest.quintamor.com with ${s.email}. Use the tab checkboxes below to limit what they see.`
        : `${s.name} no longer has admin access.`,
    });
  };

  const toggleTab = (s: Staff, tab: string) => {
    const all = ADMIN_TABS.map((t) => t.key);
    const current = s.allowed_tabs && s.allowed_tabs.length > 0 ? s.allowed_tabs : all;
    const next = current.includes(tab) ? current.filter((t) => t !== tab) : [...current, tab];
    if (next.length === 0) { toast({ title: "At least one tab", description: "An admin needs at least one visible tab.", variant: "destructive" }); return; }
    // Tous cochés -> null (= tous, y compris les futurs onglets)
    patch(s.id, { allowed_tabs: next.length === all.length ? null : next });
  };

  const grouped = useMemo(() => {
    const g = new Map<string, Staff[]>();
    for (const s of staff) {
      const k = s.team ?? "other";
      g.set(k, [...(g.get(k) ?? []), s]);
    }
    return [...TEAMS].filter((t) => g.has(t)).map((t) => [t, g.get(t)!] as const);
  }, [staff]);

  const isAdmin = (s: Staff) => !!s.email && admins.has(normalizeEmail(s.email));

  if (loading) {
    return <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-primary" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Team directory. Granting admin access lets someone sign in to this admin area with their email — restrict which tabs they see with the checkboxes.
        </p>
        <span className="ml-auto" />
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="w-4 h-4 mr-1" />Add staff</Button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-primary/50 bg-primary/5 p-3 grid sm:grid-cols-5 gap-2 items-end text-sm">
          <label className="space-y-1"><div className="text-xs text-muted-foreground">Name *</div>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9" /></label>
          <label className="space-y-1"><div className="text-xs text-muted-foreground">Role</div>
            <Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Chef, Service…" className="h-9 placeholder:italic placeholder:text-muted-foreground/50" /></label>
          <label className="space-y-1"><div className="text-xs text-muted-foreground">Team</div>
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })}>
              {TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
            </select></label>
          <label className="space-y-1"><div className="text-xs text-muted-foreground">Email</div>
            <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="h-9" /></label>
          <div className="flex items-end gap-2">
            <label className="space-y-1 flex-1"><div className="text-xs text-muted-foreground">Phone</div>
              <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="h-9" /></label>
            <Button size="sm" onClick={addStaff}>Save</Button>
          </div>
        </div>
      )}

      {grouped.map(([team, members]) => (
        <section key={team}>
          <h2 className="text-sm font-bold mb-2">{TEAM_LABEL[team] ?? team}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {members.map((s) => {
              const adm = isAdmin(s);
              const isOwner = normalizeEmail(s.email) === OWNER_EMAIL;
              const isSelf = !!s.email && normalizeEmail(s.email) === myEmail;
              const effectiveTabs = s.allowed_tabs && s.allowed_tabs.length > 0 ? s.allowed_tabs : null;
              return (
                <div key={s.id} className={`rounded-2xl border border-border/70 bg-card p-4 shadow-sm ${s.active ? "" : "opacity-55"}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary shrink-0">
                      <UserRound className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input className="font-semibold bg-transparent outline-none border-b border-transparent focus:border-input min-w-0 max-w-[160px]"
                          defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s.id, { name: v }); }} />
                        {adm && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF6DF] px-2 py-0.5 text-[10px] font-bold text-[#35532A]">
                            <ShieldCheck className="w-3 h-3" />{isOwner ? "Owner" : "Admin"}
                          </span>
                        )}
                        {!s.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Inactive</span>}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <input className="bg-transparent outline-none border-b border-transparent focus:border-input" placeholder="Role…"
                          defaultValue={s.role ?? ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.role ?? "")) patch(s.id, { role: v || null }); }} />
                        <input className="bg-transparent outline-none border-b border-transparent focus:border-input" placeholder="Phone…"
                          defaultValue={s.phone ?? ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.phone ?? "")) patch(s.id, { phone: v || null }); }} />
                        <input className="col-span-2 bg-transparent outline-none border-b border-transparent focus:border-input" placeholder="Email (needed for admin access)…"
                          defaultValue={s.email ?? ""} onBlur={(e) => { const v = normalizeEmail(e.target.value); if (v !== normalizeEmail(s.email)) patch(s.id, { email: v || null }); }} />
                      </div>
                    </div>
                  </div>

                  {/* Accès admin + onglets */}
                  <div className="mt-3 border-t border-border/60 pt-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-muted-foreground">Admin access</span>
                      <span className="ml-auto" />
                      {adm ? (
                        !isOwner && !isSelf && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-destructive"
                            disabled={busyId === s.id} onClick={() => setAdminAccess(s, false)}>
                            {busyId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Revoke"}
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                          disabled={busyId === s.id} onClick={() => setAdminAccess(s, true)}>
                          {busyId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Grant admin"}
                        </Button>
                      )}
                    </div>
                    {adm && !isOwner && (
                      <div className="mt-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Visible tabs {effectiveTabs ? `(${effectiveTabs.length}/${ADMIN_TABS.length})` : "(all)"}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {ADMIN_TABS.map((t) => {
                            const on = !effectiveTabs || effectiveTabs.includes(t.key);
                            return (
                              <button key={t.key} type="button" onClick={() => toggleTab(s, t.key)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                  on ? "border-[#79B84B] bg-[#EAF6DF] text-[#35532A]" : "border-border bg-background text-muted-foreground/60 line-through"}`}>
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <button type="button" className="text-[10px] text-muted-foreground hover:underline"
                      onClick={() => patch(s.id, { active: !s.active })}>
                      {s.active ? "Mark inactive" : "Mark active"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-[11px] text-muted-foreground">
        Tab visibility is an interface-level restriction: anyone with admin access can technically read all admin data through the API. Keep admin access for people you trust; use tabs to keep their workspace focused.
      </p>
    </div>
  );
}
