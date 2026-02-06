const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface SimulationConfig {
  idea: string;
  category: string;
  targetAudience: string[];
  country: string;
  city: string;
  riskAppetite: number;
  ideaMaturity: 'concept' | 'prototype' | 'mvp' | 'launched';
  goals: string[];
  agentCount?: number;
  iterations?: number;
}

export interface SimulationResponse {
  simulation_id: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  websocket_url: string;
}

export interface ValidationResponse {
  valid: boolean;
  errors: string[];
  suggestions?: string[];
  detected_entities?: {
    country?: string;
    city?: string;
  };
}

class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  }

  async startSimulation(config: SimulationConfig): Promise<SimulationResponse> {
    return this.request<SimulationResponse>('/api/simulation/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async pauseSimulation(simulationId: string): Promise<void> {
    return this.request(`/api/simulation/${simulationId}/pause`, {
      method: 'POST',
    });
  }

  async resumeSimulation(simulationId: string): Promise<void> {
    return this.request(`/api/simulation/${simulationId}/resume`, {
      method: 'POST',
    });
  }

  async stopSimulation(simulationId: string): Promise<void> {
    return this.request(`/api/simulation/${simulationId}/stop`, {
      method: 'POST',
    });
  }

  async validateInput(text: string): Promise<ValidationResponse> {
    return this.request<ValidationResponse>('/api/validate', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async getCategories(): Promise<string[]> {
    return this.request<string[]>('/api/categories');
  }

  async getTargetAudiences(): Promise<string[]> {
    return this.request<string[]>('/api/audiences');
  }

  async getGoals(): Promise<string[]> {
    return this.request<string[]>('/api/goals');
  }
}

export const apiService = new ApiService();
