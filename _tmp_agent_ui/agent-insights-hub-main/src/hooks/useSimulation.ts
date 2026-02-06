import { useState, useCallback, useEffect, useReducer } from 'react';
import { websocketService, WebSocketEvent, MetricsEvent, ReasoningStepEvent, AgentUpdateEvent, SimulationStatusEvent } from '@/services/websocket';
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
  | { type: 'UPDATE_AGENT'; payload: AgentUpdateEvent }
  | { type: 'UPDATE_SIMULATION_STATUS'; payload: SimulationStatusEvent }
  | { type: 'RESET' };

const initialMetrics: SimulationMetrics = {
  totalAgents: 0,
  accepted: 0,
  rejected: 0,
  neutral: 0,
  acceptanceRate: 0,
  currentIteration: 0,
  totalIterations: 0,
  categoryBreakdown: {},
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
          acceptanceRate: event.acceptance_rate,
          currentIteration: event.iteration,
          totalIterations: state.metrics.totalIterations,
          categoryBreakdown: event.category_breakdown,
        },
      };
    }
    
    case 'ADD_REASONING': {
      const event = action.payload;
      const newMessage: ReasoningMessage = {
        id: `${event.agent_id}-${event.timestamp}`,
        agentId: event.agent_id,
        message: event.message,
        timestamp: event.timestamp,
        iteration: event.iteration,
      };
      return {
        ...state,
        reasoningFeed: [...state.reasoningFeed.slice(-99), newMessage],
      };
    }
    
    case 'UPDATE_AGENT': {
      const event = action.payload;
      const newAgents = new Map(state.agents);
      newAgents.set(event.agent_id, {
        id: event.agent_id,
        status: event.status,
        position: event.position,
        category: '',
        lastUpdate: Date.now(),
      });
      return { ...state, agents: newAgents };
    }
    
    case 'UPDATE_SIMULATION_STATUS': {
      const event = action.payload;
      const statusMap: Record<string, SimulationStatus> = {
        idle: 'idle',
        running: 'running',
        paused: 'paused',
        completed: 'completed',
        error: 'error',
      };
      return {
        ...state,
        status: statusMap[event.status] || state.status,
        metrics: {
          ...state.metrics,
          currentIteration: event.current_iteration,
          totalIterations: event.total_iterations,
        },
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

  const handleWebSocketEvent = useCallback((event: WebSocketEvent) => {
    switch (event.type) {
      case 'metrics':
        dispatch({ type: 'UPDATE_METRICS', payload: event });
        break;
      case 'reasoning_step':
        dispatch({ type: 'ADD_REASONING', payload: event });
        break;
      case 'agent_update':
        dispatch({ type: 'UPDATE_AGENT', payload: event });
        break;
      case 'simulation_status':
        dispatch({ type: 'UPDATE_SIMULATION_STATUS', payload: event });
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

      await websocketService.connect(response.websocket_url);
      dispatch({ type: 'SET_STATUS', payload: 'running' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start simulation';
      setError(message);
      dispatch({ type: 'SET_STATUS', payload: 'error' });
    }
  }, []);

  const pauseSimulation = useCallback(async () => {
    if (!state.simulationId) return;
    try {
      await apiService.pauseSimulation(state.simulationId);
      dispatch({ type: 'SET_STATUS', payload: 'paused' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pause simulation';
      setError(message);
    }
  }, [state.simulationId]);

  const resumeSimulation = useCallback(async () => {
    if (!state.simulationId) return;
    try {
      await apiService.resumeSimulation(state.simulationId);
      dispatch({ type: 'SET_STATUS', payload: 'running' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume simulation';
      setError(message);
    }
  }, [state.simulationId]);

  const stopSimulation = useCallback(async () => {
    if (!state.simulationId) return;
    try {
      await apiService.stopSimulation(state.simulationId);
      websocketService.disconnect();
      dispatch({ type: 'RESET' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop simulation';
      setError(message);
    }
  }, [state.simulationId]);

  return {
    ...state,
    error,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
  };
}
