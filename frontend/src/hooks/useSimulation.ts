import { useState, useCallback, useEffect, useReducer, useRef } from 'react';
import { websocketService, WebSocketEvent, MetricsEvent, ReasoningStepEvent, ReasoningDebugEvent, AgentsEvent } from '@/services/websocket';
import { apiService, SimulationConfig, SimulationStateResponse } from '@/services/api';
import { Agent, ReasoningMessage, ReasoningDebug, SimulationMetrics, SimulationStatus } from '@/types/simulation';

interface SimulationState {
  status: SimulationStatus;
  simulationId: string | null;
  agents: Map<string, Agent>;
  metrics: SimulationMetrics;
  reasoningFeed: ReasoningMessage[];
  reasoningDebug: ReasoningDebug[];
  summary: string | null;
  activePulses: { from: string; to: string; active: boolean; pulseProgress: number }[];
}

type SimulationAction =
  | { type: 'SET_STATUS'; payload: SimulationStatus }
  | { type: 'SET_SIMULATION_ID'; payload: string }
  | { type: 'UPDATE_METRICS'; payload: MetricsEvent }
  | { type: 'UPDATE_AGENTS'; payload: AgentsEvent }
  | { type: 'SET_REASONING'; payload: ReasoningMessage[] }
  | { type: 'ADD_REASONING'; payload: ReasoningStepEvent }
  | { type: 'ADD_REASONING_DEBUG'; payload: ReasoningDebugEvent }
  | { type: 'SET_SUMMARY'; payload: string | null }
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
  simulationId: null,
  agents: new Map(),
  metrics: initialMetrics,
  reasoningFeed: [],
  reasoningDebug: [],
  summary: null,
  activePulses: [],
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
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
    
    case 'SET_SIMULATION_ID':
      return { ...state, simulationId: action.payload };
    
    case 'UPDATE_METRICS': {
      const event = action.payload;
      return {
        ...state,
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
      const nextAgents = new Map(state.agents);
      const ts = Date.now();
      const incomingIds = action.payload.agents.map((agent) => agent.agent_id);
      const allIds = Array.from(new Set([...nextAgents.keys(), ...incomingIds]));
      const connectionMap = buildConnections(allIds);
      action.payload.agents.forEach((agent, index) => {
        const existing = nextAgents.get(agent.agent_id);
        const position = existing?.position ?? createPosition(agent.agent_id, index, allIds.length);
        nextAgents.set(agent.agent_id, {
          id: agent.agent_id,
          status: mapOpinionToStatus(agent.opinion),
          position,
          connections: connectionMap.get(agent.agent_id) ?? existing?.connections ?? [],
          category: agent.category_id,
          lastUpdate: ts,
        });
      });
      return {
        ...state,
        agents: nextAgents,
      };
    }
    
    case 'ADD_REASONING': {
      const event = action.payload;
      const ts = event.timestamp ?? Date.now();
      const newMessage: ReasoningMessage = {
        id: `${event.agent_id}-${ts}`,
        agentId: event.agent_id,
        agentShortId: event.agent_short_id ?? event.agent_id.slice(0, 4),
        archetype: event.archetype,
        message: event.message,
        timestamp: ts,
        iteration: event.iteration,
        phase: event.phase,
        replyToAgentId: event.reply_to_agent_id,
        replyToShortId: event.reply_to_agent_id ? event.reply_to_agent_id.slice(0, 4) : undefined,
        opinion: event.opinion,
        opinionSource: event.opinion_source,
        stanceConfidence: event.stance_confidence,
        reasoningLength: event.reasoning_length,
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
        agents: nextAgents,
        reasoningFeed: [...state.reasoningFeed.slice(-99), newMessage],
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
        reasoningDebug: [...state.reasoningDebug.slice(-199), debugItem],
      };
    }

    case 'SET_REASONING': {
      return {
        ...state,
        reasoningFeed: action.payload.slice(-99),
      };
    }

    case 'SET_SUMMARY': {
      return {
        ...state,
        summary: action.payload,
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

export function useSimulation() {
  const [state, dispatch] = useReducer(simulationReducer, initialState);
  const [error, setError] = useState<string | null>(null);
  const [pollTask, setPollTask] = useState<number | null>(null);
  const stateRef = useRef(state);
  const carryOverRef = useRef({ active: false, skipInitial: false, iterationOffset: 0 });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const handleWebSocketEvent = useCallback((event: WebSocketEvent) => {
    switch (event.type) {
      case 'metrics':
        if (shouldSkipInitial(event.iteration)) return;
        markCarryOverProgress(event.iteration);
        dispatch({ type: 'UPDATE_METRICS', payload: applyMetricsOffset(event) });
        break;
      case 'reasoning_step':
        dispatch({
          type: 'ADD_REASONING',
          payload: {
            ...event,
            iteration: applyIterationOffset(event.iteration) ?? event.iteration,
          },
        });
        break;
      case 'reasoning_debug':
        dispatch({ type: 'ADD_REASONING_DEBUG', payload: event });
        break;
      case 'agents':
        if (shouldSkipInitial(event.iteration)) return;
        dispatch({ type: 'UPDATE_AGENTS', payload: event });
        break;
      case 'summary':
        dispatch({ type: 'SET_SUMMARY', payload: event.summary });
        break;
    }
  }, [markCarryOverProgress, shouldSkipInitial]);

  useEffect(() => {
    const unsubscribe = websocketService.subscribe('all', handleWebSocketEvent);
    return () => unsubscribe();
  }, [handleWebSocketEvent]);

  const startSimulation = useCallback(async (config: SimulationConfig, options?: { carryOver?: boolean; throwOnError?: boolean }) => {
    try {
      setError(null);
      carryOverRef.current.active = Boolean(options?.carryOver);
      carryOverRef.current.skipInitial = Boolean(options?.carryOver);
      carryOverRef.current.iterationOffset = options?.carryOver
        ? stateRef.current.metrics.currentIteration
        : 0;
      dispatch({ type: 'SET_STATUS', payload: 'configuring' });
      dispatch({ type: 'SET_SUMMARY', payload: null });

      const apiBase = (import.meta.env.VITE_API_URL || '') as string;
      const wsBase = (import.meta.env.VITE_WS_URL as string | undefined)
        || apiBase
        || 'http://localhost:8000';
      const wsUrl = wsBase
        .replace(/^http/, 'ws')
        .replace(/\/$/, '') + '/ws/simulation';
      if (!websocketService.isConnected()) {
        try {
          await websocketService.connect(wsUrl);
        } catch (wsError) {
          console.error('WebSocket connection failed:', wsError);
        }
      }

      const response = await apiService.startSimulation(config);
      dispatch({ type: 'SET_SIMULATION_ID', payload: response.simulation_id });
      dispatch({ type: 'SET_STATUS', payload: 'running' });

      // Prime state immediately after start
      try {
        const prime = await apiService.getSimulationState(response.simulation_id);
        const primeIteration = prime.metrics?.iteration ?? 0;
        if (prime.metrics && !shouldSkipInitial(primeIteration)) {
          markCarryOverProgress(primeIteration);
          const adjustedIteration = applyIterationOffset(primeIteration) ?? primeIteration;
          const adjustedTotal = applyTotalIterationsOffset(prime.metrics.total_iterations);
          dispatch({
            type: 'UPDATE_METRICS',
            payload: {
              type: 'metrics',
              accepted: prime.metrics.accepted,
              rejected: prime.metrics.rejected,
              neutral: prime.metrics.neutral,
              acceptance_rate: prime.metrics.acceptance_rate,
              polarization: prime.metrics.polarization,
              total_agents: prime.metrics.total_agents || state.metrics.totalAgents,
              iteration: adjustedIteration,
              per_category: prime.metrics.per_category || {},
              total_iterations: adjustedTotal,
            },
          });
        }
        if (prime.agents && prime.agents.length > 0 && !shouldSkipInitial(primeIteration)) {
          dispatch({
            type: 'UPDATE_AGENTS',
            payload: {
              type: 'agents',
              agents: prime.agents,
              iteration: applyIterationOffset(primeIteration) ?? primeIteration,
              total_agents: prime.metrics?.total_agents,
            },
          });
        }
        if (prime.reasoning && prime.reasoning.length > 0) {
          const reasoningMessages: ReasoningMessage[] = prime.reasoning.map((step, index) => ({
            id: `${step.agent_id}-${step.iteration}-${index}`,
            agentId: step.agent_id,
            agentShortId: step.agent_short_id ?? step.agent_id.slice(0, 4),
            archetype: step.archetype,
            message: step.message,
            timestamp: Date.now(),
            iteration: applyIterationOffset(step.iteration) ?? step.iteration,
            phase: step.phase,
            replyToAgentId: step.reply_to_agent_id,
            replyToShortId: step.reply_to_agent_id ? step.reply_to_agent_id.slice(0, 4) : undefined,
            opinion: step.opinion,
            opinionSource: step.opinion_source as ReasoningMessage['opinionSource'],
            stanceConfidence: step.stance_confidence,
            reasoningLength: step.reasoning_length,
          }));
          if (carryOverRef.current.active) {
            dispatch({ type: 'SET_REASONING', payload: [...stateRef.current.reasoningFeed, ...reasoningMessages] });
          } else {
            dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
          }
        }
        if (prime.summary) {
          dispatch({ type: 'SET_SUMMARY', payload: prime.summary });
        }
      } catch (primeErr) {
        console.warn('Initial state prime failed', primeErr);
      }

      // Poll REST endpoint for completion (backend broadcasts events but doesn't send completion status via WS).
      if (pollTask) {
        window.clearInterval(pollTask);
      }
      const intervalId = window.setInterval(async () => {
        try {
          const stateResponse: SimulationStateResponse | null = await apiService
            .getSimulationState(response.simulation_id)
            .catch(() => null);
          if (stateResponse?.error) {
            setError(stateResponse.error);
            dispatch({ type: 'SET_STATUS', payload: 'error' });
            window.clearInterval(intervalId);
            setPollTask(null);
            return;
          }
          if (stateResponse?.metrics) {
            const rawIteration = stateResponse.metrics.iteration ?? 0;
            if (!shouldSkipInitial(rawIteration)) {
              markCarryOverProgress(rawIteration);
              const adjustedIteration = applyIterationOffset(rawIteration) ?? state.metrics.currentIteration;
              const adjustedTotal = applyTotalIterationsOffset(stateResponse.metrics.total_iterations);
              dispatch({
                type: 'UPDATE_METRICS',
                payload: {
                  type: 'metrics',
                  accepted: stateResponse.metrics.accepted,
                  rejected: stateResponse.metrics.rejected,
                  neutral: stateResponse.metrics.neutral,
                  acceptance_rate: stateResponse.metrics.acceptance_rate,
                  polarization: stateResponse.metrics.polarization,
                  total_agents: stateResponse.metrics.total_agents || state.metrics.totalAgents,
                  iteration: adjustedIteration,
                  per_category: stateResponse.metrics.per_category || {},
                  total_iterations: adjustedTotal,
                },
              });
            }
          }
          if (stateResponse?.agents && stateResponse.agents.length > 0) {
            const rawIteration = stateResponse.metrics?.iteration ?? 0;
            if (!shouldSkipInitial(rawIteration)) {
              dispatch({
                type: 'UPDATE_AGENTS',
                payload: {
                  type: 'agents',
                  agents: stateResponse.agents,
                  iteration: applyIterationOffset(rawIteration) ?? state.metrics.currentIteration,
                  total_agents: stateResponse.metrics?.total_agents,
                },
              });
            }
          }
          if (stateResponse?.reasoning && stateResponse.reasoning.length > 0) {
          const reasoningMessages: ReasoningMessage[] = stateResponse.reasoning.map((step, index) => ({
            id: `${step.agent_id}-${step.iteration}-${index}`,
            agentId: step.agent_id,
            agentShortId: step.agent_short_id ?? step.agent_id.slice(0, 4),
            archetype: step.archetype,
            message: step.message,
            timestamp: Date.now(),
            iteration: applyIterationOffset(step.iteration) ?? step.iteration,
            phase: step.phase,
            replyToAgentId: step.reply_to_agent_id,
            replyToShortId: step.reply_to_agent_id ? step.reply_to_agent_id.slice(0, 4) : undefined,
            opinion: step.opinion,
            opinionSource: step.opinion_source as ReasoningMessage['opinionSource'],
            stanceConfidence: step.stance_confidence,
            reasoningLength: step.reasoning_length,
          }));
            if (carryOverRef.current.active) {
              dispatch({ type: 'SET_REASONING', payload: [...stateRef.current.reasoningFeed, ...reasoningMessages] });
            } else {
              dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
            }
          }
          if (stateResponse?.summary) {
            dispatch({ type: 'SET_SUMMARY', payload: stateResponse.summary });
          }

          const res = await apiService.getSimulationResult(response.simulation_id);
          if (res.status === 'completed' && res.metrics) {
            // Merge final metrics.
            dispatch({
              type: 'UPDATE_METRICS',
              payload: {
                type: 'metrics',
                accepted: res.metrics.accepted,
                rejected: res.metrics.rejected,
                neutral: res.metrics.neutral,
                acceptance_rate: res.metrics.acceptance_rate,
                polarization: res.metrics.polarization,
                total_agents: res.metrics.total_agents || state.metrics.totalAgents,
                iteration: state.metrics.currentIteration,
                per_category: res.metrics.per_category || {},
                total_iterations: res.metrics.total_iterations,
              },
            });
            if (stateResponse?.summary || stateResponse?.summary_ready) {
              dispatch({ type: 'SET_STATUS', payload: 'completed' });
              window.clearInterval(intervalId);
              setPollTask(null);
            }
          }
        } catch {
          // Ignore polling errors.
        }
      }, 1000);
      // faster polling for short simulations
      window.clearInterval(intervalId);
      const fastId = window.setInterval(async () => {
        try {
          const stateResponse: SimulationStateResponse | null = await apiService
            .getSimulationState(response.simulation_id)
            .catch(() => null);
          if (!stateResponse) return;
          if (stateResponse.error) {
            setError(stateResponse.error);
            dispatch({ type: 'SET_STATUS', payload: 'error' });
            window.clearInterval(fastId);
            setPollTask(null);
            return;
          }
          if (stateResponse.metrics) {
            const rawIteration = stateResponse.metrics.iteration ?? 0;
            if (!shouldSkipInitial(rawIteration)) {
              markCarryOverProgress(rawIteration);
              const adjustedIteration = applyIterationOffset(rawIteration) ?? state.metrics.currentIteration;
              const adjustedTotal = applyTotalIterationsOffset(stateResponse.metrics.total_iterations);
              dispatch({
                type: 'UPDATE_METRICS',
                payload: {
                  type: 'metrics',
                  accepted: stateResponse.metrics.accepted,
                  rejected: stateResponse.metrics.rejected,
                  neutral: stateResponse.metrics.neutral,
                  acceptance_rate: stateResponse.metrics.acceptance_rate,
                  polarization: stateResponse.metrics.polarization,
                  total_agents: stateResponse.metrics.total_agents || state.metrics.totalAgents,
                  iteration: adjustedIteration,
                  per_category: stateResponse.metrics.per_category || {},
                  total_iterations: adjustedTotal,
                },
              });
            }
          }
          if (stateResponse.agents && stateResponse.agents.length > 0) {
            const rawIteration = stateResponse.metrics?.iteration ?? 0;
            if (!shouldSkipInitial(rawIteration)) {
              dispatch({
                type: 'UPDATE_AGENTS',
                payload: {
                  type: 'agents',
                  agents: stateResponse.agents,
                  iteration: applyIterationOffset(rawIteration) ?? state.metrics.currentIteration,
                  total_agents: stateResponse.metrics?.total_agents,
                },
              });
            }
          }
          if (stateResponse.reasoning && stateResponse.reasoning.length > 0) {
            const reasoningMessages: ReasoningMessage[] = stateResponse.reasoning.map((step, index) => ({
              id: `${step.agent_id}-${step.iteration}-${index}`,
              agentId: step.agent_id,
              agentShortId: step.agent_short_id ?? step.agent_id.slice(0, 4),
              archetype: step.archetype,
              message: step.message,
              timestamp: Date.now(),
              iteration: applyIterationOffset(step.iteration) ?? step.iteration,
              phase: step.phase,
              replyToAgentId: step.reply_to_agent_id,
              replyToShortId: step.reply_to_agent_id ? step.reply_to_agent_id.slice(0, 4) : undefined,
              opinion: step.opinion,
              opinionSource: step.opinion_source as ReasoningMessage['opinionSource'],
              stanceConfidence: step.stance_confidence,
              reasoningLength: step.reasoning_length,
            }));
            if (carryOverRef.current.active) {
              dispatch({ type: 'SET_REASONING', payload: [...stateRef.current.reasoningFeed, ...reasoningMessages] });
            } else {
              dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
            }
          }
          if (stateResponse.summary) {
            dispatch({ type: 'SET_SUMMARY', payload: stateResponse.summary });
          }

          if (stateResponse.status === 'completed') {
            if (stateResponse.summary || stateResponse.summary_ready) {
              dispatch({ type: 'SET_STATUS', payload: 'completed' });
              window.clearInterval(fastId);
              setPollTask(null);
            }
          }
        } catch (e) {
          // ignore polling errors
        }
      }, 500);
      setPollTask(fastId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start simulation';
      setError(message);
      dispatch({ type: 'SET_STATUS', payload: 'error' });
      if (options?.throwOnError) {
        throw err;
      }
    }
  }, [markCarryOverProgress, pollTask, shouldSkipInitial, state.metrics.currentIteration, state.metrics.totalAgents]);

  const stopSimulation = useCallback(() => {
    websocketService.disconnect();
    if (pollTask) {
      window.clearInterval(pollTask);
      setPollTask(null);
    }
    dispatch({ type: 'RESET' });
  }, [pollTask]);

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
    stopSimulation,
    activePulses: state.activePulses,
  };
}
