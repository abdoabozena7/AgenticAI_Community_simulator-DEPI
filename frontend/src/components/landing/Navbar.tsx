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
      setIsScrolled(window.scrollY > 40);
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
    <nav ref={navRef} className="fixed top-0 inset-x-0 z-50">
      <div className={`hidden lg:flex items-center justify-between max-w-7xl mx-auto px-4 transition-all duration-500 ${isScrolled ? 'py-2' : 'py-3'}`}>
        <div className="flex items-center gap-3 z-20">
          <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm leading-none">AS</span>
          </div>
          <span className="text-foreground font-semibold text-[1.75rem]">ASSET</span>
        </div>

        <div
          className={`absolute left-1/2 -translate-x-1/2 flex items-center rounded-full border border-white/20 bg-[rgba(14,14,24,0.72)] backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all duration-500 ${
            isScrolled ? 'scale-[0.96] px-3 py-2' : 'scale-100 px-4 py-2.5'
          }`}
        >
          <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-14 bg-gradient-to-b from-transparent via-violet-400/60 to-transparent blur-[14px]" />

          {[
            { key: 'nav.features', href: '#features' },
            { key: 'nav.howItWorks', href: '#how-it-works' },
            { key: 'nav.pricing', href: '#pricing' },
          ].map((link) => (
            <a
              key={link.key}
              href={link.href}
              className={`relative z-10 inline-flex items-center rounded-full font-medium text-neutral-300 hover:text-white hover:bg-white/10 transition-all duration-300 ${
                isScrolled ? 'px-4 py-2 text-sm leading-6' : 'px-5 py-2 text-[15px] leading-7'
              }`}
            >
              {t(link.key)}
            </a>
          ))}

          <div className="relative z-10 w-px h-7 bg-white/20 mx-1.5" />

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="relative z-10 text-neutral-300 hover:text-white hover:bg-white/10 rounded-full w-10 h-10"
          >
            <Languages className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="relative z-10 text-neutral-300 hover:text-white hover:bg-white/10 rounded-full w-10 h-10"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          <div className="relative z-10 w-px h-7 bg-white/20 mx-1.5" />

          <Button
            variant="ghost"
            onClick={onLogin}
            className={`relative z-10 text-neutral-300 hover:text-white hover:bg-white/10 rounded-full transition-all duration-300 ${
              isScrolled ? 'h-9 px-4 text-sm leading-6' : 'h-10 px-5 text-sm leading-6'
            }`}
          >
            {t('nav.signIn')}
          </Button>
          <Button
            onClick={onRegister}
            className={`relative z-10 rounded-full bg-white text-black hover:bg-white/90 transition-all duration-300 ${
              isScrolled ? 'h-9 px-4 text-sm leading-6' : 'h-10 px-5 text-sm leading-6'
            }`}
          >
            {t('nav.startFree')}
          </Button>
        </div>

        <div className="w-[148px] z-10" />
      </div>

      <div className="flex lg:hidden items-center justify-between max-w-[calc(100vw-1rem)] mx-auto px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm leading-none">AS</span>
          </div>
          <span className="text-foreground font-semibold text-base">ASSET</span>
        </div>

        <div className="flex items-center gap-2">
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
        <div className="lg:hidden absolute top-full left-4 right-4 mt-2 liquid-glass rounded-2xl p-6">
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
