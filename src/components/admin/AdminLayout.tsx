import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAllowedTabs } from "@/hooks/useAllowedTabs";
import {
  LayoutDashboard, CalendarRange, Users, Wallet, Car,
  BedDouble, LogOut, ExternalLink, ChefHat, MoreHorizontal, X, Landmark, UserCog,
} from "lucide-react";

/**
 * Layout commun de l'espace admin — refonte "light & vibrant" (juillet 2026) :
 * - desktop : sidebar blanche, item actif en pilule verte (#79B84B)
 * - mobile : tab bar fixe en bas (Dashboard, Bookings, Transport, Rooms)
 *   + bouton "More" qui ouvre une feuille avec le reste (Payments, Guests,
 *   Catering, Guest area, Sign out).
 */
const NAV = [
  { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard, tab: "dashboard" },
  { to: "/admin/bookings", label: "Bookings", icon: CalendarRange, tab: "bookings" },
  { to: "/admin/guests", label: "Guests", icon: Users, tab: "guests" },
  { to: "/admin/payments", label: "Payments", icon: Wallet, tab: "payments" },
  { to: "/admin/catering", label: "Catering", icon: ChefHat, tab: "catering" },
  { to: "/admin/transportation", label: "Transportation", icon: Car, tab: "transportation" },
  { to: "/admin/rooms", label: "Housekeeping", icon: BedDouble, tab: "rooms" },
  { to: "/admin/finance", label: "Finance", icon: Landmark, tab: "finance" },
  { to: "/admin/staff", label: "Staff", icon: UserCog, tab: "staff" },
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
  { to: "/admin/finance", label: "Finance", icon: Landmark, tab: "finance" },
  { to: "/admin/guests", label: "Guests", icon: Users, tab: "guests" },
  { to: "/admin/catering", label: "Catering", icon: ChefHat, tab: "catering" },
  { to: "/admin/staff", label: "Staff", icon: UserCog, tab: "staff" },
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  // Onglets visibles pour cet admin (onglet Staff) — null = tous
  const { allowed } = useAllowedTabs();
  const visible = <T extends { tab: string }>(items: readonly T[]) =>
    allowed ? items.filter((i) => allowed.has(i.tab)) : [...items];
  const nav = visible(NAV);
  const mobileMain = visible(MOBILE_MAIN);
  const mobileMore = visible(MOBILE_MORE);

  const moreActive = mobileMore.some((i) => location.pathname.startsWith(i.to));

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
        : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
    }`;

  const tabClass = (isActive: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 pt-1.5 pb-1 text-[10px] font-medium ${
      isActive ? "text-[#35532A]" : "text-muted-foreground"
    }`;

  const tabPill = (isActive: boolean) =>
    `flex items-center justify-center px-4 py-1 rounded-full ${isActive ? "bg-secondary" : ""}`;

  return (
    <div className="admin-ui min-h-screen bg-background md:flex">
      {/* Sidebar desktop — blanche, pilule verte active */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-border">
          <div className="font-bold leading-tight">Quinta do Amor</div>
          <div className="text-xs text-muted-foreground mt-0.5">Management</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={"end" in item && item.end} className={itemClass}>
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-border space-y-0.5">
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
      <div className="flex-1 min-w-0 pb-20 md:pb-0">
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

      {/* Tab bar mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border flex items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
        {mobileMain.map((item) => (
          <NavLink key={item.to} to={item.to} end={"end" in item && item.end}
            className={({ isActive }) => tabClass(isActive)}>
            {({ isActive }) => (
              <>
                <span className={tabPill(isActive)}>
                  <item.icon className="w-5 h-5" />
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(moreActive)}>
          <span className={tabPill(moreActive)}>
            <MoreHorizontal className="w-5 h-5" />
          </span>
          More
        </button>
      </nav>
    </div>
  );
}
