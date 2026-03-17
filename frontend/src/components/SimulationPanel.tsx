import { IterationTimeline } from '@/components/IterationTimeline';
import { SimulationArena } from '@/components/SimulationArena';
import type { Agent, Connection, ReasoningMessage } from '@/types/simulation';

interface SimulationPanelProps {
  agents: Agent[];
  activePulses: Connection[];
  language: 'ar' | 'en';
  reasoningActive?: boolean;
  debateReady?: boolean;
  reasoningFeed?: ReasoningMessage[];
  graphTitle?: string;
  graphDescription?: string;
  graphLegend?: Array<{ key: string; label: string; color: string }>;
  emptyTitle?: string;
  emptyDescription?: string;
  onOpenReasoning?: () => void;
  currentIteration: number;
  totalIterations: number;
  currentPhaseKey?: string | null;
  phaseProgressPct?: number | null;
}

export function SimulationPanel({
  agents,
  activePulses,
  language,
  reasoningActive = false,
  debateReady = false,
  reasoningFeed = [],
  graphTitle,
  graphDescription,
  graphLegend = [],
  emptyTitle,
  emptyDescription,
  onOpenReasoning,
  currentIteration,
  totalIterations,
  currentPhaseKey,
  phaseProgressPct,
}: SimulationPanelProps) {
  return (
    <div className="grid min-h-0 gap-4 xl:grid-rows-[minmax(460px,1fr)_minmax(0,240px)]">
      <div className="min-h-[380px] overflow-hidden rounded-[32px]">
        <SimulationArena
          agents={agents}
          activePulses={activePulses}
          language={language}
          reasoningActive={reasoningActive}
          debateReady={debateReady}
          reasoningFeed={reasoningFeed}
          graphTitle={graphTitle}
          graphDescription={graphDescription}
          graphLegend={graphLegend}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          onOpenReasoning={onOpenReasoning}
        />
      </div>
      <div className="min-h-0 overflow-y-auto rounded-[32px] border border-border/60 bg-card/35 p-3 scrollbar-thin">
        <IterationTimeline
          currentIteration={currentIteration}
          totalIterations={totalIterations}
          language={language}
          currentPhaseKey={currentPhaseKey}
          phaseProgressPct={phaseProgressPct}
        />
      </div>
    </div>
  );
}
