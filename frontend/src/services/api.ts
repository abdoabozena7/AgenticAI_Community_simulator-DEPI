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
  status: 'running' | 'completed' | 'error';
}

export interface SimulationResultResponse {
  simulation_id: string;
  status: 'running' | 'completed';
  metrics?: {
    total_agents?: number;
    accepted: number;
    rejected: number;
    neutral: number;
    acceptance_rate: number;
    per_category?: Record<string, number>;
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
    // Backend contract: POST /simulation/start
    return this.request<SimulationResponse>('/simulation/start', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getSimulationResult(simulationId: string): Promise<SimulationResultResponse> {
    // Backend contract: GET /simulation/result?simulation_id=...
    return this.request<SimulationResultResponse>(`/simulation/result?simulation_id=${encodeURIComponent(simulationId)}`);
  }
}

export const apiService = new ApiService();
