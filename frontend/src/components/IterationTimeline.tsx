import { cn } from '@/lib/utils';

interface IterationTimelineProps {
  currentIteration: number;
  totalIterations: number;
  milestones?: number[];
  language: 'ar' | 'en';
  currentPhaseKey?: string | null;
  phaseProgressPct?: number | null;
}

type CanonicalPhaseKey =
  | 'intake'
  | 'research_digest'
  | 'agent_init'
  | 'deliberation'
  | 'convergence'
  | 'verdict'
  | 'summary'
  | 'completed';

const PHASE_ORDER: CanonicalPhaseKey[] = [
  'intake',
  'research_digest',
  'agent_init',
  'deliberation',
  'convergence',
  'verdict',
  'summary',
  'completed',
];

const LEGACY_TO_CANONICAL: Record<string, CanonicalPhaseKey> = {
  intake: 'intake',
  search_bootstrap: 'research_digest',
  evidence_map: 'research_digest',
  research_digest: 'research_digest',
  agent_init: 'agent_init',
  debate: 'deliberation',
  deliberation: 'deliberation',
  convergence: 'convergence',
  resolution: 'verdict',
  verdict: 'verdict',
  summary: 'summary',
  completed: 'completed',
};

const phaseLabel = (key: CanonicalPhaseKey, language: 'ar' | 'en') => {
  const labelsAr: Record<CanonicalPhaseKey, string> = {
    intake: 'تهيئة',
    research_digest: 'بحث/أدلة',
    agent_init: 'تجهيز الوكلاء',
    deliberation: 'نقاش',
    convergence: 'تقليل الحياد',
    verdict: 'حسم',
    summary: 'ملخص',
    completed: 'اكتمل',
  };
  const labelsEn: Record<CanonicalPhaseKey, string> = {
    intake: 'Intake',
    research_digest: 'Research',
    agent_init: 'Agent Init',
    deliberation: 'Deliberation',
    convergence: 'Convergence',
    verdict: 'Verdict',
    summary: 'Summary',
    completed: 'Done',
  };
  return language === 'ar' ? labelsAr[key] : labelsEn[key];
};

const safePct = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const normalizePhase = (raw?: string | null): CanonicalPhaseKey | null => {
  const key = String(raw || '').trim();
  if (!key) return null;
  return LEGACY_TO_CANONICAL[key] || null;
};

export function IterationTimeline({
  currentIteration,
  totalIterations,
  milestones = [],
  language,
  currentPhaseKey,
  phaseProgressPct,
}: IterationTimelineProps) {
  const normalizedPhase = normalizePhase(currentPhaseKey);
  const phaseIndex = normalizedPhase ? PHASE_ORDER.indexOf(normalizedPhase) : -1;
  const phaseRatio = safePct(phaseProgressPct) / 100;

  const phaseDrivenProgress = phaseIndex >= 0
    ? normalizedPhase === 'completed'
      ? 100
      : ((phaseIndex + phaseRatio) / (PHASE_ORDER.length - 1)) * 100
    : 0;

  const iterationDrivenProgress = totalIterations > 0
    ? (currentIteration / totalIterations) * 100
    : 0;

  const progress = normalizedPhase ? phaseDrivenProgress : iterationDrivenProgress;

  const defaultMilestones = totalIterations > 0
    ? [0.25, 0.5, 0.75, 1].map((p) => Math.floor(p * totalIterations))
    : [];

  const allMilestones = [...new Set([...milestones, ...defaultMilestones])]
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  const currentPhaseLabel = normalizedPhase
    ? phaseLabel(normalizedPhase, language)
    : (language === 'ar' ? 'غير محدد' : 'Unknown');

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-foreground">
            {language === 'ar' ? 'خط التقدم' : 'Progress Timeline'}
          </span>
        </div>
        <div className="flex items-center gap-2" dir="ltr">
          <span className="text-2xl font-mono font-bold text-primary">{currentIteration}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-mono text-muted-foreground">{totalIterations || '-'}</span>
        </div>
      </div>

      <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        >
          <div className="absolute inset-0 bg-primary/30 blur-sm" />
        </div>
      </div>

      {normalizedPhase && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {language === 'ar' ? 'المرحلة الحالية' : 'Current phase'}
            </span>
            <span className="text-foreground font-medium">
              {currentPhaseLabel}
              {typeof phaseProgressPct === 'number' && ` - ${Math.round(safePct(phaseProgressPct))}%`}
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {PHASE_ORDER.map((phase, index) => {
              const passed = phaseIndex > index || normalizedPhase === 'completed';
              const active = phaseIndex === index && normalizedPhase !== 'completed';
              return (
                <div
                  key={phase}
                  className={cn(
                    'rounded-md border px-1.5 py-1 text-center text-[10px] truncate',
                    passed && 'border-primary/40 bg-primary/10 text-primary',
                    active && 'border-accent/50 bg-accent/15 text-foreground',
                    !passed && !active && 'border-border/40 bg-secondary/30 text-muted-foreground'
                  )}
                  title={phaseLabel(phase, language)}
                >
                  {phaseLabel(phase, language)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!normalizedPhase && totalIterations > 0 && (
        <div className="relative mt-2 h-5" dir="ltr">
          {allMilestones.map((milestone) => {
            const position = (milestone / totalIterations) * 100;
            const isPassed = currentIteration >= milestone;
            return (
              <span
                key={milestone}
                className={cn(
                  'absolute text-xs font-mono -translate-x-1/2 transition-colors duration-300',
                  isPassed ? 'text-primary' : 'text-muted-foreground'
                )}
                style={{ left: `${position}%` }}
              >
                {milestone}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', progress > 0 ? 'bg-success' : 'bg-muted-foreground/30')} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'بداية' : 'Started'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', progress >= 50 ? 'bg-warning' : 'bg-muted-foreground/30')} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'منتصف' : 'Midpoint'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', progress >= 100 ? 'bg-primary' : 'bg-muted-foreground/30')} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'اكتمال' : 'Complete'}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {language === 'ar' ? `اكتمل ${progress.toFixed(0)}%` : `${progress.toFixed(0)}% complete`}
        </span>
      </div>
    </div>
  );
}
