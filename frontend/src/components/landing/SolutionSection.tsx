import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

export function SolutionSection() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Badge with crazy spiral entrance
      gsap.fromTo(
        badgeRef.current,
        { scale: 0, rotate: 720, opacity: 0 },
        {
          scale: 1,
          rotate: 0,
          opacity: 1,
          duration: 1.2,
          ease: 'elastic.out(1, 0.3)',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
          },
        }
      );

      // Text reveal with wave effect - each element comes from different direction
      const textElements = textRef.current?.querySelectorAll('.reveal-text');
      if (textElements) {
        textElements.forEach((el, i) => {
          const directions = [
            { x: -200, y: 0, rotate: -15 },
            { x: 200, y: 0, rotate: 15 },
            { x: 0, y: 100, rotate: 0 },
          ];
          const dir = directions[i % 3];
          
          gsap.fromTo(
            el,
            { opacity: 0, x: dir.x, y: dir.y, rotate: dir.rotate, scale: 0.8 },
            {
              opacity: 1,
              x: 0,
              y: 0,
              rotate: 0,
              scale: 1,
              duration: 1,
              ease: 'power4.out',
              scrollTrigger: {
                trigger: textRef.current,
                start: 'top 75%',
              },
              delay: i * 0.15,
            }
          );
        });
      }

      // Floating particles with more chaotic movement
      const particles = sectionRef.current?.querySelectorAll('.particle');
      if (particles) {
        particles.forEach((particle, i) => {
          // Initial burst animation
          gsap.fromTo(
            particle,
            { scale: 0, opacity: 0 },
            {
              scale: 1,
              opacity: 0.5,
              duration: 0.5,
              ease: 'back.out(2)',
              scrollTrigger: {
                trigger: sectionRef.current,
                start: 'top 70%',
              },
              delay: i * 0.1,
            }
          );
          
          // Continuous floating
          gsap.to(particle, {
            y: 'random(-50, 50)',
            x: 'random(-40, 40)',
            rotation: 'random(-180, 180)',
            scale: 'random(0.5, 1.5)',
            duration: 'random(4, 7)',
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
            delay: i * 0.3,
          });
        });
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-40 px-6 bg-background overflow-hidden"
    >
      {/* Decorative particles */}
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="particle absolute w-2 h-2 rounded-full opacity-30"
          style={{
            background: `rgb(var(--rgb-${['cyan', 'magenta', 'yellow'][i % 3]}))`,
            top: `${20 + i * 12}%`,
            left: `${10 + i * 15}%`,
          }}
        />
      ))}

      <div className="max-w-4xl mx-auto text-center relative z-10">
        {/* Badge */}
        <div
          ref={badgeRef}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-foreground text-background text-sm font-semibold mb-8 rgb-shadow"
        >
          <Sparkles className="w-4 h-4" />
          {t('solution.tag')}
        </div>

        <div ref={textRef} style={{ perspective: '1000px' }}>
          <h2 className="reveal-text text-5xl md:text-7xl font-bold text-foreground mb-4">
            {t('solution.title')}
          </h2>
          <p className="reveal-text text-xl md:text-2xl text-muted-foreground mb-6">
            {t('solution.subtitle')}
          </p>
          <p className="reveal-text text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t('solution.desc')}
          </p>
        </div>

        {/* RGB line decoration */}
        <div className="mt-16 h-1 w-48 mx-auto rounded-full overflow-hidden">
          <div
            className="w-full h-full"
            style={{
              background: 'var(--gradient-rgb)',
              backgroundSize: '200% 100%',
              animation: 'rgb-shift 3s linear infinite',
            }}
          />
        </div>
      </div>
    </section>
  );
}
