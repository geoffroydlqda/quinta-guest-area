import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { featureFlags } from "@/lib/featureFlags";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import RoomSetup from "./pages/RoomSetup";
import Transportation from "./pages/Transportation";
import Food from "./pages/Food";
import Documentation from "./pages/Documentation";
import Admin from "./pages/Admin";
import AdminGuestDetail from "./pages/AdminGuestDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            {/* Protected routes - require authentication */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/room-setup" element={
              <ProtectedRoute>
                <RoomSetup />
              </ProtectedRoute>
            } />
            <Route path="/transportation" element={
              <ProtectedRoute>
                <Transportation />
              </ProtectedRoute>
            } />
            <Route path="/food" element={
              <ProtectedRoute>
                <Food />
              </ProtectedRoute>
            } />
            <Route path="/documentation" element={
              featureFlags.showDocumentation ? (
                <ProtectedRoute>
                  <Documentation />
                </ProtectedRoute>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            } />
            <Route path="/admin" element={<Admin />} />
            {/* Legacy route redirect */}
            <Route path="/setup" element={
              <ProtectedRoute>
                <RoomSetup />
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
