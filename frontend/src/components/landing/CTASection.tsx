import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Button } from '@/components/ui/button';
import { ArrowRight, Rocket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

interface CTASectionProps {
  onGetStarted: () => void;
}

export function CTASection({ onGetStarted }: CTASectionProps) {
  const { t, isRTL } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Content reveal
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 60, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );

      // Floating rocket
      gsap.to('.floating-rocket', {
        y: -10,
        rotation: 5,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-32 px-6 bg-gradient-to-b from-background to-secondary/20 overflow-hidden"
    >
      {/* Background decorations */}
      <div className="absolute inset-0 opacity-5">
        <div
          className="w-full h-full"
          style={{
            backgroundImage: 'radial-gradient(circle at 30% 50%, rgb(var(--rgb-cyan)) 0%, transparent 50%), radial-gradient(circle at 70% 50%, rgb(var(--rgb-magenta)) 0%, transparent 50%)',
          }}
        />
      </div>

      <div
        ref={contentRef}
        className="max-w-3xl mx-auto text-center relative z-10 p-12 rounded-3xl liquid-glass"
      >
        <div className="floating-rocket inline-block mb-8">
          <div className="w-20 h-20 rounded-2xl liquid-glass flex items-center justify-center">
            <Rocket className="w-10 h-10 text-foreground" />
          </div>
        </div>

        <h2 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
          {t('cta.title')}
        </h2>

        <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
          {t('cta.desc')}
        </p>

        <Button
          onClick={onGetStarted}
          size="lg"
          className="liquid-glass-button px-10 py-7 text-lg font-semibold rounded-full group"
        >
          {t('cta.button')}
          <ArrowRight className={`w-5 h-5 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
        </Button>
      </div>
    </section>
  );
}
