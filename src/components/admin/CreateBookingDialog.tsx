import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, Plus, X, Search } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const initial = {
  retreat_name: "",
  first_name: "",
  last_name: "",
  email: "",
  guest_count: 1,
  check_in_date: "",
  check_out_date: "",
  payment_status: "pending" as "pending" | "deposit_paid" | "paid_in_full" | "overdue",
  deposit_amount: "",
  remaining_balance: "",
  internal_notes: "",
};

type GuestOption = { id: string; email: string; first_name: string | null; last_name: string | null };

export function CreateBookingDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Guest d'abord : le booking se crée pour une fiche guest (client_profiles),
  // existante ou nouvelle — évite les guests en doublon.
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [guestId, setGuestId] = useState<string>("new");
  const [guestQuery, setGuestQuery] = useState("");
  const [guestListOpen, setGuestListOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("client_profiles").select("id,email,first_name,last_name")
      .then(({ data }) => {
        if (data) setGuests((data as GuestOption[]).sort((a, b) =>
          `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().localeCompare(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim())
        ));
      });
  }, [open]);

  const guestLabel = (g: GuestOption) =>
    `${`${g.first_name ?? ""} ${g.last_name ?? ""}`.trim() || g.email} — ${g.email}`;

  const selectGuest = (g: GuestOption) => {
    setGuestId(g.id);
    setGuestQuery(guestLabel(g));
    setGuestListOpen(false);
    setForm((f) => ({ ...f, email: g.email, first_name: g.first_name ?? "", last_name: g.last_name ?? "" }));
  };

  const newGuestMode = () => {
    setGuestId("new");
    setGuestQuery("");
    setGuestListOpen(false);
    setForm((f) => ({ ...f, email: "", first_name: "", last_name: "" }));
    // Feedback clair : le focus saute sur le prénom du nouveau guest
    setTimeout(() => document.getElementById("first_name")?.focus(), 0);
  };

  const filteredGuests = guests.filter((g) => {
    const q = guestQuery.toLowerCase().trim();
    if (!q) return true;
    return guestLabel(g).toLowerCase().includes(q);
  }).slice(0, 8);

  const reset = () => {
    setForm(initial);
    setGuestId("new");
    setGuestQuery("");
    setGuestListOpen(false);
    setInviteUrl(null);
    setCopied(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!form.email.trim()) {
      toast({ title: "Email required", variant: "destructive" });
      return;
    }
    if (form.check_in_date && form.check_out_date && form.check_out_date < form.check_in_date) {
      toast({ title: "Check-out must be on or after check-in", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    // Règle : un seul booking actif à la fois sur des dates données
    // (la fonction create-booking refait la même vérification côté serveur).
    if (form.check_in_date && form.check_out_date) {
      const { data: conflicts } = await supabase.from("bookings")
        .select("id,retreat_name,first_name,last_name,email,check_in_date,check_out_date,is_test,cancelled_at")
        .not("check_in_date", "is", null)
        .not("check_out_date", "is", null)
        .lt("check_in_date", form.check_out_date)
        .gt("check_out_date", form.check_in_date);
      const active = (conflicts ?? []).filter((b: any) => !b.is_test && !b.cancelled_at);
      if (active.length > 0) {
        const c = active[0] as any;
        const label = c.retreat_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email;
        toast({
          title: "Dates already taken",
          description: `"${label}" occupies ${c.check_in_date} → ${c.check_out_date}. Adjust the dates or that booking first.`,
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }
    }
    const payload = {
      retreat_name: form.retreat_name.trim(),
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      email: form.email.trim().toLowerCase(),
      guest_count: Number(form.guest_count) || 1,
      check_in_date: form.check_in_date || null,
      check_out_date: form.check_out_date || null,
      payment_status: form.payment_status,
      deposit_amount: form.deposit_amount === "" ? null : Number(form.deposit_amount),
      remaining_balance: form.remaining_balance === "" ? null : Number(form.remaining_balance),
      internal_notes: form.internal_notes.trim() || null,
      origin: window.location.origin,
    };
    console.log("[create-booking] payload", payload);

    try {
      const res = await supabase.functions.invoke("create-booking", { body: payload });
      console.log("[create-booking] response", res);

      if (res.error) {
        const detail =
          (res.data as any)?.error
            ? typeof (res.data as any).error === "string"
              ? (res.data as any).error
              : JSON.stringify((res.data as any).error)
            : res.error.message;
        console.error("[create-booking] invoke error", res.error, res.data);
        toast({ title: "Failed to create booking", description: detail, variant: "destructive" });
        return;
      }

      const data = res.data as { ok?: boolean; booking?: { id?: string }; invite_url?: string; error?: unknown };
      if (!data?.ok || !data.booking?.id) {
        console.error("[create-booking] missing booking in response", data);
        toast({
          title: "Failed to create booking",
          description: typeof data?.error === "string" ? data.error : "No booking returned by server",
          variant: "destructive",
        });
        return;
      }

      console.log("[create-booking] success", { booking_id: data.booking.id, invite_url: data.invite_url });
      setInviteUrl(data.invite_url ?? null);
      toast({ title: "Booking created" });
      // Rattache le booking à sa fiche guest (existante ou créée à la volée).
      try {
        let clientId = guestId !== "new" ? guestId : null;
        if (!clientId) {
          const { data: existing } = await supabase.from("client_profiles").select("id").eq("email", payload.email).maybeSingle();
          if (existing) clientId = existing.id;
          else {
            const { data: created } = await supabase.from("client_profiles")
              .insert({ email: payload.email, first_name: payload.first_name, last_name: payload.last_name })
              .select("id").single();
            clientId = created?.id ?? null;
          }
        }
        if (clientId) await supabase.from("bookings").update({ client_id: clientId }).eq("id", data.booking.id);
      } catch (e) {
        console.warn("[create-booking] client link failed", e);
      }
      // Crée l'événement dans le calendrier Google "Events" (no-op tant que le
      // service account n'est pas configuré côté Supabase).
      supabase.functions.invoke("sync-booking-calendar", { body: { booking_id: data.booking.id } }).catch(() => {});
      onCreated?.();
    } catch (e: any) {
      console.error("[create-booking] threw", e);
      toast({ title: "Failed to create booking", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create booking</DialogTitle>
          <DialogDescription>
            Generate a new stay and an invitation link the guest can use to claim it.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-3">
            <Label>Invitation link</Label>
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={copyLink}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this with the guest. They'll be asked to sign in or sign up, then the booking will be linked to their account.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Done</Button>
              <Button onClick={reset}>Create another</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="guest_search">Guest</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="guest_search"
                    value={guestQuery}
                    placeholder="Search a guest by name or email…"
                    className="pl-8 pr-8"
                    autoComplete="off"
                    onFocus={() => setGuestListOpen(true)}
                    onBlur={() => setTimeout(() => setGuestListOpen(false), 150)}
                    onChange={(e) => {
                      // Taper dans la recherche déselectionne le guest SANS
                      // voler le focus (le saut vers #first_name est réservé
                      // au bouton + explicite — corrigé le 25 août 2026).
                      if (guestId !== "new") {
                        setGuestId("new");
                        setForm((f) => ({ ...f, email: "", first_name: "", last_name: "" }));
                      }
                      setGuestQuery(e.target.value);
                      setGuestListOpen(true);
                    }}
                  />
                  {guestId !== "new" && (
                    <button
                      type="button"
                      onClick={newGuestMode}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear selected guest"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  {guestListOpen && filteredGuests.length > 0 && (
                    <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                      {filteredGuests.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); selectGuest(g); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          >
                            <span className="font-medium">{`${g.first_name ?? ""} ${g.last_name ?? ""}`.trim() || g.email}</span>
                            <span className="text-muted-foreground"> — {g.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={newGuestMode}
                  title="New guest — clears the selection and jumps to the name fields below"
                  className={guestId === "new" ? "border-primary text-[#35532A]" : ""}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {guestId !== "new"
                  ? "Booking will be attached to this guest's profile."
                  : "New guest — fill in their name and email below."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="first_name">First name</Label>
                <Input id="first_name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="last_name">Last name</Label>
                <Input id="last_name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                disabled={guestId !== "new"}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {guestId !== "new" && (
                <p className="mt-1 text-xs text-muted-foreground">From the guest's profile — edit it in the Guests tab.</p>
              )}
            </div>
            <div>
              <Label htmlFor="retreat_name">Retreat / event name</Label>
              <Input id="retreat_name" value={form.retreat_name} onChange={(e) => setForm({ ...form, retreat_name: e.target.value })} placeholder="e.g. Yoga Retreat — June" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="check_in_date">Check-in</Label>
                <Input id="check_in_date" type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="check_out_date">Check-out</Label>
                <Input id="check_out_date" type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="guest_count">Guests</Label>
                <Input id="guest_count" type="number" min={1} max={50} value={form.guest_count} onChange={(e) => setForm({ ...form, guest_count: Number(e.target.value) || 1 })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="payment_status">Payment</Label>
                <select
                  id="payment_status"
                  value={form.payment_status}
                  onChange={(e) => setForm({ ...form, payment_status: e.target.value as typeof form.payment_status })}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background h-10"
                >
                  <option value="pending">Pending</option>
                  <option value="deposit_paid">Deposit paid</option>
                  <option value="paid_in_full">Paid in full</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>
              <div>
                <Label htmlFor="deposit_amount">Deposit</Label>
                <Input id="deposit_amount" type="number" min={0} step="0.01" value={form.deposit_amount} onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="remaining_balance">Balance</Label>
                <Input id="remaining_balance" type="number" min={0} step="0.01" value={form.remaining_balance} onChange={(e) => setForm({ ...form, remaining_balance: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="internal_notes">Internal notes</Label>
              <Textarea id="internal_notes" rows={3} value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Create booking
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
