import { useState, useCallback, useEffect, useReducer } from 'react';
import { websocketService, WebSocketEvent, MetricsEvent, ReasoningStepEvent } from '@/services/websocket';
import { apiService, SimulationConfig } from '@/services/api';
import { Agent, ReasoningMessage, SimulationMetrics, SimulationStatus } from '@/types/simulation';

interface SimulationState {
  status: SimulationStatus;
  simulationId: string | null;
  agents: Map<string, Agent>;
  metrics: SimulationMetrics;
  reasoningFeed: ReasoningMessage[];
}

type SimulationAction =
  | { type: 'SET_STATUS'; payload: SimulationStatus }
  | { type: 'SET_SIMULATION_ID'; payload: string }
  | { type: 'UPDATE_METRICS'; payload: MetricsEvent }
  | { type: 'ADD_REASONING'; payload: ReasoningStepEvent }
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
          totalIterations: state.metrics.totalIterations,
          perCategoryAccepted: event.per_category || {},
        },
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
      };
      return {
        ...state,
        reasoningFeed: [...state.reasoningFeed.slice(-99), newMessage],
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

      const response = await apiService.startSimulation(config);
      dispatch({ type: 'SET_SIMULATION_ID', payload: response.simulation_id });

      // Connect to the shared WebSocket stream.
      const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8000') as string;
      const wsBase = (import.meta.env.VITE_WS_URL as string | undefined) || apiBase;
      const wsUrl = wsBase
        .replace(/^http/, 'ws')
        .replace(/\/$/, '') + '/ws/simulation';

      await websocketService.connect(wsUrl);
      dispatch({ type: 'SET_STATUS', payload: 'running' });

      // Poll REST endpoint for completion (backend broadcasts events but doesn't send completion status via WS).
      if (pollTask) {
        window.clearInterval(pollTask);
      }
      const intervalId = window.setInterval(async () => {
        try {
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
      setPollTask(intervalId);
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
