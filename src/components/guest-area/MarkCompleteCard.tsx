import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Sparkles } from 'lucide-react';

// Carte "Mark as complete" en bas de chaque outil guest (Bedrooms / Catering /
// Transportation). Le statut par outil alimente le Stay summary ; l'édition
// reste ouverte après complétion (le statut ne se réinitialise pas).
type ToolTable = 'room_setups' | 'food_plans' | 'transportation_requests';
const STATUS_COLUMN: Record<ToolTable, string> = {
  room_setups: 'status_roomsetup',
  food_plans: 'status_food',
  transportation_requests: 'status_transportation',
};

export function MarkCompleteCard({
  table,
  toolLabel,
  onChanged,
}: {
  table: ToolTable;
  toolLabel: string;
  onChanged?: (completed: boolean) => void;
}) {
  const { user } = useAuth();
  const { activeBookingId } = useActiveBooking();
  const column = STATUS_COLUMN[table];
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [noRow, setNoRow] = useState(false);

  const scope = <T extends { eq: any }>(q: T): T =>
    activeBookingId ? q.eq('booking_id', activeBookingId) : q.eq('user_id', user?.id ?? '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user && !activeBookingId) return;
      const { data } = await scope(supabase.from(table).select(column) as any).maybeSingle();
      if (cancelled) return;
      if (!data) { setNoRow(true); setCompleted(false); return; }
      setNoRow(false);
      setCompleted((data as any)[column] === 'submitted');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, activeBookingId, user?.id]);

  const setStatus = async (next: 'submitted' | 'draft') => {
    setSaving(true);
    const { data } = await scope(
      supabase.from(table).update({ [column]: next } as any) as any
    ).select('id');
    setSaving(false);
    if (data && (data as any[]).length > 0) {
      setCompleted(next === 'submitted');
      onChanged?.(next === 'submitted');
    }
  };

  if (completed === null) return null;

  if (completed) {
    return (
      <div className="rounded-2xl border border-[#CAE8BD] bg-gradient-to-br from-[#EAF6DF] to-[#F6FBEF] p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-[#79B84B] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Check className="w-5 h-5" strokeWidth={3} />
          </span>
          <div>
            <p className="font-semibold text-[#35532A]">{toolLabel} completed — nice work!</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              You can still make changes until 7 days before your arrival.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          disabled={saving}
          onClick={() => setStatus('draft')}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Mark as not finished'}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-[#EAF6DF] text-[#35532A] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5" />
        </span>
        <div>
          <p className="font-semibold">All set here?</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {noRow
              ? `Start your ${toolLabel.toLowerCase()} above first — then mark this step as complete.`
              : `Mark ${toolLabel.toLowerCase()} as complete. You can still edit afterwards.`}
          </p>
        </div>
      </div>
      <Button
        type="button"
        className="rounded-full bg-[#35532A] text-white hover:bg-[#2A4221] gap-2"
        disabled={saving || noRow}
        onClick={() => setStatus('submitted')}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Mark as complete
      </Button>
    </div>
  );
}
