import { cn } from '@/lib/utils';

interface IterationTimelineProps {
  currentIteration: number;
  totalIterations: number;
  milestones?: number[];
  language: 'ar' | 'en';
}

export function IterationTimeline({
  currentIteration,
  totalIterations,
  milestones = [],
  language,
}: IterationTimelineProps) {
  const progress = totalIterations > 0 ? (currentIteration / totalIterations) * 100 : 0;
  
  // Generate milestone markers
  const defaultMilestones = totalIterations > 0 
    ? [0.25, 0.5, 0.75, 1].map(p => Math.floor(p * totalIterations))
    : [];
  
  const allMilestones = [...new Set([...milestones, ...defaultMilestones])].sort((a, b) => a - b);

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-foreground">
            {language === 'ar' ? 'خط التكرارات' : 'Iteration Timeline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-mono font-bold text-primary">{currentIteration}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-mono text-muted-foreground">{totalIterations || '∞'}</span>
        </div>
      </div>

      {/* Timeline Bar */}
      <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
        {/* Progress */}
        <div 
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        >
          {/* Glow effect */}
          <div className="absolute inset-0 bg-primary/30 blur-sm" />
        </div>

        {/* Milestone markers */}
        {allMilestones.map((milestone) => {
          const position = totalIterations > 0 ? (milestone / totalIterations) * 100 : 0;
          const isPassed = currentIteration >= milestone;
          
          return (
            <div
              key={milestone}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 w-1 h-full transition-colors duration-300",
                isPassed ? "bg-primary-foreground/50" : "bg-muted-foreground/30"
              )}
              style={{ left: `${position}%` }}
            />
          );
        })}

        {/* Current position indicator */}
        {totalIterations > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-primary bg-background shadow-lg transition-all duration-500 ease-out"
            style={{ left: `${Math.min(progress, 100)}%` }}
          >
            <div className="absolute inset-1 rounded-full bg-primary animate-pulse" />
          </div>
        )}
      </div>

      {/* Milestone labels */}
      {totalIterations > 0 && (
        <div className="relative mt-2 h-5">
          {allMilestones.map((milestone) => {
            const position = (milestone / totalIterations) * 100;
            const isPassed = currentIteration >= milestone;
            
            return (
              <span
                key={milestone}
                className={cn(
                  "absolute text-xs font-mono -translate-x-1/2 transition-colors duration-300",
                  isPassed ? "text-primary" : "text-muted-foreground"
                )}
                style={{ left: `${position}%` }}
              >
                {milestone}
              </span>
            );
          })}
        </div>
      )}

      {/* Status indicators */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              currentIteration > 0 ? "bg-success" : "bg-muted-foreground/30"
            )} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'بداية' : 'Started'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              progress >= 50 ? "bg-warning" : "bg-muted-foreground/30"
            )} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'منتصف' : 'Midpoint'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              progress >= 100 ? "bg-primary" : "bg-muted-foreground/30"
            )} />
            <span className="text-xs text-muted-foreground">{language === 'ar' ? 'اكتمال' : 'Complete'}</span>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {language === 'ar' ? `اكتمل ${progress.toFixed(0)}%` : `${progress.toFixed(0)}% complete`}
        </span>
      </div>
    </div>
  );
}