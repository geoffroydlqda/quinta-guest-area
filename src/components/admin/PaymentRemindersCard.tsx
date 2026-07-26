import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, BellOff, Bell } from 'lucide-react';

interface ReminderPreviewItem {
  type: 'payment_upcoming' | 'payment_overdue';
  recipient: string;
  first_name: string;
  label: string;
  amount_due: number;
  due_date: string;
}

interface PreviewResponse {
  mode: string;
  enabled: boolean;
  settings: { days_before: number; days_overdue: number };
  today: string;
  would_send: ReminderPreviewItem[];
  count: number;
}

/**
 * Aperçu des rappels de paiement automatiques (Phase 1).
 * Tant que l'interrupteur global (app_settings.payment_reminders.enabled) est
 * désactivé, RIEN ne part : cette carte montre ce qui serait envoyé.
 */
export function PaymentRemindersCard() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('payment-reminders', {
      body: { preview: true },
    });
    if (fnError || data?.error) setError(fnError?.message || data?.error || 'Unknown error');
    else setPreview(data as PreviewResponse);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async () => {
    if (!preview) return;
    const next = !preview.enabled;
    const overdueCount = preview.would_send.filter((r) => r.type === 'payment_overdue').length;
    const msg = next
      ? `Enable automatic payment reminders?\n\nFrom the next daily run (08:00 UTC), guests get an email ${preview.settings.days_before} days before a due date and a follow-up ${preview.settings.days_overdue} days after.` +
        (overdueCount > 0 ? `\n\n⚠️ ${overdueCount} overdue follow-up${overdueCount === 1 ? '' : 's'} in the preview below would go out on the first run.` : '')
      : 'Disable automatic payment reminders? Nothing will be sent until you re-enable them.';
    if (!window.confirm(msg)) return;
    setToggling(true);
    const { error: upError } = await supabase
      .from('app_settings')
      .update({
        value: {
          enabled: next,
          days_before: preview.settings.days_before,
          days_overdue: preview.settings.days_overdue,
        },
      })
      .eq('key', 'payment_reminders');
    setToggling(false);
    if (upError) setError(upError.message);
    else load();
  };

  return (
    <section className="mb-6 border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Automatic payment reminders</h3>
          {preview && (
            <Badge variant={preview.enabled ? 'default' : 'secondary'} className="gap-1">
              {preview.enabled ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
              {preview.enabled ? 'Active' : 'Disabled'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {preview && (
            <Button
              size="sm"
              variant={preview.enabled ? 'outline' : 'default'}
              onClick={toggleEnabled}
              disabled={toggling || loading}
              className="gap-1.5"
            >
              {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : preview.enabled ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
              {preview.enabled ? 'Disable' : 'Enable reminders'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {preview && (
        <p className="text-sm text-muted-foreground mt-1">
          Reminder {preview.settings.days_before} days before the due date, follow-up{' '}
          {preview.settings.days_overdue} days after. Each reminder is sent at most once per
          installment.{' '}
          {!preview.enabled && (
            <span className="font-medium text-foreground">
              Currently disabled — nothing is sent; the list below is a dry-run preview.
            </span>
          )}
        </p>
      )}

      {error && <p className="text-sm text-destructive mt-3">Preview failed: {error}</p>}

      {preview && preview.count === 0 && !error && (
        <p className="text-sm text-muted-foreground mt-3">
          Nothing pending: no reminder would be sent today.
        </p>
      )}

      {preview && preview.count > 0 && (
        <div className="overflow-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 font-medium">Guest</th>
                <th className="py-1.5 pr-3 font-medium">Installment</th>
                <th className="py-1.5 pr-3 font-medium">Amount</th>
                <th className="py-1.5 pr-3 font-medium">Due date</th>
              </tr>
            </thead>
            <tbody>
              {preview.would_send.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <Badge variant={r.type === 'payment_overdue' ? 'destructive' : 'secondary'}>
                      {r.type === 'payment_overdue' ? 'Overdue' : 'Upcoming'}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-3">{r.first_name || r.recipient}</td>
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="py-1.5 pr-3">€{Number(r.amount_due).toFixed(2)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
