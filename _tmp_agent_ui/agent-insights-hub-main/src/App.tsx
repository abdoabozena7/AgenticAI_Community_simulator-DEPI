import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
 import { PageTransition } from "@/components/PageTransition";
 import { ThemeProvider } from "@/contexts/ThemeContext";
 import { LanguageProvider } from "@/contexts/LanguageContext";
import Landing from "./pages/Landing";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
     <ThemeProvider>
       <LanguageProvider>
         <TooltipProvider>
           <Toaster />
           <Sonner />
           <BrowserRouter>
             <PageTransition>
              <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/app" element={<Index />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
             </PageTransition>
           </BrowserRouter>
         </TooltipProvider>
       </LanguageProvider>
     </ThemeProvider>
  </QueryClientProvider>
);

export default App;
