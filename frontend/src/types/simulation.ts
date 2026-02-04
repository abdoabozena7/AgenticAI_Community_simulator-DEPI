export interface Agent {
  id: string;
  status: 'accepted' | 'rejected' | 'neutral' | 'thinking' | 'reasoning';
  position: [number, number, number];
  connections: string[];
  category: string;
  lastUpdate: number;
}

export interface Connection {
  from: string;
  to: string;
  active: boolean;
  pulseProgress: number;
}

export interface ReasoningMessage {
  id: string;
  agentId: string;
  agentShortId?: string;
  archetype?: string;
  message: string;
  timestamp: number;
  iteration: number;
  phase?: string;
  replyToAgentId?: string;
  replyToShortId?: string;
  opinion?: 'accept' | 'reject' | 'neutral';
  opinionSource?: 'llm' | 'default' | 'fallback';
  stanceConfidence?: number;
  reasoningLength?: 'short' | 'full';
}

export interface ReasoningDebug {
  id: string;
  agentId: string;
  agentShortId?: string;
  phase?: string;
  attempt?: number;
  stage?: string;
  reason: string;
  timestamp: number;
}

export interface SimulationMetrics {
  totalAgents: number;
  accepted: number;
  rejected: number;
  neutral: number;
  acceptanceRate: number;
  polarization?: number;
  currentIteration: number;
  totalIterations: number;
  // Backend provides per-category acceptance counts only.
  perCategoryAccepted: Record<string, number>;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'system' | 'agent';
  content: string;
  timestamp: number;
  agentId?: string;
  options?: {
    field: 'category' | 'audience' | 'goals' | 'maturity' | 'location_choice';
    kind: 'single' | 'multi';
    items: { value: string; label: string; description?: string }[];
  };
}

export interface UserInput {
  idea: string;
  category: string;
  targetAudience: string[];
  country: string;
  city: string;
  riskAppetite: number;
  ideaMaturity: 'concept' | 'prototype' | 'mvp' | 'launched';
  goals: string[];
  /** Number of agents to simulate (5..500). Optional. */
  agentCount?: number;
}

export type SimulationStatus = 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
