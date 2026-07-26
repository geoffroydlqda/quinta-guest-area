import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard, CalendarRange, Users, Wallet, Car,
  BedDouble, LogOut, ExternalLink,
} from "lucide-react";

/**
 * Layout commun de l'espace admin : sidebar fixe (desktop) / barre horizontale
 * (mobile), police Inter via la classe .admin-ui (voir index.css).
 */
const NAV = [
  { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/bookings", label: "Bookings", icon: CalendarRange },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/payments", label: "Payments", icon: Wallet },
  { to: "/admin/transportation", label: "Transportation", icon: Car },
  { to: "/admin/rooms", label: "Room setup", icon: BedDouble },
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground font-medium"
        : "text-foreground/80 hover:bg-muted hover:text-foreground"
    }`;

  const mobileItemClass = ({ isActive }: { isActive: boolean }) =>
    `shrink-0 rounded-full px-3 py-1.5 text-xs whitespace-nowrap border transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground border-primary font-medium"
        : "bg-background border-border text-foreground/80"
    }`;

  return (
    <div className="admin-ui min-h-screen bg-background md:flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-border">
          <div className="font-semibold leading-tight">Quinta do Amor</div>
          <div className="text-xs text-muted-foreground mt-0.5">Management</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV.map((item) => (
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
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            Guest area
          </a>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Contenu (avec nav horizontale sur mobile) */}
      <div className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-20 border-b border-border bg-card px-2 py-2 flex gap-1.5 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={"end" in item && item.end} className={mobileItemClass}>
              {item.label}
            </NavLink>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
