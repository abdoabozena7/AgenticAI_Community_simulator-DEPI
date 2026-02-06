import { useState, useEffect } from 'react';
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
import { ParticleBackground } from '@/components/landing/ParticleBackground';

gsap.registerPlugin(ScrollTrigger);

 const Landing = () => {
   const { isRTL } = useLanguage();
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

  const handleOpenAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setIsAuthOpen(true);
  };

  return (
     <div className={`min-h-screen bg-background transition-colors duration-300 ${isRTL ? 'rtl' : 'ltr'}`}>
      <ParticleBackground />
      
      <Navbar
        onLogin={() => handleOpenAuth('login')}
        onRegister={() => handleOpenAuth('register')}
      />

      <HeroSection onGetStarted={() => handleOpenAuth('register')} />

      <ProblemSection />

      <SolutionSection />

      <SimulationSection />

      <FeaturesSection />

      <PricingSection onGetStarted={() => handleOpenAuth('register')} />

      <CTASection onGetStarted={() => handleOpenAuth('register')} />

      <FooterSection />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        initialMode={authMode}
      />
    </div>
  );
};

export default Landing;
