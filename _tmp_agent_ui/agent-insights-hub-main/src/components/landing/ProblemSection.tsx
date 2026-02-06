import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AlertTriangle, MessageCircle, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

export function ProblemSection() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Title reveal with spiral effect
      gsap.fromTo(
        '.problem-title',
        { opacity: 0, y: 40, rotate: -5, scale: 0.9 },
        {
          opacity: 1,
          y: 0,
          rotate: 0,
          scale: 1,
          duration: 1,
          ease: 'elastic.out(1, 0.5)',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );

      // Cards stagger reveal with faster animation
      const cards = cardsRef.current?.querySelectorAll('.problem-card');
      if (cards) {
        gsap.fromTo(
          cards,
          {
            opacity: 0,
            rotateX: -45,
            y: 60,
            scale: 0.8,
          },
          {
            opacity: 1,
            rotateX: 0,
            y: 0,
            scale: 1,
            stagger: 0.1,
            duration: 0.2,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: cardsRef.current,
              start: 'top 50%',
            },
          }
        );

        // Add floating animation after reveal
        cards.forEach((card, i) => {
          gsap.to(card, {
            y: 'random(-8, 8)',
            rotation: 'random(-1, 1)',
            duration: 'random(2, 3)',
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut',
            delay: i * 0.3,
            scrollTrigger: {
              trigger: cardsRef.current,
              start: 'top 80%',
            },
          });
        });
      }
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  const problems = [
    {
      icon: MessageCircle,
      title: t('problem.point1'),
      desc: t('problem.point1Desc'),
      color: 'rgb-cyan',
    },
    {
      icon: AlertTriangle,
      title: t('problem.point2'),
      desc: t('problem.point2Desc'),
      color: 'rgb-magenta',
    },
    {
      icon: Users,
      title: t('problem.point3'),
      desc: t('problem.point3Desc'),
      color: 'rgb-yellow',
    },
  ];

  return (
    <section
      ref={sectionRef}
      className="relative py-32 px-6 bg-gradient-to-b from-secondary/20 to-background overflow-hidden"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 problem-title">
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {t('problem.tag')}
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mt-4 mb-4">
            {t('problem.title')}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('problem.desc')}
          </p>
        </div>

        <div
          ref={cardsRef}
          className="grid md:grid-cols-3 gap-6"
          style={{ perspective: '1000px' }}
        >
          {problems.map((problem, i) => (
            <div
              key={i}
              className="problem-card group p-6 rounded-2xl liquid-glass border border-border/50 hover:border-white/20 transition-all duration-300"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div
                className={`w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-all duration-300 rgb-icon-${problem.color.replace('rgb-', '')}`}
              >
                <problem.icon className="w-7 h-7 text-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                {problem.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {problem.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
