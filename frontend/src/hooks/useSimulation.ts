import { useState, useCallback, useEffect, useReducer, useRef } from 'react';
import { websocketService, WebSocketEvent, MetricsEvent, ReasoningStepEvent, ReasoningDebugEvent, AgentsEvent } from '@/services/websocket';
import { apiService, SimulationConfig, SimulationStateResponse, getAuthToken } from '@/services/api';
import { Agent, ReasoningMessage, ReasoningDebug, SimulationMetrics, SimulationStatus, SimulationChatEvent, PendingClarification, PendingResearchReview } from '@/types/simulation';

interface SimulationState {
  status: SimulationStatus;
  statusReason: 'running' | 'interrupted' | 'paused_manual' | 'paused_search_failed' | 'paused_research_review' | 'paused_credits_exhausted' | 'paused_clarification_needed' | 'error' | 'completed' | null;
  policyMode: 'normal' | 'safety_guard_hard';
  policyReason: string | null;
  searchQuality: {
    usable_sources: number;
    domains: number;
    extraction_success_rate: number;
  } | null;
  simulationId: string | null;
  currentPhaseKey: string | null;
  phaseProgressPct: number;
  lastEventSeq: number;
  agents: Map<string, Agent>;
  metrics: SimulationMetrics;
  reasoningFeed: ReasoningMessage[];
  reasoningDebug: ReasoningDebug[];
  chatEvents: SimulationChatEvent[];
  researchSources: {
    eventSeq?: number;
    cycleId?: string | null;
    action?: string | null;
    status?: string | null;
    url?: string | null;
    domain?: string | null;
    faviconUrl?: string | null;
    title?: string | null;
    httpStatus?: number | null;
    contentChars?: number | null;
    relevanceScore?: number | null;
    progressPct?: number | null;
    snippet?: string | null;
    error?: string | null;
    metaJson?: Record<string, unknown> | null;
    timestamp: number;
  }[];
  summary: string | null;
  canResume: boolean;
  resumeReason: string | null;
  pendingClarification: PendingClarification | null;
  canAnswerClarification: boolean;
  pendingResearchReview: PendingResearchReview | null;
  activePulses: { from: string; to: string; active: boolean; pulseProgress: number }[];
}

type SimulationAction =
  | { type: 'SET_STATUS'; payload: SimulationStatus }
  | { type: 'SET_STATUS_REASON'; payload: SimulationState['statusReason'] }
  | { type: 'SET_POLICY'; payload: { policyMode: SimulationState['policyMode']; policyReason: string | null; searchQuality: SimulationState['searchQuality'] } }
  | { type: 'SET_SIMULATION_ID'; payload: string }
  | { type: 'SET_PHASE'; payload: { currentPhaseKey: string | null; phaseProgressPct: number } }
  | { type: 'SET_LAST_EVENT_SEQ'; payload: number }
  | { type: 'UPDATE_METRICS'; payload: MetricsEvent }
  | { type: 'UPDATE_AGENTS'; payload: AgentsEvent }
  | { type: 'SET_REASONING'; payload: ReasoningMessage[] }
  | { type: 'SET_CHAT_EVENTS'; payload: SimulationChatEvent[] }
  | { type: 'ADD_CHAT_EVENT'; payload: SimulationChatEvent }
  | { type: 'ADD_REASONING'; payload: ReasoningStepEvent }
  | { type: 'ADD_REASONING_DEBUG'; payload: ReasoningDebugEvent }
  | { type: 'SET_RESEARCH_SOURCES'; payload: SimulationState['researchSources'] }
  | { type: 'ADD_RESEARCH_SOURCE'; payload: SimulationState['researchSources'][number] }
  | { type: 'SET_SUMMARY'; payload: string | null }
  | { type: 'SET_RESUME_META'; payload: { canResume: boolean; resumeReason: string | null } }
  | { type: 'SET_CLARIFICATION'; payload: { pendingClarification: PendingClarification | null; canAnswerClarification: boolean } }
  | { type: 'SET_RESEARCH_REVIEW'; payload: PendingResearchReview | null }
  | { type: 'SET_PULSES'; payload: { from: string; to: string; active: boolean; pulseProgress: number }[] }
  | { type: 'ADD_PULSES'; payload: { from: string; to: string; active: boolean; pulseProgress: number }[] }
  | { type: 'RESET' };

const initialMetrics: SimulationMetrics = {
  totalAgents: 0,
  accepted: 0,
  rejected: 0,
  neutral: 0,
  acceptanceRate: 0,
  polarization: 0,
  currentIteration: 0,
  totalIterations: 0,
  perCategoryAccepted: {},
};

const initialState: SimulationState = {
  status: 'idle',
  statusReason: null,
  policyMode: 'normal',
  policyReason: null,
  searchQuality: null,
  simulationId: null,
  currentPhaseKey: null,
  phaseProgressPct: 0,
  lastEventSeq: 0,
  agents: new Map(),
  metrics: initialMetrics,
  reasoningFeed: [],
  reasoningDebug: [],
  chatEvents: [],
  researchSources: [],
  summary: null,
  canResume: false,
  resumeReason: null,
  pendingClarification: null,
  canAnswerClarification: false,
  pendingResearchReview: null,
  activePulses: [],
};

const ACTIVE_SIMULATION_KEY = 'activeSimulationId';

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildReasoningId = (input: {
  stepUid?: string;
  agentId: string;
  iteration: number;
  phase?: string;
  replyToShortId?: string;
  opinion?: string;
  message: string;
}) => {
  if (input.stepUid) {
    return `r-${input.stepUid}`;
  }
  const key = [
    input.agentId,
    String(input.iteration ?? 0),
    input.phase ?? '',
    input.replyToShortId ?? '',
    input.opinion ?? '',
    (input.message || '').trim(),
  ].join('|');
  return `r-${hashString(key)}`;
};

const createPosition = (seed: string, index: number, total: number): [number, number, number] => {
  const base = hashString(seed) || 1;
  const rand = (n: number) => {
    const x = Math.sin(base * n) * 10000;
    return x - Math.floor(x);
  };
  const phi = Math.acos(-1 + (2 * index) / Math.max(total, 1));
  const theta = Math.sqrt(Math.max(total, 1) * Math.PI) * phi;
  const radius = 4 + rand(1) * 1.5;
  return [
    radius * Math.cos(theta) * Math.sin(phi),
    radius * Math.sin(theta) * Math.sin(phi),
    radius * Math.cos(phi),
  ];
};

const mapOpinionToStatus = (opinion: string): Agent['status'] => {
  if (opinion === 'accept') return 'accepted';
  if (opinion === 'reject') return 'rejected';
  return 'neutral';
};

