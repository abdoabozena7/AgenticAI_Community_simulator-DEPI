import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { RippleButton } from '@/components/ui/ripple-button';
import { ArrowRight, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VideoModal } from './VideoModal';

interface HeroSectionProps {
  onGetStarted: () => void;
}

export function HeroSection({ onGetStarted }: HeroSectionProps) {
  const { t, isRTL } = useLanguage();
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });

      tl.fromTo(
        badgeRef.current,
        { opacity: 0, y: 30, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.8 }
      )
        .fromTo(
          titleRef.current,
          { opacity: 0, y: 60, rotateX: 15 },
          { opacity: 1, y: 0, rotateX: 0, duration: 1 },
          '-=0.4'
        )
        .fromTo(
          subtitleRef.current,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.8 },
          '-=0.6'
        )
        .fromTo(
          ctaRef.current,
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.6 },
          '-=0.4'
        )
        .fromTo(
          statsRef.current?.querySelectorAll('.stat-item'),
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, stagger: 0.1, duration: 0.5 },
          '-=0.2'
        );

      // Floating animation for badge
      gsap.to(badgeRef.current, {
        y: -5,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      // Parallax scroll effect
      gsap.to(titleRef.current, {
        yPercent: 30,
        ease: 'none',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden"
    >
      {/* Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_8%,rgba(120,72,190,0.20),transparent_55%),linear-gradient(to_bottom,rgba(0,0,0,0.08),rgba(0,0,0,0.22))]" />

      {/* Animated grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--foreground) / 0.1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* RGB Orb glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] opacity-20 blur-3xl pointer-events-none">
        <div 
          className="w-full h-full rounded-full animate-pulse"
          style={{
            background: 'radial-gradient(circle, rgba(0, 210, 210, 0.65) 0%, rgba(56, 22, 98, 0.8) 46%, transparent 74%)',
          }}
        />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        {/* Badge */}
        <div
          ref={badgeRef}
        >
        
        </div>

        {/* Title */}
        <h1
          ref={titleRef}
          className={`font-bold text-foreground tracking-tight ${
            isRTL
              ? 'text-5xl md:text-7xl lg:text-[5.5rem] leading-[1.2] mb-8'
              : 'text-5xl md:text-7xl lg:text-8xl leading-[1.1] mb-6'
          }`}
          style={{ perspective: '1000px' }}
        >
          <span>{t('hero.title1')}</span>
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground/80 to-foreground/40 inline-block">
            {t('hero.title2')}
          </span>
        </h1>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className={`text-muted-foreground mx-auto ${
            isRTL
              ? 'text-base md:text-lg max-w-xl mb-12 leading-[1.9]'
              : 'text-lg md:text-xl max-w-2xl mb-10 leading-relaxed'
          }`}
        >
          {t('hero.subtitle')}
        </p>

        {/* CTAs */}
        <div ref={ctaRef} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <RippleButton
            onClick={onGetStarted}
            size="lg"
            rippleColor="rgba(0, 255, 255, 0.3)"
            className="bg-foreground text-background hover:bg-foreground/90 px-8 py-6 text-base font-semibold rounded-full group rgb-shadow-hover"
          >
            {t('hero.cta')}
            <ArrowRight className={`w-4 h-4 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
          </RippleButton>

          <RippleButton
            onClick={() => setIsVideoOpen(true)}
            variant="ghost"
            size="lg"
            rippleColor="rgba(255, 0, 255, 0.2)"
            className="text-muted-foreground hover:text-foreground hover:bg-secondary px-8 py-6 text-base rounded-full rgb-shadow-hover"
          >
            <Play className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('hero.watchDemo')}
          </RippleButton>
        </div>

        <VideoModal isOpen={isVideoOpen} onClose={() => setIsVideoOpen(false)} />

        {/* Stats */}
        <div 
          ref={statsRef}
          className="flex items-center justify-center gap-8 md:gap-12 mt-16 pt-8"
        >
          {[
            { value: t('hero.stat1'), label: t('hero.stat1Label') },
            { value: t('hero.stat2'), label: t('hero.stat2Label') },
            { value: t('hero.stat3'), label: t('hero.stat3Label') },
          ].map((stat, i) => (
            <div key={i} className="stat-item text-center group cursor-default px-6 py-4 rounded-xl liquid-glass">
              <div className="text-2xl md:text-3xl font-bold text-foreground mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="w-6 h-10 rounded-full border-2 border-border flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-muted-foreground rounded-full animate-bounce" />
        </div>
      </div>
    </section>
  );
}
