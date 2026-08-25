import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Plus, Pencil, Trash2, Send, Mail } from 'lucide-react';

// Moteur d'emails automatiques : les règles vivent dans email_rules, l'Edge
// Function email-rules-run les évalue chaque matin (08:05 UTC). Cette carte
// permet de créer/éditer les règles, voir les envois du jour et tester.

interface EmailRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  offset_days: number;
  event_type_filter: string | null;
  subject: string;
  body: string;
  cta: string;
  cta_label: string | null;
  cta_url: string | null;
  payment_filter: string;
}

interface PreviewMatch {
  rule_id: string;
  rule_name: string;
  rule_enabled: boolean;
  booking_id: string;
  recipient: string | null;
  label: string;
  installment_id: string | null;
  installment_label: string | null;
  amount: number | null;
  subject: string;
  already_sent: boolean;
}

// Historique des emails déjà partis pour une échéance (reminder_log) — repris
// de l'ancienne carte "Automatic payment reminders" pour garder la vue
// "dois-je encore envoyer quelque chose ?".
interface SentLogEntry { type: string; status: string | null; created_at: string }
const SENT_LABEL: Record<string, string> = {
  payment_request: 'Request',
  payment_manual: 'Manual reminder',
  payment_upcoming: 'Auto reminder',
  payment_overdue: 'Auto follow-up',
  payment_receipt: 'Confirmation',
};
const fmtShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const TRIGGER_LABEL: Record<string, string> = {
  check_in: 'check-in',
  check_out: 'check-out',
  due_date: 'payment due date',
};

const EVENT_TYPES = ['retreat', 'wedding', 'other', 'day_retreat'];

const VARIABLES_HINT =
  '{{first_name}} {{name}} {{retreat_name}} {{check_in_date}} {{check_out_date}} {{amount}} {{label}} {{due_date}} {{next_due_date}} {{next_amount}} {{balance}}';

const PAYMENT_FILTER_LABEL: Record<string, string> = {
  any: 'any payment',
  deposit: 'deposit (first rental payment)',
  final: 'final payment (settles the stay)',
};

function describeRule(r: EmailRule): string {
  if (r.trigger === 'payment_received') {
    return `When a payment is received — ${PAYMENT_FILTER_LABEL[r.payment_filter] ?? r.payment_filter}`;
  }
  const t = TRIGGER_LABEL[r.trigger] ?? r.trigger;
  if (r.offset_days === 0) return `On the day of ${t}`;
  const n = Math.abs(r.offset_days);
  return `${n} day${n === 1 ? '' : 's'} ${r.offset_days < 0 ? 'before' : 'after'} ${t}`;
}

interface EditorState {
  id: string | null;
  name: string;
  trigger: string;
  offsetAbs: string;
  direction: 'before' | 'after';
  eventType: string; // 'any' ou un type
  subject: string;
  body: string;
  cta: string;
  ctaLabel: string;
  ctaUrl: string;
  paymentFilter: string;
}

const EMPTY_EDITOR: EditorState = {
  id: null, name: '', trigger: 'check_in', offsetAbs: '3', direction: 'before',
  eventType: 'any', subject: '', body: '', cta: 'none', ctaLabel: '', ctaUrl: '',
  paymentFilter: 'any',
};

