import { Brain, LayoutPanelTop, MessageSquareMore, MoonStar, Sparkles, SunMedium } from 'lucide-react';
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
  selectedCategory?: string;
  selectedAudiences?: string[];
  selectedGoals?: string[];
  riskLevel?: number;
  maturity?: string;
  activePanel?: 'config' | 'chat' | 'reasoning';
  reasoningCount?: number;
  currentPhaseLabel?: string;
  searchLabel?: string;
  onPanelChange?: (panel: 'config' | 'chat' | 'reasoning') => void;
}

const translations: Record<string, string> = {
  Technology: 'تكنولوجيا',
  Healthcare: 'رعاية صحية',
  Finance: 'تمويل',
  Education: 'تعليم',
  'E-commerce': 'تجارة إلكترونية',
  Entertainment: 'ترفيه',
  Social: 'مجتمعات',
  'B2B SaaS': 'برمجيات أعمال',
  'Consumer Apps': 'تطبيقات مستهلكين',
  Hardware: 'أجهزة',
};

export function TopBar({
  language,
  theme = 'dark',
  selectedCategory,
  selectedAudiences = [],
  selectedGoals = [],
  riskLevel = 50,
  maturity = 'concept',
  activePanel = 'chat',
  reasoningCount = 0,
  currentPhaseLabel,
  searchLabel,
  onPanelChange,
}: TopBarProps) {
  const audienceLabel = selectedAudiences.length
    ? selectedAudiences.slice(0, 2).join(language === 'ar' ? '، ' : ', ')
    : (language === 'ar' ? 'غير محدد' : 'Not set');
  const goalLabel = selectedGoals.length
    ? selectedGoals.slice(0, 2).join(language === 'ar' ? '، ' : ', ')
    : (language === 'ar' ? 'بدون هدف واضح' : 'No explicit goal');

  return (
    <div className="mx-4 mt-3 rounded-[28px] border border-border/60 bg-card/70 px-4 py-3 backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
            <LayoutPanelTop className="h-4 w-4" />
            <span>{currentPhaseLabel || (language === 'ar' ? 'مساحة العمل' : 'Workspace')}</span>
          </div>
          <div className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-sm text-muted-foreground">
            {searchLabel || (language === 'ar' ? 'جاهز للبحث' : 'Ready for search')}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-sm text-muted-foreground">
            {theme === 'dark' ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
            <span>{language === 'ar' ? (theme === 'dark' ? 'الوضع الداكن' : 'الوضع الأبيض') : (theme === 'dark' ? 'Dark mode' : 'White mode')}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 xl:w-[360px]">
          {[
            { key: 'chat', label: language === 'ar' ? 'الدردشة' : 'Chat', icon: MessageSquareMore },
            { key: 'reasoning', label: language === 'ar' ? 'النقاش' : 'Reasoning', icon: Brain },
            { key: 'config', label: language === 'ar' ? 'الإعدادات' : 'Config', icon: Sparkles },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onPanelChange?.(item.key as 'config' | 'chat' | 'reasoning')}
                className={cn(
                  'flex h-11 items-center justify-center gap-2 rounded-full border text-sm font-semibold transition',
                  activePanel === item.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.key === 'reasoning' && reasoningCount > 0 ? `${item.label} (${reasoningCount})` : item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-4">
        <div className="rounded-[22px] border border-border/55 bg-background/45 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{language === 'ar' ? 'الفئة' : 'Category'}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{language === 'ar' ? translations[selectedCategory || ''] || selectedCategory || 'غير محددة' : selectedCategory || 'Not set'}</div>
        </div>
        <div className="rounded-[22px] border border-border/55 bg-background/45 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{language === 'ar' ? 'الجمهور' : 'Audience'}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{audienceLabel}</div>
        </div>
        <div className="rounded-[22px] border border-border/55 bg-background/45 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{language === 'ar' ? 'الأهداف' : 'Goals'}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{goalLabel}</div>
        </div>
        <div className="rounded-[22px] border border-border/55 bg-background/45 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{language === 'ar' ? 'المخاطرة / المرحلة' : 'Risk / stage'}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{riskLevel}% · {maturity}</div>
        </div>
      </div>
    </div>
  );
}
