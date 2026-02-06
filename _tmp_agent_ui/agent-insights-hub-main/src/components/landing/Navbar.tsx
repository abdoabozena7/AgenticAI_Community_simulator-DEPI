import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Button } from '@/components/ui/button';
import { Menu, X, Moon, Sun, Languages } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

interface NavbarProps {
  onLogin: () => void;
  onRegister: () => void;
}

export function Navbar({ onLogin, onRegister }: NavbarProps) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        navRef.current,
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.5 }
      );
    });

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      ctx.revert();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  return (
    <nav
      ref={navRef}
      className="fixed top-0 left-0 right-0 z-50 px-6 py-4"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3 z-10">
          <div className="w-9 h-9 rounded-xl bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm">AS</span>
          </div>
          <span className="text-foreground font-semibold text-lg hidden sm:block">
            ASSET
          </span>
        </div>

        {/* Centered Glass Nav - Desktop */}
        <div 
          className={`hidden md:flex items-center gap-1 px-2 py-2 rounded-full transition-all duration-500 ${
            isScrolled 
              ? 'liquid-glass' 
              : 'bg-white/5 backdrop-blur-md border border-white/10'
          }`}
        >
          {[
            { key: 'nav.features', href: '#features' },
            { key: 'nav.howItWorks', href: '#how-it-works' },
            { key: 'nav.pricing', href: '#pricing' },
          ].map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-full transition-all duration-300"
            >
              {t(link.key)}
            </a>
          ))}
          
          <div className="w-px h-6 bg-white/20 mx-1" />
          
          {/* Language Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-full w-9 h-9"
          >
            <Languages className="w-4 h-4" />
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-full w-9 h-9"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>

        {/* Right Controls - Desktop */}
        <div className="hidden md:flex items-center gap-2 z-10">
          <Button
            variant="ghost"
            onClick={onLogin}
            className="text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-full px-5"
          >
            {t('nav.signIn')}
          </Button>
          <Button
            onClick={onRegister}
            className="liquid-glass-button rounded-full px-5"
          >
            {t('nav.startFree')}
          </Button>
        </div>

        {/* Mobile Controls */}
        <div className="flex md:hidden items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="text-muted-foreground"
          >
            <Languages className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="text-muted-foreground"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-4 right-4 mt-2 liquid-glass rounded-2xl p-6">
          <div className="flex flex-col gap-2">
            {[
              { key: 'nav.features', href: '#features' },
              { key: 'nav.howItWorks', href: '#how-it-works' },
              { key: 'nav.pricing', href: '#pricing' },
            ].map((link) => (
              <a
                key={link.key}
                href={link.href}
                className="text-muted-foreground hover:text-foreground py-3 px-4 rounded-xl hover:bg-white/10 transition-all"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {t(link.key)}
              </a>
            ))}
            <div className="h-px bg-white/10 my-2" />
            <Button
              variant="ghost"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLogin();
              }}
              className="justify-start text-muted-foreground"
            >
              {t('nav.signIn')}
            </Button>
            <Button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onRegister();
              }}
              className="liquid-glass-button rounded-full"
            >
              {t('nav.startFree')}
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
