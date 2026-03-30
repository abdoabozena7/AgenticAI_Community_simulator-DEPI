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
  const { t, language, setLanguage, isRTL } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const [collapseProgress, setCollapseProgress] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const smoothTiming = { transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as const;

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        navRef.current,
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.5 }
      );
    });

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const nextProgress = Math.max(0, Math.min(1, (window.scrollY - 8) / 112));
        setCollapseProgress((prev) => (Math.abs(prev - nextProgress) < 0.01 ? prev : nextProgress));
        ticking = false;
      });
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => {
      ctx.revert();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const lerp = (from: number, to: number) => from + (to - from) * collapseProgress;
  const navWidth = collapseProgress === 0 ? '100%' : `min(calc(100% - ${lerp(0, 32).toFixed(1)}px), ${lerp(1280, 1040).toFixed(0)}px)`;
  const navStyle = {
    marginTop: `${lerp(24, 8).toFixed(1)}px`,
    width: navWidth,
    paddingInline: `${lerp(40, 16).toFixed(1)}px`,
    paddingBlock: `${lerp(12, 8).toFixed(1)}px`,
    borderRadius: `${lerp(0, 999).toFixed(1)}px`,
    borderColor: `rgba(255,255,255,${lerp(0, 0.2).toFixed(3)})`,
    backgroundColor: `rgba(14,14,24,${lerp(0, 0.72).toFixed(3)})`,
    backdropFilter: `blur(${lerp(0, 20).toFixed(1)}px)`,
    boxShadow: `0 ${lerp(0, 14).toFixed(1)}px ${lerp(0, 38).toFixed(1)}px -20px rgba(0,0,0,${lerp(0, 0.52).toFixed(3)})`,
    transform: `scale(${lerp(1, 0.985).toFixed(4)})`,
    ...smoothTiming,
  } as const;
  const centerStyle = {
    gap: `${lerp(28, 18).toFixed(1)}px`,
    paddingInline: `${lerp(28, 16).toFixed(1)}px`,
    marginInline: 'auto',
    ...smoothTiming,
  } as const;
  const actionGroupStyle = {
    gap: `${lerp(12, 8).toFixed(1)}px`,
    marginInlineStart: `${lerp(16, 0).toFixed(1)}px`,
    ...smoothTiming,
  } as const;
  const actionClusterStyle = {
    gap: `${lerp(10, 8).toFixed(1)}px`,
    ...smoothTiming,
  } as const;
  const iconButtonTone = `rgba(255,255,255,${lerp(0.7, 0.78).toFixed(3)})`;
  const mutedTone = `rgba(255,255,255,${lerp(0.75, 0.78).toFixed(3)})`;
  const dividerTone = `rgba(255,255,255,${lerp(0.15, 0.2).toFixed(3)})`;
  const linkBaseStyle = {
    paddingInline: `${lerp(28, 20).toFixed(1)}px`,
    paddingBlock: '8px',
    fontSize: `${lerp(17, 15).toFixed(2)}px`,
    lineHeight: `${lerp(28, 24).toFixed(1)}px`,
    color: `rgba(255,255,255,${lerp(0.88, 0.94).toFixed(3)})`,
    fontWeight: 600,
    ...smoothTiming,
  } as const;
  const buttonTextStyle = {
    height: `${lerp(40, 36).toFixed(1)}px`,
    paddingInline: `${lerp(24, 16).toFixed(1)}px`,
    fontSize: '14px',
    lineHeight: `${lerp(24, 24).toFixed(1)}px`,
    ...smoothTiming,
  } as const;
  const compactGlowOpacity = collapseProgress;

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  return (
    <nav ref={navRef} className="fixed top-0 inset-x-0 z-50">
      <div
        className="hidden lg:flex relative items-center mx-auto border will-change-transform transition-[margin-top,width,padding,background-color,border-color,box-shadow,backdrop-filter,transform,border-radius] duration-700"
        style={navStyle}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-16 -translate-x-1/2 bg-gradient-to-b from-transparent via-violet-400/55 to-transparent blur-[16px] transition-opacity duration-700"
          style={{ opacity: compactGlowOpacity, ...smoothTiming }}
        />

        <div className={`flex items-center gap-3 z-20 shrink-0 ${isRTL ? 'order-3 flex-row-reverse' : 'order-1'}`}>
          <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm leading-none">AS</span>
          </div>
          <span className="text-foreground font-semibold text-[1.75rem]">ASSET</span>
        </div>

        <div
          className={`flex flex-1 items-center justify-center transition-[gap,padding] duration-700 ${isRTL ? 'order-2' : 'order-2'}`}
          style={centerStyle}
        >
          {[
            { key: 'nav.features', href: '#features' },
            { key: 'nav.howItWorks', href: '#how-it-works' },
            { key: 'nav.pricing', href: '#pricing' },
          ].map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="relative z-10 inline-flex items-center rounded-full font-medium transition-[padding,color,background-color,font-size,line-height,transform] duration-500 hover:bg-white/10 hover:text-white"
              style={linkBaseStyle}
            >
              {t(link.key)}
            </a>
          ))}
        </div>

        <div className={`z-10 shrink-0 flex items-center transition-[gap,margin] duration-700 ${isRTL ? 'order-1' : 'order-3'}`} style={actionGroupStyle}>
          <div className={`flex items-center ${isRTL ? 'flex-row-reverse' : ''}`} style={actionClusterStyle}>
            <Button
              onClick={onRegister}
              className="relative z-10 rounded-full bg-white text-black transition-[padding,height,background-color,font-size,line-height,transform,box-shadow] duration-500 hover:bg-white/90"
              style={buttonTextStyle}
            >
              {t('nav.startFree')}
            </Button>
            <Button
              variant="ghost"
              onClick={onLogin}
              className="relative z-10 rounded-full transition-[padding,height,color,background-color,font-size,line-height] duration-500 hover:bg-white/10 hover:text-white"
              style={{ color: mutedTone, ...buttonTextStyle }}
            >
              {t('nav.signIn')}
            </Button>
          </div>

          <div className="mx-1 h-7 w-px" style={{ backgroundColor: dividerTone }} />

          <div className={`flex items-center ${isRTL ? 'flex-row-reverse' : ''}`} style={actionClusterStyle}>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="relative z-10 h-10 w-10 rounded-full hover:bg-white/10 hover:text-white"
              style={{ color: iconButtonTone, ...smoothTiming }}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLanguage}
              className="relative z-10 h-10 w-10 rounded-full hover:bg-white/10 hover:text-white"
              style={{ color: iconButtonTone, ...smoothTiming }}
            >
              <Languages className="w-4 h-4" />
            </Button>
          </div>
        </div>
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
