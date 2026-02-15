import type { ReactNode } from 'react';
import { Users, CheckCircle, XCircle, MinusCircle, TrendingUp, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { SimulationMetrics } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface MetricsPanelProps {
  metrics: SimulationMetrics;
  language: 'ar' | 'en';
  onSelectStance?: (stance: 'accepted' | 'rejected' | 'neutral') => void;
  selectedStance?: 'accepted' | 'rejected' | 'neutral' | null;
  filteredAgents?: {
    agent_id: string;
    agent_label?: string;
    agent_short_id?: string;
    archetype?: string;
    opinion: 'accept' | 'reject' | 'neutral';
  }[];
  filteredAgentsTotal?: number;
}

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: number | string;
  subValue?: string;
  color?: 'primary' | 'success' | 'destructive' | 'warning' | 'neutral';
  animate?: boolean;
  dataTestId?: string;
  onClick?: () => void;
  active?: boolean;
}

function MetricCard({
  icon,
  label,
  value,
  subValue,
  color = 'primary',
  animate = false,
  dataTestId,
  onClick,
  active = false,
}: MetricCardProps) {
  const colorClasses = {
    primary: 'text-primary',
    success: 'text-success',
    destructive: 'text-destructive',
    warning: 'text-warning',
    neutral: 'text-muted-foreground',
  };

  const bgClasses = {
    primary: 'bg-primary/10',
    success: 'bg-success/10',
    destructive: 'bg-destructive/10',
    warning: 'bg-warning/10',
    neutral: 'bg-muted/50',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'metric-card text-left w-full',
        onClick ? 'cursor-pointer hover:border-primary/40 transition-colors' : 'cursor-default',
        active ? 'border border-primary/50' : ''
      )}
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', bgClasses[color])}>
          <div className={colorClasses[color]}>{icon}</div>
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-end justify-between" dir="ltr">
        <span
          className={cn(
            'text-3xl font-bold font-mono',
            colorClasses[color],
            animate && 'animate-pulse-soft'
          )}
        >
          {value}
        </span>
        {subValue && <span className="text-sm text-muted-foreground">{subValue}</span>}
      </div>
    </button>
  );
}

export function MetricsPanel({
  metrics,
  language,
  onSelectStance,
  selectedStance = null,
  filteredAgents = [],
  filteredAgentsTotal = 0,
}: MetricsPanelProps) {
  const {
    totalAgents,
    accepted,
    rejected,
    neutral,
    acceptanceRate,
    currentIteration,
    perCategoryAccepted,
  } = metrics;

  const categories = Object.entries(perCategoryAccepted || {});

  return (
    <div className="glass-panel h-full flex flex-col">
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            {language === 'ar' ? 'المؤشرات المباشرة' : 'Live Metrics'}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {language === 'ar' ? 'بيانات المحاكاة لحظيًا' : 'Real-time simulation data'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={<Users className="w-5 h-5" />}
            label={language === 'ar' ? 'إجمالي الوكلاء' : 'Total Agents'}
            value={totalAgents}
            color="primary"
            dataTestId="metric-total-agents"
          />
          <MetricCard
            icon={<TrendingUp className="w-5 h-5" />}
            label={language === 'ar' ? 'نسبة القبول' : 'Acceptance Rate'}
            value={`${acceptanceRate.toFixed(1)}%`}
            color={acceptanceRate >= 60 ? 'success' : acceptanceRate >= 40 ? 'warning' : 'destructive'}
            animate={currentIteration > 0}
            dataTestId="metric-acceptance-rate"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {language === 'ar' ? 'قرارات الوكلاء' : 'Agent Decisions'}
          </h3>

          <MetricCard
            icon={<CheckCircle className="w-5 h-5" />}
            label={language === 'ar' ? 'مقبول' : 'Accepted'}
            value={accepted}
            subValue={totalAgents > 0 ? `${((accepted / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="success"
            dataTestId="metric-accepted"
            onClick={onSelectStance ? () => onSelectStance('accepted') : undefined}
            active={selectedStance === 'accepted'}
          />

          <MetricCard
            icon={<XCircle className="w-5 h-5" />}
            label={language === 'ar' ? 'مرفوض' : 'Rejected'}
            value={rejected}
            subValue={totalAgents > 0 ? `${((rejected / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="destructive"
            dataTestId="metric-rejected"
            onClick={onSelectStance ? () => onSelectStance('rejected') : undefined}
            active={selectedStance === 'rejected'}
          />

          <MetricCard
            icon={<MinusCircle className="w-5 h-5" />}
            label={language === 'ar' ? 'محايد' : 'Neutral'}
            value={neutral}
            subValue={totalAgents > 0 ? `${((neutral / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="neutral"
            dataTestId="metric-neutral"
            onClick={onSelectStance ? () => onSelectStance('neutral') : undefined}
            active={selectedStance === 'neutral'}
          />
        </div>

        {selectedStance && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'قائمة الوكلاء' : 'Agent List'}
            </h3>
            <div className="rounded-lg border border-border/40 bg-secondary/30 p-2 space-y-2 max-h-52 overflow-y-auto">
              {filteredAgents.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  {language === 'ar' ? 'لا توجد بيانات متاحة الآن.' : 'No agents available yet.'}
                </div>
              ) : (
                filteredAgents.map((agent) => (
                  <div key={agent.agent_id} className="text-xs rounded-md border border-border/40 px-2 py-1.5">
                    <div className="font-medium text-foreground">
                      {agent.agent_label || agent.agent_short_id || agent.agent_id.slice(0, 4)}
                    </div>
                    {agent.archetype && <div className="text-muted-foreground mt-0.5">{agent.archetype}</div>}
                  </div>
                ))
              )}
              {filteredAgentsTotal > filteredAgents.length && (
                <div className="text-[11px] text-muted-foreground">
                  {language === 'ar'
                    ? `المعروض ${filteredAgents.length} من ${filteredAgentsTotal}`
                    : `Showing ${filteredAgents.length} of ${filteredAgentsTotal}`}
                </div>
              )}
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'حسب الفئة (المقبول)' : 'By Category (Accepted)'}
            </h3>
            <div className="space-y-4">
              {(() => {
                const maxAccepted = Math.max(1, ...categories.map(([, count]) => count));
                return categories.map(([category, count]) => {
                  const width = (count / maxAccepted) * 100;
                  return (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground capitalize">{category}</span>
                        <span className="text-sm font-mono text-success">{count}</span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-success transition-all duration-300"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {language === 'ar' ? 'تقدم المحاكاة' : 'Simulation Progress'}
          </h3>
          <div className="metric-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-foreground">
                {language === 'ar' ? 'التكرار الحالي' : 'Current Iteration'}
              </span>
              <span className="text-lg font-mono text-primary" dir="ltr">{currentIteration}</span>
            </div>
            {metrics.totalIterations > 0 && (
              <Progress
                value={(currentIteration / metrics.totalIterations) * 100}
                className="h-2"
              />
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-border/50">
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success" />
            {language === 'ar' ? 'مقبول' : 'Accepted'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            {language === 'ar' ? 'مرفوض' : 'Rejected'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            {language === 'ar' ? 'محايد' : 'Neutral'}
          </span>
        </div>
      </div>
    </div>
  );
}
