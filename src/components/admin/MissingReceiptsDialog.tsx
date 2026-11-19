import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Copy, Mail } from "lucide-react";

/**
 * Relance mensuelle des tickets manquants (18 nov 2026, demande Geoffroy).
 * Le 1er jour ouvrable du mois, on génère pour chaque payer (porteur de
 * carte) un message listant ses dépenses CARTE du mois précédent sans
 * justificatif. Il ajoute ses tickets dans l'app Revolut (Expenses) : le
 * cron revolut-receipts-backfill les rapatrie et les lie tout seul.
 * Les virements (Bills, payer vide) ne sont pas relancés : leur facture est
 * dans Revolut Bills, c'est l'équipe compta qui les traite.
 */

export type MissingItem = {
  id: string; date: string; description: string | null; amount: number;
  payer: string | null; method: string | null;
  currency?: string | null; category?: string | null; event?: string | null;
};

type Lang = "en" | "fr" | "pt";
const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
};
const DAYS: Record<Lang, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  fr: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
  pt: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"],
};
const SHORT: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
};

const eur = (n: number) => `€${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number, cur?: string | null) => (!cur || cur === "EUR" ? eur(n)
  : `${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);
// "Lois Marc D Hemeleers" -> "Lois" ; "Card •5673" -> "" (porteur inconnu)
const firstName = (payer: string) => (/^card\b/i.test(payer.trim()) ? "" : payer.trim().split(/\s+/)[0]);
const cleanDesc = (d: string | null) => (d ?? "").replace(/^(to|à)\s+/i, "").trim() || "Payment";

// Échéance (19 nov 2026, demande Geoffroy) : le 8 du mois qui suit le mois
// des dépenses. Si cette date est déjà passée (relance tardive) ou pour
// « All months » : le prochain 8 à venir.
const dueDateObj = (month: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next8 = new Date(today.getFullYear(), today.getMonth() + (today.getDate() > 8 ? 1 : 0), 8);
  if (month === "all") return next8;
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 8); // m (1-based) = mois suivant en index 0-based
  return d < today ? next8 : d;
};
const dueDate = (lang: Lang, month: string) => {
  const d = dueDateObj(month);
  return `${d.getDate()} ${MONTHS[lang][d.getMonth()]}`;
};
const LBL: Record<Lang, { card: string; cat: string; event: string }> = {
  en: { card: "card payment", cat: "category", event: "event" },
  fr: { card: "paiement carte", cat: "catégorie", event: "événement" },
  pt: { card: "pagamento com cartão", cat: "categoria", event: "evento" },
};
// Détail maximal par paiement pour que le payer le retrouve dans Revolut :
// jour de la semaine, date complète, libellé tel que Revolut l'affiche,
// montant (devise d'origine), puis catégorie et événement s'ils sont connus.
const itemLines = (lang: Lang, t: MissingItem) => {
  const d = new Date(`${t.date.slice(0, 10)}T12:00:00`);
  const head = `• ${DAYS[lang][d.getDay()]} ${d.getDate()} ${SHORT[lang][d.getMonth()]} ${d.getFullYear()} · ${cleanDesc(t.description)} · ${money(t.amount, t.currency)}`;
  const extra = [LBL[lang].card, t.category ? `${LBL[lang].cat}: ${t.category}` : "", t.event ? `${LBL[lang].event}: ${t.event}` : ""].filter(Boolean).join(" · ");
  return `${head}\n   ${extra}`;
};

function buildMessage(lang: Lang, payer: string, month: string, items: MissingItem[]) {
  const all = month === "all";
  const [y, m] = all ? [0, 1] : month.split("-").map(Number);
  const monthName = all ? "" : `${MONTHS[lang][m - 1]} ${y}`;
  const name = firstName(payer);
  const lines = items
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => itemLines(lang, t))
    .join("\n");
  const total = eur(items.reduce((s, t) => s + Math.abs(t.amount), 0));
  if (lang === "fr") return `Salut${name ? ` ${name}` : ""},

Petit point tickets${all ? "" : ` pour ${monthName}`} : ${items.length === 1 ? "ce paiement par carte n'a" : `ces ${items.length} paiements par carte n'ont`} pas encore de ticket dans Revolut (${total}).

${lines}

Tu peux ajouter la photo de chaque ticket directement sur la transaction dans l'app Revolut (ouvre le paiement, puis « Ajouter un reçu ») d'ici le ${dueDate(lang, month)} ? Si un paiement n'a jamais eu de ticket, réponds-moi juste en disant à quoi il correspondait.

Merci !`;
  if (lang === "pt") return `Olá${name ? ` ${name}` : ""},

Ponto de situação dos talões${all ? "" : ` de ${monthName}`}: ${items.length === 1 ? "este pagamento com cartão ainda não tem" : `estes ${items.length} pagamentos com cartão ainda não têm`} talão no Revolut (${total}).

