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

export type TopBarStepState = 'completed' | 'current' | 'upcoming';

export interface TopBarStep {
  key: string;
  label: string;
  state: TopBarStepState;
  subtleStatus?: string;
}

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'blocked';

export interface SimulationPipelineStep {
  key: string;
  label: {
    ar?: string;
    en?: string;
  };
  status: PipelineStepStatus;
  detail?: string | null;
  started_at?: number | null;
  completed_at?: number | null;
}

export interface SimulationPersonaSourceOption {
  mode: string;
  label: string;
  recommended?: boolean;
}

export interface SimulationPersonaSource {
  mode?: string | null;
  resolved: boolean;
  auto_selected?: boolean;
  notice?: string | null;
  selected_set_key?: string | null;
  selected_set_label?: string | null;
  options: SimulationPersonaSourceOption[];
}

export interface SimulationPipeline {
  ready_for_simulation: boolean;
  blockers: string[];
  actively_blocked?: boolean;
  blocker_details?: Array<{
    code: string;
    phase_key?: string | null;
    title: string;
    message: string;
    action?: string | null;
  }>;
  blocked_phase?: string | null;
  warnings?: string[];
  fatal_errors?: string[];
  steps: SimulationPipelineStep[];
}

export interface SimulationUiState {
  screenTitle: string;
  stageLabel: string;
  currentStatusLabel: string;
  currentStatusTone: 'idle' | 'info' | 'success' | 'warning' | 'error';
  steps: TopBarStep[];
  currentStepLoading: boolean;
  graphTitle: string;
  graphDescription: string;
  graphLegend: Array<{
    key: string;
    label: string;
    color: string;
  }>;
  graphEmptyTitle: string;
  graphEmptyDescription: string;
  metricsHeadline: string;
  metricsDescription: string;
  metricsEmptyLabel: string;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'system' | 'agent';
  content: string;
  timestamp: number;
  agentId?: string;
  options?: {
    field: 'category' | 'audience' | 'goals' | 'maturity' | 'location_choice' | 'clarification_choice' | 'preflight_choice';
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
  decisionAxis?: string | null;
  affectedAgents?: {
    reject: number;
    neutral: number;
    totalWindow: number;
  } | null;
  supportingSnippets?: string[];
  questionQuality?: {
    score: number;
    checksPassed: string[];
  } | null;
  createdAt?: number | null;
  required: true;
}

export interface PreflightQuestionOption {
  id: string;
  label: string;
}

export interface UnderstandingQuestion {
  id: string;
  axis: string;
  question: string;
  options: PreflightQuestionOption[];
  required: boolean;
  reasonSummary?: string;
  generationMode?: 'llm' | 'fallback';
  questionQuality?: {
    score?: number;
    checksPassed?: string[];
  } | null;
}

export interface UnderstandingBatchAnswer {
  questionId: string;
  axis: string;
  selectedOptionId?: string;
  customText?: string;
}

export interface PreferredIdeaConfirmationState {
  description: string;
  summary?: string;
  clarityScore?: number;
}

export interface SocietyCatalogItem {
  categoryId: string;
  description: string;
  templateCount: number;
  sampleArchetypes: string[];
}

export interface SocietyCustomSpec {
  profileName?: string;
  profileId?: string;
  agentCount: number;
  distribution: {
    skepticRatio: number;
    optimistRatio: number;
    pragmaticRatio: number;
    policyGuardRatio: number;
  };
  controls: {
    diversity: number;
    innovationBias: number;
    riskSensitivity: number;
    strictPolicy: boolean;
    humanDebateStyle: boolean;
    personaHint?: string;
  };
}

export type StartPathChoice = 'inspect_default' | 'build_custom' | 'start_default';

export interface PreflightQuestion {
  questionId: string;
  axis: string;
  question: string;
  options: PreflightQuestionOption[];
  reasonSummary?: string;
  required: true;
  questionQuality?: {
    score?: number;
    checksPassed?: string[];
  } | null;
}

export interface PreflightState {
  active: boolean;
  round: number;
  maxRounds: number;
  clarityScore: number;
  missingAxes: string[];
  normalizedContext: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
  question: PreflightQuestion | null;
}

export interface PendingIdeaConfirmation {
  description: string;
  summary?: string;
  clarityScore?: number;
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

export type SimulationBlockerTag =
  | 'competitive_parity'
  | 'unclear_value'
  | 'unclear_target'
  | 'market_demand'
  | 'feasibility_scalability'
  | 'evidence_gap'
  | string;

export interface CoachEvidenceRef {
  id: string;
  source: 'agent' | 'research';
  label?: string;
  quote: string;
  messageId?: string;
  stepUid?: string | null;
  eventSeq?: number | null;
  agentId?: string;
  agentLabel?: string;
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  reasonTag?: string | null;
}

export interface CoachSuggestion {
  suggestionId: string;
  kind: string;
  title: string;
  oneLiner: string;
  rationale: string;
  tradeoff?: string;
  ctaLabel?: string;
  evidenceRefIds: string[];
  contextPatch: Record<string, unknown>;
  rerunFromStage: string;
  estimatedEtaDeltaSeconds: number;
}

export interface CoachPatchPreview {
  contextPatch: Record<string, unknown>;
  rerunFromStage: string;
  guideMessage: string;
  selectedSuggestionId?: string | null;
  neutralizedText?: string | null;
  notes?: string[];
  estimatedEtaDeltaSeconds?: number | null;
}

export interface CoachIntervention {
  interventionId: string;
  simulationId?: string;
  blockerTag: SimulationBlockerTag;
  blockerSummary: string;
  severity: 'medium' | 'high' | string;
  decisionAxis?: string | null;
  shouldPause: boolean;
  uiState: 'observing' | 'diagnosed' | 'options_ready' | 'applying_patch' | 'rerunning' | 'resolved' | string;
  guideMessage?: string;
  phaseKey?: string | null;
  agentCitations: CoachEvidenceRef[];
  researchEvidence: CoachEvidenceRef[];
  suggestions: CoachSuggestion[];
  patchPreview?: CoachPatchPreview | null;
  customFix?: {
    raw_text?: string;
    neutralized_text?: string;
    field_updates?: Record<string, unknown>;
    notes?: string[];
    steering_filtered?: boolean;
    apply_mode?: 'factual_update' | 'needs_review' | 'filtered' | string;
  } | null;
  continueBlocked?: boolean;
  createdAt?: number | null;
  resolvedAt?: number | null;
  resolution?: string | null;
  history?: Array<{
    type: string;
    label?: string;
  }>;
}

export interface UserInput {
  idea: string;
  category: string;
  targetAudience: string[];
  country: string;
  city: string;
  placeName?: string;
  riskAppetite: number;
  ideaMaturity: 'concept' | 'prototype' | 'mvp' | 'launched';
  goals: string[];
  /** Number of agents to simulate (5..500). Optional. */
  agentCount?: number;
}

export type SimulationStatus = 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';

export type ResearchGateMode = 'none' | 'prestart_review' | 'runtime_review';

export type WorkflowStage =
  | 'context_scope'
  | 'schema_intake'
  | 'clarification'
  | 'idea_research'
  | 'location_research'
  | 'persona_synthesis'
  | 'review'
  | 'ready_to_start';

export type WorkflowStatus = 'awaiting_input' | 'in_progress' | 'paused' | 'ready';

export interface WorkflowGuideMessage {
  id: string;
  role: 'guide';
  tone?: 'guide' | 'status' | 'correction';
  content: string;
  stage?: WorkflowStage | string;
  timestamp: number;
}

export interface WorkflowClarificationQuestion {
  id: string;
  axis: string;
  prompt: string;
  reason?: string;
  answer_type: 'text';
}

export interface GuidedWorkflowDraftContext {
  idea: string;
  category: string;
  targetAudience: string[];
  country: string;
  city: string;
  placeName: string;
  riskAppetite: number;
  ideaMaturity: 'concept' | 'prototype' | 'mvp' | 'launched' | string;
  goals: string[];
  contextScope: '' | 'specific_place' | 'internet' | 'global';
  language?: 'ar' | 'en';
  valuePromise?: string;
  adoptionTrigger?: string;
}

export interface WorkflowResearchSource {
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  favicon_url?: string;
  score?: number;
}

export interface GuidedWorkflowCorrection {
  raw_text: string;
  neutralized_text: string;
  field_updates?: Record<string, unknown>;
  notes?: string[];
  steering_filtered?: boolean;
  apply_mode?: 'factual_update' | 'needs_review' | 'filtered';
  timestamp: number;
}

export interface GuidedWorkflowPersonaSnapshot {
  title: string;
  place_key: string;
  place_label: string;
  scope: string;
  source_policy: string;
  source?: string;
  personas: Array<{
    id: string;
    label: string;
    stance: 'accept' | 'reject' | 'neutral' | string;
    summary: string;
    motivations: string[];
    concerns: string[];
    source_signals?: string[];
  }>;
}

export interface GuidedWorkflowState {
  workflow_id: string;
  status: WorkflowStatus;
  current_stage: WorkflowStage;
  current_stage_status: string;
  stage_eta_seconds: number;
  estimated_total_seconds: number;
  required_fields: string[];
  context_options: Array<{
    id: GuidedWorkflowDraftContext['contextScope'];
    label: string;
    description: string;
  }>;
  draft_context: GuidedWorkflowDraftContext;
  guide_messages: WorkflowGuideMessage[];
  stage_history: Array<{
    stage: WorkflowStage | string;
    status: string;
    eta_seconds?: number;
    summary?: string;
    started_at?: number;
    completed_at?: number | null;
  }>;
  clarification_questions?: WorkflowClarificationQuestion[] | null;
  clarification_answers?: Record<string, string>;
  idea_research?: {
    query?: string;
    summary?: string;
    highlights?: string[];
    sources?: WorkflowResearchSource[];
    provider?: string;
    quality?: Record<string, unknown>;
  } | null;
  location_research?: {
    query_plan?: string[];
    summary?: string;
    signals?: string[];
    sources?: WorkflowResearchSource[];
    place_label?: string;
    source_policy?: string;
  } | null;
  persona_snapshot?: GuidedWorkflowPersonaSnapshot | null;
  persona_library?: {
    place_key?: string;
    place_label?: string;
    source?: string;
  } | null;
  review?: {
    title?: string;
    summary?: string;
    research_highlights?: string[];
    location_summary?: string;
    persona_count?: number;
    persona_title?: string;
    applied_corrections?: GuidedWorkflowCorrection[];
    estimated_runtime_seconds?: number;
    ready_to_start?: boolean;
  } | null;
  review_approved?: boolean;
  last_correction?: GuidedWorkflowCorrection | null;
  corrections?: GuidedWorkflowCorrection[];
  verification?: {
    stage?: string;
    ok?: boolean;
    checked_at?: number;
  };
  simulation?: {
    attached_simulation_id?: string | null;
    debate_session?: {
      status?: string;
      watch_ready?: boolean;
      message?: string;
    };
  };
  pause_reason?: string | null;
  created_at?: number | string;
  updated_at?: number | string;
}
