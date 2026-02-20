import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Flag, Lightbulb, Target, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CATEGORY_OPTIONS, AUDIENCE_OPTIONS, GOAL_OPTIONS, MATURITY_LEVELS } from '@/components/TopBar';
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
  showSocietyBuilder?: boolean;
  onToggleSocietyBuilder?: (open: boolean) => void;
  societyControls?: SocietyControls;
  onSocietyControlsChange?: (updates: Partial<SocietyControls>) => void;
  onOpenStartChoice?: () => void;
  societyAssistantBusy?: boolean;
  societyAssistantAnswer?: string;
  onAskSocietyAssistant?: (question: string) => void;
}

const CATEGORY_LABELS_AR: Record<string, string> = {
  Technology: 'تكنولوجيا',
  Healthcare: 'رعاية صحية',
  Finance: 'تمويل',
  Education: 'تعليم',
  'E-commerce': 'تجارة إلكترونية',
  Entertainment: 'ترفيه',
  Social: 'اجتماعي',
  'B2B SaaS': 'برمجيات أعمال',
  'Consumer Apps': 'تطبيقات مستهلكين',
  Hardware: 'أجهزة',
};

const AUDIENCE_LABELS_AR: Record<string, string> = {
  'Gen Z (18-24)': 'جيل Z (18-24)',
  'Millennials (25-40)': 'جيل الألفية (25-40)',
  'Gen X (41-56)': 'جيل X (41-56)',
  'Boomers (57-75)': 'الطفرة (57-75)',
  Developers: 'مطورون',
  Enterprises: 'شركات كبرى',
  SMBs: 'شركات صغيرة',
  Consumers: 'مستهلكون',
  Students: 'طلاب',
  Professionals: 'محترفون',
};

const GOAL_LABELS_AR: Record<string, string> = {
  'Market Validation': 'تحقق السوق',
  'Funding Readiness': 'جاهزية التمويل',
  'User Acquisition': 'اكتساب المستخدمين',
  'Product-Market Fit': 'ملاءمة المنتج',
  'Competitive Analysis': 'تحليل المنافسين',
  'Growth Strategy': 'استراتيجية النمو',
};

