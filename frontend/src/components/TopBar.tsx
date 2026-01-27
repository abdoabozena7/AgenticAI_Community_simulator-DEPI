import { ChevronDown, Zap, Target, AlertTriangle, Lightbulb, Flag } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TopBarProps {
  selectedCategory?: string;
  selectedAudiences?: string[];
  selectedGoals?: string[];
  riskLevel?: number;
  maturity?: string;
  language: 'ar' | 'en';
  onCategoryChange: (value: string) => void;
  onAudienceChange: (value: string[]) => void;
  onRiskChange: (value: number) => void;
  onMaturityChange: (value: string) => void;
  onGoalsChange: (value: string[]) => void;
}

export const CATEGORY_OPTIONS = [
  'Technology', 'Healthcare', 'Finance', 'Education', 'E-commerce',
  'Entertainment', 'Social', 'B2B SaaS', 'Consumer Apps', 'Hardware'
];

export const AUDIENCE_OPTIONS = [
  'Gen Z (18-24)', 'Millennials (25-40)', 'Gen X (41-56)', 'Boomers (57-75)',
  'Developers', 'Enterprises', 'SMBs', 'Consumers', 'Students', 'Professionals'
];

export const MATURITY_LEVELS = [
  { value: 'concept', label: 'Concept', icon: 'C' },
  { value: 'prototype', label: 'Prototype', icon: 'P' },
  { value: 'mvp', label: 'MVP', icon: 'M' },
  { value: 'launched', label: 'Launched', icon: 'L' },
];

export const GOAL_OPTIONS = [
  'Market Validation', 'Funding Readiness', 'User Acquisition',
  'Product-Market Fit', 'Competitive Analysis', 'Growth Strategy'
];

