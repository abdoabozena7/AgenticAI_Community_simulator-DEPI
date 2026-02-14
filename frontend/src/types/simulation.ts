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
  stepUid?: string;
  eventSeq?: number;
  agentId: string;
  agentShortId?: string;
  agentLabel?: string;
  archetype?: string;
  message: string;
  timestamp: number;
  iteration: number;
  phase?: string;
  replyToAgentId?: string;
  replyToShortId?: string;
  opinion?: 'accept' | 'reject' | 'neutral';
  opinionSource?: 'llm' | 'llm_classified' | 'fallback';
  stanceBefore?: 'accept' | 'reject' | 'neutral';
  stanceAfter?: 'accept' | 'reject' | 'neutral';
  stanceConfidence?: number;
  reasoningLength?: 'short' | 'full';
  fallbackReason?: string | null;
  relevanceScore?: number | null;
  policyGuard?: boolean;
  policyReason?: string | null;
  stanceLocked?: boolean;
}

export interface SimulationChatEvent {
  eventSeq: number;
  messageId: string;
  role: 'user' | 'system' | 'research' | 'status';
  content: string;
  meta?: Record<string, unknown>;
  timestamp: number;
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
    field: 'category' | 'audience' | 'goals' | 'maturity' | 'location_choice' | 'clarification_choice';
    kind: 'single' | 'multi';
    items: { value: string; label: string; description?: string }[];
  };
}

export interface ClarificationOption {
  id: string;
  label: string;
}

export interface PendingClarification {
  questionId: string;
  question: string;
  options: ClarificationOption[];
  reasonTag?: string | null;
  reasonSummary?: string | null;
  createdAt?: number | null;
  required: true;
}

export interface PendingResearchReviewCandidateUrl {
  id: string;
  url: string;
  domain?: string;
  title?: string;
  snippet?: string;
  faviconUrl?: string | null;
  score?: number;
}

export interface PendingResearchReview {
  cycleId: string;
  queryPlan: string[];
  candidateUrls: PendingResearchReviewCandidateUrl[];
  qualitySnapshot?: {
    usable_sources: number;
    domains: number;
    extraction_success_rate: number;
    max_content_chars?: number;
  } | null;
  gapSummary?: string | null;
  suggestedQueries?: string[];
  required: boolean;
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
