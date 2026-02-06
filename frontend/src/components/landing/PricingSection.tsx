import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, Zap, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

gsap.registerPlugin(ScrollTrigger);

interface PricingSectionProps {
  onGetStarted: () => void;
}

const plans = [
  {
    name: 'Starter',
    price: '$0',
    period: '/month',
    description: 'Perfect for trying out the platform',
    icon: Zap,
    features: [
      '3 simulations per day',
      '50 AI agents per simulation',
      'Basic analytics',
      'Email support',
      'Community access',
    ],
    cta: 'Start Free',
    popular: false,
    gradient: 'from-cyan-500/20 to-cyan-500/5',
    iconColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/20 hover:border-cyan-500/40',
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'For serious entrepreneurs and teams',
    icon: Sparkles,
    features: [
      'Unlimited simulations',
      '500 AI agents per simulation',
      'Advanced analytics & reports',
      'Priority support',
      'API access',
      'Custom agent personas',
    ],
    cta: 'Start 7-Day Trial',
    popular: true,
    gradient: 'from-magenta-500/20 via-purple-500/20 to-magenta-500/5',
    iconColor: 'text-magenta-400',
    borderColor: 'border-magenta-500/40',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations',
    icon: Crown,
    features: [
      'Everything in Pro',
      'Unlimited agents',
      'White-label solution',
      'Dedicated account manager',
      'Custom integrations',
      'SLA guarantee',
      'On-premise deployment',
    ],
    cta: 'Contact Sales',
    popular: false,
    gradient: 'from-yellow-500/20 to-yellow-500/5',
    iconColor: 'text-yellow-400',
    borderColor: 'border-yellow-500/20 hover:border-yellow-500/40',
  },
];

export function PricingSection({ onGetStarted }: PricingSectionProps) {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.pricing-header',
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
          },
        }
      );

      gsap.fromTo(
        '.pricing-card',
        { opacity: 0, y: 60, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          stagger: 0.1,
          duration: 0.5,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: cardsRef.current,
            start: 'top 80%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="relative py-32 px-6 bg-background overflow-hidden"
    >
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-20 blur-3xl pointer-events-none">
        <div className="w-full h-full rounded-full bg-gradient-to-r from-cyan-500 via-magenta-500 to-yellow-500" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-16 pricing-header">
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {t('pricing.tag')}
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mt-4 mb-4">
            {t('pricing.title')}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('pricing.desc')}
          </p>
        </div>

        <div ref={cardsRef} className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`pricing-card relative p-8 rounded-3xl liquid-glass border ${plan.borderColor} transition-all duration-300 ${
                plan.popular ? 'md:-translate-y-4 md:scale-105' : ''
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-magenta-500 to-purple-500 text-white text-sm font-medium shadow-lg shadow-magenta-500/25">
                    <Sparkles className="w-3.5 h-3.5" />
                    Most Popular
                  </div>
                </div>
              )}

              {/* Gradient overlay */}
              <div className={`absolute inset-0 rounded-3xl bg-gradient-to-b ${plan.gradient} pointer-events-none`} />

              <div className="relative z-10">
                {/* Icon */}
                <div className={`w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-6 ${plan.iconColor}`}>
                  <plan.icon className="w-6 h-6" />
                </div>

                {/* Name & Price */}
                <h3 className="text-xl font-bold text-foreground mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-muted-foreground">
                      <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-foreground" />
                      </div>
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  onClick={onGetStarted}
                  className={`w-full rounded-full py-6 text-base font-semibold transition-all duration-300 ${
                    plan.popular
                      ? 'bg-gradient-to-r from-magenta-500 to-purple-500 text-white hover:opacity-90 shadow-lg shadow-magenta-500/25'
                      : 'liquid-glass-button'
                  }`}
                >
                  {plan.cta}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          All plans include a 7-day free trial. No credit card required.
        </p>
      </div>
    </section>
  );
}
