import { useRef, useEffect, useState } from 'react';
import { RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Agent, SimulationStatus } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface SimulationArenaProps {
  agents: Map<string, Agent>;
  status: SimulationStatus;
  currentIteration: number;
  totalIterations: number;
  onReset: () => void;
}

export function SimulationArena({
  agents,
  status,
  currentIteration,
  totalIterations,
  onReset,
}: SimulationArenaProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Placeholder for Three.js integration
  useEffect(() => {
    // Three.js scene initialization will go here
    // For now, we render a placeholder visualization
  }, []);

  const getStatusColor = (agentStatus: Agent['status']) => {
    switch (agentStatus) {
      case 'accepted': return 'bg-success';
      case 'rejected': return 'bg-destructive';
      case 'thinking': return 'bg-warning animate-pulse';
      default: return 'bg-agent-neutral';
    }
  };

  const agentArray = Array.from(agents.values());
  
  // Create a grid visualization of agents
  const gridSize = Math.ceil(Math.sqrt(Math.max(agentArray.length, 100)));

  return (
    <div className={cn(
      "glass-panel h-full flex flex-col",
      isFullscreen && "fixed inset-4 z-50"
    )}>
      {/* Header Controls */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-foreground">Simulation Arena</h2>
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-2 h-2 rounded-full",
              status === 'running' ? "bg-success animate-pulse" :
              status === 'paused' ? "bg-warning" :
              status === 'completed' ? "bg-primary" :
              "bg-muted-foreground"
            )} />
            <span className="text-sm text-muted-foreground capitalize">{status}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Pause/Resume not supported by the current backend contract */}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="text-muted-foreground hover:text-foreground"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Three.js Canvas Placeholder */}
      <div 
        ref={canvasRef} 
        className="flex-1 simulation-canvas relative overflow-hidden"
      >
        {/* Grid background pattern */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'linear-gradient(hsl(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Central glow effect */}
        <div className="absolute inset-0 pointer-events-none">
          <div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full opacity-30"
            style={{
              background: 'radial-gradient(ellipse at center, hsl(var(--primary) / 0.3) 0%, transparent 70%)',
            }}
          />
        </div>

        {/* Agent Visualization */}
        {status === 'idle' ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full border-2 border-dashed border-primary/30 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border border-primary/50 flex items-center justify-center animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-primary/20" />
                </div>
              </div>
              <h3 className="text-xl font-medium text-foreground mb-2">Ready to Simulate</h3>
              <p className="text-sm text-muted-foreground max-w-[300px]">
                Configure your idea in the chat panel to start the multi-agent simulation
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 p-8 flex items-center justify-center">
            <div 
              className="grid gap-1.5 max-w-full max-h-full"
              style={{
                gridTemplateColumns: `repeat(${Math.min(gridSize, 15)}, minmax(0, 1fr))`,
              }}
            >
              {agentArray.slice(0, 225).map((agent) => (
                <div
                  key={agent.id}
                  className={cn(
                    "agent-dot transition-colors duration-300",
                    getStatusColor(agent.status)
                  )}
                  title={`Agent ${agent.id.slice(0, 8)} - ${agent.status}`}
                />
              ))}
              {agentArray.length === 0 && (status === 'running' || status === 'paused') && (
                // Placeholder agents for demo
                Array.from({ length: 100 }).map((_, i) => (
                  <div
                    key={i}
                    className="agent-dot bg-agent-neutral opacity-50"
                    style={{ animationDelay: `${i * 0.02}s` }}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Iteration indicator overlay */}
        {status !== 'idle' && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="glass-panel p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Iteration Progress</span>
                <span className="text-sm font-mono text-primary">
                  {currentIteration} / {totalIterations || '∞'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-500 rounded-full"
                  style={{ 
                    width: totalIterations > 0 
                      ? `${(currentIteration / totalIterations) * 100}%` 
                      : '50%' 
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
