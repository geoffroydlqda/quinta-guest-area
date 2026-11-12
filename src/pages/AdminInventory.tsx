import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { InventoryPage } from "@/components/admin/InventoryPage";
import { useAllowedTabs } from "@/hooks/useAllowedTabs";

/**
 * Route /admin/inventory (12 nov 2026) — page dediee (convention "une page par
 * route") plutot qu'une vue de plus dans Admin.tsx : l'onglet Inventory est
 * autonome (ses propres donnees, pas besoin d'admin-list-data) et c'est aussi
 * l'onglet unique de Luis (allowed_tabs = ["inventory"]), qui n'a pas besoin
 * de charger tout le reste de l'admin.
 */
function AdminInventoryContent() {
  const { allowed, loaded } = useAllowedTabs();
  useEffect(() => { document.title = "Inventory — Quinta do Amor"; }, []);
  if (loaded && allowed && !allowed.has("inventory")) return <Navigate to="/admin" replace />;
  return (
    <AdminLayout>
      <main className="px-4 md:px-6 py-6 max-w-[1400px]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Approved references, stock levels and shopping list — counted on the buffer day before each event.
          </p>
        </div>
        <InventoryPage />
      </main>
    </AdminLayout>
  );
}

const AdminInventory = () => (
  <ProtectedRoute>
    <AdminGuard>
      <AdminInventoryContent />
    </AdminGuard>
  </ProtectedRoute>
);

export default AdminInventory;