const buildConnections = (agentIds: string[]) => {
  const connections = new Map<string, string[]>();
  const total = agentIds.length;
  agentIds.forEach((id, idx) => {
    if (total <= 1) {
      connections.set(id, []);
      return;
    }
    const picks = (hashString(`${id}-c`) % 3) + 1;
    const targets = new Set<string>();
    for (let i = 0; i < picks; i += 1) {
      const offset = 1 + (hashString(`${id}-${i}`) % (total - 1));
      const target = agentIds[(idx + offset) % total];
      if (target && target !== id) {
        targets.add(target);
      }
    }
    connections.set(id, Array.from(targets));
  });
  return connections;
};

function simulationReducer(state: SimulationState, action: SimulationAction): SimulationState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.payload };

    case 'SET_STATUS_REASON':
      return { ...state, statusReason: action.payload };

    case 'SET_POLICY':
      return {
        ...state,
        policyMode: action.payload.policyMode,
        policyReason: action.payload.policyReason,
        searchQuality: action.payload.searchQuality,
      };

    case 'SET_SIMULATION_ID':
      return { ...state, simulationId: action.payload };

    case 'SET_PHASE':
      return {
        ...state,
        currentPhaseKey: action.payload.currentPhaseKey,
        phaseProgressPct: action.payload.phaseProgressPct,
      };

    case 'SET_LAST_EVENT_SEQ':
      return {
        ...state,
        lastEventSeq: Math.max(state.lastEventSeq, action.payload),
      };

    case 'UPDATE_METRICS': {
      const event = action.payload;
      return {
        ...state,
        lastEventSeq: typeof event.event_seq === 'number' ? Math.max(state.lastEventSeq, event.event_seq) : state.lastEventSeq,
        metrics: {
          totalAgents: event.total_agents,
          accepted: event.accepted,
          rejected: event.rejected,
          neutral: event.neutral,
          acceptanceRate: event.acceptance_rate * 100,
          polarization: typeof event.polarization === 'number' ? event.polarization : state.metrics.polarization,
          currentIteration: event.iteration,
          totalIterations: event.total_iterations ?? state.metrics.totalIterations,
          perCategoryAccepted: event.per_category || {},
        },
      };
    }

    case 'UPDATE_AGENTS': {
      const previousAgents = state.agents;
      const nextAgents = new Map<string, Agent>();
      const ts = Date.now();
      const incomingIds = action.payload.agents.map((agent) => agent.agent_id);
      const connectionMap = buildConnections(incomingIds);
      action.payload.agents.forEach((agent, index) => {
        const existing = previousAgents.get(agent.agent_id);
        const position = existing?.position ?? createPosition(agent.agent_id, index, incomingIds.length);
        nextAgents.set(agent.agent_id, {
          id: agent.agent_id,
          status: mapOpinionToStatus(agent.opinion),
          position,
          connections: connectionMap.get(agent.agent_id) ?? [],
          category: agent.category_id,
          lastUpdate: ts,
        });
      });
      return {
        ...state,
        lastEventSeq: typeof action.payload.event_seq === 'number'
          ? Math.max(state.lastEventSeq, action.payload.event_seq)
          : state.lastEventSeq,
        agents: nextAgents,
      };
    }

    case 'ADD_REASONING': {
      const event = action.payload;
      const ts = event.timestamp ?? Date.now();
      const replyToShortId = event.reply_to_short_id ?? (event.reply_to_agent_id ? event.reply_to_agent_id.slice(0, 4) : undefined);
      const messageId = buildReasoningId({
        stepUid: event.step_uid,
        agentId: event.agent_id,
        iteration: event.iteration,
        phase: event.phase,
        replyToShortId,
        opinion: event.opinion,
        message: event.message,
      });
      if (state.reasoningFeed.some((item) => item.id === messageId)) {
        return state;
      }
      const newMessage: ReasoningMessage = {
        id: messageId,
        stepUid: event.step_uid,
        eventSeq: event.event_seq,
        agentId: event.agent_id,
        agentShortId: event.agent_short_id ?? event.agent_id.slice(0, 4),
        agentLabel: event.agent_label,
        archetype: event.archetype,
        message: event.message,
        timestamp: ts,
        iteration: event.iteration,
        phase: event.phase,
        replyToAgentId: event.reply_to_agent_id,
        replyToShortId,
        opinion: event.opinion,
        opinionSource: event.opinion_source ?? 'llm',
        stanceBefore: event.stance_before,
        stanceAfter: event.stance_after,
        stanceConfidence: event.stance_confidence,
        reasoningLength: event.reasoning_length,
        fallbackReason: event.fallback_reason ?? null,
        relevanceScore: typeof event.relevance_score === 'number' ? event.relevance_score : null,
        policyGuard: Boolean(event.policy_guard),
        policyReason: event.policy_reason ?? null,
        stanceLocked: Boolean(event.stance_locked),
      };
      const nextAgents = new Map(state.agents);
      const existing = nextAgents.get(event.agent_id);
      if (existing) {
        const nextStatus = event.opinion
          ? mapOpinionToStatus(event.opinion)
          : 'reasoning';
        nextAgents.set(event.agent_id, {
          ...existing,
          status: nextStatus,
          lastUpdate: ts,
        });
      }
      const pulseTargets = existing?.connections ?? [];
      const newPulses = pulseTargets.map((to) => ({
        from: event.agent_id,
        to,
        active: true,
        pulseProgress: 0,
      }));
      return {
        ...state,
        lastEventSeq: typeof event.event_seq === 'number' ? Math.max(state.lastEventSeq, event.event_seq) : state.lastEventSeq,
        agents: nextAgents,
        reasoningFeed: [...state.reasoningFeed, newMessage],
        activePulses: [...state.activePulses, ...newPulses],
      };
    }

    case 'ADD_REASONING_DEBUG': {
      const event = action.payload;
      const ts = event.timestamp ?? Date.now();
      const debugItem: ReasoningDebug = {
        id: `${event.agent_id}-${ts}-${event.attempt ?? 'x'}`,
        agentId: event.agent_id,
        agentShortId: event.agent_short_id ?? event.agent_id.slice(0, 4),
        phase: event.phase,
        attempt: event.attempt,
        stage: event.stage,
        reason: event.reason,
        timestamp: ts,
      };
      return {
        ...state,
        reasoningDebug: [...state.reasoningDebug, debugItem],
      };
    }

    case 'SET_REASONING': {
      return {
        ...state,
        reasoningFeed: action.payload,
      };
    }

    case 'SET_CHAT_EVENTS': {
      return {
        ...state,
        chatEvents: action.payload,
      };
    }

    case 'ADD_CHAT_EVENT': {
      const incoming = action.payload;
      const existingIndex = state.chatEvents.findIndex(
        (item) => item.eventSeq === incoming.eventSeq
          || (incoming.messageId && item.messageId === incoming.messageId),
      );
      const next = [...state.chatEvents];
      if (existingIndex >= 0) {
        next[existingIndex] = incoming;
      } else {
        next.push(incoming);
      }
      next.sort((a, b) => (a.eventSeq || 0) - (b.eventSeq || 0));
      const clipped = next.length > 600 ? next.slice(next.length - 600) : next;
      return {
        ...state,
        chatEvents: clipped,
        lastEventSeq: Math.max(state.lastEventSeq, incoming.eventSeq || 0),
      };
    }

    case 'SET_RESEARCH_SOURCES':
      return {
        ...state,
        researchSources: action.payload,
      };

    case 'ADD_RESEARCH_SOURCE': {
      const item = action.payload;
      const key = `${item.eventSeq ?? 'x'}|${item.url ?? ''}|${item.action ?? ''}|${item.status ?? ''}|${item.timestamp}`;
      const exists = state.researchSources.some((entry) => {
        const entryKey = `${entry.eventSeq ?? 'x'}|${entry.url ?? ''}|${entry.action ?? ''}|${entry.status ?? ''}|${entry.timestamp}`;
        return entryKey === key;
      });
      if (exists) {
        return state;
      }
      return {
        ...state,
        researchSources: [...state.researchSources, item].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
        lastEventSeq: typeof item.eventSeq === 'number' ? Math.max(state.lastEventSeq, item.eventSeq) : state.lastEventSeq,
      };
    }

    case 'SET_SUMMARY': {
      return {
        ...state,
        summary: action.payload,
      };
    }

    case 'SET_RESUME_META': {
      return {
        ...state,
        canResume: action.payload.canResume,
        resumeReason: action.payload.resumeReason,
      };
    }

    case 'SET_CLARIFICATION': {
      return {
        ...state,
        pendingClarification: action.payload.pendingClarification,
        canAnswerClarification: action.payload.canAnswerClarification,
      };
    }

    case 'SET_RESEARCH_REVIEW': {
      return {
        ...state,
        pendingResearchReview: action.payload,
      };
    }

    case 'SET_PULSES': {
      return {
        ...state,
        activePulses: action.payload,
      };
    }

    case 'ADD_PULSES': {
      return {
        ...state,
        activePulses: [...state.activePulses, ...action.payload],
      };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

interface UseSimulationOptions {
  suppressAutoRestore?: boolean;
}

export function useSimulation(options?: UseSimulationOptions) {
  const suppressAutoRestore = Boolean(options?.suppressAutoRestore);
  const [state, dispatch] = useReducer(simulationReducer, initialState);
  const [error, setError] = useState<string | null>(null);
  const [pollTask, setPollTask] = useState<number | null>(null);
  const stateRef = useRef(state);
  const requestEpochRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const pollCooldownUntilRef = useRef(0);
  const carryOverRef = useRef({ active: false, skipInitial: false, iterationOffset: 0 });
  const restoreOnceRef = useRef(false);
  const latestWsIterationRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const mapBackendStatus = useCallback((status?: SimulationStateResponse['status']): SimulationStatus => {
    if (status === 'completed') return 'completed';
    if (status === 'error') return 'error';
    if (status === 'paused') return 'paused';
    return 'running';
  }, []);

  const shouldSkipInitial = useCallback((iteration?: number) => {
    return carryOverRef.current.active
      && carryOverRef.current.skipInitial
      && (iteration ?? 0) === 0
      && stateRef.current.metrics.currentIteration > 0;
  }, []);

  const markCarryOverProgress = useCallback((iteration?: number) => {
    if (carryOverRef.current.active && carryOverRef.current.skipInitial && (iteration ?? 0) > 0) {
      carryOverRef.current.skipInitial = false;
    }
  }, []);

  const applyIterationOffset = useCallback((iteration?: number) => {
    if (typeof iteration !== 'number') return iteration;
    if (!carryOverRef.current.active) return iteration;
    return iteration + carryOverRef.current.iterationOffset;
  }, []);

  const applyTotalIterationsOffset = useCallback((total?: number) => {
    if (typeof total !== 'number') return total;
    if (!carryOverRef.current.active) return total;
    return total + carryOverRef.current.iterationOffset;
  }, []);

  const applyMetricsOffset = useCallback((event: MetricsEvent): MetricsEvent => {
    if (!carryOverRef.current.active) return event;
    return {
      ...event,
      iteration: (event.iteration ?? 0) + carryOverRef.current.iterationOffset,
      total_iterations: typeof event.total_iterations === 'number'
        ? event.total_iterations + carryOverRef.current.iterationOffset
        : event.total_iterations,
    };
  }, []);

  const mergeReasoning = useCallback((base: ReasoningMessage[], incoming: ReasoningMessage[]) => {
    const map = new Map<string, ReasoningMessage>();
    [...base, ...incoming].forEach((message) => {
      map.set(message.id, message);
    });
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  const buildReasoningMessages = useCallback((steps: NonNullable<SimulationStateResponse['reasoning']>): ReasoningMessage[] => {
    const fallbackTs = Date.now();
    return steps.map((step, index) => {
      const rawTimestamp = (step as unknown as { timestamp?: number }).timestamp;
      const replyToShortId = step.reply_to_short_id ?? (step.reply_to_agent_id ? step.reply_to_agent_id.slice(0, 4) : undefined);
      return {
        id: buildReasoningId({
          stepUid: step.step_uid,
          agentId: step.agent_id,
          iteration: step.iteration,
          phase: step.phase,
          replyToShortId,
          opinion: step.opinion,
          message: step.message,
        }),
        stepUid: step.step_uid,
        eventSeq: step.event_seq,
        agentId: step.agent_id,
        agentShortId: step.agent_short_id ?? step.agent_id.slice(0, 4),
        agentLabel: step.agent_label,
        archetype: step.archetype,
        message: step.message,
        timestamp: typeof rawTimestamp === 'number' ? rawTimestamp : fallbackTs + index,
        iteration: applyIterationOffset(step.iteration) ?? step.iteration,
        phase: step.phase,
        replyToAgentId: step.reply_to_agent_id,
        replyToShortId,
        opinion: step.opinion,
        opinionSource: (step.opinion_source as ReasoningMessage['opinionSource']) ?? 'llm',
        stanceBefore: step.stance_before,
        stanceAfter: step.stance_after,
        stanceConfidence: step.stance_confidence,
        reasoningLength: step.reasoning_length,
        fallbackReason: step.fallback_reason ?? null,
        relevanceScore: typeof step.relevance_score === 'number' ? step.relevance_score : null,
        policyGuard: Boolean(step.policy_guard),
        policyReason: step.policy_reason ?? null,
        stanceLocked: Boolean(step.stance_locked),
      };
    });
  }, [applyIterationOffset]);

  const clearPolling = useCallback(() => {
    if (pollTask) {
      window.clearInterval(pollTask);
      setPollTask(null);
    }
  }, [pollTask]);

  const ensureSocketConnection = useCallback(async () => {
    const apiBase = (import.meta.env.VITE_API_URL || '') as string;
    const wsBase = (import.meta.env.VITE_WS_URL as string | undefined)
      || apiBase
      || 'http://localhost:8000';
    const token = getAuthToken();
    const wsUrl = wsBase
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + `/ws/simulation${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    if (!websocketService.isConnected()) {
      await websocketService.connect(wsUrl);
    }
  }, []);

  const applyStateResponse = useCallback((stateResponse: SimulationStateResponse, options?: { appendReasoning?: boolean }) => {
    if (typeof stateResponse.event_seq === 'number' && stateResponse.event_seq < stateRef.current.lastEventSeq) {
      return;
    }
    const rawIteration = stateResponse.metrics?.iteration ?? 0;
    const mappedStatus = mapBackendStatus(stateResponse.status);
    const adjustedIteration = applyIterationOffset(rawIteration) ?? rawIteration;
    const currentIteration = stateRef.current.metrics.currentIteration ?? 0;
    if (stateResponse.metrics && !shouldSkipInitial(rawIteration)) {
      markCarryOverProgress(rawIteration);
      const adjustedTotal = applyTotalIterationsOffset(stateResponse.metrics.total_iterations);
      if (adjustedIteration >= currentIteration && adjustedIteration >= latestWsIterationRef.current) {
        dispatch({
          type: 'UPDATE_METRICS',
          payload: {
            type: 'metrics',
            accepted: stateResponse.metrics.accepted,
            rejected: stateResponse.metrics.rejected,
            neutral: stateResponse.metrics.neutral,
            acceptance_rate: stateResponse.metrics.acceptance_rate,
            polarization: stateResponse.metrics.polarization,
            total_agents: stateResponse.metrics.total_agents || stateRef.current.metrics.totalAgents,
            iteration: adjustedIteration,
            per_category: stateResponse.metrics.per_category || {},
            total_iterations: adjustedTotal,
          },
        });
      }
    }
    if (stateResponse.agents && stateResponse.agents.length > 0 && !shouldSkipInitial(rawIteration)) {
      dispatch({
        type: 'UPDATE_AGENTS',
        payload: {
          type: 'agents',
          agents: stateResponse.agents,
          iteration: adjustedIteration,
          total_agents: stateResponse.metrics?.total_agents,
        },
      });
    }
    if (stateResponse.reasoning && stateResponse.reasoning.length > 0) {
      const reasoningMessages = buildReasoningMessages(stateResponse.reasoning);
      const shouldMerge = options?.appendReasoning || mappedStatus === 'running';
      const nextReasoning = shouldMerge
        ? mergeReasoning(stateRef.current.reasoningFeed, reasoningMessages)
        : reasoningMessages;
      dispatch({ type: 'SET_REASONING', payload: nextReasoning });
    }
    if (stateResponse.chat_events && stateResponse.chat_events.length > 0) {
      const mappedChatEvents = stateResponse.chat_events
        .map((item, index) => ({
          eventSeq: item.event_seq ?? (index + 1),
          messageId: item.message_id || `chat-${index + 1}`,
          role: (item.role === 'user' || item.role === 'system' || item.role === 'research' || item.role === 'status')
            ? item.role
            : 'system',
          content: item.content || '',
          meta: item.meta || {},
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now() + index,
        }))
        .sort((a, b) => (a.eventSeq || 0) - (b.eventSeq || 0));
      dispatch({ type: 'SET_CHAT_EVENTS', payload: mappedChatEvents });
      const maxChatSeq = mappedChatEvents.reduce((max, item) => Math.max(max, item.eventSeq || 0), 0);
      if (maxChatSeq > 0) {
        dispatch({ type: 'SET_LAST_EVENT_SEQ', payload: maxChatSeq });
      }
    }
    if (stateResponse.research_sources && stateResponse.research_sources.length > 0) {
      const mappedResearch = stateResponse.research_sources.map((entry, index) => ({
        eventSeq: entry.event_seq,
        cycleId: entry.cycle_id ?? null,
        action: entry.action,
        status: entry.status,
        url: entry.url ?? null,
        domain: entry.domain ?? null,
        faviconUrl: entry.favicon_url ?? null,
        title: entry.title ?? null,
        httpStatus: typeof entry.http_status === 'number' ? entry.http_status : null,
        contentChars: typeof entry.content_chars === 'number' ? entry.content_chars : null,
        relevanceScore: typeof entry.relevance_score === 'number' ? entry.relevance_score : null,
        progressPct: typeof entry.progress_pct === 'number' ? entry.progress_pct : null,
        snippet: entry.snippet ?? null,
        error: entry.error ?? null,
        metaJson: entry.meta_json ?? null,
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now() + index,
      }));
      dispatch({ type: 'SET_RESEARCH_SOURCES', payload: mappedResearch });
    }
    if (stateResponse.current_phase_key || stateResponse.phase_progress_pct !== undefined) {
      dispatch({
        type: 'SET_PHASE',
        payload: {
          currentPhaseKey: stateResponse.current_phase_key ?? stateRef.current.currentPhaseKey,
          phaseProgressPct: typeof stateResponse.phase_progress_pct === 'number'
            ? stateResponse.phase_progress_pct
            : stateRef.current.phaseProgressPct,
        },
      });
    }
    if (stateResponse.summary) {
      dispatch({ type: 'SET_SUMMARY', payload: stateResponse.summary });
    }
    dispatch({
      type: 'SET_RESUME_META',
      payload: {
        canResume: Boolean(stateResponse.can_resume),
        resumeReason: stateResponse.resume_reason ?? null,
      },
    });
    const pendingClarificationRaw = stateResponse.pending_clarification;
    const mappedPendingClarification: PendingClarification | null =
      pendingClarificationRaw && typeof pendingClarificationRaw === 'object'
        ? {
            questionId: String(pendingClarificationRaw.question_id || ''),
            question: String(pendingClarificationRaw.question || ''),
            options: Array.isArray(pendingClarificationRaw.options)
              ? pendingClarificationRaw.options
                  .map((item, index) => {
                    if (!item || typeof item !== 'object') return null;
                    const label = String(item.label || item.text || item.value || '').trim();
                    if (!label) return null;
                    const id = String(item.id || `opt_${index + 1}`).trim() || `opt_${index + 1}`;
                    return { id, label };
                  })
                  .filter((item): item is { id: string; label: string } => Boolean(item))
                  .slice(0, 3)
              : [],
            reasonTag: pendingClarificationRaw.reason_tag ?? null,
            reasonSummary: pendingClarificationRaw.reason_summary ?? null,
            createdAt: typeof pendingClarificationRaw.created_at === 'number' ? pendingClarificationRaw.created_at : null,
            required: true,
          }
        : null;
    dispatch({
      type: 'SET_CLARIFICATION',
      payload: {
        pendingClarification: mappedPendingClarification && mappedPendingClarification.questionId
          ? mappedPendingClarification
          : null,
        canAnswerClarification: Boolean(stateResponse.can_answer_clarification),
      },
    });
    const pendingResearchRaw = stateResponse.pending_research_review;
    const mappedPendingResearch: PendingResearchReview | null =
      pendingResearchRaw && typeof pendingResearchRaw === 'object'
        ? {
            cycleId: String(pendingResearchRaw.cycle_id || '').trim(),
            queryPlan: Array.isArray(pendingResearchRaw.query_plan)
              ? pendingResearchRaw.query_plan.map((q) => String(q || '').trim()).filter(Boolean)
              : [],
            candidateUrls: Array.isArray(pendingResearchRaw.candidate_urls)
              ? pendingResearchRaw.candidate_urls
                  .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const id = String(item.id || '').trim();
                    const url = String(item.url || '').trim();
                    if (!id || !url) return null;
                    return {
                      id,
                      url,
                      domain: typeof item.domain === 'string' ? item.domain : undefined,
                      title: typeof item.title === 'string' ? item.title : undefined,
                      snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
                      faviconUrl: typeof item.favicon_url === 'string' ? item.favicon_url : null,
                      score: typeof item.score === 'number' ? item.score : undefined,
                    };
                  })
                  .filter((item): item is PendingResearchReview['candidateUrls'][number] => Boolean(item))
              : [],
            qualitySnapshot: pendingResearchRaw.quality_snapshot && typeof pendingResearchRaw.quality_snapshot === 'object'
              ? {
                  usable_sources: Number((pendingResearchRaw.quality_snapshot as { usable_sources?: number }).usable_sources || 0),
                  domains: Number((pendingResearchRaw.quality_snapshot as { domains?: number }).domains || 0),
                  extraction_success_rate: Number((pendingResearchRaw.quality_snapshot as { extraction_success_rate?: number }).extraction_success_rate || 0),
                  max_content_chars: Number((pendingResearchRaw.quality_snapshot as { max_content_chars?: number }).max_content_chars || 0),
                }
              : null,
            gapSummary: typeof pendingResearchRaw.gap_summary === 'string' ? pendingResearchRaw.gap_summary : null,
            suggestedQueries: Array.isArray(pendingResearchRaw.suggested_queries)
              ? pendingResearchRaw.suggested_queries.map((q) => String(q || '').trim()).filter(Boolean)
              : [],
            required: Boolean(pendingResearchRaw.required ?? true),
          }
        : null;
    dispatch({
      type: 'SET_RESEARCH_REVIEW',
      payload: mappedPendingResearch && mappedPendingResearch.cycleId ? mappedPendingResearch : null,
    });
    dispatch({
      type: 'SET_STATUS_REASON',
      payload: stateResponse.status_reason
        ?? (stateResponse.status === 'running'
          ? 'running'
          : stateResponse.status === 'paused'
            ? 'interrupted'
            : stateResponse.status === 'error'
              ? 'error'
              : 'completed'),
    });
    if (typeof stateResponse.event_seq === 'number') {
      dispatch({ type: 'SET_LAST_EVENT_SEQ', payload: stateResponse.event_seq });
    }
    dispatch({
      type: 'SET_POLICY',
      payload: {
        policyMode: stateResponse.policy_mode ?? 'normal',
        policyReason: stateResponse.policy_reason ?? null,
        searchQuality: stateResponse.search_quality ?? null,
      },
    });
    dispatch({ type: 'SET_STATUS', payload: mappedStatus });
  }, [
    applyIterationOffset,
    applyTotalIterationsOffset,
    buildReasoningMessages,
    mapBackendStatus,
    markCarryOverProgress,
    mergeReasoning,
    shouldSkipInitial,
  ]);

  const beginPolling = useCallback((simulationId: string, requestEpoch: number) => {
    clearPolling();
    pollInFlightRef.current = false;
    pollFailuresRef.current = 0;
    pollCooldownUntilRef.current = 0;
    const configuredInterval = Number((import.meta.env.VITE_STATE_POLL_INTERVAL_MS as string | undefined) || 2000);
    const pollIntervalMs = Number.isFinite(configuredInterval)
      ? Math.max(1200, configuredInterval)
      : 2000;
    const intervalId = window.setInterval(async () => {
      if (requestEpochRef.current !== requestEpoch) return;
      if (stateRef.current.simulationId && stateRef.current.simulationId !== simulationId) return;
      if (pollInFlightRef.current) return;
      const now = Date.now();
      if (now < pollCooldownUntilRef.current) return;
      pollInFlightRef.current = true;
      const stateResponse = await apiService.getSimulationState(simulationId).catch(() => null);
      try {
        if (requestEpochRef.current !== requestEpoch) return;
        if (stateResponse?.simulation_id && stateResponse.simulation_id !== simulationId) return;
        if (!stateResponse) {
          pollFailuresRef.current += 1;
          const backoffMs = Math.min(10000, 1000 * (2 ** Math.min(4, pollFailuresRef.current)));
          pollCooldownUntilRef.current = Date.now() + backoffMs;
          return;
        }
        pollFailuresRef.current = 0;
        pollCooldownUntilRef.current = 0;
        if (stateResponse.error) {
          setError(stateResponse.error);
          dispatch({ type: 'SET_STATUS', payload: 'error' });
          dispatch({
            type: 'SET_RESUME_META',
            payload: { canResume: true, resumeReason: stateResponse.resume_reason ?? stateResponse.error },
          });
          dispatch({ type: 'SET_STATUS_REASON', payload: stateResponse.status_reason ?? 'error' });
          clearPolling();
          return;
        }
        applyStateResponse(stateResponse, { appendReasoning: carryOverRef.current.active });
        const mapped = mapBackendStatus(stateResponse.status);
        if (mapped !== 'running') {
          clearPolling();
        }
      } finally {
        pollInFlightRef.current = false;
      }
    }, pollIntervalMs);
    setPollTask(intervalId);
  }, [applyStateResponse, clearPolling, mapBackendStatus]);

  const handleWebSocketEvent = useCallback((event: WebSocketEvent) => {
    const activeSimulationId = stateRef.current.simulationId;
    if (event.simulation_id) {
      if (!activeSimulationId) return;
      if (event.simulation_id !== activeSimulationId) return;
    }
    const eventSeq = (event as { event_seq?: number }).event_seq;
    if (typeof eventSeq === 'number' && eventSeq < stateRef.current.lastEventSeq) {
      return;
    }
    if (typeof eventSeq === 'number') {
      dispatch({ type: 'SET_LAST_EVENT_SEQ', payload: eventSeq });
    }
    switch (event.type) {
      case 'metrics':
        if (shouldSkipInitial(event.iteration)) return;
        const adjustedMetricsEvent = applyMetricsOffset(event);
        if ((adjustedMetricsEvent.iteration ?? 0) < (stateRef.current.metrics.currentIteration ?? 0)) return;
        markCarryOverProgress(event.iteration);
        latestWsIterationRef.current = Math.max(latestWsIterationRef.current, adjustedMetricsEvent.iteration ?? 0);
        dispatch({ type: 'UPDATE_METRICS', payload: adjustedMetricsEvent });
        dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: null } });
        dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
        break;
      case 'reasoning_step':
        dispatch({
          type: 'ADD_REASONING',
          payload: {
            ...event,
            iteration: applyIterationOffset(event.iteration) ?? event.iteration,
          },
        });
        dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: null } });
        dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
        break;
      case 'reasoning_debug':
        dispatch({ type: 'ADD_REASONING_DEBUG', payload: event });
        break;
      case 'agents':
        if (shouldSkipInitial(event.iteration)) return;
        latestWsIterationRef.current = Math.max(
          latestWsIterationRef.current,
          applyIterationOffset(event.iteration) ?? event.iteration ?? 0,
        );
        dispatch({
          type: 'UPDATE_AGENTS',
          payload: {
            ...event,
            iteration: applyIterationOffset(event.iteration) ?? event.iteration,
          },
        });
        dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: null } });
        dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
        break;
      case 'phase_update':
        dispatch({
          type: 'SET_PHASE',
          payload: {
            currentPhaseKey: event.phase_key ?? stateRef.current.currentPhaseKey,
            phaseProgressPct: typeof event.progress_pct === 'number'
              ? event.progress_pct
              : stateRef.current.phaseProgressPct,
          },
        });
        break;
      case 'research_update':
        dispatch({
          type: 'ADD_RESEARCH_SOURCE',
          payload: {
            eventSeq: event.event_seq,
            cycleId: event.cycle_id ?? null,
            action: event.action ?? null,
            status: event.status ?? null,
            url: event.url ?? null,
            domain: event.domain ?? null,
            faviconUrl: event.favicon_url ?? null,
            title: event.title ?? null,
            httpStatus: typeof event.http_status === 'number' ? event.http_status : null,
            contentChars: typeof event.content_chars === 'number' ? event.content_chars : null,
            relevanceScore: typeof event.relevance_score === 'number' ? event.relevance_score : null,
            progressPct: typeof event.progress_pct === 'number' ? event.progress_pct : null,
            snippet: event.snippet ?? null,
            error: event.error ?? null,
            metaJson: event.meta_json ?? null,
            timestamp: Date.now(),
          },
        });
        if (event.action === 'review_required') {
          const raw = event.meta_json && typeof event.meta_json === 'object' ? event.meta_json : {};
          const pendingReview: PendingResearchReview = {
            cycleId: String((raw as { cycle_id?: string }).cycle_id || event.cycle_id || '').trim(),
            queryPlan: Array.isArray((raw as { query_plan?: unknown[] }).query_plan)
              ? ((raw as { query_plan: unknown[] }).query_plan.map((q) => String(q || '').trim()).filter(Boolean))
              : [],
            candidateUrls: Array.isArray((raw as { candidate_urls?: unknown[] }).candidate_urls)
              ? (raw as { candidate_urls: unknown[] }).candidate_urls
                  .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const obj = item as Record<string, unknown>;
                    const id = String(obj.id || '').trim();
                    const url = String(obj.url || '').trim();
                    if (!id || !url) return null;
                    return {
                      id,
                      url,
                      domain: typeof obj.domain === 'string' ? obj.domain : undefined,
                      title: typeof obj.title === 'string' ? obj.title : undefined,
                      snippet: typeof obj.snippet === 'string' ? obj.snippet : undefined,
                      faviconUrl: typeof obj.favicon_url === 'string' ? obj.favicon_url : null,
                      score: typeof obj.score === 'number' ? obj.score : undefined,
                    };
                  })
                  .filter((item): item is PendingResearchReview['candidateUrls'][number] => Boolean(item))
              : [],
            qualitySnapshot: (raw as { quality_snapshot?: unknown }).quality_snapshot && typeof (raw as { quality_snapshot?: unknown }).quality_snapshot === 'object'
              ? {
                  usable_sources: Number(((raw as { quality_snapshot: { usable_sources?: number } }).quality_snapshot.usable_sources) || 0),
                  domains: Number(((raw as { quality_snapshot: { domains?: number } }).quality_snapshot.domains) || 0),
                  extraction_success_rate: Number(((raw as { quality_snapshot: { extraction_success_rate?: number } }).quality_snapshot.extraction_success_rate) || 0),
                  max_content_chars: Number(((raw as { quality_snapshot: { max_content_chars?: number } }).quality_snapshot.max_content_chars) || 0),
                }
              : null,
            gapSummary: typeof (raw as { gap_summary?: unknown }).gap_summary === 'string' ? String((raw as { gap_summary?: unknown }).gap_summary) : null,
            suggestedQueries: Array.isArray((raw as { suggested_queries?: unknown[] }).suggested_queries)
              ? ((raw as { suggested_queries: unknown[] }).suggested_queries.map((q) => String(q || '').trim()).filter(Boolean))
              : [],
            required: true,
          };
          dispatch({ type: 'SET_RESEARCH_REVIEW', payload: pendingReview.cycleId ? pendingReview : null });
          dispatch({ type: 'SET_STATUS', payload: 'paused' });
          dispatch({ type: 'SET_STATUS_REASON', payload: 'paused_research_review' });
          dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: event.error ?? event.snippet ?? null } });
        } else if (event.action && [
          'research_started',
          'query_planned',
          'search_results_ready',
          'fetch_started',
          'fetch_done',
          'summary_ready',
          'evidence_cards_ready',
          'gaps_ready',
          'research_done',
        ].includes(event.action)) {
          dispatch({ type: 'SET_RESEARCH_REVIEW', payload: null });
          dispatch({ type: 'SET_STATUS', payload: 'running' });
          dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
        }
        break;
      case 'summary':
        dispatch({ type: 'SET_SUMMARY', payload: event.summary });
        break;
      case 'clarification_request': {
        const mappedOptions = Array.isArray(event.options)
          ? event.options
              .map((item, index) => {
                if (!item || typeof item !== 'object') return null;
                const label = String(item.label || item.text || item.value || '').trim();
                if (!label) return null;
                const id = String(item.id || `opt_${index + 1}`).trim() || `opt_${index + 1}`;
                return { id, label };
              })
              .filter((item): item is { id: string; label: string } => Boolean(item))
              .slice(0, 3)
          : [];
        dispatch({
          type: 'SET_CLARIFICATION',
          payload: {
            pendingClarification: {
              questionId: String(event.question_id || ''),
              question: String(event.question || ''),
              options: mappedOptions,
              reasonTag: event.reason_tag ?? null,
              reasonSummary: event.reason_summary ?? null,
              createdAt: typeof event.created_at === 'number' ? event.created_at : null,
              required: true,
            },
            canAnswerClarification: true,
          },
        });
        dispatch({ type: 'SET_STATUS', payload: 'paused' });
        dispatch({ type: 'SET_STATUS_REASON', payload: 'paused_clarification_needed' });
        dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: event.reason_summary ?? null } });
        break;
      }
      case 'clarification_resolved':
        dispatch({
          type: 'SET_CLARIFICATION',
          payload: {
            pendingClarification: null,
            canAnswerClarification: false,
          },
        });
        dispatch({ type: 'SET_STATUS', payload: 'running' });
        dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
        break;
      case 'chat_event':
        dispatch({
          type: 'ADD_CHAT_EVENT',
          payload: {
            eventSeq: typeof event.event_seq === 'number' ? event.event_seq : (stateRef.current.lastEventSeq + 1),
            messageId: String(event.message_id || `chat-${Date.now()}`),
            role: (event.role === 'user' || event.role === 'system' || event.role === 'research' || event.role === 'status')
              ? event.role
              : 'system',
            content: String(event.content || ''),
            meta: event.meta || {},
            timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
          },
        });
        break;
    }
  }, [applyIterationOffset, applyMetricsOffset, markCarryOverProgress, shouldSkipInitial]);

  useEffect(() => {
    const unsubscribe = websocketService.subscribe('all', handleWebSocketEvent);
    return () => unsubscribe();
  }, [handleWebSocketEvent]);

  const loadSimulation = useCallback(async (simulationId: string) => {
    if (!simulationId) return;
    const opEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = opEpoch;
    setError(null);
    latestWsIterationRef.current = 0;
    carryOverRef.current.active = false;
    carryOverRef.current.skipInitial = false;
    carryOverRef.current.iterationOffset = 0;
    dispatch({ type: 'SET_STATUS', payload: 'configuring' });
    dispatch({ type: 'SET_SIMULATION_ID', payload: simulationId });
    dispatch({ type: 'SET_STATUS_REASON', payload: null });
    await ensureSocketConnection();
    if (requestEpochRef.current !== opEpoch) return;
    websocketService.setSimulationSubscription(simulationId);
    const stateResponse = await apiService.getSimulationState(simulationId);
    if (requestEpochRef.current !== opEpoch) return;
    if (stateResponse.simulation_id && stateResponse.simulation_id !== simulationId) return;
    applyStateResponse(stateResponse);
    const mapped = mapBackendStatus(stateResponse.status);
    if (mapped === 'running') beginPolling(simulationId, opEpoch);
    else clearPolling();
  }, [applyStateResponse, beginPolling, clearPolling, ensureSocketConnection, mapBackendStatus]);

  const startSimulation = useCallback(async (config: SimulationConfig, options?: { carryOver?: boolean; throwOnError?: boolean }) => {
    try {
      const opEpoch = requestEpochRef.current + 1;
      requestEpochRef.current = opEpoch;
      setError(null);
      latestWsIterationRef.current = 0;
      carryOverRef.current.active = Boolean(options?.carryOver);
      carryOverRef.current.skipInitial = Boolean(options?.carryOver);
      carryOverRef.current.iterationOffset = options?.carryOver
        ? stateRef.current.metrics.currentIteration
        : 0;
      if (!options?.carryOver) {
        clearPolling();
        websocketService.setSimulationSubscription(null);
        dispatch({ type: 'RESET' });
      }
      dispatch({ type: 'SET_STATUS', payload: 'configuring' });
      dispatch({ type: 'SET_STATUS_REASON', payload: null });
      dispatch({ type: 'SET_SUMMARY', payload: null });
      dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: null } });

      await ensureSocketConnection();
      if (requestEpochRef.current !== opEpoch) return;
      const response = await apiService.startSimulation(config);
      if (requestEpochRef.current !== opEpoch) return;
      websocketService.setSimulationSubscription(response.simulation_id);
      dispatch({ type: 'SET_SIMULATION_ID', payload: response.simulation_id });
      const mappedStartStatus: SimulationStatus =
        response.status === 'paused'
          ? 'paused'
          : response.status === 'completed'
            ? 'completed'
            : response.status === 'error'
              ? 'error'
              : 'running';
      dispatch({ type: 'SET_STATUS', payload: mappedStartStatus });
      dispatch({
        type: 'SET_STATUS_REASON',
        payload: response.status_reason
          ?? (mappedStartStatus === 'running'
            ? 'running'
            : mappedStartStatus === 'paused'
              ? 'paused_search_failed'
              : mappedStartStatus === 'error'
                ? 'error'
                : 'completed'),
      });
      if (mappedStartStatus !== 'running') {
        dispatch({
          type: 'SET_RESUME_META',
          payload: {
            canResume: mappedStartStatus === 'paused' || mappedStartStatus === 'error',
            resumeReason: response.status_reason ?? null,
          },
        });
      }

      const prime = await apiService.getSimulationState(response.simulation_id).catch(() => null);
      if (prime && requestEpochRef.current === opEpoch && (!prime.simulation_id || prime.simulation_id === response.simulation_id)) {
        applyStateResponse(prime, { appendReasoning: carryOverRef.current.active });
      }
      if (mappedStartStatus === 'running') {
        beginPolling(response.simulation_id, opEpoch);
      } else {
        clearPolling();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start simulation';
      setError(message);
      dispatch({ type: 'SET_STATUS', payload: 'error' });
      dispatch({ type: 'SET_STATUS_REASON', payload: 'error' });
      dispatch({ type: 'SET_RESUME_META', payload: { canResume: false, resumeReason: null } });
      if (options?.throwOnError) {
        throw err;
      }
    }
  }, [applyStateResponse, beginPolling, clearPolling, ensureSocketConnection]);

  const resumeSimulation = useCallback(async (simulationId: string) => {
    if (!simulationId) return null;
    const opEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = opEpoch;
    setError(null);
    latestWsIterationRef.current = 0;
    dispatch({ type: 'SET_STATUS', payload: 'configuring' });
    dispatch({ type: 'SET_SIMULATION_ID', payload: simulationId });
    dispatch({ type: 'SET_STATUS_REASON', payload: null });
    await ensureSocketConnection();
    if (requestEpochRef.current !== opEpoch) return null;
    websocketService.setSimulationSubscription(simulationId);
    const response = await apiService.resumeSimulation(simulationId);
    if (requestEpochRef.current !== opEpoch) return response;
    const snapshot = await apiService.getSimulationState(simulationId).catch(() => null);
    if (snapshot && (!snapshot.simulation_id || snapshot.simulation_id === simulationId)) {
      applyStateResponse(snapshot);
    } else {
      dispatch({ type: 'SET_STATUS', payload: mapBackendStatus(response.status) });
      dispatch({ type: 'SET_STATUS_REASON', payload: response.status === 'running' ? 'running' : null });
    }
    if (response.status === 'running') {
      beginPolling(simulationId, opEpoch);
    } else {
      clearPolling();
    }
    return response;
  }, [applyStateResponse, beginPolling, clearPolling, ensureSocketConnection, mapBackendStatus]);

  const pauseSimulation = useCallback(async (simulationId: string, reason?: string) => {
    if (!simulationId) return null;
    const response = await apiService.pauseSimulation(simulationId, reason);
    const snapshot = await apiService.getSimulationState(simulationId).catch(() => null);
    if (snapshot && (!snapshot.simulation_id || snapshot.simulation_id === simulationId)) {
      applyStateResponse(snapshot);
    } else {
      dispatch({ type: 'SET_STATUS', payload: response.status === 'paused' ? 'paused' : mapBackendStatus(response.status) });
      dispatch({ type: 'SET_STATUS_REASON', payload: response.status === 'paused' ? 'paused_manual' : null });
    }
    clearPolling();
    return response;
  }, [applyStateResponse, clearPolling, mapBackendStatus]);

  const submitResearchAction = useCallback(async (payload: {
    simulationId: string;
    cycleId: string;
    action: 'scrape_selected' | 'continue_search' | 'cancel_review';
    selectedUrlIds?: string[];
    addedUrls?: string[];
    queryRefinement?: string;
  }) => {
    const simulationId = payload.simulationId?.trim();
    if (!simulationId) return null;
    const opEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = opEpoch;
    setError(null);
    dispatch({ type: 'SET_STATUS', payload: 'configuring' });
    await ensureSocketConnection();
    if (requestEpochRef.current !== opEpoch) return null;
    websocketService.setSimulationSubscription(simulationId);
    const response = await apiService.submitResearchAction({
      simulation_id: simulationId,
      cycle_id: payload.cycleId,
      action: payload.action,
      selected_url_ids: payload.selectedUrlIds,
      added_urls: payload.addedUrls,
      query_refinement: payload.queryRefinement,
    });
    if (requestEpochRef.current !== opEpoch) return response;
    const snapshot = await apiService.getSimulationState(simulationId).catch(() => null);
    if (snapshot && (!snapshot.simulation_id || snapshot.simulation_id === simulationId)) {
      applyStateResponse(snapshot);
      if (snapshot.status === 'running') beginPolling(simulationId, opEpoch);
      else clearPolling();
    } else {
      dispatch({ type: 'SET_STATUS', payload: mapBackendStatus(response.status) });
      dispatch({ type: 'SET_STATUS_REASON', payload: response.status_reason ?? null });
      if (response.status === 'running') beginPolling(simulationId, opEpoch);
      else clearPolling();
    }
    return response;
  }, [applyStateResponse, beginPolling, clearPolling, ensureSocketConnection, mapBackendStatus]);

  const submitClarificationAnswer = useCallback(async (payload: {
    simulationId: string;
    questionId: string;
    selectedOptionId?: string;
    customText?: string;
  }) => {
    const simulationId = payload.simulationId?.trim();
    if (!simulationId) return null;
    const opEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = opEpoch;
    setError(null);
    dispatch({ type: 'SET_STATUS', payload: 'configuring' });
    const response = await apiService.submitClarificationAnswer({
      simulation_id: simulationId,
      question_id: payload.questionId,
      selected_option_id: payload.selectedOptionId,
      custom_text: payload.customText,
    });
    if (requestEpochRef.current !== opEpoch) return response;
    dispatch({
      type: 'SET_CLARIFICATION',
      payload: {
        pendingClarification: null,
        canAnswerClarification: false,
      },
    });
    dispatch({ type: 'SET_STATUS', payload: 'running' });
    dispatch({ type: 'SET_STATUS_REASON', payload: 'running' });
    await ensureSocketConnection();
    if (requestEpochRef.current !== opEpoch) return response;
    websocketService.setSimulationSubscription(simulationId);
    const snapshot = await apiService.getSimulationState(simulationId).catch(() => null);
    if (snapshot && (!snapshot.simulation_id || snapshot.simulation_id === simulationId)) {
      applyStateResponse(snapshot);
    }
    beginPolling(simulationId, opEpoch);
    return response;
  }, [applyStateResponse, beginPolling, ensureSocketConnection]);

  const stopSimulation = useCallback(() => {
    requestEpochRef.current += 1;
    clearPolling();
    websocketService.setSimulationSubscription(null);
    websocketService.disconnect();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACTIVE_SIMULATION_KEY);
    }
    carryOverRef.current.active = false;
    carryOverRef.current.skipInitial = false;
    carryOverRef.current.iterationOffset = 0;
    dispatch({ type: 'RESET' });
  }, [clearPolling]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (state.simulationId) {
      window.localStorage.setItem(ACTIVE_SIMULATION_KEY, state.simulationId);
    }
  }, [state.simulationId]);

  useEffect(() => {
    if (restoreOnceRef.current) return;
    restoreOnceRef.current = true;
    if (typeof window === 'undefined') return;
    if (suppressAutoRestore) {
      window.localStorage.removeItem(ACTIVE_SIMULATION_KEY);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const requestedSimulationId = params.get('simulation_id')?.trim();
    if (requestedSimulationId) {
      return;
    }
    const pendingAutoStart = window.localStorage.getItem('pendingAutoStart') === 'true';
    const pendingIdea = (window.localStorage.getItem('pendingIdea') || '').trim();
    // If the user is clearly starting a new run (idea form flow), don't resurrect the old active session.
    if (!requestedSimulationId && (pendingAutoStart || pendingIdea)) {
      window.localStorage.removeItem(ACTIVE_SIMULATION_KEY);
      return;
    }
    const savedSimulationId = window.localStorage.getItem(ACTIVE_SIMULATION_KEY);
    if (!savedSimulationId) return;
    loadSimulation(savedSimulationId).catch(() => {
      window.localStorage.removeItem(ACTIVE_SIMULATION_KEY);
    });
  }, [loadSimulation, suppressAutoRestore]);

  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  const pulsesRef = useRef(state.activePulses);
  useEffect(() => {
    pulsesRef.current = state.activePulses;
  }, [state.activePulses]);

  useEffect(() => {
    if (state.status !== 'running') return;
    const pulseId = window.setInterval(() => {
      const next = pulsesRef.current
        .map((p) => ({ ...p, pulseProgress: p.pulseProgress + 0.08 }))
        .filter((p) => p.pulseProgress < 1);
      dispatch({ type: 'SET_PULSES', payload: next });
    }, 80);
    return () => window.clearInterval(pulseId);
  }, [state.status]);

  return {
    ...state,
    error,
    startSimulation,
    loadSimulation,
    resumeSimulation,
    pauseSimulation,
    submitResearchAction,
    submitClarificationAnswer,
    stopSimulation,
    activePulses: state.activePulses,
  };
}
