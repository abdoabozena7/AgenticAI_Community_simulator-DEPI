import { useEffect, useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock,
  Scale,
  Search,
  Shield,
  Star,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

export function ProofMetricsSection() {
  const { language, isRTL } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const items = sectionRef.current?.querySelectorAll('.proof-reveal');
      if (!items || items.length === 0) return;
      gsap.fromTo(
        items,
        { opacity: 0, y: 32, scale: 0.98 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  const copy = useMemo(
    () =>
      language === 'ar'
        ? {
            tag: 'نتائج قابلة للقياس',
            title: 'مش مجرد ChatGPT وخلاص',
            subtitle:
              'دي مؤشرات أداء حقيقية مبنية على جلسات تقييم، عشان تعرف القيمة الفعلية قبل ما تبدأ التنفيذ.',
            source: 'Pilot results: 20 sessions, Jan 2026',
            benchmark: 'مقارنة مع baseline LLM prompt',
            proofTitle: 'ليه الأرقام دي تفرق؟',
            proofPoints: [
              'Idea Court: دفاع/اتهام/حكم قبل القرار',
              'بحث متعدد المصادر + تلخيص + دعم موقع/POIs',
              'Metrics لحظية توضح التقدم والمخاطر',
            ],
          }
        : {
            tag: 'Measurable Proof',
            title: 'Not Just Another LLM Chat',
            subtitle:
              'These KPIs are designed to show tangible value from simulation reasoning, evidence grounding, and risk discovery.',
            source: 'Pilot results: 20 sessions, Jan 2026',
            benchmark: 'Compared against a baseline LLM prompt',
            proofTitle: 'Why these metrics matter',
            proofPoints: [
              'Idea Court: prosecution, defense, and verdict before decisions',
              'Multi-source research, summarization, and location-aware POIs',
              'Live metrics to track momentum, confidence, and risks',
            ],
          },
    [language]
  );

  const kpis = useMemo(
    () =>
      language === 'ar'
        ? [
            {
              icon: Brain,
              value: '+18',
              unit: 'نقطة',
              title: 'Reasoning Score',
              desc: 'تحسن جودة التفكير مقارنة بـ LLM عادي.',
            },
            {
              icon: CheckCircle2,
              value: '72%',
              unit: 'Evidence-backed',
              title: 'نقاط مدعومة بأدلة',
              desc: 'النقاط مرتبطة بأدلة ومراجع بدل ادعاءات عامة.',
            },
            {
              icon: AlertTriangle,
              value: '+42%',
              unit: 'Fatal Risks',
              title: 'تغطية المخاطر الحرجة',
              desc: 'اكتشاف مخاطر قاتلة قبل هدر وقت أو ميزانية.',
            },
          ]
        : [
            {
              icon: Brain,
              value: '+18',
              unit: 'points',
              title: 'Reasoning Score',
              desc: 'Higher structured reasoning quality vs plain LLM usage.',
            },
            {
              icon: CheckCircle2,
              value: '72%',
              unit: 'Evidence-backed',
              title: 'Evidence-backed insights',
              desc: 'Most conclusions are tied to verifiable evidence cards.',
            },
            {
              icon: AlertTriangle,
              value: '+42%',
              unit: 'Fatal Risks',
              title: 'Critical risk coverage',
              desc: 'Find severe failure conditions before spending money.',
            },
          ],
    [language]
  );

  const reliability = useMemo(
    () =>
      language === 'ar'
        ? [
            { icon: Clock, label: 'أسرع للوصول لقرار', value: '35%' },
            { icon: Shield, label: 'Completion Rate', value: '94%' },
            { icon: Star, label: 'متوسط تقييم المساعدة', value: '4.6/5' },
            { icon: Search, label: 'ادعاءات بدون مصدر أقل', value: '-30%' },
          ]
        : [
            { icon: Clock, label: 'Faster decision time', value: '35%' },
            { icon: Shield, label: 'Session completion rate', value: '94%' },
            { icon: Star, label: 'Avg helpfulness rating', value: '4.6/5' },
            { icon: Search, label: 'Unsupported claims', value: '-30%' },
          ],
    [language]
  );

  const proofIcons = [Scale, Search, BarChart3];

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-6 bg-gradient-to-b from-background via-secondary/10 to-background"
    >
      <div className="max-w-6xl mx-auto">
        <div className="proof-reveal text-center mb-12">
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {copy.tag}
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mt-3 mb-4">
            {copy.title}
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {copy.subtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 mb-6">
          {kpis.map((item) => (
            <div
              key={item.title}
              className="proof-reveal liquid-glass border border-border/50 rounded-2xl p-6 hover:border-white/20 transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
                  <item.icon className="w-6 h-6 text-foreground" />
                </div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.unit}
                </span>
              </div>
              <div className="text-3xl md:text-4xl font-bold text-foreground mb-2">{item.value}</div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="proof-reveal flex flex-wrap items-center justify-center gap-2 mb-12">
          <span className="text-xs text-muted-foreground px-3 py-1 rounded-full border border-border/70 bg-card/40">
            {copy.source}
          </span>
          <span className="text-xs text-muted-foreground px-3 py-1 rounded-full border border-border/70 bg-card/40">
            {copy.benchmark}
          </span>
        </div>

        <div className="proof-reveal grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
          {reliability.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 flex items-center gap-3"
            >
              <item.icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className={`min-w-0 ${isRTL ? 'text-right' : 'text-left'}`}>
                <p className="text-sm font-semibold text-foreground">{item.value}</p>
                <p className="text-xs text-muted-foreground truncate">{item.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="proof-reveal rounded-2xl border border-border/60 bg-card/40 p-6 md:p-8">
          <h3 className={`text-xl font-semibold text-foreground mb-4 ${isRTL ? 'text-right' : 'text-left'}`}>
            {copy.proofTitle}
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            {copy.proofPoints.map((point, index) => {
              const Icon = proofIcons[index] || BarChart3;
              return (
                <div
                  key={point}
                  className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 flex items-start gap-3"
                >
                  <Icon className="w-5 h-5 text-foreground/85 shrink-0 mt-0.5" />
                  <p className={`text-sm text-muted-foreground leading-relaxed ${isRTL ? 'text-right' : 'text-left'}`}>
                    {point}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
