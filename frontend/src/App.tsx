import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import AgentResearchScreen from "./pages/AgentResearchScreen";
import IdeaCourtPage from "./pages/IdeaCourtPage";
import AdminDashboard from "./pages/AdminDashboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ErrorBoundary>
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              {/* Protected routes: pages should redirect internally if not authenticated */}
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/research" element={<AgentResearchScreen />} />
              <Route path="/court" element={<IdeaCourtPage />} />
              <Route path="/admin" element={<AdminDashboard />} />
              {/* Simulation remains at root */}
              <Route path="/" element={<Index />} />
              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
