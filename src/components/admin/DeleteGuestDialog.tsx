import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Booking id (la route /admin/guest/:guestId porte en réalité un booking id) */
  guestId: string | null;
  guestLabel?: string;
  onDeleted?: (bookingId: string) => void;
}

// Suppression scopée : admin-delete-guest supprime UN booking et ses données
// enfants — jamais la fiche client ni le compte de connexion (le guest peut
// avoir d'autres séjours). Pour supprimer une fiche entière : onglet Guests.
export function DeleteGuestDialog({ open, onOpenChange, guestId, guestLabel, onDeleted }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!guestId) return;
    setBusy(true);
    const res = await supabase.functions.invoke("admin-delete-guest", {
      body: { booking_id: guestId },
    });
    setBusy(false);
    if (res.error || (res.data && (res.data as any).error)) {
      const raw = (res.data as any)?.error ?? res.error?.message ?? "Deletion failed";
      const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
      toast({ title: "Deletion failed", description: msg, variant: "destructive" });
      return;
    }
    toast({ title: "Booking deleted." });
    onOpenChange(false);
    onDeleted?.(guestId);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {guestLabel && <p className="font-medium text-foreground">{guestLabel}</p>}
              <p>This will permanently remove this booking and its data:</p>
              <ul className="list-disc list-inside text-sm">
                <li>guest profile for this stay</li>
                <li>room setup</li>
                <li>food selections</li>
                <li>transportation trips</li>
                <li>payment installments</li>
              </ul>
              <p className="text-sm text-muted-foreground">
                The client card and login account are kept — delete them from the Guests tab if needed.
              </p>
              <p className="text-sm font-medium">This action cannot be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
