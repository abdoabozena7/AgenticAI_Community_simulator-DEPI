import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useLanguage } from '@/contexts/LanguageContext';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { SolutionSection } from '@/components/landing/SolutionSection';
import { SimulationSection } from '@/components/landing/SimulationSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { CTASection } from '@/components/landing/CTASection';
import { FooterSection } from '@/components/landing/FooterSection';
import { AuthModal } from '@/components/landing/AuthModal';
import { LandingVisualBackground } from '@/components/landing/LandingVisualBackground';

gsap.registerPlugin(ScrollTrigger);

const MarketingLandingPage = () => {
  const { isRTL } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');

  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
    const handleResize = () => {
      ScrollTrigger.refresh();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const auth = params.get('auth');
    if (auth === 'login' || auth === 'register') {
      setAuthMode(auth);
      setIsAuthOpen(true);
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const handleOpenAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setIsAuthOpen(true);
  };

  const handleGetStarted = () => {
    try {
      localStorage.setItem('postLoginRedirect', '/dashboard');
    } catch {
      // ignore
    }
    handleOpenAuth('register');
  };

  return (
    <div className={`relative min-h-screen bg-background transition-colors duration-300 ${isRTL ? 'rtl' : 'ltr'}`}>
      <LandingVisualBackground />

      <div className="relative z-10">
        <Navbar
          onLogin={() => handleOpenAuth('login')}
          onRegister={handleGetStarted}
        />

        <HeroSection onGetStarted={handleGetStarted} />

        <ProblemSection />

        <SolutionSection />

        <SimulationSection />

        <FeaturesSection />

        <PricingSection onGetStarted={handleGetStarted} />

        <CTASection onGetStarted={handleGetStarted} />

        <FooterSection />

        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          initialMode={authMode}
        />
      </div>
    </div>
  );
};

export default MarketingLandingPage;
