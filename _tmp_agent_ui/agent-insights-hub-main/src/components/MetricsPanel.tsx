import { Users, CheckCircle, XCircle, MinusCircle, TrendingUp, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { SimulationMetrics } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface MetricsPanelProps {
  metrics: SimulationMetrics;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subValue?: string;
  color?: 'primary' | 'success' | 'destructive' | 'warning' | 'neutral';
  animate?: boolean;
}

function MetricCard({ icon, label, value, subValue, color = 'primary', animate = false }: MetricCardProps) {
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
    <div className="metric-card">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", bgClasses[color])}>
          <div className={colorClasses[color]}>{icon}</div>
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className={cn(
          "text-3xl font-bold font-mono",
          colorClasses[color],
          animate && "animate-pulse-soft"
        )}>
          {value}
        </span>
        {subValue && (
          <span className="text-sm text-muted-foreground">{subValue}</span>
        )}
      </div>
    </div>
  );
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const {
    totalAgents,
    accepted,
    rejected,
    neutral,
    acceptanceRate,
    currentIteration,
    categoryBreakdown,
  } = metrics;

  const categories = Object.entries(categoryBreakdown);

  return (
    <div className="glass-panel h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Live Metrics</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Real-time simulation data</p>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* Main Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={<Users className="w-5 h-5" />}
            label="Total Agents"
            value={totalAgents}
            color="primary"
          />
          <MetricCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Acceptance Rate"
            value={`${acceptanceRate.toFixed(1)}%`}
            color={acceptanceRate >= 60 ? 'success' : acceptanceRate >= 40 ? 'warning' : 'destructive'}
            animate={currentIteration > 0}
          />
        </div>

        {/* Status Breakdown */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Agent Decisions</h3>
          
          <MetricCard
            icon={<CheckCircle className="w-5 h-5" />}
            label="Accepted"
            value={accepted}
            subValue={totalAgents > 0 ? `${((accepted / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="success"
          />
          
          <MetricCard
            icon={<XCircle className="w-5 h-5" />}
            label="Rejected"
            value={rejected}
            subValue={totalAgents > 0 ? `${((rejected / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="destructive"
          />
          
          <MetricCard
            icon={<MinusCircle className="w-5 h-5" />}
            label="Neutral"
            value={neutral}
            subValue={totalAgents > 0 ? `${((neutral / totalAgents) * 100).toFixed(0)}%` : '0%'}
            color="neutral"
          />
        </div>

        {/* Category Breakdown */}
        {categories.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">By Category</h3>
            <div className="space-y-4">
              {categories.map(([category, data]) => {
                const total = data.accepted + data.rejected + data.neutral;
                const rate = total > 0 ? (data.accepted / total) * 100 : 0;
                
                return (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground capitalize">{category}</span>
                      <span className={cn(
                        "text-sm font-mono",
                        rate >= 60 ? "text-success" : rate >= 40 ? "text-warning" : "text-destructive"
                      )}>
                        {rate.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden flex">
                      <div 
                        className="h-full bg-success transition-all duration-300"
                        style={{ width: `${total > 0 ? (data.accepted / total) * 100 : 0}%` }}
                      />
                      <div 
                        className="h-full bg-destructive transition-all duration-300"
                        style={{ width: `${total > 0 ? (data.rejected / total) * 100 : 0}%` }}
                      />
                      <div 
                        className="h-full bg-muted-foreground/50 transition-all duration-300"
                        style={{ width: `${total > 0 ? (data.neutral / total) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-success" />
                        {data.accepted}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-destructive" />
                        {data.rejected}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                        {data.neutral}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Iteration Progress */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Simulation Progress</h3>
          <div className="metric-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-foreground">Current Iteration</span>
              <span className="text-lg font-mono text-primary">{currentIteration}</span>
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

      {/* Legend */}
      <div className="p-4 border-t border-border/50">
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success" />
            Accepted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            Rejected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            Neutral
          </span>
        </div>
      </div>
    </div>
  );
}
