import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { TasksPage } from "@/components/admin/TasksPage";
import { useAllowedTabs } from "@/hooks/useAllowedTabs";

/**
 * Route /admin/tasks (25 nov 2026) — task tracker de l'équipe, centralisé
 * depuis l'artifact de Loïs. Page dédiée (données autonomes, pas besoin
 * d'admin-list-data), même convention qu'Inventory.
 */
function AdminTasksContent() {
  const { allowed, loaded } = useAllowedTabs();
  useEffect(() => { document.title = "Tasks — Quinta do Amor"; }, []);
  if (loaded && allowed && !allowed.has("tasks")) return <Navigate to="/admin" replace />;
  return (
    <AdminLayout>
      <main className="px-4 md:px-6 py-6 max-w-[1400px]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The team's shared to-do list — assign, prioritise, and let recurring chores come back on their own.
          </p>
        </div>
        <TasksPage />
      </main>
    </AdminLayout>
  );
}

const AdminTasks = () => (
  <ProtectedRoute>
    <AdminGuard>
      <AdminTasksContent />
    </AdminGuard>
  </ProtectedRoute>
);

export default AdminTasks;
