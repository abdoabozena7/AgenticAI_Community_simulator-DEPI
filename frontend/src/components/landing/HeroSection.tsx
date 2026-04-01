import { useEffect, useMemo, useState } from 'react';
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
  const [typedTitle1, setTypedTitle1] = useState('');
  const [typedTitle2, setTypedTitle2] = useState('');
  const title1 = t('hero.title1');
  const title2 = t('hero.title2');
  const title1Chars = useMemo(() => Array.from(title1), [title1]);
  const title2Chars = useMemo(() => Array.from(title2), [title2]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const schedule = (fn: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
      timers.push(id);
    };

    setTypedTitle1('');
    setTypedTitle2('');

    title1Chars.forEach((_, index) => { 
      schedule(() => {
        setTypedTitle1(title1Chars.slice(0, index + 1).join(''));
      }, index * 82); //
    });

    const lineTwoStartDelay = title1Chars.length * 82 + 160;  
    title2Chars.forEach((_, index) => {
      schedule(() => {
        setTypedTitle2(title2Chars.slice(0, index + 1).join(''));
      }, lineTwoStartDelay + index * 42); 
    });

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [title1Chars, title2Chars]);

  return (
    <section
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-28 md:pt-32"
    >
      {/* Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_10%,rgba(120,72,190,0.22),transparent_52%),linear-gradient(180deg,rgba(0,0,0,0.01),rgba(0,0,0,0.12))]" />

      {/* Animated grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.028]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--foreground) / 0.1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.1) 1px, transparent 1px)',
          backgroundSize: '84px 84px',
        }}
      />

      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-[40%] h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 opacity-[0.18] blur-3xl">
        <div 
          className="h-full w-full rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(82, 39, 255, 0.92) 0%, rgba(38, 22, 86, 0.72) 48%, transparent 76%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        {/* Badge */}
        <div className="mb-7 md:mb-9">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-foreground/85 backdrop-blur-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
              <span className="text-[11px] font-bold leading-none">AS</span>
            </div>
            <span className="font-medium tracking-tight">ASSET</span>
          </div>
        </div>

        {/* Title */}
        <h1
          className={`${isRTL ? 'hero-title-ar' : 'font-display'} font-semibold text-foreground ${
            isRTL
              ? 'max-w-[13.5ch] text-[3.25rem] leading-[1.08] tracking-[-0.02em] md:text-[4.45rem] lg:text-[5.05rem] mb-4'
              : 'max-w-[12ch] text-5xl leading-[1.02] tracking-[-0.05em] md:text-7xl lg:text-[7rem] mb-4'
          }`}
        >
          <span className="block min-h-[1.2em] md:whitespace-nowrap">
            {typedTitle1}
            {typedTitle1.length < title1.length ? <span className="ml-1 inline-block h-[0.9em] w-px animate-pulse bg-current align-middle" /> : null}
          </span>
          <span className="mt-1 block text-foreground md:whitespace-nowrap">
            {typedTitle2}
            {typedTitle1.length === title1.length && typedTitle2.length < title2.length ? (
              <span className="ml-1 inline-block h-[0.9em] w-px animate-pulse bg-current align-middle" />
            ) : null}
          </span>
        </h1>

        {/* Subtitle */}
        <p
          className={`text-muted-foreground mx-auto ${
            isRTL
              ? 'mb-8 max-w-xl text-[1rem] leading-[1.85] md:text-[1.08rem]'
              : 'mb-8 max-w-2xl text-lg leading-relaxed md:text-[1.15rem]'
          }`}
        >
          {t('hero.subtitle')}
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <RippleButton
            onClick={onGetStarted}
            size="lg"
            rippleColor="rgba(0, 255, 255, 0.3)"
            className="group min-w-[230px] rounded-full bg-foreground px-8 py-5 text-[0.98rem] font-semibold text-background hover:bg-foreground/90 rgb-shadow-hover"
          >
            {t('hero.cta')}
            <ArrowRight className={`w-4 h-4 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
          </RippleButton>

          <RippleButton
            onClick={() => setIsVideoOpen(true)}
            variant="ghost"
            size="lg"
            rippleColor="rgba(255, 0, 255, 0.2)"
            className="rounded-full px-7 py-5 text-[0.98rem] text-foreground/72 hover:bg-white/[0.04] hover:text-foreground rgb-shadow-hover"
          >
            <Play className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('hero.watchDemo')}
          </RippleButton>
        </div>

        <VideoModal isOpen={isVideoOpen} onClose={() => setIsVideoOpen(false)} />
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="w-6 h-10 rounded-full border-2 border-border flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-muted-foreground rounded-full" />
        </div>
      </div>
    </section>
  );
}
