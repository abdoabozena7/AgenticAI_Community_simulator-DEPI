import { Brain, MessageSquareMore, MoonStar, Sparkles, SunMedium } from 'lucide-react';
import type { TopBarStep } from '@/types/simulation';
import { cn } from '@/lib/utils';

export const CATEGORY_OPTIONS = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'E-commerce',
  'Entertainment', 'Social', 'B2B SaaS', 'Consumer Apps', 'Hardware',
];

export const AUDIENCE_OPTIONS = [
  'Gen Z (18-24)', 'Millennials (25-40)', 'Gen X (41-56)', 'Boomers (57-75)',
  'Developers', 'Enterprises', 'SMBs', 'Consumers', 'Students', 'Professionals',
];

export const MATURITY_LEVELS = [
  { value: 'concept', label: 'Concept', icon: 'C' },
  { value: 'prototype', label: 'Prototype', icon: 'P' },
  { value: 'mvp', label: 'MVP', icon: 'M' },
  { value: 'launched', label: 'Launched', icon: 'L' },
];

export const GOAL_OPTIONS = [
  'Market Validation', 'Funding Readiness', 'User Acquisition',
  'Product-Market Fit', 'Competitive Analysis', 'Growth Strategy',
];

interface TopBarProps {
  language: 'ar' | 'en';
  theme?: string;
  activePanel?: 'config' | 'chat' | 'reasoning';
  reasoningCount?: number;
  screenTitle: string;
  stageLabel: string;
  currentStatusLabel: string;
  currentStatusTone?: 'idle' | 'info' | 'success' | 'warning' | 'error';
  currentStepLoading?: boolean;
  steps?: TopBarStep[];
  onPanelChange?: (panel: 'config' | 'chat' | 'reasoning') => void;
  configDisabled?: boolean;
  configDisabledReason?: string;
  reasoningDisabled?: boolean;
  reasoningDisabledReason?: string;
}

const toneClasses: Record<NonNullable<TopBarProps['currentStatusTone']>, string> = {
  idle: 'border-border/60 bg-background/65 text-muted-foreground',
  info: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  error: 'border-rose-400/35 bg-rose-500/10 text-rose-100',
};

export function TopBar({
  language,
  theme = 'dark',
  activePanel = 'chat',
  reasoningCount = 0,
  screenTitle,
  stageLabel,
  currentStatusLabel,
  currentStatusTone = 'idle',
  currentStepLoading = false,
  steps = [],
  onPanelChange,
  configDisabled = false,
  configDisabledReason,
  reasoningDisabled = false,
  reasoningDisabledReason,
}: TopBarProps) {
  const panelItems = [
    { key: 'chat' as const, label: language === 'ar' ? 'الدردشة' : 'Chat', icon: MessageSquareMore },
    { key: 'reasoning' as const, label: language === 'ar' ? 'النقاش' : 'Reasoning', icon: Brain },
    { key: 'config' as const, label: language === 'ar' ? 'الإعدادات' : 'Config', icon: Sparkles },
  ];

  return (
    <div className="mx-4 mt-3 rounded-[30px] border border-border/60 bg-card/75 px-4 py-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.78)] backdrop-blur-xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground sm:text-xl">{screenTitle}</h1>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {stageLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                {theme === 'dark' ? <MoonStar className="h-3.5 w-3.5" /> : <SunMedium className="h-3.5 w-3.5" />}
                <span>{language === 'ar' ? (theme === 'dark' ? 'الوضع الداكن' : 'الوضع الفاتح') : (theme === 'dark' ? 'Dark mode' : 'Light mode')}</span>
              </span>
            </div>
            <div className={cn('mt-3 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-sm', toneClasses[currentStatusTone])}>
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  currentStatusTone === 'success' && 'bg-emerald-300',
                  currentStatusTone === 'warning' && 'bg-amber-300',
                  currentStatusTone === 'error' && 'bg-rose-300',
                  (currentStatusTone === 'idle' || currentStatusTone === 'info') && 'bg-white/80',
                  currentStepLoading && 'animate-pulse',
                )}
                aria-hidden="true"
              />
              <span className="truncate">{currentStatusLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 xl:min-w-[360px]">
            {panelItems.map((item) => {
              const Icon = item.icon;
              const disabled = (item.key === 'config' && configDisabled) || (item.key === 'reasoning' && reasoningDisabled);
              const disabledReason = item.key === 'config' ? configDisabledReason : item.key === 'reasoning' ? reasoningDisabledReason : undefined;
              const label = item.key === 'reasoning' && reasoningCount > 0
                ? `${item.label} (${reasoningCount})`
                : item.label;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => !disabled && onPanelChange?.(item.key)}
                  disabled={disabled}
                  title={disabled ? disabledReason : undefined}
                  className={cn(
                    'flex h-11 items-center justify-center gap-2 rounded-full border text-sm font-semibold transition-all duration-200',
                    activePanel === item.key
                      ? 'border-primary bg-primary text-primary-foreground shadow-[0_10px_20px_-16px_rgba(255,255,255,0.9)]'
                      : 'border-border/60 bg-background/65 text-muted-foreground hover:border-primary/30 hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {steps.length ? (
          <div className="overflow-x-auto scrollbar-thin">
            <div className="flex min-w-max items-center gap-2 pb-1" dir="rtl">
              {steps.map((step, index) => (
                <div key={step.key} className="flex items-center gap-2">
                  <div
                    className={cn(
                      'group flex min-w-[132px] items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all duration-300',
                      step.state === 'completed' && 'border-emerald-400/40 bg-emerald-500/12 text-emerald-100',
                      step.state === 'current' && 'border-white/35 bg-white text-slate-950 shadow-[0_14px_28px_-20px_rgba(255,255,255,0.9)]',
                      step.state === 'upcoming' && 'border-amber-400/40 bg-amber-500/12 text-amber-100',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300',
                        step.state === 'completed' && 'bg-emerald-400 text-slate-950',
                        step.state === 'current' && 'bg-slate-950 text-white',
                        step.state === 'upcoming' && 'bg-amber-300 text-slate-950',
                      )}
                    >
                      {step.state === 'current' ? (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold">{index + 1}</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{step.label}</div>
                      {step.subtleStatus ? (
                        <div className={cn('truncate text-[11px]', step.state === 'current' ? 'text-slate-700' : 'text-current/70')}>
                          {step.subtleStatus}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {index < steps.length - 1 ? (
                    <div
                      className={cn(
                        'h-px w-6 shrink-0 transition-colors duration-300',
                        step.state === 'completed' ? 'bg-emerald-400/60' : 'bg-border/70',
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