export function AutomatedEmailsCard() {
  const { toast } = useToast();
  const [rules, setRules] = useState<EmailRule[]>([]);
  const [matches, setMatches] = useState<PreviewMatch[]>([]);
  const [sentByInst, setSentByInst] = useState<Map<string, SentLogEntry[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadPreview = useCallback(async (hasRules: boolean) => {
    if (!hasRules) { setMatches([]); setSentByInst(new Map()); return; }
    setPreviewLoading(true);
    const { data, error } = await supabase.functions.invoke('email-rules-run', {
      body: { preview: true },
    });
    setPreviewLoading(false);
    const list = !error && data?.matches ? (data.matches as PreviewMatch[]) : [];
    setMatches(list);
    // Historique des emails de paiement déjà envoyés pour ces échéances
    const ids = [...new Set(list.map((m) => m.installment_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: logs } = await supabase
        .from('reminder_log')
        .select('installment_id,type,status,created_at')
        .in('installment_id', ids)
        .order('created_at', { ascending: false });
      const map = new Map<string, SentLogEntry[]>();
      for (const l of (logs ?? []) as any[]) {
        const arr = map.get(l.installment_id) || [];
        arr.push({ type: l.type, status: l.status, created_at: l.created_at });
        map.set(l.installment_id, arr);
      }
      setSentByInst(map);
    } else {
      setSentByInst(new Map());
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_rules')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      toast({ title: 'Could not load email rules', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const list = (data ?? []) as EmailRule[];
    setRules(list);
    setLoading(false);
    // L'aperçu couvre TOUTES les règles, y compris désactivées (dry-run).
    loadPreview(list.length > 0);
  }, [toast, loadPreview]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => setEditor({ ...EMPTY_EDITOR });
  const openEdit = (r: EmailRule) => setEditor({
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    offsetAbs: String(Math.abs(r.offset_days)),
    direction: r.offset_days > 0 ? 'after' : 'before',
    eventType: r.event_type_filter ?? 'any',
    subject: r.subject,
    body: r.body,
    cta: r.cta,
    ctaLabel: r.cta_label ?? '',
    ctaUrl: r.cta_url ?? '',
    paymentFilter: r.payment_filter ?? 'any',
  });

  const saveEditor = async () => {
    if (!editor) return;
    if (!editor.name.trim() || !editor.subject.trim() || !editor.body.trim()) {
      toast({ title: 'Name, subject and body are required', variant: 'destructive' });
      return;
    }
    if (editor.cta === 'custom' && !/^https?:\/\//i.test(editor.ctaUrl.trim())) {
      toast({ title: 'The button link must be a full URL (https://…)', variant: 'destructive' });
      return;
    }
    const abs = Math.min(365, Math.max(0, Math.round(Number(editor.offsetAbs) || 0)));
    const offset = editor.trigger === 'payment_received'
      ? 0
      : editor.direction === 'before' ? -abs : abs;
    const payload = {
      name: editor.name.trim(),
      trigger: editor.trigger,
      offset_days: offset,
      payment_filter: editor.trigger === 'payment_received' ? editor.paymentFilter : 'any',
      event_type_filter: editor.eventType === 'any' ? null : editor.eventType,
      subject: editor.subject.trim(),
      body: editor.body,
      cta: editor.cta,
      cta_label: editor.cta === 'custom' ? (editor.ctaLabel.trim() || null) : null,
      cta_url: editor.cta === 'custom' ? editor.ctaUrl.trim() : null,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const res = editor.id
      ? await supabase.from('email_rules').update(payload).eq('id', editor.id)
      : await supabase.from('email_rules').insert(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: 'Could not save the rule', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editor.id ? 'Rule updated' : 'Rule created — enable it when ready' });
    setEditor(null);
    load();
  };

  const toggleRule = async (r: EmailRule, next: boolean) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)));
    const { error } = await supabase.from('email_rules')
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (error) {
      toast({ title: 'Could not update the rule', description: error.message, variant: 'destructive' });
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !next } : x)));
      return;
    }
    loadPreview(true);
  };

  const deleteRule = async (r: EmailRule) => {
    if (!window.confirm(`Delete the rule "${r.name}"? Its send history will be removed too.`)) return;
    const { error } = await supabase.from('email_rules').delete().eq('id', r.id);
    if (error) {
      toast({ title: 'Could not delete the rule', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Rule deleted' });
    load();
  };

  const sendTest = async (r: EmailRule) => {
    const { data: { user } } = await supabase.auth.getUser();
    const to = user?.email;
    if (!to) {
      toast({ title: 'Could not determine your email address', variant: 'destructive' });
      return;
    }
    setTestingId(r.id);
    const { data, error } = await supabase.functions.invoke('email-rules-run', {
      body: { test: { rule_id: r.id, to } },
    });
    setTestingId(null);
    if (error || data?.error) {
      toast({ title: 'Test email failed', description: error?.message || data?.error, variant: 'destructive' });
      return;
    }
    toast({ title: `Test sent to ${to}`, description: data?.subject });
  };

  return (
    <section className="mb-6 border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold">Automated emails</h3>
          {rules.length > 0 && (
            <Badge variant="secondary">
              {rules.filter((r) => r.enabled).length}/{rules.length} active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openNew} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New rule
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mt-1">
        Your own automated emails: pick a trigger (before/after check-in, check-out or a payment
        due date — or the moment a payment is received), write the message with variables, and
        enable the rule. Date-based rules go out once a day at 08:05 UTC, payment confirmations
        right after the payment — never twice for the same booking or installment.
      </p>

      {!loading && rules.length === 0 && (
        <p className="text-sm text-muted-foreground mt-3">
          No rules yet. Create one — for example arrival info 7 days before check-in, a payment
          reminder 3 days before each due date, or a feedback form 2 days after check-out.
        </p>
      )}

      {rules.length > 0 && (
        <div className="mt-3 divide-y divide-border border border-border rounded-md">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => toggleRule(r, v)}
                aria-label={`Enable ${r.name}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium text-sm ${r.enabled ? '' : 'text-muted-foreground'}`}>{r.name}</span>
                  {r.event_type_filter && (
                    <Badge variant="outline" className="text-[11px]">{r.event_type_filter.replace('_', ' ')}</Badge>
                  )}
                  {r.cta !== 'none' && (
                    <Badge variant="secondary" className="text-[11px]">
                      {r.cta === 'pay' ? 'Pay button'
                        : r.cta === 'custom' ? `Button: ${r.cta_label || 'link'}`
                        : 'Guest Area button'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {describeRule(r)} · “{r.subject}”
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs" disabled={testingId === r.id} onClick={() => sendTest(r)} title="Send a rendered sample to your own inbox">
                  {testingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteRule(r)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Preview — what matches today{previewLoading ? '…' : matches.length === 0 ? ': nothing.' : ' (disabled rules included, they won’t send):'}
          </p>
          {matches.length > 0 && (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Rule</th>
                    <th className="py-1.5 pr-3 font-medium">Booking</th>
                    <th className="py-1.5 pr-3 font-medium">Recipient</th>
                    <th className="py-1.5 pr-3 font-medium">Subject</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Emails sent</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => {
                    const logs = m.installment_id ? (sentByInst.get(m.installment_id) ?? []) : [];
                    const sentLogs = logs.filter((l) => l.status !== 'error');
                    const byType = new Map<string, { count: number; last: string }>();
                    for (const l of sentLogs) {
                      const cur = byType.get(l.type);
                      if (cur) cur.count += 1;
                      else byType.set(l.type, { count: 1, last: l.created_at });
                    }
                    const tooltip = sentLogs
                      .map((l) => `${SENT_LABEL[l.type] ?? l.type} — ${fmtShortDate(l.created_at)}`)
                      .join('\n');
                    return (
                      <tr key={i} className={`border-t border-border ${m.rule_enabled ? '' : 'opacity-60'}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{m.rule_name}</td>
                        <td className="py-1.5 pr-3">{m.label}{m.installment_label ? ` — ${m.installment_label}` : ''}</td>
                        <td className="py-1.5 pr-3">{m.recipient}</td>
                        <td className="py-1.5 pr-3">{m.subject}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {m.already_sent ? (
                            <Badge variant="secondary">Sent</Badge>
                          ) : !m.rule_enabled ? (
                            <Badge variant="outline">Rule off</Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Will send at 08:05 UTC</Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-3" title={tooltip || undefined}>
                          {!m.installment_id ? (
                            <span className="text-muted-foreground">—</span>
                          ) : sentLogs.length === 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-medium whitespace-nowrap">
                              No email yet
                            </span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {[...byType.entries()].map(([type, info]) => (
                                <span
                                  key={type}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full border border-border bg-muted text-[11px] font-medium whitespace-nowrap text-foreground"
                                >
                                  ✉ {SENT_LABEL[type] ?? type}{info.count > 1 ? ` ×${info.count}` : ''} · {fmtShortDate(info.last)}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? 'Edit rule' : 'New automated email'}</DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-name">Name</Label>
                <Input
                  id="rule-name"
                  placeholder="e.g. Payment reminder J-3"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <Select value={editor.trigger} onValueChange={(v) => setEditor({ ...editor, trigger: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check_in">Before / after check-in</SelectItem>
                    <SelectItem value="check_out">Before / after check-out</SelectItem>
                    <SelectItem value="due_date">Before / after a payment due date</SelectItem>
                    <SelectItem value="payment_received">When a payment is received (confirmation)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editor.trigger === 'payment_received' ? (
                <div className="space-y-1.5">
                  <Label>Which payment</Label>
                  <Select value={editor.paymentFilter} onValueChange={(v) => setEditor({ ...editor, paymentFilter: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deposit">Deposit (first rental payment)</SelectItem>
                      <SelectItem value="final">Final payment (settles the whole stay)</SelectItem>
                      <SelectItem value="any">Any payment</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Sent right after the payment, with the invoice attached automatically. One
                    confirmation per payment — the most specific rule wins; if no rule matches,
                    the standard confirmation is sent instead.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Days</Label>
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={editor.offsetAbs}
                      onChange={(e) => setEditor({ ...editor, offsetAbs: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>When</Label>
                    <Select value={editor.direction} onValueChange={(v) => setEditor({ ...editor, direction: v as 'before' | 'after' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="before">before</SelectItem>
                        <SelectItem value="after">after</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Booking type</Label>
                  <Select value={editor.eventType} onValueChange={(v) => setEditor({ ...editor, eventType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {EVENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Button</Label>
                  <Select value={editor.cta} onValueChange={(v) => setEditor({ ...editor, cta: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No button</SelectItem>
                      <SelectItem value="guest_area">Open Guest Area</SelectItem>
                      <SelectItem value="pay">Pay (Stripe link)</SelectItem>
                      <SelectItem value="custom">Custom link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {editor.cta === 'custom' && (
                <div className="grid grid-cols-[1fr_1.6fr] gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cta-label">Button text</Label>
                    <Input
                      id="cta-label"
                      placeholder="e.g. Give us feedback"
                      value={editor.ctaLabel}
                      onChange={(e) => setEditor({ ...editor, ctaLabel: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cta-url">Button link</Label>
                    <Input
                      id="cta-url"
                      placeholder="https://forms.gle/…"
                      value={editor.ctaUrl}
                      onChange={(e) => setEditor({ ...editor, ctaUrl: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="rule-subject">Subject</Label>
                <Input
                  id="rule-subject"
                  placeholder="e.g. Your payment for {{retreat_name}} is due soon"
                  value={editor.subject}
                  onChange={(e) => setEditor({ ...editor, subject: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-body">Message</Label>
                <Textarea
                  id="rule-body"
                  rows={9}
                  placeholder={`Hi {{first_name}},\n\nJust a friendly note: the payment of {{amount}} for {{retreat_name}} is due on {{due_date}}.\n\nWarmly,\nGeo`}
                  value={editor.body}
                  onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Variables: <code className="font-mono">{VARIABLES_HINT}</code>. Place the button
                  exactly where you want with <code className="font-mono">{'{{button}}'}</code> —
                  otherwise it appears after the text. Signature (site, phone, links) is added
                  automatically. “Pay” button links each due installment; on check-in/check-out
                  rules it targets the next unpaid installment.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
            <Button onClick={saveEditor} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editor?.id ? 'Save changes' : 'Create rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
