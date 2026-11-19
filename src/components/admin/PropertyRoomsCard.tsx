import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, BedDouble, Loader2, Plus, Trash2 } from "lucide-react";
import { PROPERTY_LABEL, type Property } from "@/lib/property";

/**
 * Multi-lieux P3 (19 nov 2026) — gestion des chambres d'un lieu SANS plan
 * dessiné (Terra da Paz). Les 11 chambres de la Quinta restent codées en dur
 * dans l'app (plan, photos, paires de salles de bain) — ce tool ne les gère
 * pas. Les chambres saisies ici (table property_rooms) serviront à la guest
 * area Terra (P4 : room setup en liste) et au récap Housekeeping.
 */

type Room = {
  id: string;
  property: string;
  name: string;
  bed_type: string | null;
  capacity: number;
  bathroom: string;
  note: string | null;
  sort_order: number;
  active: boolean;
};

const BED_SUGGESTIONS = ["King", "Queen", "Twins", "Double", "Single", "Bunk beds", "Dorm"];

export function PropertyRoomsCard({ property }: { property: Property }) {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Formulaire d'ajout
  const [name, setName] = useState("");
  const [bedType, setBedType] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [bathroom, setBathroom] = useState<"en-suite" | "shared">("shared");
  const [note, setNote] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("property_rooms")
      .select("*")
      .eq("property", property)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast({ title: "Could not load rooms", description: error.message, variant: "destructive" });
    setRooms((data as Room[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [property]);

  const activeRooms = useMemo(() => rooms.filter((r) => r.active), [rooms]);
  const totalCapacity = useMemo(() => activeRooms.reduce((s, r) => s + (r.capacity || 0), 0), [activeRooms]);

  const addRoom = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast({ title: "Room name required", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("property_rooms").insert({
      property,
      name: trimmed,
      bed_type: bedType.trim() || null,
      capacity: Math.max(1, Math.min(20, Number(capacity) || 2)),
      bathroom,
      note: note.trim() || null,
      sort_order: rooms.length,
    });
    setSaving(false);
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setName(""); setBedType(""); setCapacity("2"); setNote("");
    toast({ title: `Room "${trimmed}" added` });
    load();
  };

  const patchRoom = async (id: string, patch: Partial<Room>) => {
    const { error } = await supabase.from("property_rooms")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const deleteRoom = async (room: Room) => {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("property_rooms").delete().eq("id", room.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Room "${room.name}" deleted` });
    load();
  };

  // Réordonne : échange avec le voisin puis réécrit sort_order = index pour
  // tout le monde (peu de lignes — simple et robuste aux doublons d'ordre).
  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...rooms];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRooms(next);
    await Promise.all(next.map((r, i) =>
      r.sort_order === i ? null : supabase.from("property_rooms").update({ sort_order: i }).eq("id", r.id)
    ));
  };

  return (
    <div className="bg-card border rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BedDouble className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold">Rooms — {PROPERTY_LABEL[property]}</h3>
        </div>
        <div className="text-sm text-muted-foreground">
          {activeRooms.length} room{activeRooms.length === 1 ? "" : "s"} · sleeps {totalCapacity}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading rooms…
        </div>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No rooms yet — add the first one below. These rooms will power the {PROPERTY_LABEL[property]} guest
          area (bedroom setup) and the housekeeping overview.
        </p>
      ) : (
        <div className="space-y-2">
          {rooms.map((room, idx) => (
            <div
              key={room.id}
              className={`flex flex-wrap items-center gap-2 border rounded-lg px-3 py-2 ${room.active ? "" : "opacity-50"}`}
            >
              <div className="flex flex-col gap-0.5">
                <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => move(idx, 1)} disabled={idx === rooms.length - 1} title="Move down">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <Input
                defaultValue={room.name}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== room.name) patchRoom(room.id, { name: v }); }}
                className="h-8 w-[150px] font-medium"
              />
              <Input
                defaultValue={room.bed_type ?? ""}
                placeholder="Bed type"
                list="qda-bed-types"
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== room.bed_type) patchRoom(room.id, { bed_type: v }); }}
                className="h-8 w-[110px]"
              />
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Input
                  type="number" min={1} max={20}
                  defaultValue={room.capacity}
                  onBlur={(e) => { const v = Math.max(1, Math.min(20, Number(e.target.value) || room.capacity)); if (v !== room.capacity) patchRoom(room.id, { capacity: v }); }}
                  className="h-8 w-[60px]"
                />
                <span>guests</span>
              </div>
              <select
                value={room.bathroom}
                onChange={(e) => patchRoom(room.id, { bathroom: e.target.value })}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="en-suite">En-suite</option>
                <option value="shared">Shared bathroom</option>
              </select>
              <Input
                defaultValue={room.note ?? ""}
                placeholder="Note (floor, view…)"
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== room.note) patchRoom(room.id, { note: v }); }}
                className="h-8 flex-1 min-w-[120px]"
              />
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={room.active} onChange={(e) => patchRoom(room.id, { active: e.target.checked })} />
                Active
              </label>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteRoom(room)} title="Delete room">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <datalist id="qda-bed-types">
        {BED_SUGGESTIONS.map((b) => <option key={b} value={b} />)}
      </datalist>

      <div className="border-t pt-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Room name</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Olive room" className="h-9 w-[150px]" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Bed type</div>
          <Input value={bedType} onChange={(e) => setBedType(e.target.value)} list="qda-bed-types" placeholder="Queen…" className="h-9 w-[110px]" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Guests</div>
          <Input type="number" min={1} max={20} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="h-9 w-[70px]" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Bathroom</div>
          <select value={bathroom} onChange={(e) => setBathroom(e.target.value as "en-suite" | "shared")} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="shared">Shared</option>
            <option value="en-suite">En-suite</option>
          </select>
        </div>
        <div className="space-y-1 flex-1 min-w-[140px]">
          <div className="text-xs text-muted-foreground">Note</div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="h-9" />
        </div>
        <Button onClick={addRoom} disabled={saving} className="h-9">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          Add room
        </Button>
      </div>
    </div>
  );
}
