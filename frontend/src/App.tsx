import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Import additional pages.  These components implement the basic login
// and landing flows, research interface, idea court feature and admin
// dashboard.  If the application is extended you can enrich these
// components further.
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import AgentResearchScreen from "./pages/AgentResearchScreen";
import IdeaCourtPage from "./pages/IdeaCourtPage";
import AdminDashboard from "./pages/AdminDashboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { apiService, getAuthToken } from "@/services/api";

const queryClient = new QueryClient();

const useAuthStatus = () => {
  const [status, setStatus] = useState<'checking' | 'authed' | 'guest'>('checking');
  const token = getAuthToken();

  useEffect(() => {
    let active = true;
    if (!token) {
      setStatus('guest');
      return () => { active = false; };
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);

    apiService
      .getMe({ signal: controller.signal })
      .then(() => {
        if (active) setStatus('authed');
      })
      .catch(() => {
        if (active) setStatus('guest');
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [token]);

  return status;
};

const AuthLoading = () => (
  <div className="p-4 text-sm text-muted-foreground">Checking session...</div>
);

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const status = useAuthStatus();
  if (status === 'checking') return <AuthLoading />;
  if (status === 'guest') return <Navigate to="/login" replace />;
  return children;
};

const PublicOnly = ({ children }: { children: JSX.Element }) => {
  const status = useAuthStatus();
  if (status === 'checking') return <AuthLoading />;
  if (status === 'authed') return <Navigate to="/landing" replace />;
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ErrorBoundary>
          <BrowserRouter>
            <Routes>
              {/* Root route retains the original Index page for running simulations */}
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Index />
                  </RequireAuth>
                }
              />
              {/* Landing page shown after login and on refresh when a token is present */}
              <Route
                path="/landing"
                element={
                  <RequireAuth>
                    <LandingPage />
                  </RequireAuth>
                }
              />
              {/* Login and registration */}
              <Route
                path="/login"
                element={
                  <PublicOnly>
                    <LoginPage />
                  </PublicOnly>
                }
              />
              {/* Research workflow */}
              <Route
                path="/research"
                element={
                  <RequireAuth>
                    <AgentResearchScreen />
                  </RequireAuth>
                }
              />
              {/* Idea court workflow */}
              <Route
                path="/court"
                element={
                  <RequireAuth>
                    <IdeaCourtPage />
                  </RequireAuth>
                }
              />
              {/* Administrative interface */}
              <Route
                path="/admin"
                element={
                  <RequireAuth>
                    <AdminDashboard />
                  </RequireAuth>
                }
              />
              {/* Catch-all route for unknown paths */}
              <Route
                path="*"
                element={
                  <RequireAuth>
                    <NotFound />
                  </RequireAuth>
                }
              />
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