export function ConfigPanel({
  value,
  onChange,
  onSubmit,
  missingFields,
  language,
  isSearching,
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
  const [societyAssistantQuestion, setSocietyAssistantQuestion] = useState('');

  const missingSet = useMemo(() => new Set(missingFields), [missingFields]);
  const canConfirm = missingFields.length === 0 && value.idea.trim().length > 0;

  useEffect(() => {
    if (missingFields.length === 0) return;
    const field = missingFields[0];
    if (field === 'country') countryRef.current?.focus();
    if (field === 'city') cityRef.current?.focus();
  }, [missingFields]);

  const toggleAudience = (aud: string) => {
    const updated = value.targetAudience.includes(aud)
      ? value.targetAudience.filter((item) => item !== aud)
      : [...value.targetAudience, aud];
    onChange({ targetAudience: updated });
  };

  const toggleGoal = (goal: string) => {
    const updated = value.goals.includes(goal)
      ? value.goals.filter((item) => item !== goal)
      : [...value.goals, goal];
    onChange({ goals: updated });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-thin">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {language === 'ar' ? 'إعدادات الفكرة' : 'Configuration'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ar'
            ? 'راجع البيانات التي استنتجناها. يمكنك تعديل أي عنصر.'
            : 'Review the inferred data. You can adjust any field.'}
        </p>
      </div>
      <div className="space-y-2">
      
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            {language === 'ar' ? 'الدولة' : 'Country'}
          </label>
          <Input
            ref={countryRef}
            value={value.country}
            onChange={(e) => onChange({ country: e.target.value })}
            placeholder={language === 'ar' ? 'مثال: مصر' : 'e.g. Egypt'}
            className={cn(
              'bg-secondary border-border/50',
              missingSet.has('country') && 'border-destructive/60 focus-visible:ring-destructive/50'
            )}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            {language === 'ar' ? 'المدينة' : 'City'}
          </label>
          <Input
            ref={cityRef}
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder={language === 'ar' ? 'مثال: القاهرة' : 'e.g. Cairo'}
            className={cn(
              'bg-secondary border-border/50',
              missingSet.has('city') && 'border-destructive/60 focus-visible:ring-destructive/50'
            )}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label
          className={cn(
            "text-sm text-muted-foreground flex items-center gap-2",
            missingSet.has('category') && 'text-destructive'
          )}
        >
          <Target className="w-4 h-4" />
          {language === 'ar' ? 'الفئة' : 'Category'}
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((cat) => {
            const label = language === 'ar' ? CATEGORY_LABELS_AR[cat] || cat : cat;
            const selected = value.category === cat.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onChange({ category: cat.toLowerCase() })}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border',
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary/60 text-muted-foreground border-border/40 hover:bg-secondary'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label
          className={cn(
            "text-sm text-muted-foreground flex items-center gap-2",
            missingSet.has('target_audience') && 'text-destructive'
          )}
        >
          <Target className="w-4 h-4" />
          {language === 'ar' ? 'الجمهور المستهدف' : 'Target Market'}
        </label>
        <div className="flex flex-wrap gap-2">
          {AUDIENCE_OPTIONS.map((aud) => {
            const label = language === 'ar' ? AUDIENCE_LABELS_AR[aud] || aud : aud;
            const selected = value.targetAudience.includes(aud);
            return (
              <Badge
                key={aud}
                onClick={() => toggleAudience(aud)}
                className={cn(
                  'cursor-pointer text-xs border',
                  selected
                    ? 'bg-primary/80 text-primary-foreground border-primary'
                    : 'bg-secondary/60 text-muted-foreground border-border/40'
                )}
              >
                {label}
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label
          className={cn(
            "text-sm text-muted-foreground flex items-center gap-2",
            missingSet.has('idea_maturity') && 'text-destructive'
          )}
        >
          <Zap className="w-4 h-4" />
          {language === 'ar' ? 'مرحلة الفكرة' : 'Idea Maturity'}
        </label>
        <div className="flex flex-wrap gap-2">
          {MATURITY_LEVELS.map((level) => {
            const selected = value.ideaMaturity === level.value;
            const label = language === 'ar'
              ? ({ concept: 'فكرة', prototype: ' نموذج صغير', mvp: 'فكره لاول مره', launched: 'موجوده بالفعل' } as Record<string, string>)[level.value]
              : level.label;
            return (
              <button
                key={level.value}
                type="button"
                onClick={() => onChange({ ideaMaturity: level.value as UserInput['ideaMaturity'] })}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium border',
                  selected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary/60 text-muted-foreground border-border/40 hover:bg-secondary'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {language === 'ar' ? 'درجة المخاطرة' : 'Risk Appetite'}
        </label>
        <Slider
          value={[value.riskAppetite]}
          onValueChange={(v) => onChange({ riskAppetite: v[0] })}
          max={100}
          step={1}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <label
          className={cn(
            "text-sm text-muted-foreground flex items-center gap-2",
            missingSet.has('goals') && 'text-destructive'
          )}
        >
          <Flag className="w-4 h-4" />
          {language === 'ar' ? 'الأهداف' : 'Goals'}
        </label>
        <div className="flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((goal) => {
            const label = language === 'ar' ? GOAL_LABELS_AR[goal] || goal : goal;
            const selected = value.goals.includes(goal);
            return (
              <Badge
                key={goal}
                onClick={() => toggleGoal(goal)}
                className={cn(
                  'cursor-pointer text-xs border',
                  selected
                    ? 'bg-accent/80 text-accent-foreground border-accent'
                    : 'bg-secondary/60 text-muted-foreground border-border/40'
                )}
              >
                {label}
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          {language === 'ar' ? 'عدد الوكلاء' : 'Agents'}
          <span className="text-xs text-muted-foreground/80">
            {language === 'ar' ? '(حتى 500)' : '(up to 500)'}
          </span>
        </label>
        <div className="flex items-center gap-3">
          <Slider
            value={[value.agentCount ?? 20]}
            onValueChange={(v) => onChange({ agentCount: Math.min(500, Math.max(5, v[0])) })}
            min={5}
            max={500}
            step={1}
            className="w-full"
          />
          <div className="w-16 text-right text-sm tabular-nums">
            {value.agentCount ?? 20}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {language === 'ar' ? 'المجتمع الافتراضي' : 'Default Society'}
            </div>
            <div className="text-xs text-muted-foreground">
              {language === 'ar'
                ? 'يمكنك تشغيل المحاكاة بالمجتمع الحالي أو بناء مجتمعك المخصص.'
                : 'Run with the default society or build your own.'}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenStartChoice?.()}
          >
            {language === 'ar' ? 'خيارات البدء' : 'Start choices'}
          </Button>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => onToggleSocietyBuilder?.(!showSocietyBuilder)}
        >
          {showSocietyBuilder
            ? (language === 'ar' ? 'إخفاء بناء المجتمع' : 'Hide society builder')
            : (language === 'ar' ? 'ابنِ مجتمعك الخاص' : 'Build your own society')}
        </Button>
      </div>

      {showSocietyBuilder && societyControls && onSocietyControlsChange && (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="text-sm font-medium text-foreground">
            {language === 'ar' ? 'لوحة بناء المجتمع (متقدم)' : 'Society Builder (Advanced)'}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              {language === 'ar' ? 'تنوع الوكلاء' : 'Agent diversity'} ({societyControls.diversity}%)
            </label>
            <Slider
              value={[societyControls.diversity]}
              onValueChange={(v) => onSocietyControlsChange({ diversity: v[0] })}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              {language === 'ar' ? 'نسبة الشخصيات المتشككة' : 'Skeptic persona ratio'} ({societyControls.skepticRatio}%)
            </label>
            <Slider
              value={[societyControls.skepticRatio]}
              onValueChange={(v) => onSocietyControlsChange({ skepticRatio: v[0] })}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              {language === 'ar' ? 'انحياز الابتكار' : 'Innovation bias'} ({societyControls.innovationBias}%)
            </label>
            <Slider
              value={[societyControls.innovationBias]}
              onValueChange={(v) => onSocietyControlsChange({ innovationBias: v[0] })}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              type="button"
              variant={societyControls.strictPolicy ? 'default' : 'outline'}
              onClick={() => onSocietyControlsChange({ strictPolicy: !societyControls.strictPolicy })}
              className="w-full"
            >
              {language === 'ar' ? 'تدقيق سياسات صارم' : 'Strict policy mode'}
            </Button>
            <Button
              type="button"
              variant={societyControls.humanDebate ? 'default' : 'outline'}
              onClick={() => onSocietyControlsChange({ humanDebate: !societyControls.humanDebate })}
              className="w-full"
            >
              {language === 'ar' ? 'نمط نقاش بشري' : 'Human-like debate'}
            </Button>
          </div>

          <Input
            value={societyControls.personaHint}
            onChange={(e) => onSocietyControlsChange({ personaHint: e.target.value })}
            placeholder={language === 'ar' ? 'ملاحظة عن شخصيات المجتمع (اختياري)' : 'Persona note for this society (optional)'}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
            className="bg-secondary/50 border-border/50"
          />

          <div className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-2.5">
            <div className="text-xs font-medium text-foreground">
              {language === 'ar' ? 'مساعد المجتمع (LLM)' : 'Society Copilot (LLM)'}
            </div>
            <Input
              value={societyAssistantQuestion}
              onChange={(e) => setSocietyAssistantQuestion(e.target.value)}
              placeholder={language === 'ar' ? 'اسأل عن أفضل توزيع للشخصيات...' : 'Ask for the best persona distribution...'}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              className="bg-secondary/50 border-border/50"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={societyAssistantBusy || !societyAssistantQuestion.trim() || !onAskSocietyAssistant}
              onClick={() => onAskSocietyAssistant?.(societyAssistantQuestion.trim())}
            >
              {societyAssistantBusy
                ? (language === 'ar' ? 'جاري التحليل...' : 'Analyzing...')
                : (language === 'ar' ? 'اسأل المساعد' : 'Ask copilot')}
            </Button>
            {societyAssistantAnswer && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed rounded-md border border-border/35 bg-secondary/25 p-2">
                {societyAssistantAnswer}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pt-2 space-y-2">
        <Button className="w-full" onClick={onSubmit} disabled={!canConfirm || isSearching}>
          {language === 'ar' ? 'تأكيد البيانات' : 'Confirm Data'}
        </Button>
        {!canConfirm && (
          <div className="text-xs text-destructive">
            {language === 'ar'
              ? 'أكمل الحقول الناقصة قبل المتابعة.'
              : 'Fill the missing fields before continuing.'}
          </div>
        )}
        {isSearching && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="inline-block w-2 h-2 rounded-full bg-primary/60 animate-pulse [animation-delay:200ms]" />
              <span className="inline-block w-2 h-2 rounded-full bg-primary/40 animate-pulse [animation-delay:400ms]" />
            </span>
            {language === 'ar' ? 'جارٍ البحث عن الفكرة...' : 'Searching the internet for your idea...'}
          </div>
        )}
      </div>
    </div>
  );
}


