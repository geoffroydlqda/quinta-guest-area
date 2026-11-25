import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLisbon } from "@/lib/dates";
import { usePropertyFilter, PROPERTY_SHORT } from "@/lib/property";
import { normalizeEmail } from "@/lib/admin";
import { BookUser, FileText, Loader2, Mail, MessageCircle, Pencil, Phone, Plus, Star, Trash2, Upload } from "lucide-react";

/**
 * Onglet Toolbox (25 nov 2026, demande Geoffroy) — la boîte à outils du lieu :
 * - Contacts : fournisseurs & prestataires (catégorie, tél/email/WhatsApp,
 *   ⭐ préféré, lieu quinta/terra/shared), recherche.
 * - Documents : coffre des papiers importants (assurances, contrats,
 *   licences…) dans le bucket privé `toolbox`, avec date de validité et
 *   alerte d'expiration (rouge = expiré, ambre = < 60 jours).
 */

type Contact = {
  id: string; name: string; company: string | null; category: string | null;
  phone: string | null; email: string | null; notes: string | null;
  preferred: boolean; property: string;
};
type Doc = {
  id: string; title: string; category: string | null; property: string;
  storage_path: string; file_name: string | null; mime_type: string | null;
  valid_until: string | null; notes: string | null; created_by: string | null; created_at: string;
};

const DOC_CATEGORIES = ["Insurance", "Contract", "License", "Certificate", "Legal", "Manual", "Other"];
const CONTACT_CATEGORIES = ["Plumber", "Electrician", "Pool", "Garden", "Builder", "Catering supplier", "Transport", "Accounting", "IT", "Other"];

