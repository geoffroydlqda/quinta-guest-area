import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAllowedTabs } from "@/hooks/useAllowedTabs";
import {
  LayoutDashboard, CalendarRange, Users, Wallet, Car,
  BedDouble, LogOut, ExternalLink, ChefHat, MoreHorizontal, X, Landmark, UserCog, Package,
  Moon, Sun,
} from "lucide-react";

/**
 * Layout commun de l'espace admin — refonte "light & vibrant" (juillet 2026) :
 * - desktop : sidebar blanche, item actif en pilule verte (#79B84B)
 * - mobile : tab bar fixe en bas (Dashboard, Bookings, Transport, Rooms)
 *   + bouton "More" qui ouvre une feuille avec le reste (Payments, Guests,
 *   Catering, Guest area, Sign out).
 */
/* Sidebar groupée (12 août 2026) : Operations (Catering, Transportation,
   Housekeeping) et Finance (Payments, Accounting — ex-onglet Finance).
   Les clés `tab` ne changent pas : allowed_tabs et routes restent identiques. */
const NAV_GROUPS = [
  { label: null, items: [
    { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, tab: "dashboard" },
    { to: "/admin/bookings", label: "Bookings", icon: CalendarRange, tab: "bookings" },
    { to: "/admin/guests", label: "Guests", icon: Users, tab: "guests" },
  ]},
  { label: "Operations", items: [
    { to: "/admin/catering", label: "Catering", icon: ChefHat, tab: "catering" },
    { to: "/admin/transportation", label: "Transportation", icon: Car, tab: "transportation" },
    { to: "/admin/rooms", label: "Housekeeping", icon: BedDouble, tab: "rooms" },
  ]},
  { label: "Finance", items: [
    { to: "/admin/payments", label: "Payments", icon: Wallet, tab: "payments" },
    { to: "/admin/finance", label: "Accounting", icon: Landmark, tab: "finance" },
    { to: "/admin/products", label: "Products", icon: Package, tab: "products" },
  ]},
  { label: null, items: [
    { to: "/admin/staff", label: "Staff", icon: UserCog, tab: "staff" },
  ]},
] as const;

/* Onglets principaux de la tab bar mobile (choix Geoffroy, 31 juil. 2026) */
const MOBILE_MAIN = [
  { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, tab: "dashboard" },
  { to: "/admin/bookings", label: "Bookings", icon: CalendarRange, tab: "bookings" },
  { to: "/admin/transportation", label: "Transport", icon: Car, tab: "transportation" },
  { to: "/admin/rooms", label: "Housekeep.", icon: BedDouble, tab: "rooms" },
] as const;

const MOBILE_MORE = [
  { to: "/admin/payments", label: "Payments", icon: Wallet, tab: "payments" },
  { to: "/admin/finance", label: "Accounting", icon: Landmark, tab: "finance" },
  { to: "/admin/guests", label: "Guests", icon: Users, tab: "guests" },
  { to: "/admin/catering", label: "Catering", icon: ChefHat, tab: "catering" },
  { to: "/admin/products", label: "Products", icon: Package, tab: "products" },
  { to: "/admin/staff", label: "Staff", icon: UserCog, tab: "staff" },
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  // Dark mode (18 août 2026) — préférence stockée en local, scope admin
  // uniquement (la guest area garde son thème). Classe .dark sur .admin-ui.
  const [dark, setDark] = useState(() => localStorage.getItem("qda-admin-theme") === "dark");
  useEffect(() => { localStorage.setItem("qda-admin-theme", dark ? "dark" : "light"); }, [dark]);
  const location = useLocation();
  // Onglets visibles pour cet admin (onglet Staff) — null = tous
  const { allowed } = useAllowedTabs();
  const visible = <T extends { tab: string }>(items: readonly T[]) =>
    allowed ? items.filter((i) => allowed.has(i.tab)) : [...items];
  const navGroups = NAV_GROUPS
    .map((g) => ({ label: g.label, items: visible(g.items) }))
    .filter((g) => g.items.length > 0);
  const mobileMain = visible(MOBILE_MAIN);
  const mobileMore = visible(MOBILE_MORE);

  const moreActive = mobileMore.some((i) => location.pathname.startsWith(i.to));

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
        : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
    }`;

  // Tab bar flottante façon Revolut : pilule détachée des bords, capsule
  // sur l'onglet actif, au-dessus de la barre home iPhone (viewport-fit=cover).
  const tabClass = (isActive: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 min-h-[52px] rounded-[20px] text-[10px] font-medium transition-colors ${
      isActive ? "bg-secondary text-[#35532A]" : "text-muted-foreground"
    }`;

  return (
    <div className={`admin-ui ${dark ? "dark" : ""} min-h-screen bg-background text-foreground md:flex`}>
      {/* Sidebar desktop — blanche, pilule verte active */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-border">
          <div className="font-bold leading-tight">Quinta do Amor</div>
          <div className="text-xs text-muted-foreground mt-0.5">Management</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "pt-2" : undefined}>
              {group.label && (
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={"end" in item && item.end} className={itemClass}>
                    <item.icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-2 border-t border-border space-y-0.5">
          <button
            type="button"
            onClick={() => setDark((v) => !v)}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
          >
            {dark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <a
            href="/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            Guest area
          </a>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Contenu — padding bas sur mobile pour la tab bar */}
      <div className="flex-1 min-w-0 pb-24 md:pb-0">
        {children}
      </div>

      {/* Feuille "More" (mobile) */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-foreground/30" />
          <div
            className="absolute bottom-0 inset-x-0 bg-card rounded-t-3xl p-4 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">More</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="p-1.5 rounded-full hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {mobileMore.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={itemClass}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
              <button
                type="button"
                onClick={() => setDark((v) => !v)}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                {dark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
                {dark ? "Light mode" : "Dark mode"}
              </button>
              <a
                href="/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                Guest area
              </a>
              <button
                type="button"
                onClick={signOut}
                className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar mobile — pilule flottante (inspiration Revolut, 12 août 2026) */}
      <nav className="md:hidden fixed z-30 inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] rounded-[26px] bg-card/95 backdrop-blur-md border border-border shadow-[0_8px_30px_-6px_rgba(49,53,46,0.25)] flex items-stretch gap-0.5 p-1.5">
        {mobileMain.map((item) => (
          <NavLink key={item.to} to={item.to} end={"end" in item && item.end}
            className={({ isActive }) => tabClass(isActive)}>
            <item.icon className="w-[22px] h-[22px]" />
            {item.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(moreActive)}>
          <MoreHorizontal className="w-[22px] h-[22px]" />
          More
        </button>
      </nav>
    </div>
  );
}
