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
    total_iterations?: number;
    per_category?: Record<string, number>;
  };
}

export interface SimulationStateResponse {
  simulation_id: string;
  status: 'running' | 'completed';
  metrics?: {
    total_agents?: number;
    accepted: number;
    rejected: number;
    neutral: number;
    acceptance_rate: number;
    total_iterations?: number;
    per_category?: Record<string, number>;
    iteration?: number;
  };
  agents?: {
    agent_id: string;
    category_id: string;
    opinion: 'accept' | 'reject' | 'neutral';
    confidence?: number;
  }[];
  reasoning?: {
    agent_id: string;
    iteration: number;
    message: string;
  }[];
  error?: string;
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

  async getSimulationState(simulationId: string): Promise<SimulationStateResponse> {
    // Backend contract: GET /simulation/state?simulation_id=...
    return this.request<SimulationStateResponse>(`/simulation/state?simulation_id=${encodeURIComponent(simulationId)}`);
  }

  async generateMessage(prompt: string, system?: string): Promise<string> {
    const response = await this.request<{ text: string }>('/llm/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, system }),
    });
    return response.text;
  }

  async extractSchema(message: string, schema: Record<string, unknown>): Promise<{
    idea?: string;
    country?: string;
    city?: string;
    category?: string;
    target_audience?: string[];
    goals?: string[];
    risk_appetite?: number;
    idea_maturity?: string;
    missing: string[];
    question?: string;
  }> {
    return this.request('/llm/extract', {
      method: 'POST',
      body: JSON.stringify({ message, schema }),
    });
  }
}

export const apiService = new ApiService();
