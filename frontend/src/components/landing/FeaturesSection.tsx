import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Zap, Target, BarChart3, Shield, Globe, Cpu } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

export function FeaturesSection() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const features = [
    { icon: Zap, titleKey: 'features.f1', descKey: 'features.f1Desc', color: 'cyan' },
    { icon: Target, titleKey: 'features.f2', descKey: 'features.f2Desc', color: 'magenta' },
    { icon: BarChart3, titleKey: 'features.f3', descKey: 'features.f3Desc', color: 'yellow' },
    { icon: Shield, titleKey: 'features.f4', descKey: 'features.f4Desc', color: 'green' },
    { icon: Globe, titleKey: 'features.f5', descKey: 'features.f5Desc', color: 'cyan' },
    { icon: Cpu, titleKey: 'features.f6', descKey: 'features.f6Desc', color: 'magenta' },
  ];

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Title reveal
      gsap.fromTo(
        '.features-header',
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );

      // Cards reveal with 3D rotation
      const cards = cardsRef.current?.querySelectorAll('.feature-card');
      if (cards) {
        gsap.fromTo(
          cards,
          {
            opacity: 0,
            y: 100,
            rotateX: 15,
            scale: 0.9,
          },
          {
            opacity: 1,
            y: 0,
            rotateX: 0,
            scale: 1,
            stagger: {
              each: 0.08,
              from: 'start',
            },
            duration: 0.7,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: cardsRef.current,
              start: 'top 80%',
            },
          }
        );
      }

      // Hover animations for cards
      cards?.forEach((card) => {
        const icon = card.querySelector('.feature-icon');
        
        card.addEventListener('mouseenter', () => {
          gsap.to(card, { y: -8, duration: 0.3, ease: 'power2.out' });
          gsap.to(icon, { scale: 1.2, rotate: 5, duration: 0.3 });
        });
        
        card.addEventListener('mouseleave', () => {
          gsap.to(card, { y: 0, duration: 0.3 });
          gsap.to(icon, { scale: 1, rotate: 0, duration: 0.3 });
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-32 px-6 bg-gradient-to-b from-secondary/10 via-background to-background"
    >
      {/* Background dots pattern */}
      <div className="absolute inset-0 opacity-[0.02]">
        <div
          className="w-full h-full"
          style={{
            backgroundImage:
              'radial-gradient(circle at center, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-16 features-header">
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {t('features.tag')}
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mt-4 mb-4">
            {t('features.title')}
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            {t('features.desc')}
          </p>
        </div>

        <div
          ref={cardsRef}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          style={{ perspective: '1000px' }}
        >
          {features.map((feature, i) => (
            <div
              key={i}
              className="feature-card group p-6 rounded-2xl liquid-glass border border-border/50 hover:border-white/20 transition-all duration-300 cursor-pointer"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div
                className={`feature-icon w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center mb-5 transition-all duration-300 rgb-icon-${feature.color}`}
              >
                <feature.icon className="w-7 h-7 text-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2 transition-all duration-300">
                {t(feature.titleKey)}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t(feature.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
