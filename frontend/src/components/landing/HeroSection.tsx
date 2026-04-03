import { useEffect, useMemo, useState } from 'react';
import { RippleButton } from '@/components/ui/ripple-button';
import { ArrowRight, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { TubesBackground } from '@/components/landing/TubesBackground';

interface HeroSectionProps {
  onGetStarted: () => void;
}

export function HeroSection({ onGetStarted }: HeroSectionProps) {
  const { t, isRTL } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [typedTitle1, setTypedTitle1] = useState('');
  const [typedTitle2, setTypedTitle2] = useState('');
  const [showSupportingContent, setShowSupportingContent] = useState(false);
  const title1 = t('hero.title1');
  const title2 = t('hero.title2');
  const title1Chars = useMemo(() => Array.from(title1), [title1]);
  const title2Chars = useMemo(() => Array.from(title2), [title2]);
  const firstLineTypingDelayMs = 160;
  const secondLineTypingDelayMs = 115;
  const lineBreakPauseMs = 340;
  const supportingContentPauseMs = 260;

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
    setShowSupportingContent(false);

    title1Chars.forEach((_, index) => { 
      schedule(() => {
        setTypedTitle1(title1Chars.slice(0, index + 1).join(''));
      }, index * firstLineTypingDelayMs);
    });

    const lineTwoStartDelay = title1Chars.length * firstLineTypingDelayMs + lineBreakPauseMs;
    title2Chars.forEach((_, index) => {
      schedule(() => {
        setTypedTitle2(title2Chars.slice(0, index + 1).join(''));
      }, lineTwoStartDelay + index * secondLineTypingDelayMs);
    });

    const supportingContentDelay = lineTwoStartDelay + title2Chars.length * secondLineTypingDelayMs + supportingContentPauseMs;
    schedule(() => {
      setShowSupportingContent(true);
    }, supportingContentDelay);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [
    firstLineTypingDelayMs,
    lineBreakPauseMs,
    secondLineTypingDelayMs,
    supportingContentPauseMs,
    title1Chars,
    title2Chars,
  ]);

  const handleScrollToDemo = () => {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-28 md:pt-32"
    >
      <TubesBackground theme={theme} />
      <div
        className={`pointer-events-none absolute inset-0 ${
          isDark
            ? 'bg-[linear-gradient(180deg,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.56)_28%,rgba(0,0,0,0.72)_100%)]'
            : 'bg-transparent'
        }`}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        {/* Badge */}
        <div
          className={`mb-7 transition-[opacity,transform] duration-500 md:mb-9 ${
            showSupportingContent ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
        >
          <div
            className={`inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm backdrop-blur-sm ${
              isDark
                ? 'border border-white/12 bg-white/8 text-white'
                : 'border border-slate-900/12 bg-white text-slate-950 shadow-[0_10px_30px_rgba(15,23,42,0.08)]'
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                isDark ? 'bg-white text-black' : 'bg-black text-white'
              }`}
            >
              <span className="text-[11px] font-bold leading-none">AS</span>
            </div>
            <span className="font-medium tracking-tight">ASSET</span>
          </div>
        </div>

        {/* Title */}
        <h1
          className={`${isRTL ? 'hero-title-ar' : 'font-display'} font-semibold ${
            isDark ? 'text-white' : 'text-slate-950'
          } ${
            isRTL
              ? 'max-w-[13.5ch] text-[3.25rem] leading-[1.08] tracking-[-0.02em] md:text-[4.45rem] lg:text-[5.05rem] mb-4'
              : 'max-w-[12ch] text-5xl leading-[1.02] tracking-[-0.05em] md:text-7xl lg:text-[7rem] mb-4'
          }`}
          style={{ color: isDark ? '#ffffff' : '#020617' }}
        >
          <span className="block min-h-[1.2em] md:whitespace-nowrap">
            {typedTitle1}
            {typedTitle1.length < title1.length ? <span className="ml-1 inline-block h-[0.9em] w-px animate-pulse bg-current align-middle" /> : null}
          </span>
          <span className="mt-1 block md:whitespace-nowrap">
            {typedTitle2}
            {typedTitle1.length === title1.length && typedTitle2.length < title2.length ? (
              <span className="ml-1 inline-block h-[0.9em] w-px animate-pulse bg-current align-middle" />
            ) : null}
          </span>
        </h1>

        {/* Subtitle */}
        <p
          className={`mx-auto ${
            isDark ? 'text-white/72' : 'text-slate-700'
          } ${
            isRTL
              ? 'mb-8 max-w-xl text-[1rem] leading-[1.85] md:text-[1.08rem]'
              : 'mb-8 max-w-2xl text-lg leading-relaxed md:text-[1.15rem]'
          } transition-[opacity,transform] duration-500 ${
            showSupportingContent ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
          style={{ color: isDark ? 'rgba(255,255,255,0.72)' : '#334155' }}
        >
          {t('hero.subtitle')}
        </p>

        {/* CTAs */}
        <div
          className={`flex flex-col items-center justify-center gap-3 transition-[opacity,transform] duration-500 sm:flex-row ${
            showSupportingContent ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <RippleButton
            onClick={onGetStarted}
            size="lg"
            rippleColor={isDark ? 'rgba(0, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.15)'}
            className={`group min-w-[230px] rounded-full px-8 py-5 text-[0.98rem] font-semibold rgb-shadow-hover ${
              isDark
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-black text-white hover:bg-black/90'
            }`}
          >
            {t('hero.cta')}
            <ArrowRight className={`w-4 h-4 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
          </RippleButton>

          <RippleButton
            onClick={handleScrollToDemo}
            variant="ghost"
            size="lg"
            rippleColor={isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.08)'}
            className={`rounded-full px-7 py-5 text-[0.98rem] rgb-shadow-hover ${
              isDark
                ? 'text-white/76 hover:bg-white/8 hover:text-white'
                : 'text-slate-900 hover:bg-black/5 hover:text-black'
            }`}
          >
            <Play className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('hero.watchDemo')}
          </RippleButton>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div
          className={`flex h-10 w-6 items-start justify-center rounded-full border-2 p-2 ${
            isDark ? 'border-white/25' : 'border-slate-900/18'
          }`}
        >
          <div className={`h-2 w-1 animate-bounce rounded-full ${isDark ? 'bg-white/70' : 'bg-slate-900/55'}`} />
        </div>
      </div>
    </section>
  );
}
