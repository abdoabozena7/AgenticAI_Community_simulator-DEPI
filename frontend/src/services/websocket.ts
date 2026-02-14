export type MessageType =
  | 'reasoning_step'
  | 'reasoning_debug'
  | 'metrics'
  | 'agents'
  | 'summary'
  | 'phase_update'
  | 'research_update'
  | 'clarification_request'
  | 'clarification_resolved'
  | 'chat_event';

export interface ReasoningStepEvent {
  type: 'reasoning_step';
  simulation_id?: string;
  step_uid?: string;
  event_seq?: number;
  agent_id: string;
  agent_short_id?: string;
  agent_label?: string;
  archetype?: string;
  iteration: number;
  phase?: string;
  reply_to_agent_id?: string;
  reply_to_short_id?: string;
  message: string;
  opinion?: 'accept' | 'reject' | 'neutral';
  stance_before?: 'accept' | 'reject' | 'neutral';
  stance_after?: 'accept' | 'reject' | 'neutral';
  opinion_source?: 'llm' | 'llm_classified' | 'fallback';
  stance_confidence?: number;
  reasoning_length?: 'short' | 'full';
  fallback_reason?: string | null;
  relevance_score?: number | null;
  policy_guard?: boolean;
  policy_reason?: string | null;
  stance_locked?: boolean;
  // Backend does not include timestamp; client adds one for ordering.
  timestamp?: number;
}

export interface ReasoningDebugEvent {
  type: 'reasoning_debug';
  simulation_id?: string;
  agent_id: string;
  agent_short_id?: string;
  phase?: string;
  attempt?: number;
  stage?: string;
  reason: string;
  timestamp?: number;
}

export interface MetricsEvent {
  type: 'metrics';
  simulation_id?: string;
  event_seq?: number;
  accepted: number;
  rejected: number;
  neutral: number;
  acceptance_rate: number;
  polarization?: number;
  total_agents: number;
  iteration: number;
  total_iterations?: number;
  // Backend includes per-category acceptance counts only.
  per_category?: Record<string, number>;
}

export interface AgentSnapshot {
  agent_id: string;
  category_id: string;
  opinion: 'accept' | 'reject' | 'neutral';
  confidence?: number;
}

export interface AgentsEvent {
  type: 'agents';
  simulation_id?: string;
  event_seq?: number;
  agents: AgentSnapshot[];
  iteration: number;
  total_agents?: number;
}

export interface SummaryEvent {
  type: 'summary';
  simulation_id?: string;
  summary: string;
}

export interface PhaseUpdateEvent {
  type: 'phase_update';
  simulation_id?: string;
  event_seq?: number;
  phase_key?: string;
  phase_label?: string;
  progress_pct?: number;
  status?: string;
  reason?: string;
}

export interface ResearchUpdateEvent {
  type: 'research_update';
  simulation_id?: string;
  event_seq?: number;
  action?: 'research_started' | 'query_planned' | 'search_results_ready' | 'review_required' | 'fetch_started' | 'fetch_done' | 'summary_ready' | 'evidence_cards_ready' | 'gaps_ready' | 'research_done' | 'research_failed' | 'query_started' | 'query_result' | 'url_opened' | 'url_extracted' | 'url_failed' | 'search_completed' | 'search_failed' | string;
  status?: string;
  cycle_id?: string | null;
  url?: string | null;
  domain?: string | null;
  favicon_url?: string | null;
  title?: string | null;
  http_status?: number | null;
  content_chars?: number | null;
  relevance_score?: number | null;
  snippet?: string | null;
  error?: string | null;
  progress_pct?: number;
  meta_json?: Record<string, unknown> | null;
}

export interface ClarificationRequestEvent {
  type: 'clarification_request';
  simulation_id?: string;
  event_seq?: number;
  question_id: string;
  question: string;
  options: { id?: string; label?: string; text?: string; value?: string }[];
  reason_tag?: string | null;
  reason_summary?: string | null;
  created_at?: number;
  required?: boolean;
}

export interface ClarificationResolvedEvent {
  type: 'clarification_resolved';
  simulation_id?: string;
  event_seq?: number;
  question_id: string;
  answer_source?: 'custom' | 'option';
}

export interface ChatEventEvent {
  type: 'chat_event';
  simulation_id?: string;
  event_seq?: number;
  message_id?: string;
  role?: 'user' | 'system' | 'research' | 'status';
  content?: string;
  meta?: Record<string, unknown>;
  timestamp?: number;
}

export type WebSocketEvent =
  | ReasoningStepEvent
  | ReasoningDebugEvent
  | MetricsEvent
  | AgentsEvent
  | SummaryEvent
  | PhaseUpdateEvent
  | ResearchUpdateEvent
  | ClarificationRequestEvent
  | ClarificationResolvedEvent
  | ChatEventEvent;

type EventCallback = (event: WebSocketEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private listeners: Map<MessageType | 'all', EventCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private currentSimulationId: string | null = null;

  connect(url: string): Promise<void> {
    this.url = url;
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          if (this.currentSimulationId) {
            this.send({ type: 'subscribe', simulation_id: this.currentSimulationId, replace: true });
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: WebSocketEvent = JSON.parse(event.data);
            this.notifyListeners(data);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket closed');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        this.connect(this.url).catch(console.error);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  subscribe(type: MessageType | 'all', callback: EventCallback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(callback);

    return () => {
      const callbacks = this.listeners.get(type);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  setSimulationSubscription(simulationId: string | null) {
    this.currentSimulationId = simulationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && simulationId) {
      this.send({ type: 'subscribe', simulation_id: simulationId, replace: true });
    }
  }

  private notifyListeners(event: WebSocketEvent) {
    // Notify specific type listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach(callback => callback(event));
    }

    // Notify 'all' listeners
    const allListeners = this.listeners.get('all');
    if (allListeners) {
      allListeners.forEach(callback => callback(event));
    }
  }

  send(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const websocketService = new WebSocketService();
