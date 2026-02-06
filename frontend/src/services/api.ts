const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const ACCESS_TOKEN_KEY = 'agentic_access_token';
const REFRESH_TOKEN_KEY = 'agentic_refresh_token';

const getStoredAccessToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

const getStoredRefreshToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
};

const setStoredTokens = (accessToken?: string | null, refreshToken?: string | null) => {
  if (typeof window === 'undefined') return;
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
};

export const getAuthToken = () => getStoredAccessToken();

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
  evidence_cards?: string[];
  language?: 'ar' | 'en';
  speed?: number;
  reasoning_scope?: 'hybrid' | 'full' | 'speakers_only';
  reasoning_detail?: 'short' | 'full';
  llm_batch_size?: number;
  llm_concurrency?: number;
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
    agent_short_id?: string;
    archetype?: string;
    iteration: number;
    phase?: string;
    reply_to_agent_id?: string;
    message: string;
    opinion?: 'accept' | 'reject' | 'neutral';
    opinion_source?: 'llm' | 'default' | 'fallback';
    stance_confidence?: number;
    reasoning_length?: 'short' | 'full';
  }[];
  summary?: string;
  error?: string;
}

export interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  message?: string;
}

export interface OAuthLoginPayload {
  id_token?: string;
  email?: string;
  name?: string;
}

export interface UserMe {
  id: number;
  username: string;
  role: string;
  credits: number;
  daily_usage?: number;
  daily_limit?: number;
  email?: string;
  email_verified?: boolean | number;
}

export interface RedeemResponse {
  message: string;
  bonus_attempts: number;
}

export interface PromoCreateResponse {
  id: number;
  code: string;
}

export interface PromoteResponse {
  message: string;
  role: string;
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
  evidence_cards?: string[];
}

export interface SimulationListItem {
  simulation_id: string;
  status: 'running' | 'completed' | 'error';
  idea: string;
  category?: string;
  created_at?: string;
  ended_at?: string;
  summary?: string;
  acceptance_rate?: number;
  total_agents?: number;
}

export interface SimulationListResponse {
  items: SimulationListItem[];
  total: number;
}

export interface SimulationAnalyticsResponse {
  totals: {
    total_simulations: number;
    completed: number;
    avg_acceptance_rate: number;
    total_agents: number;
  };
  weekly: { date: string; simulations: number; success: number; agents: number }[];
  categories: { name: string; value: number }[];
}

export interface NotificationLogItem {
  id: number;
  action: string;
  meta?: Record<string, any>;
  created_at?: string;
}

export interface NotificationsResponse {
  items: NotificationLogItem[];
}

class ApiService {
  private refreshingPromise: Promise<boolean> | null = null;
  private static readonly DEFAULT_TIMEOUT_MS = 30000;
  private static readonly LONG_TIMEOUT_MS = 120000;

