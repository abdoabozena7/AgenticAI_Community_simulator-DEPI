export type MessageType = 'reasoning_step' | 'metrics' | 'agents' | 'summary';

export interface ReasoningStepEvent {
  type: 'reasoning_step';
  simulation_id?: string;
  agent_id: string;
  agent_short_id?: string;
  archetype?: string;
  iteration: number;
  phase?: string;
  reply_to_agent_id?: string;
  message: string;
  opinion?: 'accept' | 'reject' | 'neutral';
  // Backend does not include timestamp; client adds one for ordering.
  timestamp?: number;
}

export interface MetricsEvent {
  type: 'metrics';
  simulation_id?: string;
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
  agents: AgentSnapshot[];
  iteration: number;
  total_agents?: number;
}

export interface SummaryEvent {
  type: 'summary';
  simulation_id?: string;
  summary: string;
}

export type WebSocketEvent = ReasoningStepEvent | MetricsEvent | AgentsEvent | SummaryEvent;

type EventCallback = (event: WebSocketEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private listeners: Map<MessageType | 'all', EventCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  connect(url: string): Promise<void> {
    // Append JWT token as a query parameter if present
    const token = localStorage.getItem('agentic_sim_jwt');
    this.url = url;
    let wsUrl = url;
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      wsUrl = `${url}${sep}token=${encodeURIComponent(token)}`;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
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