export function TopBar({
  selectedCategory,
  selectedAudiences,
  selectedGoals,
  riskLevel,
  maturity,
  language,
  onCategoryChange,
  onAudienceChange,
  onRiskChange,
  onMaturityChange,
  onGoalsChange,
}: TopBarProps) {
  const activeCategory = selectedCategory ?? '';
  const activeAudiences = selectedAudiences ?? [];
  const activeGoals = selectedGoals ?? [];
  const activeRiskLevel = typeof riskLevel === 'number' ? riskLevel : 50;
  const activeMaturity = maturity ?? 'concept';

  const toggleAudience = (audience: string) => {
    const updated = activeAudiences.includes(audience)
      ? activeAudiences.filter(a => a !== audience)
      : [...activeAudiences, audience];
    onAudienceChange(updated);
  };

  const toggleGoal = (goal: string) => {
    const updated = activeGoals.includes(goal)
      ? activeGoals.filter(g => g !== goal)
      : [...activeGoals, goal];
    onGoalsChange(updated);
  };

  const handleRiskChange = (value: number[]) => {
    onRiskChange(value[0]);
  };

  const getRiskLabel = (value: number) => {
    if (language === 'ar') {
      if (value < 30) return 'محافظ';
      if (value < 70) return 'متوسط';
      return 'مغامر';
    }
    if (value < 30) return 'Conservative';
    if (value < 70) return 'Moderate';
    return 'Aggressive';
  };

  const getRiskColor = (value: number) => {
    if (value < 30) return 'text-success';
    if (value < 70) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <div className="glass-panel border-b border-border/50 px-6 py-4">
      <div className="flex flex-wrap items-center gap-6">
        {/* Category Select */}
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lightbulb className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'ar' ? 'الفئة' : 'Category'}</span>
          </div>
          <Select value={activeCategory} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-[200px] bg-secondary border-border/50 h-10 text-sm">
              <SelectValue placeholder={language === 'ar' ? 'اختر...' : 'Select...'} />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {CATEGORY_OPTIONS.map((cat) => (
                <SelectItem key={cat} value={cat.toLowerCase()}>
                  {language === 'ar'
                    ? ({
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
                    } as Record<string, string>)[cat] || cat
                    : cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Target Audience Multi-select */}
        <div className="flex items-center gap-3 min-w-[300px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'ar' ? 'الجمهور' : 'Audience'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-w-[220px]">
            {activeAudiences.length === 0 ? (
              <span className="text-sm text-muted-foreground">{language === 'ar' ? 'غير محدد' : 'None selected'}</span>
            ) : (
              activeAudiences.slice(0, 2).map((aud) => (
                <Badge
                  key={aud}
                  variant="secondary"
                  className="bg-primary/20 text-primary border-primary/30 text-xs cursor-pointer hover:bg-primary/30"
                  onClick={() => toggleAudience(aud)}
                >
                  {language === 'ar'
                    ? ({
                      'Gen Z (18-24)': 'جيل Z',
                      'Millennials (25-40)': 'جيل الألفية',
                      'Gen X (41-56)': 'جيل X',
                      'Boomers (57-75)': 'الطفرة',
                      Developers: 'مطوّرون',
                      Enterprises: 'شركات كبرى',
                      SMBs: 'شركات صغيرة',
                      Consumers: 'مستهلكون',
                      Students: 'طلاب',
                      Professionals: 'محترفون',
                    } as Record<string, string>)[aud] || aud
                    : aud.split(' ')[0]}
                </Badge>
              ))
            )}
            {activeAudiences.length > 2 && (
              <Badge variant="secondary" className="text-xs">
                +{activeAudiences.length - 2}
              </Badge>
            )}
          </div>
          <Select onValueChange={(val) => toggleAudience(val)}>
            <SelectTrigger className="w-10 h-10 p-0 bg-secondary border-border/50">
              <ChevronDown className="w-4 h-4" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-[300px]">
              {AUDIENCE_OPTIONS.map((aud) => (
                <SelectItem 
                  key={aud} 
                  value={aud}
                  className={cn(activeAudiences.includes(aud) && "bg-primary/10")}
                >
                  {language === 'ar'
                    ? ({
                      'Gen Z (18-24)': 'جيل Z (18-24)',
                      'Millennials (25-40)': 'جيل الألفية (25-40)',
                      'Gen X (41-56)': 'جيل X (41-56)',
                      'Boomers (57-75)': 'الطفرة (57-75)',
                      Developers: 'مطوّرون',
                      Enterprises: 'شركات كبرى',
                      SMBs: 'شركات صغيرة',
                      Consumers: 'مستهلكون',
                      Students: 'طلاب',
                      Professionals: 'محترفون',
                    } as Record<string, string>)[aud] || aud
                    : aud}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Risk Appetite Slider */}
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'ar' ? 'المخاطرة' : 'Risk'}</span>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              value={[activeRiskLevel]}
              onValueChange={handleRiskChange}
              max={100}
              step={1}
              className="w-24"
            />
            <span className={cn("text-sm font-medium min-w-[80px]", getRiskColor(activeRiskLevel))}>
              {getRiskLabel(activeRiskLevel)}
            </span>
          </div>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Idea Maturity */}
        <div className="flex items-center gap-3 min-w-[260px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'ar' ? 'النضج' : 'Maturity'}</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {MATURITY_LEVELS.map((level) => (
              <button
                key={level.value}
                onClick={() => {
                  onMaturityChange(level.value);
                }}
                className={cn(
                  "px-3 py-2 rounded-md text-xs font-medium transition-all",
                  activeMaturity === level.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                )}
              >
                <span className="mr-1">{level.icon}</span>
                {language === 'ar'
                  ? ({ Concept: 'فكرة', Prototype: 'نموذج', MVP: 'نسخة أولية', Launched: 'أُطلق' } as Record<string, string>)[level.label] || level.label
                  : level.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-8 bg-border/50" />

        {/* Goals Multi-select */}
        <div className="flex items-center gap-3 min-w-[240px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Flag className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'ar' ? 'الأهداف' : 'Goals'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-w-[180px]">
            {activeGoals.length === 0 ? (
              <span className="text-sm text-muted-foreground">{language === 'ar' ? 'لا يوجد' : 'None'}</span>
            ) : (
              activeGoals.slice(0, 1).map((goal) => (
                <Badge
                  key={goal}
                  variant="secondary"
                  className="bg-accent/20 text-accent border-accent/30 text-xs cursor-pointer"
                  onClick={() => toggleGoal(goal)}
                >
                  {language === 'ar'
                    ? ({
                      'Market Validation': 'تحقق السوق',
                      'Funding Readiness': 'جاهزية التمويل',
                      'User Acquisition': 'اكتساب المستخدمين',
                      'Product-Market Fit': 'ملاءمة المنتج',
                      'Competitive Analysis': 'تحليل المنافسين',
                      'Growth Strategy': 'استراتيجية النمو',
                    } as Record<string, string>)[goal] || goal
                    : goal.split(' ')[0]}
                </Badge>
              ))
            )}
            {activeGoals.length > 1 && (
              <Badge variant="secondary" className="text-xs">
                +{activeGoals.length - 1}
              </Badge>
            )}
          </div>
          <Select onValueChange={(val) => toggleGoal(val)}>
            <SelectTrigger className="w-10 h-10 p-0 bg-secondary border-border/50">
              <ChevronDown className="w-4 h-4" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {GOAL_OPTIONS.map((goal) => (
                <SelectItem 
                  key={goal} 
                  value={goal}
                  className={cn(activeGoals.includes(goal) && "bg-primary/10")}
                >
                  {language === 'ar'
                    ? ({
                      'Market Validation': 'تحقق السوق',
                      'Funding Readiness': 'جاهزية التمويل',
                      'User Acquisition': 'اكتساب المستخدمين',
                      'Product-Market Fit': 'ملاءمة المنتج للسوق',
                      'Competitive Analysis': 'تحليل المنافسين',
                      'Growth Strategy': 'استراتيجية النمو',
                    } as Record<string, string>)[goal] || goal
                    : goal}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
