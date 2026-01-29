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
  research_summary?: string;
  research_sources?: SearchResult[];
  research_structured?: SearchStructured;
  language?: 'ar' | 'en';
  speed?: number;
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
    polarization?: number;
    total_iterations?: number;
    per_category?: Record<string, number>;
  };
}

export interface SimulationStateResponse {
  simulation_id: string;
  status: 'running' | 'completed';
  summary_ready?: boolean;
  summary_at?: string;
  metrics?: {
    total_agents?: number;
    accepted: number;
    rejected: number;
    neutral: number;
    acceptance_rate: number;
    polarization?: number;
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
    opinion?: 'accept' | 'reject' | 'neutral';
  }[];
  summary?: string;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  score?: number | null;
  reason?: string;
}

export interface SearchResponse {
  provider: string;
  is_live: boolean;
  answer: string;
  results: SearchResult[];
  structured?: SearchStructured;
}

export interface SearchStructured {
  summary?: string;
  signals?: string[];
  competition_level?: 'low' | 'medium' | 'high';
  demand_level?: 'low' | 'medium' | 'high';
  regulatory_risk?: 'low' | 'medium' | 'high';
  price_sensitivity?: 'low' | 'medium' | 'high';
  notable_locations?: string[];
  gaps?: string[];
  sources?: { title?: string; url?: string; domain?: string }[];
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
      const err = new Error(error.detail || error.message || 'Request failed');
      (err as Error & { status?: number }).status = response.status;
      throw err;
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
    try {
      return await this.request<SimulationStateResponse>(`/simulation/state?simulation_id=${encodeURIComponent(simulationId)}`);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) {
        return {
          simulation_id: simulationId,
          status: 'completed',
          error: 'Simulation not found',
        };
      }
      throw err;
    }
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

  async detectStartIntent(message: string, context?: string): Promise<{ start: boolean; reason?: string | null }> {
    return this.request('/llm/intent', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    });
  }

  async detectMessageMode(message: string, context?: string, language?: 'ar' | 'en'): Promise<{ mode: 'update' | 'discuss'; reason?: string | null }> {
    return this.request('/llm/message_mode', {
      method: 'POST',
      body: JSON.stringify({ message, context, language }),
    });
  }

  async searchWeb(query: string, language = 'en', maxResults = 5): Promise<SearchResponse> {
    return this.request('/search/web', {
      method: 'POST',
      body: JSON.stringify({ query, language, max_results: maxResults }),
    });
  }
}

export const apiService = new ApiService();
