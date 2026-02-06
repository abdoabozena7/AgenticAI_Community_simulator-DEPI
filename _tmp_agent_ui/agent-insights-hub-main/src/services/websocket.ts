export type MessageType = 'reasoning_step' | 'metrics' | 'agent_update' | 'simulation_status';

export interface ReasoningStepEvent {
  type: 'reasoning_step';
  agent_id: string;
  iteration: number;
  message: string;
  timestamp: number;
}

export interface MetricsEvent {
  type: 'metrics';
  accepted: number;
  rejected: number;
  neutral: number;
  acceptance_rate: number;
  total_agents: number;
  iteration: number;
  category_breakdown: Record<string, { accepted: number; rejected: number; neutral: number }>;
}

export interface AgentUpdateEvent {
  type: 'agent_update';
  agent_id: string;
  status: 'accepted' | 'rejected' | 'neutral';
  position: { x: number; y: number; z: number };
}

export interface SimulationStatusEvent {
  type: 'simulation_status';
  status: 'running' | 'paused' | 'completed' | 'error';
  current_iteration: number;
  total_iterations: number;
}

export type WebSocketEvent = ReasoningStepEvent | MetricsEvent | AgentUpdateEvent | SimulationStatusEvent;

type EventCallback = (event: WebSocketEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private listeners: Map<MessageType | 'all', EventCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  connect(url: string): Promise<void> {
    this.url = url;
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

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
