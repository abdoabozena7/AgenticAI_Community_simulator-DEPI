import { useState, useCallback, useEffect, useReducer } from 'react';
import { websocketService, WebSocketEvent, MetricsEvent, ReasoningStepEvent, AgentsEvent } from '@/services/websocket';
import { apiService, SimulationConfig, SimulationStateResponse } from '@/services/api';
import { Agent, ReasoningMessage, SimulationMetrics, SimulationStatus } from '@/types/simulation';

interface SimulationState {
  status: SimulationStatus;
  simulationId: string | null;
  agents: Map<string, Agent>;
  metrics: SimulationMetrics;
  reasoningFeed: ReasoningMessage[];
  summary: string | null;
}

type SimulationAction =
  | { type: 'SET_STATUS'; payload: SimulationStatus }
  | { type: 'SET_SIMULATION_ID'; payload: string }
  | { type: 'UPDATE_METRICS'; payload: MetricsEvent }
  | { type: 'UPDATE_AGENTS'; payload: AgentsEvent }
  | { type: 'SET_REASONING'; payload: ReasoningMessage[] }
  | { type: 'ADD_REASONING'; payload: ReasoningStepEvent }
  | { type: 'SET_SUMMARY'; payload: string | null }
  | { type: 'RESET' };

const initialMetrics: SimulationMetrics = {
  totalAgents: 0,
  accepted: 0,
  rejected: 0,
  neutral: 0,
  acceptanceRate: 0,
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
  summary: null,
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const createPosition = (seed: string) => {
  const base = hashString(seed) || 1;
  const rand = (n: number) => {
    const x = Math.sin(base * n) * 10000;
    return x - Math.floor(x);
  };
  return { x: rand(1), y: rand(2), z: rand(3) };
};

const mapOpinionToStatus = (opinion: string): Agent['status'] => {
  if (opinion === 'accept') return 'accepted';
  if (opinion === 'reject') return 'rejected';
  return 'neutral';
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
          currentIteration: event.iteration,
          totalIterations: event.total_iterations ?? state.metrics.totalIterations,
          perCategoryAccepted: event.per_category || {},
        },
      };
    }

    case 'UPDATE_AGENTS': {
      const nextAgents = new Map(state.agents);
      const ts = Date.now();
      action.payload.agents.forEach((agent) => {
        const existing = nextAgents.get(agent.agent_id);
        nextAgents.set(agent.agent_id, {
          id: agent.agent_id,
          status: mapOpinionToStatus(agent.opinion),
          position: existing?.position ?? createPosition(agent.agent_id),
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
        message: event.message,
        timestamp: ts,
        iteration: event.iteration,
        opinion: event.opinion,
      };
      const nextAgents = new Map(state.agents);
      const existing = nextAgents.get(event.agent_id);
      if (existing) {
        nextAgents.set(event.agent_id, {
          ...existing,
          status: 'thinking',
          lastUpdate: ts,
        });
      }
      return {
        ...state,
        agents: nextAgents,
        reasoningFeed: [...state.reasoningFeed.slice(-99), newMessage],
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

  const handleWebSocketEvent = useCallback((event: WebSocketEvent) => {
    switch (event.type) {
      case 'metrics':
        dispatch({ type: 'UPDATE_METRICS', payload: event });
        break;
      case 'reasoning_step':
        dispatch({ type: 'ADD_REASONING', payload: event });
        break;
      case 'agents':
        dispatch({ type: 'UPDATE_AGENTS', payload: event });
        break;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = websocketService.subscribe('all', handleWebSocketEvent);
    return () => unsubscribe();
  }, [handleWebSocketEvent]);

  const startSimulation = useCallback(async (config: SimulationConfig) => {
    try {
      setError(null);
      dispatch({ type: 'SET_STATUS', payload: 'configuring' });

      const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8000') as string;
      const wsBase = (import.meta.env.VITE_WS_URL as string | undefined) || apiBase;
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
        if (prime.metrics) {
          dispatch({
            type: 'UPDATE_METRICS',
            payload: {
              type: 'metrics',
              accepted: prime.metrics.accepted,
              rejected: prime.metrics.rejected,
              neutral: prime.metrics.neutral,
              acceptance_rate: prime.metrics.acceptance_rate,
              total_agents: prime.metrics.total_agents || state.metrics.totalAgents,
              iteration: prime.metrics.iteration ?? 0,
              per_category: prime.metrics.per_category || {},
              total_iterations: prime.metrics.total_iterations,
            },
          });
        }
        if (prime.agents && prime.agents.length > 0) {
          dispatch({
            type: 'UPDATE_AGENTS',
            payload: {
              type: 'agents',
              agents: prime.agents,
              iteration: prime.metrics?.iteration ?? 0,
              total_agents: prime.metrics?.total_agents,
            },
          });
        }
        if (prime.reasoning && prime.reasoning.length > 0) {
          const reasoningMessages: ReasoningMessage[] = prime.reasoning.map((step, index) => ({
            id: `${step.agent_id}-${step.iteration}-${index}`,
            agentId: step.agent_id,
            message: step.message,
            timestamp: Date.now(),
            iteration: step.iteration,
            opinion: step.opinion,
          }));
          dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
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
            dispatch({
              type: 'UPDATE_METRICS',
              payload: {
                type: 'metrics',
                accepted: stateResponse.metrics.accepted,
                rejected: stateResponse.metrics.rejected,
                neutral: stateResponse.metrics.neutral,
                acceptance_rate: stateResponse.metrics.acceptance_rate,
                total_agents: stateResponse.metrics.total_agents || state.metrics.totalAgents,
                iteration: stateResponse.metrics.iteration ?? state.metrics.currentIteration,
                per_category: stateResponse.metrics.per_category || {},
                total_iterations: stateResponse.metrics.total_iterations,
              },
            });
          }
          if (stateResponse?.agents && stateResponse.agents.length > 0) {
            dispatch({
              type: 'UPDATE_AGENTS',
              payload: {
                type: 'agents',
                agents: stateResponse.agents,
                iteration: stateResponse.metrics?.iteration ?? state.metrics.currentIteration,
                total_agents: stateResponse.metrics?.total_agents,
              },
            });
          }
          if (stateResponse?.reasoning && stateResponse.reasoning.length > 0) {
          const reasoningMessages: ReasoningMessage[] = stateResponse.reasoning.map((step, index) => ({
            id: `${step.agent_id}-${step.iteration}-${index}`,
            agentId: step.agent_id,
            message: step.message,
            timestamp: Date.now(),
            iteration: step.iteration,
            opinion: step.opinion,
          }));
            dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
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
                total_agents: res.metrics.total_agents || state.metrics.totalAgents,
                iteration: state.metrics.currentIteration,
                per_category: res.metrics.per_category || {},
                total_iterations: res.metrics.total_iterations,
              },
            });
            dispatch({ type: 'SET_STATUS', payload: 'completed' });
            window.clearInterval(intervalId);
            setPollTask(null);
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
            dispatch({
              type: 'UPDATE_METRICS',
              payload: {
                type: 'metrics',
                accepted: stateResponse.metrics.accepted,
                rejected: stateResponse.metrics.rejected,
                neutral: stateResponse.metrics.neutral,
                acceptance_rate: stateResponse.metrics.acceptance_rate,
                total_agents: stateResponse.metrics.total_agents || state.metrics.totalAgents,
                iteration: stateResponse.metrics.iteration ?? state.metrics.currentIteration,
                per_category: stateResponse.metrics.per_category || {},
                total_iterations: stateResponse.metrics.total_iterations,
              },
            });
          }
          if (stateResponse.agents && stateResponse.agents.length > 0) {
            dispatch({
              type: 'UPDATE_AGENTS',
              payload: {
                type: 'agents',
                agents: stateResponse.agents,
                iteration: stateResponse.metrics?.iteration ?? state.metrics.currentIteration,
                total_agents: stateResponse.metrics?.total_agents,
              },
            });
          }
          if (stateResponse.reasoning && stateResponse.reasoning.length > 0) {
            const reasoningMessages: ReasoningMessage[] = stateResponse.reasoning.map((step, index) => ({
              id: `${step.agent_id}-${step.iteration}-${index}`,
              agentId: step.agent_id,
              message: step.message,
              timestamp: Date.now(),
              iteration: step.iteration,
            }));
            dispatch({ type: 'SET_REASONING', payload: reasoningMessages });
          }
          if (stateResponse.summary) {
            dispatch({ type: 'SET_SUMMARY', payload: stateResponse.summary });
          }

          if (stateResponse.status === 'completed') {
            dispatch({ type: 'SET_STATUS', payload: 'completed' });
            window.clearInterval(fastId);
            setPollTask(null);
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
    }
  }, [pollTask, state.metrics.currentIteration, state.metrics.totalAgents]);

  const stopSimulation = useCallback(() => {
    websocketService.disconnect();
    if (pollTask) {
      window.clearInterval(pollTask);
      setPollTask(null);
    }
    dispatch({ type: 'RESET' });
  }, [pollTask]);

  return {
    ...state,
    error,
    startSimulation,
    stopSimulation,
  };
}