const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, "")}`;

export function ToolboxPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const myEmail = normalizeEmail(user?.email) ?? "";
  const today = todayLisbon();
  const [propertyFilter] = usePropertyFilter();
  const [view, setView] = useState<"contacts" | "documents">("contacts");
  const [loading, setLoading] = useState(true);

  const [contactsAll, setContactsAll] = useState<Contact[]>([]);
  const [docsAll, setDocsAll] = useState<Doc[]>([]);
  const [search, setSearch] = useState("");

  const load = async () => {
    const [c, d] = await Promise.all([
      supabase.from("toolbox_contacts").select("*").order("preferred", { ascending: false }).order("name"),
      supabase.from("toolbox_documents").select("*").order("valid_until", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }),
    ]);
    if (c.error) toast({ title: "Failed to load toolbox", description: c.error.message, variant: "destructive" });
    setContactsAll((c.data as Contact[] | null) ?? []);
    setDocsAll((d.data as Doc[] | null) ?? []);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const scoped = <T extends { property: string }>(arr: T[]) =>
    propertyFilter === "all" ? arr : arr.filter((x) => x.property === propertyFilter || x.property === "shared");
  const q = search.trim().toLowerCase();
  const contacts = useMemo(() => scoped(contactsAll).filter((c) =>
    !q || [c.name, c.company, c.category, c.phone, c.email, c.notes].some((v) => (v ?? "").toLowerCase().includes(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [contactsAll, propertyFilter, q]);
  const docs = useMemo(() => scoped(docsAll).filter((d) =>
    !q || [d.title, d.category, d.file_name, d.notes].some((v) => (v ?? "").toLowerCase().includes(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [docsAll, propertyFilter, q]);

  const expiringSoon = useMemo(() => {
    const in60 = new Date(`${today}T12:00:00`); in60.setDate(in60.getDate() + 60);
    const iso = in60.toISOString().slice(0, 10);
    return scoped(docsAll).filter((d) => d.valid_until && d.valid_until <= iso);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsAll, propertyFilter, today]);

  /* ---------- contacts ---------- */
  const emptyContact = { name: "", company: "", category: "", phone: "", email: "", notes: "", property: "shared" };
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactDraft, setContactDraft] = useState(emptyContact);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  const addContact = async () => {
    if (!contactDraft.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const { error } = await supabase.from("toolbox_contacts").insert({
      name: contactDraft.name.trim(), company: contactDraft.company.trim() || null,
      category: contactDraft.category.trim() || null, phone: contactDraft.phone.trim() || null,
      email: contactDraft.email.trim() || null, notes: contactDraft.notes.trim() || null,
      property: contactDraft.property,
    });
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setContactDraft(emptyContact); setShowAddContact(false); load();
  };

  const patchContact = async (id: string, p: Partial<Contact>) => {
    setContactsAll((arr) => arr.map((c) => (c.id === id ? { ...c, ...p } : c)));
    const { error } = await supabase.from("toolbox_contacts")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const deleteContact = async (c: Contact) => {
    if (!confirm(`Delete contact “${c.name}”?`)) return;
    const { error } = await supabase.from("toolbox_contacts").delete().eq("id", c.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  /* ---------- documents ---------- */
  const emptyDoc = { title: "", category: "Insurance", valid_until: "", notes: "", property: "shared" };
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [docDraft, setDocDraft] = useState(emptyDoc);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);

  // Édition inline d'un document (25 nov 2026, demande Geoffroy) — titre,
  // catégorie, lieu, échéance de validité, notes. Le fichier lui-même ne
  // change pas (supprimer + re-uploader pour ça). Pas d'updated_at sur cette
  // table.
  const patchDoc = async (id: string, p: Partial<Doc>) => {
    setDocsAll((arr) => arr.map((d) => (d.id === id ? { ...d, ...p } : d)));
    const { error } = await supabase.from("toolbox_documents").update(p).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const addDoc = async () => {
    if (!docFile) { toast({ title: "Pick a file", variant: "destructive" }); return; }
    const title = docDraft.title.trim() || docFile.name.replace(/\.[^.]+$/, "");
    setUploading(true);
    try {
      const safe = docFile.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${docDraft.property}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from("toolbox").upload(path, docFile, { contentType: docFile.type || undefined });
      if (up.error) throw up.error;
      const { error } = await supabase.from("toolbox_documents").insert({
        title, category: docDraft.category || null, property: docDraft.property,
        storage_path: path, file_name: docFile.name, mime_type: docFile.type || null,
        valid_until: docDraft.valid_until || null, notes: docDraft.notes.trim() || null,
        created_by: myEmail || null,
      });
      if (error) throw error;
      setDocDraft(emptyDoc); setDocFile(null); setShowAddDoc(false);
      toast({ title: `“${title}” stored` });
      load();
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setUploading(false); }
  };

  const openDoc = async (d: Doc) => {
    const { data, error } = await supabase.storage.from("toolbox").createSignedUrl(d.storage_path, 3600);
    if (error || !data?.signedUrl) { toast({ title: "Could not open", description: error?.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const deleteDoc = async (d: Doc) => {
    if (!confirm(`Delete document “${d.title}”? The file is removed too.`)) return;
    await supabase.storage.from("toolbox").remove([d.storage_path]);
    const { error } = await supabase.from("toolbox_documents").delete().eq("id", d.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const validityChip = (d: Doc) => {
    if (!d.valid_until) return null;
    const expired = d.valid_until < today;
    const in60 = new Date(`${today}T12:00:00`); in60.setDate(in60.getDate() + 60);
    const soon = !expired && d.valid_until <= in60.toISOString().slice(0, 10);
    return (
      <span className={`text-xs rounded-full px-2 py-0.5 font-medium whitespace-nowrap ${
        expired ? "bg-[#FFEAE7] text-[#C84B3F]" : soon ? "bg-[#FFF4DC] text-[#9A7B1E]" : "bg-muted text-muted-foreground"
      }`}>
        {expired ? "⚠ expired " : soon ? "expires " : "valid until "}
        {new Date(`${d.valid_until}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
      </span>
    );
  };

  const propertySelect = (value: string, onChange: (v: string) => void, cls = "h-10") => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} rounded-md border border-input bg-background px-3 text-sm`}>
      <option value="shared">Shared (both)</option>
      <option value="quinta">Quinta do Amor</option>
      <option value="terra">Terra da Paz</option>
    </select>
  );

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {expiringSoon.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⏳ <b>{expiringSoon.length} document{expiringSoon.length > 1 ? "s" : ""}</b> expired or expiring within 60 days —{" "}
          {expiringSoon.slice(0, 3).map((d) => d.title).join(", ")}{expiringSoon.length > 3 ? "…" : ""}.{" "}
          <button className="underline" onClick={() => setView("documents")}>Review</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([["contacts", "Contacts", BookUser], ["documents", "Documents", FileText]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setView(k)}
            className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
              view === k ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
            }`}>
            <Icon className="h-3.5 w-3.5" />{label}
            <span className="opacity-70">({k === "contacts" ? contacts.length : docs.length})</span>
          </button>
        ))}
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-[180px] ml-auto" />
        {view === "contacts" ? (
          <Button onClick={() => setShowAddContact((v) => !v)}><Plus className="w-4 h-4 mr-1" /> Add contact</Button>
        ) : (
          <Button onClick={() => setShowAddDoc((v) => !v)}><Upload className="w-4 h-4 mr-1" /> Add document</Button>
        )}
      </div>

      {/* ---------- CONTACTS ---------- */}
      {view === "contacts" && (
        <>
          {showAddContact && (
            <div className="rounded-2xl border border-border bg-card p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input placeholder="Name *" value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} autoFocus />
              <Input placeholder="Company" value={contactDraft.company} onChange={(e) => setContactDraft({ ...contactDraft, company: e.target.value })} />
              <Input placeholder="Category (Plumber…)" list="toolbox-cats" value={contactDraft.category} onChange={(e) => setContactDraft({ ...contactDraft, category: e.target.value })} />
              {propertySelect(contactDraft.property, (v) => setContactDraft({ ...contactDraft, property: v }))}
              <Input placeholder="Phone (+351…)" value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })} />
              <Input placeholder="Email" value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} />
              <Input placeholder="Notes (prices, who recommended…)" className="lg:col-span-2" value={contactDraft.notes} onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })} />
              <div className="flex gap-2 lg:col-span-4 justify-end">
                <Button variant="outline" onClick={() => { setShowAddContact(false); setContactDraft(emptyContact); }}>Cancel</Button>
                <Button onClick={addContact}>Save contact</Button>
              </div>
            </div>
          )}
          {contacts.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              No contacts yet — add your plumbers, electricians and suppliers here.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {contacts.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-card p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => patchContact(c.id, { preferred: !c.preferred })} title={c.preferred ? "Preferred supplier" : "Mark as preferred"}>
                      <Star className={`w-4 h-4 ${c.preferred ? "fill-[#E8B93B] text-[#E8B93B]" : "text-muted-foreground/40"}`} />
                    </button>
                    <span className="font-semibold text-sm flex-1 truncate">{c.name}</span>
                    {c.property !== "shared" && (
                      <span className="text-[10px] font-semibold rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                        {PROPERTY_SHORT[(c.property === "terra" ? "terra" : "quinta")]}
                      </span>
                    )}
                    <button className="text-muted-foreground/60 hover:text-foreground" onClick={() => setEditingContactId(editingContactId === c.id ? null : c.id)} title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="text-muted-foreground/60 hover:text-destructive" onClick={() => deleteContact(c)} title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[c.category, c.company].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {c.phone && (
                      <>
                        <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs rounded-full bg-secondary px-2.5 py-1 hover:bg-primary hover:text-primary-foreground"><Phone className="w-3 h-3" /> Call</a>
                        <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs rounded-full bg-secondary px-2.5 py-1 hover:bg-primary hover:text-primary-foreground"><MessageCircle className="w-3 h-3" /> WhatsApp</a>
                      </>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs rounded-full bg-secondary px-2.5 py-1 hover:bg-primary hover:text-primary-foreground"><Mail className="w-3 h-3" /> Email</a>
                    )}
                  </div>
                  {c.notes && <div className="text-xs text-muted-foreground pt-0.5">{c.notes}</div>}
                  {editingContactId === c.id && (
                    <div className="pt-2 mt-1 border-t border-border/60 grid gap-2">
                      <Input defaultValue={c.name} placeholder="Name"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) patchContact(c.id, { name: v }); }} className="h-8" />
                      <Input defaultValue={c.company ?? ""} placeholder="Company"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.company) patchContact(c.id, { company: v }); }} className="h-8" />
                      <Input defaultValue={c.category ?? ""} placeholder="Category" list="toolbox-cats"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.category) patchContact(c.id, { category: v }); }} className="h-8" />
                      <Input defaultValue={c.phone ?? ""} placeholder="Phone (+351…)"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.phone) patchContact(c.id, { phone: v }); }} className="h-8" />
                      <Input defaultValue={c.email ?? ""} placeholder="Email"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.email) patchContact(c.id, { email: v }); }} className="h-8" />
                      <Input defaultValue={c.notes ?? ""} placeholder="Notes"
                        onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.notes) patchContact(c.id, { notes: v }); }} className="h-8" />
                      {propertySelect(c.property, (v) => patchContact(c.id, { property: v }), "h-8")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <datalist id="toolbox-cats">
            {[...new Set([...CONTACT_CATEGORIES, ...contactsAll.map((c) => c.category ?? "").filter(Boolean)])].map((c) => <option key={c} value={c} />)}
          </datalist>
        </>
      )}

      {/* ---------- DOCUMENTS ---------- */}
      {view === "documents" && (
        <>
          {showAddDoc && (
            <div className="rounded-2xl border border-border bg-card p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                className="lg:col-span-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm" />
              <Input placeholder="Title (defaults to file name)" value={docDraft.title} onChange={(e) => setDocDraft({ ...docDraft, title: e.target.value })} className="lg:col-span-2" />
              <select value={docDraft.category} onChange={(e) => setDocDraft({ ...docDraft, category: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {propertySelect(docDraft.property, (v) => setDocDraft({ ...docDraft, property: v }))}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Valid until</span>
                <Input type="date" value={docDraft.valid_until} onChange={(e) => setDocDraft({ ...docDraft, valid_until: e.target.value })} />
              </div>
              <Input placeholder="Notes" value={docDraft.notes} onChange={(e) => setDocDraft({ ...docDraft, notes: e.target.value })} />
              <div className="flex gap-2 lg:col-span-4 justify-end">
                <Button variant="outline" onClick={() => { setShowAddDoc(false); setDocDraft(emptyDoc); setDocFile(null); }}>Cancel</Button>
                <Button onClick={addDoc} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />} Store document
                </Button>
              </div>
            </div>
          )}
          {docs.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              No documents yet — store insurance policies, contracts and licenses here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Document</th><th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Property</th><th className="px-3 py-2">Validity</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <Fragment key={d.id}>
                    <tr className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2.5">
                        <button className="font-semibold text-left hover:underline" onClick={() => openDoc(d)}>{d.title}</button>
                        <div className="text-xs text-muted-foreground">{d.file_name}{d.notes ? ` · ${d.notes}` : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{d.category ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-[11px] font-semibold rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {d.property === "shared" ? "Shared" : PROPERTY_SHORT[(d.property === "terra" ? "terra" : "quinta")]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{validityChip(d) ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openDoc(d)}>Open</Button>
                        <button className="ml-1 text-muted-foreground/60 hover:text-foreground align-middle" onClick={() => setEditingDocId(editingDocId === d.id ? null : d.id)} title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button className="ml-1 text-muted-foreground/60 hover:text-destructive align-middle" onClick={() => deleteDoc(d)} title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                    {editingDocId === d.id && (
                      <tr className="border-b border-border/50 last:border-0 bg-muted/30">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <Input defaultValue={d.title} placeholder="Title"
                              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.title) patchDoc(d.id, { title: v }); }} className="h-8 lg:col-span-2" />
                            <select value={d.category ?? ""} onChange={(e) => patchDoc(d.id, { category: e.target.value || null })}
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                              <option value="">No category</option>
                              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            {propertySelect(d.property, (v) => patchDoc(d.id, { property: v }), "h-8")}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">Valid until</span>
                              <Input type="date" defaultValue={d.valid_until ?? ""}
                                onBlur={(e) => { const v = e.target.value || null; if (v !== d.valid_until) patchDoc(d.id, { valid_until: v }); }} className="h-8" />
                            </div>
                            <Input defaultValue={d.notes ?? ""} placeholder="Notes"
                              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== d.notes) patchDoc(d.id, { notes: v }); }} className="h-8 lg:col-span-3" />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
