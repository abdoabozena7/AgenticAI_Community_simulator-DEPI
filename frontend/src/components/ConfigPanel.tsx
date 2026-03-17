import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Flag, Sparkles, Target, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { CATEGORY_OPTIONS, AUDIENCE_OPTIONS, GOAL_OPTIONS, MATURITY_LEVELS } from '@/components/TopBar';
import { cn } from '@/lib/utils';
import { UserInput } from '@/types/simulation';

export interface SocietyControls {
  diversity: number;
  skepticRatio: number;
  innovationBias: number;
  strictPolicy: boolean;
  humanDebate: boolean;
  personaHint: string;
}

interface ConfigPanelProps {
  value: UserInput;
  onChange: (updates: Partial<UserInput>) => void;
  onSubmit: () => void;
  missingFields: string[];
  language: 'ar' | 'en';
  isSearching: boolean;
  isLocked: boolean;
  lockReason?: string;
  showSocietyBuilder?: boolean;
  onToggleSocietyBuilder?: (open: boolean) => void;
  societyControls?: SocietyControls;
  onSocietyControlsChange?: (updates: Partial<SocietyControls>) => void;
  onOpenStartChoice?: () => void;
  societyAssistantBusy?: boolean;
  societyAssistantAnswer?: string;
  onAskSocietyAssistant?: (question: string) => void;
}

const labelsAr: Record<string, string> = {
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
  'Market Validation': 'تحقق السوق',
  'Funding Readiness': 'جاهزية التمويل',
  'User Acquisition': 'اكتساب المستخدمين',
  'Product-Market Fit': 'ملاءمة المنتج',
  'Competitive Analysis': 'تحليل المنافسين',
  'Growth Strategy': 'استراتيجية النمو',
  Developers: 'مطورون',
  Enterprises: 'شركات كبرى',
  SMBs: 'شركات صغيرة',
  Consumers: 'مستهلكون',
  Students: 'طلاب',
  Professionals: 'محترفون',
  'Gen Z (18-24)': 'جيل زد',
  'Millennials (25-40)': 'جيل الألفية',
  'Gen X (41-56)': 'جيل إكس',
  'Boomers (57-75)': 'الأكبر سنًا',
};

