import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { NeuralNetwork3D } from './NeuralNetwork3D';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

export function SimulationSection() {
  const { t } = useLanguage();
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // 3D canvas reveal with dramatic flip-in
      gsap.fromTo(
        canvasRef.current,
        { scale: 0.3, opacity: 0, rotateY: -180, rotateX: 30 },
        {
          scale: 1,
          opacity: 1,
          rotateY: 0,
          rotateX: 0,
          duration: 1.5,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
            end: 'top 40%',
            scrub: 1,
            onEnter: () => setIsInView(true),
            onLeaveBack: () => setIsInView(false),
          },
        }
      );

      // Content reveal with elastic bounce from right
      const items = contentRef.current?.querySelectorAll('.reveal-item');
      if (items) {
        gsap.fromTo(
          items,
          { opacity: 0, x: 150, skewX: -10, scale: 0.8 },
          {
            opacity: 1,
            x: 0,
            skewX: 0,
            scale: 1,
            stagger: 0.12,
            duration: 0.9,
            ease: 'elastic.out(1, 0.5)',
            scrollTrigger: {
              trigger: contentRef.current,
              start: 'top 75%',
            },
          }
        );
      }

      // Feature cards with magnetic hover effect
      const featureCards = contentRef.current?.querySelectorAll('.feature-card');
      featureCards?.forEach((card, i) => {
        // Staggered entrance with rotation
        gsap.fromTo(
          card,
          { opacity: 0, y: 80, rotate: i % 2 === 0 ? 5 : -5 },
          {
            opacity: 1,
            y: 0,
            rotate: 0,
            duration: 0.8,
            ease: 'back.out(1.7)',
            scrollTrigger: {
              trigger: card,
              start: 'top 85%',
            },
            delay: i * 0.1,
          }
        );
        
        card.addEventListener('mouseenter', () => {
          gsap.to(card, { 
            scale: 1.05, 
            y: -5,
            boxShadow: '0 20px 40px rgba(0, 255, 255, 0.15), 0 10px 20px rgba(255, 0, 255, 0.1)',
            duration: 0.3 
          });
        });
        card.addEventListener('mouseleave', () => {
          gsap.to(card, { 
            scale: 1, 
            y: 0,
            boxShadow: 'none',
            duration: 0.3 
          });
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative min-h-screen py-24 px-6 bg-gradient-to-b from-background to-secondary/10 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* 3D Simulation */}
          <div
            ref={canvasRef}
            className="relative aspect-square lg:aspect-auto lg:h-[600px] rounded-3xl overflow-hidden bg-gradient-to-br from-card to-background border border-border rgb-shadow-hover"
            style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
          >
            <NeuralNetwork3D isInView={isInView} />

            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent pointer-events-none" />

            {/* Status indicators */}
            <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/50 backdrop-blur-sm border border-border">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs text-muted-foreground">{t('sim.live')}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">24 {t('sim.agents')}</div>
            </div>
          </div>

          {/* Content */}
          <div ref={contentRef} className="lg:pl-8">
            <div className="reveal-item">
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                {t('sim.tag')}
              </span>
            </div>

            <h2 className="reveal-item text-4xl md:text-5xl font-bold text-foreground mt-4 mb-6 leading-tight">
              {t('sim.title')}
            </h2>

            <p className="reveal-item text-lg text-muted-foreground mb-8 leading-relaxed">
              {t('sim.desc')}
            </p>

            <div className="space-y-4">
              {[
                { title: t('sim.feature1'), desc: t('sim.feature1Desc'), color: 'cyan' },
                { title: t('sim.feature2'), desc: t('sim.feature2Desc'), color: 'magenta' },
                { title: t('sim.feature3'), desc: t('sim.feature3Desc'), color: 'yellow' },
                { title: t('sim.feature4'), desc: t('sim.feature4Desc'), color: 'green' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="feature-card reveal-item flex items-start gap-4 p-4 rounded-xl liquid-glass border border-border/50 hover:border-white/20 transition-all duration-300 cursor-pointer"
                >
                  <div
                    className={`w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0 transition-all duration-300 rgb-icon-${item.color}`}
                  >
                    <span className="text-sm font-bold text-foreground">{i + 1}</span>
                  </div>
                  <div>
                    <h3 className="text-foreground font-semibold mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
