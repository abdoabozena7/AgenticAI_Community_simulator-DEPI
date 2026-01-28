export interface Agent {
  id: string;
  status: 'accepted' | 'rejected' | 'neutral' | 'thinking';
  position: { x: number; y: number; z: number };
  category: string;
  lastUpdate: number;
}

export interface ReasoningMessage {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  iteration: number;
  opinion?: 'accept' | 'reject' | 'neutral';
}

export interface SimulationMetrics {
  totalAgents: number;
  accepted: number;
  rejected: number;
  neutral: number;
  acceptanceRate: number;
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
    field: 'category' | 'audience' | 'goals' | 'maturity';
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
}

export type SimulationStatus = 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
