import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { isAdminEmail } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Download, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

type Profile = {
  user_id: string; first_name: string | null; last_name: string | null;
  full_name: string; email: string;
  check_in_date: string | null; check_out_date: string | null;
  guests_count: number; status_overall: string; submitted_at: string | null;
};

type Room = { user_id: string; email: string; queen_shared_qty: number; twins_shared_qty: number; queen_ensuite_qty: number; twins_ensuite_qty: number; remarks_roomsetup: string | null; remarks: string | null; status_roomsetup: string };
type Trip = { user_id: string; trip_direction: string; pickup_location: string; dropoff_location: string; trip_date: string; trip_time: string; passengers_count: number; taxi_size: string; price_estimate: string };
type FoodPlan = { user_id: string; selections: any; diet_preference: string | null; status_food: string };

interface Data {
  profiles: Profile[]; rooms: Room[]; trips: Trip[]; food: FoodPlan[];
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, rows: any[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const AdminContent = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted">("all");

  if (!isAdminEmail(user?.email)) return <Navigate to="/dashboard" replace />;

  const load = async () => {
    setLoading(true);
    const res = await supabase.functions.invoke("admin-list-data");
    if (res.error) {
      toast({ title: "Error", description: res.error.message, variant: "destructive" });
    } else {
      setData(res.data as Data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    const res = await supabase.functions.invoke("sync-google-sheets");
    setSyncing(false);
    if (res.error) toast({ title: "Sync failed", description: res.error.message, variant: "destructive" });
    else toast({ title: "Synced to Google Sheets" });
  };

  const profileById = useMemo(() => new Map((data?.profiles || []).map((p) => [p.user_id, p])), [data]);
  const guestName = (uid: string) => {
    const p = profileById.get(uid);
    if (!p) return "Unknown";
    return p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email;
  };

  const filteredProfiles = useMemo(() => {
    if (!data) return [];
    const s = search.toLowerCase().trim();
    return data.profiles.filter((p) => {
      if (statusFilter !== "all" && p.status_overall !== statusFilter) return false;
      if (!s) return true;
      return (
        (p.full_name || "").toLowerCase().includes(s) ||
        (p.email || "").toLowerCase().includes(s) ||
        (p.first_name || "").toLowerCase().includes(s) ||
        (p.last_name || "").toLowerCase().includes(s)
      );
    });
  }, [data, search, statusFilter]);

  const toolStatus = (uid: string) => {
    const room = data?.rooms.find((r) => r.user_id === uid);
    const trip = data?.trips.find((t) => t.user_id === uid);
    const food = data?.food.find((f) => f.user_id === uid);
    const hasFood = food?.selections && Array.isArray(food.selections) &&
      (food.selections as any[]).some((s: any) => s.fullBoard || s.breakfast || s.lunch || s.dinner);
    return {
      room: room ? room.status_roomsetup : "—",
      trip: trip ? "set" : "—",
      food: hasFood ? (food?.status_food || "draft") : "—",
    };
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-medium">Admin · Quinta do Amor</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            <Button size="sm" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Sync to Google Sheets
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="overview">
          <TabsList className="mb-4 flex flex-wrap">
            <TabsTrigger value="overview">Guests Overview</TabsTrigger>
            <TabsTrigger value="food">Food Planning</TabsTrigger>
            <TabsTrigger value="transport">Transportation</TabsTrigger>
            <TabsTrigger value="rooms">Room Setup</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="flex flex-wrap gap-2 mb-3">
              <Input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="border border-border rounded-md px-3 py-2 text-sm bg-background">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => downloadCSV("guests.csv", [
                ["First name","Last name","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status","Submitted at"],
                ...filteredProfiles.map((p) => {
                  const ts = toolStatus(p.user_id);
                  return [p.first_name||"", p.last_name||"", p.email, p.check_in_date||"", p.check_out_date||"", p.guests_count, ts.room, ts.food, ts.trip, p.status_overall, p.submitted_at||""];
                }),
              ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
            </div>
            <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    {["First","Last","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.map((p) => {
                    const ts = toolStatus(p.user_id);
                    return (
                      <tr key={p.user_id} className="border-t border-border hover:bg-muted/40">
                        <td className="px-3 py-2">{p.first_name}</td>
                        <td className="px-3 py-2">{p.last_name}</td>
                        <td className="px-3 py-2">{p.email}</td>
                        <td className="px-3 py-2">{p.check_in_date}</td>
                        <td className="px-3 py-2">{p.check_out_date}</td>
                        <td className="px-3 py-2">{p.guests_count}</td>
                        <td className="px-3 py-2">{ts.room}</td>
                        <td className="px-3 py-2">{ts.food}</td>
                        <td className="px-3 py-2">{ts.trip}</td>
                        <td className="px-3 py-2">{p.status_overall}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="food">
            <FoodView data={data} guestName={guestName} />
          </TabsContent>

          <TabsContent value="transport">
            <TransportView data={data} guestName={guestName} />
          </TabsContent>

          <TabsContent value="rooms">
            <RoomsView data={data} guestName={guestName} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

function FoodView({ data, guestName }: { data: Data; guestName: (u: string) => string }) {
  const rows = useMemo(() => {
    const out: { date: string; guest: string; guests: number; diet: string; meals: string }[] = [];
    for (const fp of data.food) {
      const sels = Array.isArray(fp.selections) ? fp.selections : [];
      const p = data.profiles.find((pp) => pp.user_id === fp.user_id);
      const gc = p?.guests_count ?? 1;
      for (const s of sels as any[]) {
        const meals = s.fullBoard ? "Full board" : ["breakfast","lunch","dinner"].filter((m) => s[m]).join(", ");
        if (!meals) continue;
        out.push({ date: s.date, guest: guestName(fp.user_id), guests: gc, diet: fp.diet_preference || "", meals });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [data, guestName]);

  const totalsByDate = useMemo(() => {
    const map = new Map<string, { breakfast: number; lunch: number; dinner: number; fullBoard: number }>();
    for (const fp of data.food) {
      const p = data.profiles.find((pp) => pp.user_id === fp.user_id);
      const gc = p?.guests_count ?? 1;
      const sels = Array.isArray(fp.selections) ? fp.selections : [];
      for (const s of sels as any[]) {
        const t = map.get(s.date) || { breakfast: 0, lunch: 0, dinner: 0, fullBoard: 0 };
        if (s.fullBoard) t.fullBoard += gc;
        else { if (s.breakfast) t.breakfast += gc; if (s.lunch) t.lunch += gc; if (s.dinner) t.dinner += gc; }
        map.set(s.date, t);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => downloadCSV("food.csv", [
          ["Date","Guest","Guests","Diet","Meals"],
          ...rows.map((r) => [r.date, r.guest, r.guests, r.diet, r.meals]),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>
      <div className="overflow-auto border border-border rounded-lg bg-card max-h-[40vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Date","Guest","Guests","Diet","Meals"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.guest}</td>
                <td className="px-3 py-2">{r.guests}</td>
                <td className="px-3 py-2">{r.diet}</td>
                <td className="px-3 py-2">{r.meals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="font-medium mt-6">Totals per day</h3>
      <div className="overflow-auto border border-border rounded-lg bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Date","Breakfast","Lunch","Dinner","Full board"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {totalsByDate.map(([date, t]) => (
              <tr key={date} className="border-t border-border">
                <td className="px-3 py-2">{date}</td>
                <td className="px-3 py-2">{t.breakfast}</td>
                <td className="px-3 py-2">{t.lunch}</td>
                <td className="px-3 py-2">{t.dinner}</td>
                <td className="px-3 py-2">{t.fullBoard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransportView({ data, guestName }: { data: Data; guestName: (u: string) => string }) {
  const rows = useMemo(() =>
    [...data.trips].sort((a, b) => `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`)),
    [data]
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => downloadCSV("transport.csv", [
          ["Date","Time","Guest","Direction","Pickup","Dropoff","Taxi","Passengers","Price","Custom"],
          ...rows.map((t) => [t.trip_date, t.trip_time, guestName(t.user_id), t.trip_direction, t.pickup_location, t.dropoff_location, t.taxi_size, t.passengers_count, t.price_estimate, t.price_estimate?.toLowerCase().includes("custom") ? "yes" : ""]),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>
      <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Date","Time","Guest","Direction","Pickup","Dropoff","Taxi","Pax","Price"].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{t.trip_date}</td>
                <td className="px-3 py-2">{t.trip_time}</td>
                <td className="px-3 py-2">{guestName(t.user_id)}</td>
                <td className="px-3 py-2">{t.trip_direction}</td>
                <td className="px-3 py-2">{t.pickup_location}</td>
                <td className="px-3 py-2">{t.dropoff_location}</td>
                <td className="px-3 py-2">{t.taxi_size}</td>
                <td className="px-3 py-2">{t.passengers_count}</td>
                <td className="px-3 py-2">{t.price_estimate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoomsView({ data, guestName }: { data: Data; guestName: (u: string) => string }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => downloadCSV("rooms.csv", [
          ["Guest","Email","Queen shared","Twin shared","Queen ensuite","Twin ensuite","Remarks"],
          ...data.rooms.map((r) => [guestName(r.user_id), r.email, r.queen_shared_qty, r.twins_shared_qty, r.queen_ensuite_qty, r.twins_ensuite_qty, r.remarks_roomsetup || r.remarks || ""]),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>
      <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Guest","Queen shared","Twin shared","Queen ensuite","Twin ensuite","Remarks"].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {data.rooms.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{guestName(r.user_id)}</td>
                <td className="px-3 py-2">{r.queen_shared_qty}</td>
                <td className="px-3 py-2">{r.twins_shared_qty}</td>
                <td className="px-3 py-2">{r.queen_ensuite_qty}</td>
                <td className="px-3 py-2">{r.twins_ensuite_qty}</td>
                <td className="px-3 py-2">{r.remarks_roomsetup || r.remarks || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Admin = () => (
  <ProtectedRoute>
    <AdminContent />
  </ProtectedRoute>
);

export default Admin;