${lines}

Podes juntar a foto de cada talão diretamente na transação na app Revolut (abre o pagamento e depois « Adicionar recibo ») até ${dueDate(lang, month)}? Se algum pagamento não teve talão, responde-me só a dizer a que corresponde.

Obrigado!`;
  return `Hi${name ? ` ${name}` : ""},

Quick receipt check${all ? "" : ` for ${monthName}`}: ${items.length === 1 ? "this card payment still has" : `these ${items.length} card payments still have`} no receipt in Revolut (${total}).

${lines}

Could you add a photo of each receipt to the transaction in the Revolut app (open the payment, then "Add receipt") by ${dueDate(lang, month)}? If a payment never had a receipt, just reply and tell me what it was for.

Thanks!`;
}

export function MissingReceiptsDialog({ open, onOpenChange, items }: {
  open: boolean; onOpenChange: (v: boolean) => void; items: MissingItem[];
}) {
  const { toast } = useToast();
  const prevMonth = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const months = useMemo(() => [...new Set([prevMonth, ...items.map((t) => t.date.slice(0, 7))])].sort().reverse(), [items, prevMonth]);
  const [month, setMonth] = useState(prevMonth);
  const [lang, setLang] = useState<Lang>("en");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const inMonth = useMemo(() => (month === "all" ? items : items.filter((t) => t.date.startsWith(month))), [items, month]);
  const byPayer = useMemo(() => {
    const m = new Map<string, MissingItem[]>();
    inMonth.filter((t) => t.payer && t.method !== "transfer").forEach((t) => {
      const k = t.payer as string;
      m.set(k, [...(m.get(k) ?? []), t]);
    });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [inMonth]);
  const transfers = inMonth.filter((t) => !t.payer || t.method === "transfer");

  // Messages régénérés quand le mois ou la langue change (les éditions à la
  // main sont perdues à ce moment-là, c'est voulu).
  useEffect(() => {
    const d: Record<string, string> = {};
    byPayer.forEach(([p, list]) => { d[p] = buildMessage(lang, p, month, [...list]); });
    setDrafts(d);
  }, [byPayer, lang, month]);

  const copy = async (p: string) => {
    try { await navigator.clipboard.writeText(drafts[p] ?? ""); toast({ title: "Message copied", description: `Paste it to ${p}.` }); }
    catch { toast({ title: "Copy failed", description: "Select the text and copy it by hand.", variant: "destructive" }); }
  };
  const subject = () => {
    const base = lang === "fr" ? "Tickets manquants" : lang === "pt" ? "Talões em falta" : "Missing receipts";
    if (month === "all") return base;
    const [y, m] = month.split("-").map(Number);
    return `${base} ${MONTHS[lang][m - 1]} ${y}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ask payers for missing receipts</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          One message per card holder, listing their card expenses with no receipt. They add the receipts in the Revolut app;
          the daily Revolut sync brings them here and links them automatically (usually the next morning).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">All months</option>
            {months.map((m) => {
              const [y, mm] = m.split("-").map(Number);
              return <option key={m} value={m}>{MONTHS.en[mm - 1]} {y}{m === prevMonth ? " (last month)" : ""}</option>;
            })}
          </select>
          <div className="flex rounded-full border border-border bg-card p-0.5">
            {(["en", "fr", "pt"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${lang === l ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {byPayer.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            No card expense without a receipt for this month.
          </div>
        )}

        <div className="space-y-4">
          {byPayer.map(([p, list]) => (
            <div key={p} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{p}</span>
                <span className="text-xs text-muted-foreground">
                  {list.length} expense{list.length > 1 ? "s" : ""} · {eur(list.reduce((s, t) => s + Math.abs(t.amount), 0))}
                </span>
                {/^card\b/i.test(p) && (
                  <span className="text-[11px] rounded-full bg-[#FDF1E0] text-[#B45309] px-2 py-0.5">card holder unknown</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => copy(p)}>
                    <Copy className="w-3.5 h-3.5 mr-1" />Copy
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" asChild>
                    <a href={`mailto:?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(drafts[p] ?? "")}`}>
                      <Mail className="w-3.5 h-3.5 mr-1" />Email
                    </a>
                  </Button>
                </span>
              </div>
              <Textarea rows={Math.min(40, (drafts[p] ?? "").split("\n").length + 1)} className="text-xs font-mono"
                value={drafts[p] ?? ""} onChange={(e) => setDrafts({ ...drafts, [p]: e.target.value })} />
            </div>
          ))}
        </div>

        {transfers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not included: {transfers.length} bank transfer{transfers.length > 1 ? "s" : ""} (Revolut Bills) without a receipt{month === "all" ? "" : " this month"}.
            Their invoice lives in Revolut Bills, so the accounting team handles them (filter 🏦 Bills / transfers).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
