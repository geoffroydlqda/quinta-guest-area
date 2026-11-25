import { supabase } from "@/integrations/supabase/client";

/**
 * Centre de notifications admin (25 nov 2026) — fan-out : une ligne
 * admin_notifications PAR destinataire. Les destinataires sont les comptes
 * ADMIN (admin-staff-access list — la table admin_users est verrouillée en
 * RLS). Best-effort : une notification qui échoue ne casse jamais l'action.
 */
export async function notifyAdmins(opts: {
  message: string;
  type?: string;
  taskId?: string | null;
  /** Emails à ne pas notifier (l'auteur, un destinataire déjà notifié à part…). */
  exclude?: (string | null | undefined)[];
  /** Si fourni, seuls ces emails sont notifiés (ex. l'assigné). */
  only?: string[] | null;
  createdBy?: string | null;
}) {
  try {
    let recipients: string[];
    if (opts.only?.length) {
      recipients = opts.only.map((e) => e.toLowerCase());
    } else {
      const res = await supabase.functions.invoke("admin-staff-access", { body: { action: "list" } });
      recipients = Array.isArray(res.data?.admins)
        ? (res.data.admins as string[]).map((e) => e.toLowerCase())
        : [];
    }
    const excluded = new Set((opts.exclude ?? []).filter(Boolean).map((e) => (e as string).toLowerCase()));
    recipients = [...new Set(recipients)].filter((e) => e && !excluded.has(e));
    if (!recipients.length) return;
    await supabase.from("admin_notifications").insert(recipients.map((e) => ({
      recipient_email: e,
      message: opts.message,
      type: opts.type ?? "task",
      task_id: opts.taskId ?? null,
      created_by: opts.createdBy ?? null,
    })));
  } catch {
    /* best-effort */
  }
}
