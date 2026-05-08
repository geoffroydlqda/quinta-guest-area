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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guestId: string | null;
  guestLabel?: string;
  onDeleted?: (guestId: string) => void;
}

export function DeleteGuestDialog({ open, onOpenChange, guestId, guestLabel, onDeleted }: Props) {
  const { toast } = useToast();
  const [alsoDeleteAuth, setAlsoDeleteAuth] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!guestId) return;
    setBusy(true);
    const res = await supabase.functions.invoke("admin-delete-guest", {
      body: { guest_id: guestId, also_delete_auth_user: alsoDeleteAuth },
    });
    setBusy(false);
    if (res.error || (res.data && (res.data as any).error)) {
      const msg = (res.data as any)?.error || res.error?.message || "Deletion failed";
      toast({ title: "Deletion failed", description: String(msg), variant: "destructive" });
      return;
    }
    toast({ title: "Guest entry deleted." });
    onOpenChange(false);
    setAlsoDeleteAuth(false);
    onDeleted?.(guestId);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete guest entry?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {guestLabel && <p className="font-medium text-foreground">{guestLabel}</p>}
              <p>This will permanently remove:</p>
              <ul className="list-disc list-inside text-sm">
                <li>guest profile</li>
                <li>room setup</li>
                <li>food selections</li>
                <li>transportation trips</li>
                <li>summaries</li>
                <li>associated admin data</li>
              </ul>
              <p className="text-sm font-medium">This action cannot be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-start gap-2 text-sm border-t border-border pt-3">
          <Checkbox
            checked={alsoDeleteAuth}
            onCheckedChange={(v) => setAlsoDeleteAuth(v === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            Also delete login account
            <span className="block text-xs text-muted-foreground">
              Removes the authentication user. Leave unchecked to keep the account but clear all data.
            </span>
          </span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
