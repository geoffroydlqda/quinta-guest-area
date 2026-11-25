import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ToolboxPage } from "@/components/admin/ToolboxPage";
import { useAllowedTabs } from "@/hooks/useAllowedTabs";

/**
 * Route /admin/toolbox (25 nov 2026) — contacts fournisseurs/prestataires et
 * coffre à documents (assurances, contrats…). Page dédiée, convention
 * Inventory.
 */
function AdminToolboxContent() {
  const { allowed, loaded } = useAllowedTabs();
  useEffect(() => { document.title = "Toolbox — Quinta do Amor"; }, []);
  if (loaded && allowed && !allowed.has("toolbox")) return <Navigate to="/admin" replace />;
  return (
    <AdminLayout>
      <main className="px-4 md:px-6 py-6 max-w-[1400px]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Toolbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Trusted suppliers & contractors, and the documents that matter — insurance, contracts, licenses.
          </p>
        </div>
        <ToolboxPage />
      </main>
    </AdminLayout>
  );
}

const AdminToolbox = () => (
  <ProtectedRoute>
    <AdminGuard>
      <AdminToolboxContent />
    </AdminGuard>
  </ProtectedRoute>
);

export default AdminToolbox;