const maturityAr: Record<string, string> = {
  concept: 'فكرة أولية',
  prototype: 'نموذج أولي',
  mvp: 'نسخة أولى',
  launched: 'موجودة في السوق',
};

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border/60 bg-card/70 p-4 backdrop-blur-xl">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-7 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ConfigPanel({
  value,
  onChange,
  onSubmit,
  missingFields,
  language,
  isSearching,
  isLocked,
  lockReason,
  showSocietyBuilder = false,
  onToggleSocietyBuilder,
  societyControls,
  onSocietyControlsChange,
  onOpenStartChoice,
  societyAssistantBusy = false,
  societyAssistantAnswer = '',
  onAskSocietyAssistant,
}: ConfigPanelProps) {
  const countryRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const [societyQuestion, setSocietyQuestion] = useState('');
  const missingSet = useMemo(() => new Set(missingFields), [missingFields]);
  const controlsLocked = isLocked || isSearching;
  const canConfirm = value.idea.trim().length > 0 && missingFields.length === 0;

  useEffect(() => {
    if (controlsLocked || !missingFields.length) return;
    if (missingFields[0] === 'country') countryRef.current?.focus();
    if (missingFields[0] === 'city') cityRef.current?.focus();
  }, [controlsLocked, missingFields]);

  const toggleAudience = (audience: string) => {
    if (controlsLocked) return;
    onChange({
      targetAudience: value.targetAudience.includes(audience)
        ? value.targetAudience.filter((item) => item !== audience)
        : [...value.targetAudience, audience],
    });
  };

  const toggleGoal = (goal: string) => {
    if (controlsLocked) return;
    onChange({
      goals: value.goals.includes(goal)
        ? value.goals.filter((item) => item !== goal)
        : [...value.goals, goal],
    });
  };

  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4 scrollbar-thin" dir="rtl">
      {controlsLocked ? (
        <div className="rounded-[24px] border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm leading-7 text-amber-100">
          {lockReason || (language === 'ar' ? 'أوقف التنفيذ أو انتظر حتى تنتهي المرحلة الحالية لتعديل الإعدادات.' : 'Pause execution or wait for the current phase to end before editing settings.')}
        </div>
      ) : null}

      <Section
        title={language === 'ar' ? 'الموقع والسياق' : 'Location and context'}
        description={language === 'ar' ? 'حدّد أين سيتم اختبار الفكرة حتى تصبح الشخصيات والبحث أكثر واقعية.' : 'Set where the idea will be tested so personas and research stay realistic.'}
        icon={<Target className="h-4 w-4" />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            ref={countryRef}
            value={value.country}
            onChange={(event) => onChange({ country: event.target.value })}
            placeholder={language === 'ar' ? 'الدولة' : 'Country'}
            className={cn('h-12 rounded-2xl border-border/60 bg-background/65 text-base', missingSet.has('country') && 'border-destructive/60')}
            dir="rtl"
            disabled={controlsLocked}
          />
          <Input
            ref={cityRef}
            value={value.city}
            onChange={(event) => onChange({ city: event.target.value })}
            placeholder={language === 'ar' ? 'المدينة' : 'City'}
            className={cn('h-12 rounded-2xl border-border/60 bg-background/65 text-base', missingSet.has('city') && 'border-destructive/60')}
            dir="rtl"
            disabled={controlsLocked}
          />
        </div>
      </Section>

      <Section
        title={language === 'ar' ? 'الفئة والجمهور' : 'Category and audience'}
        description={language === 'ar' ? 'اختر السوق والجمهور الأساسي بدل ترك النظام يتخمن كل شيء.' : 'Define the market and audience instead of leaving everything to inference.'}
        icon={<Users className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div>
            <div className={cn('mb-2 text-sm font-medium text-muted-foreground', missingSet.has('category') && 'text-destructive')}>
              {language === 'ar' ? 'الفئة' : 'Category'}
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((category) => {
                const selected = value.category === category.toLowerCase();
                return (
                  <button
                    key={category}
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => onChange({ category: category.toLowerCase() })}
                    className={cn('rounded-full border px-3 py-2 text-sm transition', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-background/55 text-foreground hover:border-primary/25')}
                  >
                    {language === 'ar' ? labelsAr[category] || category : category}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className={cn('mb-2 text-sm font-medium text-muted-foreground', missingSet.has('target_audience') && 'text-destructive')}>
              {language === 'ar' ? 'الجمهور' : 'Audience'}
            </div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.map((audience) => {
                const selected = value.targetAudience.includes(audience);
                return (
                  <button
                    key={audience}
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => toggleAudience(audience)}
                    className={cn('rounded-full border px-3 py-2 text-sm transition', selected ? 'border-primary bg-primary/12 text-primary' : 'border-border/60 bg-background/55 text-foreground hover:border-primary/25')}
                  >
                    {language === 'ar' ? labelsAr[audience] || audience : audience}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title={language === 'ar' ? 'مرحلة الفكرة وأهدافها' : 'Maturity and goals'}
        description={language === 'ar' ? 'هذه الإعدادات تغيّر طريقة مناقشة الوكلاء للفكرة.' : 'These settings change how agents evaluate the idea.'}
        icon={<Zap className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div>
            <div className={cn('mb-2 text-sm font-medium text-muted-foreground', missingSet.has('idea_maturity') && 'text-destructive')}>
              {language === 'ar' ? 'مرحلة الفكرة' : 'Idea maturity'}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MATURITY_LEVELS.map((level) => {
                const selected = value.ideaMaturity === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => onChange({ ideaMaturity: level.value as UserInput['ideaMaturity'] })}
                    className={cn('rounded-[22px] border px-4 py-3 text-start transition', selected ? 'border-primary bg-primary/12 text-primary' : 'border-border/60 bg-background/55 text-foreground hover:border-primary/25')}
                  >
                    <div className="text-sm font-semibold">{language === 'ar' ? maturityAr[level.value] || level.label : level.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className={cn('mb-2 text-sm font-medium text-muted-foreground', missingSet.has('goals') && 'text-destructive')}>
              {language === 'ar' ? 'الأهداف' : 'Goals'}
            </div>
            <div className="flex flex-wrap gap-2">
              {GOAL_OPTIONS.map((goal) => {
                const selected = value.goals.includes(goal);
                return (
                  <button
                    key={goal}
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => toggleGoal(goal)}
                    className={cn('rounded-full border px-3 py-2 text-sm transition', selected ? 'border-primary bg-primary/12 text-primary' : 'border-border/60 bg-background/55 text-foreground hover:border-primary/25')}
                  >
                    {language === 'ar' ? labelsAr[goal] || goal : goal}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title={language === 'ar' ? 'شدة المخاطرة وحجم المحاكاة' : 'Risk and simulation scale'}
        description={language === 'ar' ? 'تحكم في مزاج السوق وعدد الوكلاء المشاركين.' : 'Control market risk appetite and the size of the simulated population.'}
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>{language === 'ar' ? 'درجة المخاطرة' : 'Risk appetite'}</span>
              <span>{value.riskAppetite}%</span>
            </div>
            <Slider value={[value.riskAppetite]} onValueChange={(next) => onChange({ riskAppetite: next[0] })} max={100} step={1} disabled={controlsLocked} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>{language === 'ar' ? 'عدد الوكلاء' : 'Agents count'}</span>
              <span>{value.agentCount ?? 20}</span>
            </div>
            <Slider value={[value.agentCount ?? 20]} onValueChange={(next) => onChange({ agentCount: Math.min(500, Math.max(5, next[0])) })} min={5} max={500} step={1} disabled={controlsLocked} />
          </div>
        </div>
      </Section>

      <Section
        title={language === 'ar' ? 'لوحة المجتمع' : 'Society builder'}
        description={language === 'ar' ? 'ابدأ بالمجتمع الافتراضي أو افتح البناء المتقدم قبل تشغيل الجلسة.' : 'Start with the default society or open advanced builder controls before running.'}
        icon={<Sparkles className="h-4 w-4" />}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={() => onOpenStartChoice?.()} disabled={controlsLocked}>
            {language === 'ar' ? 'خيارات البدء' : 'Start choices'}
          </Button>
          <Button type="button" className="h-11 rounded-2xl" onClick={() => onToggleSocietyBuilder?.(!showSocietyBuilder)} disabled={controlsLocked}>
            {showSocietyBuilder ? (language === 'ar' ? 'إخفاء البناء المتقدم' : 'Hide advanced builder') : (language === 'ar' ? 'افتح البناء المتقدم' : 'Open advanced builder')}
          </Button>
        </div>

        {showSocietyBuilder && societyControls && onSocietyControlsChange ? (
          <div className="mt-4 space-y-4 rounded-[24px] border border-primary/25 bg-primary/6 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>{language === 'ar' ? 'تنوع المجتمع' : 'Society diversity'}</span>
                <span>{societyControls.diversity}%</span>
              </div>
              <Slider value={[societyControls.diversity]} onValueChange={(next) => onSocietyControlsChange({ diversity: next[0] })} min={0} max={100} step={1} disabled={controlsLocked} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>{language === 'ar' ? 'نسبة المتشككين' : 'Skeptic ratio'}</span>
                <span>{societyControls.skepticRatio}%</span>
              </div>
              <Slider value={[societyControls.skepticRatio]} onValueChange={(next) => onSocietyControlsChange({ skepticRatio: next[0] })} min={0} max={100} step={1} disabled={controlsLocked} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>{language === 'ar' ? 'انحياز الابتكار' : 'Innovation bias'}</span>
                <span>{societyControls.innovationBias}%</span>
              </div>
              <Slider value={[societyControls.innovationBias]} onValueChange={(next) => onSocietyControlsChange({ innovationBias: next[0] })} min={0} max={100} step={1} disabled={controlsLocked} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant={societyControls.strictPolicy ? 'default' : 'outline'} onClick={() => onSocietyControlsChange({ strictPolicy: !societyControls.strictPolicy })} className="rounded-2xl" disabled={controlsLocked}>
                {language === 'ar' ? 'سياسات صارمة' : 'Strict policy'}
              </Button>
              <Button type="button" variant={societyControls.humanDebate ? 'default' : 'outline'} onClick={() => onSocietyControlsChange({ humanDebate: !societyControls.humanDebate })} className="rounded-2xl" disabled={controlsLocked}>
                {language === 'ar' ? 'نقاش بشري' : 'Human debate'}
              </Button>
            </div>
            <Input value={societyControls.personaHint} onChange={(event) => onSocietyControlsChange({ personaHint: event.target.value })} className="h-12 rounded-2xl border-border/60 bg-background/65 text-base" placeholder={language === 'ar' ? 'ملاحظة عن نوع الشخصيات (اختياري)' : 'Hint about persona mix (optional)'} dir="rtl" disabled={controlsLocked} />
            <div className="rounded-[22px] border border-border/60 bg-background/45 p-3">
              <div className="mb-2 text-sm font-medium text-foreground">{language === 'ar' ? 'مساعد المجتمع' : 'Society copilot'}</div>
              <Input value={societyQuestion} onChange={(event) => setSocietyQuestion(event.target.value)} className="h-12 rounded-2xl border-border/60 bg-background/65 text-base" placeholder={language === 'ar' ? 'اسأل عن أفضل توزيع للشخصيات...' : 'Ask for the best persona distribution...'} dir="rtl" disabled={controlsLocked} />
              <Button type="button" variant="outline" className="mt-3 h-11 rounded-2xl" disabled={controlsLocked || societyAssistantBusy || !societyQuestion.trim() || !onAskSocietyAssistant} onClick={() => onAskSocietyAssistant?.(societyQuestion.trim())}>
                {societyAssistantBusy ? (language === 'ar' ? 'جاري التحليل...' : 'Analyzing...') : (language === 'ar' ? 'اسأل المساعد' : 'Ask copilot')}
              </Button>
              {societyAssistantAnswer ? <div className="mt-3 rounded-[18px] border border-border/55 bg-card/80 px-3 py-2 text-sm leading-7 text-muted-foreground">{societyAssistantAnswer}</div> : null}
            </div>
          </div>
        ) : null}
      </Section>

      <Section
        title={language === 'ar' ? 'التأكيد النهائي' : 'Final confirmation'}
        description={language === 'ar' ? 'لن يبدأ التشغيل حتى تصبح الحقول المهمة مكتملة.' : 'Execution will not start until the critical fields are complete.'}
        icon={<Flag className="h-4 w-4" />}
      >
        <Button className="h-12 w-full rounded-[24px] text-base" onClick={onSubmit} disabled={!canConfirm || controlsLocked}>
          {language === 'ar' ? 'تأكيد البيانات' : 'Confirm data'}
        </Button>
        {!canConfirm ? <div className="mt-2 text-sm text-destructive">{language === 'ar' ? 'أكمل الحقول الناقصة قبل المتابعة.' : 'Fill the missing fields before continuing.'}</div> : null}
      </Section>
    </div>
  );
}