  private async refreshTokens(): Promise<boolean> {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return false;
    if (this.refreshingPromise) return this.refreshingPromise;
    this.refreshingPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!response.ok) {
          setStoredTokens(null, null);
          return false;
        }
        const data = await response.json();
        setStoredTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshingPromise = null;
      }
    })();
    return this.refreshingPromise;
  }

  private async request<T>(
    endpoint: string,
    options?: (RequestInit & { timeoutMs?: number }),
    retry = true
  ): Promise<T> {
    const { timeoutMs = ApiService.DEFAULT_TIMEOUT_MS, ...requestInit } = options || {};
    const token = getStoredAccessToken();
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...requestInit,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...requestInit?.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 && retry) {
          const refreshed = await this.refreshTokens();
          if (refreshed) {
            return this.request<T>(endpoint, options, false);
          }
          setStoredTokens(null, null);
        }
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        const err = new Error(error.detail || error.message || 'Request failed');
        (err as Error & { status?: number }).status = response.status;
        throw err;
      }

      return response.json();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        const timeoutSeconds = Math.floor(timeoutMs / 1000);
        throw new Error(`Request timed out after ${timeoutSeconds}s. Please check the backend or increase timeout.`);
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async register(username: string, email: string, password: string): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    if (res?.access_token) setStoredTokens(res.access_token, res.refresh_token);
    return res;
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res?.access_token) setStoredTokens(res.access_token, res.refresh_token);
    return res;
  }

  async loginWithGoogle(payload: OAuthLoginPayload): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res?.access_token) setStoredTokens(res.access_token, res.refresh_token);
    return res;
  }

  async logout(): Promise<void> {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      try {
        await this.request('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
        }, false);
      } catch {
        // ignore
      }
    }
    setStoredTokens(null, null);
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem('dashboardIdea');
      localStorage.removeItem('pendingIdea');
      localStorage.removeItem('pendingAutoStart');
      localStorage.removeItem('pendingCourtIdea');
      localStorage.removeItem('postLoginRedirect');
    } catch {
      // ignore
    }
  }

  async getMe(options?: RequestInit): Promise<UserMe> {
    return this.request<UserMe>('/auth/me', options);
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    return this.request('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    return this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    return this.request('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async redeemPromo(code: string): Promise<RedeemResponse> {
    return this.request<RedeemResponse>('/auth/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async promoteSelf(secret: string): Promise<PromoteResponse> {
    return this.request<PromoteResponse>('/auth/promote', {
      method: 'POST',
      body: JSON.stringify({ secret }),
    });
  }

  async runResearch(query: string, location?: string, category?: string, language = 'en'): Promise<any> {
    return this.request('/research/run', {
      method: 'POST',
      body: JSON.stringify({ query, location, category, language }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async runCourt(payload: { idea: string; category?: string; evidence?: string; language?: string }): Promise<any> {
    return this.request('/court/run', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async listUsers(): Promise<any[]> {
    return this.request('/admin/users');
  }

  async getStats(): Promise<any> {
    return this.request('/admin/stats');
  }

  async adjustCredits(payload: { user_id?: number; username?: string; delta: number }): Promise<any> {
    return this.request('/admin/credits', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateRole(payload: { user_id?: number; username?: string; role: string }): Promise<any> {
    return this.request('/admin/role', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async resetUsage(payload: { user_id?: number; username?: string; date?: string; all_users?: boolean }): Promise<any> {
    return this.request('/admin/usage/reset', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createPromo(payload: { code: string; bonus_attempts: number; max_uses?: number; expires_at?: string }): Promise<PromoCreateResponse> {
    return this.request('/admin/promo', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async startSimulation(config: SimulationConfig): Promise<SimulationResponse> {
    // Backend contract: POST /simulation/start
    return this.request<SimulationResponse>('/simulation/start', {
      method: 'POST',
      body: JSON.stringify(config),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async listSimulations(limit = 25, offset = 0): Promise<SimulationListResponse> {
    return this.request<SimulationListResponse>(`/simulation/list?limit=${limit}&offset=${offset}`);
  }

  async getSimulationAnalytics(days = 7): Promise<SimulationAnalyticsResponse> {
    return this.request<SimulationAnalyticsResponse>(`/simulation/analytics?days=${days}`);
  }

  async listNotifications(limit = 20): Promise<NotificationsResponse> {
    return this.request<NotificationsResponse>(`/auth/notifications?limit=${limit}`);
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
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
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
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async detectStartIntent(message: string, context?: string): Promise<{ start: boolean; reason?: string | null }> {
    return this.request('/llm/intent', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async detectMessageMode(message: string, context?: string, language?: 'ar' | 'en'): Promise<{ mode: 'update' | 'discuss'; reason?: string | null }> {
    return this.request('/llm/message_mode', {
      method: 'POST',
      body: JSON.stringify({ message, context, language }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async searchWeb(query: string, language = 'en', maxResults = 5): Promise<SearchResponse> {
    return this.request('/search/web', {
      method: 'POST',
      body: JSON.stringify({ query, language, max_results: maxResults }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }
}

export const apiService = new ApiService();
