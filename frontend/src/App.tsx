import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Import additional pages.  These components implement the basic login
// and landing flows, research interface, idea court feature and admin
// dashboard.  If the application is extended you can enrich these
// components further.
import DashboardPage from "./pages/DashboardPage";
import MarketingLandingPage from "./pages/MarketingLandingPage";
import AgentResearchScreen from "./pages/AgentResearchScreen";
import IdeaCourtPage from "./pages/IdeaCourtPage";
import AdminDashboard from "./pages/AdminDashboard";
import BonusPage from "./pages/BonusPage";
import SettingsPage from "./pages/SettingsPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { apiService, getAuthToken } from "@/services/api";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { PageTransition } from "@/components/PageTransition";

const queryClient = new QueryClient();

const applyLanguageSettings = (language?: string | null) => {
  if (typeof document === 'undefined') return;
  const lang = language === 'ar' ? 'ar' : language === 'en' ? 'en' : null;
  if (!lang) return;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  root.classList.toggle('rtl', lang === 'ar');
  root.classList.toggle('lang-ar', lang === 'ar');
};

const useAuthStatus = () => {
  const [status, setStatus] = useState<'checking' | 'authed' | 'guest'>('checking');
  const [role, setRole] = useState<string | null>(null);
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
      .then((me) => {
        if (!active) return;
        setRole(me?.role || null);
        setStatus('authed');
      })
      .catch(() => {
        if (active) {
          setRole(null);
          setStatus('guest');
        }
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

  return { status, role };
};

const AuthLoading = () => (
  <div className="p-4 text-sm text-muted-foreground">Checking session...</div>
);

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { status } = useAuthStatus();
  if (status === 'checking') return <AuthLoading />;
  if (status === 'guest') return <Navigate to="/?auth=login" replace />;
  return children;
};

const PublicOnly = ({ children }: { children: JSX.Element }) => {
  const { status, role } = useAuthStatus();
  if (status === 'checking') return <AuthLoading />;
  if (status === 'authed') {
    return <Navigate to={role === 'admin' ? "/control-center" : "/dashboard"} replace />;
  }
  return children;
};

const RequireAdmin = ({ children }: { children: JSX.Element }) => {
  const { status, role } = useAuthStatus();
  if (status === 'checking') return <AuthLoading />;
  if (status === 'guest') return <Navigate to="/?auth=login" replace />;
  if (role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <ErrorBoundary>
            <BrowserRouter>
              <PageTransition>
                <AppShell />
              </PageTransition>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const AppShell = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('appSettings');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      applyLanguageSettings(parsed?.language);
    } catch {
      // ignore
    }
  }, []);

  return (
    <Routes>
              {/* Public marketing landing page */}
              <Route
                path="/"
                element={
                  <PublicOnly>
                    <MarketingLandingPage />
                  </PublicOnly>
                }
              />
              {/* Simulation workspace */}
              <Route
                path="/simulate"
                element={
                  <RequireAuth>
                    <Index />
                  </RequireAuth>
                }
              />
              {/* Dashboard shown after login and on refresh when a token is present */}
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />
              {/* Backwards-compatible redirect */}
              <Route path="/landing" element={<Navigate to="/" replace />} />
              {/* Login and registration */}
              <Route
                path="/login"
                element={
                  <PublicOnly>
                    <Navigate to="/?auth=login" replace />
                  </PublicOnly>
                }
              />
              <Route
                path="/verify-email"
                element={
                  <PublicOnly>
                    <VerifyEmailPage />
                  </PublicOnly>
                }
              />
              <Route
                path="/reset-password"
                element={
                  <PublicOnly>
                    <ResetPasswordPage />
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
        path="/control-center"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
      <Route path="/admin" element={<Navigate to="/control-center" replace />} />
      {/* Bonus credits (coming soon) */}
      <Route
        path="/bonus"
        element={
          <RequireAuth>
            <BonusPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
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
  );
};

export default App;
