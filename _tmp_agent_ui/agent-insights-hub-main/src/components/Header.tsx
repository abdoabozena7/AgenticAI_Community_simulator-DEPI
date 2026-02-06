import { Cpu, Wifi, WifiOff } from 'lucide-react';
import { SimulationStatus } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface HeaderProps {
  simulationStatus: SimulationStatus;
  isConnected: boolean;
}

export function Header({ simulationStatus, isConnected }: HeaderProps) {
  return (
    <header className="glass-panel border-b border-border/50 px-6 py-3">
      <div className="flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary-foreground" />
            </div>
            {simulationStatus === 'running' && (
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success border-2 border-background animate-pulse" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              <span className="text-gradient">AgentSim</span>
            </h1>
            <p className="text-xs text-muted-foreground">Multi-Agent Social Simulation</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
            isConnected 
              ? "bg-success/10 text-success border border-success/20" 
              : "bg-destructive/10 text-destructive border border-destructive/20"
          )}>
            {isConnected ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>

          {/* Simulation Status */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
            simulationStatus === 'running' && "bg-primary/10 text-primary border-primary/20",
            simulationStatus === 'paused' && "bg-warning/10 text-warning border-warning/20",
            simulationStatus === 'completed' && "bg-success/10 text-success border-success/20",
            simulationStatus === 'error' && "bg-destructive/10 text-destructive border-destructive/20",
            simulationStatus === 'idle' && "bg-muted text-muted-foreground border-border",
            simulationStatus === 'configuring' && "bg-accent/10 text-accent border-accent/20"
          )}>
            <div className={cn(
              "w-2 h-2 rounded-full",
              simulationStatus === 'running' && "bg-primary animate-pulse",
              simulationStatus === 'paused' && "bg-warning",
              simulationStatus === 'completed' && "bg-success",
              simulationStatus === 'error' && "bg-destructive",
              simulationStatus === 'idle' && "bg-muted-foreground",
              simulationStatus === 'configuring' && "bg-accent animate-pulse"
            )} />
            <span className="capitalize">{simulationStatus}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
