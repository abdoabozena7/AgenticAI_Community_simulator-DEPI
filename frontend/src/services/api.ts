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

const decodeJwtExp = (token: string): number | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1] || '';
    const normalized = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const jsonText = atob(normalized.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(jsonText);
    const exp = Number(parsed?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
};

const isTokenExpiringSoon = (token: string, minTtlSeconds = 45): boolean => {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= (now + Math.max(5, minTtlSeconds));
};

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
  parent_simulation_id?: string;
  followup_mode?: 'make_acceptable' | 'bring_to_world';
  seed_context?: Record<string, unknown>;
  preflight_ready?: boolean;
  preflight_summary?: string;
  preflight_answers?: Record<string, unknown>;
  preflight_clarity_score?: number;
  preflight_assumptions?: string[];
}

export interface SimulationResponse {
  simulation_id: string;
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'error';
  status_reason?: 'running' | 'interrupted' | 'paused_manual' | 'paused_search_failed' | 'paused_research_review' | 'paused_credits_exhausted' | 'paused_clarification_needed' | 'error' | 'completed';
}

export interface SimulationResultResponse {
  simulation_id: string;
  status: 'running' | 'paused' | 'completed' | 'error';
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
  status: 'running' | 'paused' | 'completed' | 'error';
  status_reason?: 'running' | 'interrupted' | 'paused_manual' | 'paused_search_failed' | 'paused_research_review' | 'paused_credits_exhausted' | 'paused_clarification_needed' | 'error' | 'completed';
  policy_mode?: 'normal' | 'safety_guard_hard';
  policy_reason?: string | null;
  search_quality?: {
    usable_sources: number;
    domains: number;
    extraction_success_rate: number;
  } | null;
  current_phase_key?: string | null;
  phase_progress_pct?: number | null;
  event_seq?: number;
  pause_available?: boolean;
  summary_ready?: boolean;
  summary_at?: string;
  can_resume?: boolean;
  resume_reason?: string | null;
  pending_clarification?: {
    question_id: string;
    question: string;
    options: { id?: string; label?: string; text?: string; value?: string }[];
    reason_tag?: string | null;
    reason_summary?: string | null;
    decision_axis?: string | null;
    affected_agents?: {
      reject?: number;
      neutral?: number;
      total_window?: number;
    } | null;
    supporting_snippets?: string[];
    question_quality?: {
      score?: number;
      checks_passed?: string[];
    } | null;
    created_at?: number | null;
    required?: boolean;
  } | null;
  can_answer_clarification?: boolean;
  pending_research_review?: {
    cycle_id: string;
    query_plan: string[];
    candidate_urls: Array<{
      id: string;
      url: string;
      domain?: string;
      title?: string;
      snippet?: string;
      favicon_url?: string | null;
      score?: number;
    }>;
    quality_snapshot?: {
      usable_sources: number;
      domains: number;
      extraction_success_rate: number;
      max_content_chars?: number;
    } | null;
    gap_summary?: string | null;
    suggested_queries?: string[];
    required?: boolean;
  } | null;
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
    }[];
  chat_events?: {
    event_seq: number;
    message_id: string;
    role: 'user' | 'system' | 'research' | 'status';
    content: string;
    meta?: Record<string, unknown>;
    timestamp?: number | null;
  }[];
  research_sources?: {
    event_seq?: number;
    cycle_id?: string | null;
    url?: string | null;
    domain?: string | null;
    favicon_url?: string | null;
    action?: string | null;
    status?: string | null;
    title?: string | null;
    http_status?: number | null;
    content_chars?: number | null;
    relevance_score?: number | null;
    progress_pct?: number | null;
    snippet?: string | null;
    error?: string | null;
    meta_json?: Record<string, unknown> | null;
    timestamp?: number | null;
  }[];
  summary?: string;
  error?: string;
}

export interface PreflightQuestionOption {
  id: string;
  label: string;
}

export interface SimulationPreflightQuestion {
  question_id: string;
  axis: string;
  question: string;
  options: PreflightQuestionOption[];
  reason_summary?: string;
  required: true;
  question_quality?: {
    score?: number;
    checks_passed?: string[];
  };
}

export interface SimulationPreflightNextResponse {
  ready: boolean;
  clarity_score: number;
  round: number;
  max_rounds: number;
  missing_axes: string[];
  question?: SimulationPreflightQuestion | null;
  normalized_context: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  preflight_summary?: string;
  assumptions?: string[];
}

export interface SimulationPreflightFinalizeResponse {
  preflight_ready: true | boolean;
  preflight_summary: string;
  preflight_answers: Record<string, unknown>;
  preflight_clarity_score: number;
  assumptions: string[];
  missing_axes?: string[];
  normalized_context?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
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
  daily_tokens_used?: number;
  daily_tokens_limit?: number;
  daily_tokens_remaining?: number;
  token_price_per_1k_credits?: number;
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

export interface BillingSettingsResponse {
  token_price_per_1k_credits: number;
  free_daily_tokens: number;
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
  status: 'running' | 'paused' | 'completed' | 'error';
  idea: string;
  category?: string;
  created_at?: string;
  ended_at?: string;
  summary?: string;
  acceptance_rate?: number;
  total_agents?: number;
  can_resume?: boolean;
  resume_reason?: string | null;
}

export interface SimulationListResponse {
  items: SimulationListItem[];
  total: number;
}

export interface SimulationResumeResponse {
  simulation_id: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  resumed: boolean;
  resume_from_phase?: string | null;
}

export interface SimulationPauseResponse {
  simulation_id: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  paused: boolean;
}

export interface SimulationResearchActionResponse {
  ok: boolean;
  simulation_id: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  status_reason?: 'running' | 'interrupted' | 'paused_manual' | 'paused_search_failed' | 'paused_research_review' | 'paused_credits_exhausted' | 'paused_clarification_needed' | 'error' | 'completed';
}

export interface SimulationChatEventResponse {
  ok: boolean;
  event_seq: number;
  message_id: string;
}

export interface SimulationClarificationAnswerResponse {
  ok: boolean;
  simulation_id: string;
  resumed: boolean;
  applied_answer: string;
  answer_source: 'custom' | 'option';
}

export interface SimulationPostActionResponse {
  action: 'make_acceptable' | 'bring_to_world';
  title: string;
  summary: string;
  steps: string[];
  risks: string[];
  kpis: string[];
  followup_seed?: Record<string, unknown>;
  revised_idea?: string;
  compliance_fixes?: string[];
  blocking_reasons?: string[];
  mvp_scope?: string[];
  go_to_market?: string[];
  '30_day_plan'?: string[];
}

export interface SimulationAgentsResponse {
  simulation_id: string;
  items: {
    agent_id: string;
    agent_short_id?: string;
    agent_label?: string;
    archetype?: string;
    category_id?: string;
    opinion: 'accept' | 'reject' | 'neutral';
    confidence?: number;
    phase?: string;
  }[];
  page: number;
  page_size: number;
  total: number;
}

export interface SimulationResearchSourcesResponse {
  simulation_id: string;
  items: {
    event_seq?: number;
    cycle_id?: string | null;
    url?: string | null;
    domain?: string | null;
    favicon_url?: string | null;
    action?: string | null;
    status?: string | null;
    title?: string | null;
    http_status?: number | null;
    content_chars?: number | null;
    relevance_score?: number | null;
    progress_pct?: number | null;
    snippet?: string | null;
    error?: string | null;
    meta_json?: Record<string, unknown> | null;
    timestamp?: number | null;
  }[];
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

export interface DevLabSearchTestResponse {
  provider?: string;
  is_live: boolean;
  strict_mode: boolean;
  quality: {
    usable_sources?: number;
    domains?: number;
    extraction_success_rate?: number;
    max_content_chars?: number;
  };
  results: SearchResult[];
  structured?: SearchStructured;
  latency_ms: number;
  warnings: string[];
}

export interface DevLabLlmTestResponse {
  text: string;
  latency_ms: number;
  model?: string;
  mojibake_detected: boolean;
  warnings: string[];
}

export interface DevLabSuiteCase {
  key: string;
  title: string;
  idea: string;
  expected: Record<string, unknown>;
}

export interface DevLabSuiteStartResponse {
  suite_id: string;
  status: 'running' | 'completed' | 'failed';
  created_at?: number;
}

export interface DevLabSuiteStateResponse {
  suite_id: string;
  status: 'running' | 'completed' | 'failed';
  progress_pct: number;
  cases: Array<{
    key: string;
    simulation_id?: string;
    expected?: Record<string, unknown>;
    actual?: Record<string, unknown>;
    status?: string;
    pass?: boolean | null;
    failures?: string[];
  }>;
  started_at?: string;
  ended_at?: string;
  summary?: Record<string, unknown>;
}

export interface DevLabSuiteListResponse {
  items: Array<{
    suite_id: string;
    status: string;
    summary?: Record<string, unknown>;
    created_at?: string;
    ended_at?: string;
  }>;
  total: number;
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

  async ensureAccessTokenFresh(minTtlSeconds = 45): Promise<string | null> {
    const current = getStoredAccessToken();
    if (current && !isTokenExpiringSoon(current, minTtlSeconds)) {
      return current;
    }
    const refreshed = await this.refreshTokens();
    if (refreshed) {
      return getStoredAccessToken();
    }
    return getStoredAccessToken();
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

  async getBillingSettings(): Promise<BillingSettingsResponse> {
    return this.request<BillingSettingsResponse>('/admin/billing');
  }

  async updateBillingSettings(payload: BillingSettingsResponse): Promise<BillingSettingsResponse> {
    return this.request<BillingSettingsResponse>('/admin/billing', {
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

  async devlabSearchTest(payload: {
    query: string;
    language?: 'ar' | 'en';
    max_results?: number;
  }): Promise<DevLabSearchTestResponse> {
    return this.request<DevLabSearchTestResponse>('/devlab/search/test', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async devlabLlmTest(payload: {
    prompt: string;
    system?: string;
    temperature?: number;
    language?: 'ar' | 'en';
  }): Promise<DevLabLlmTestResponse> {
    return this.request<DevLabLlmTestResponse>('/devlab/llm/test', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async startDevlabReasoningSuite(payload: {
    language?: 'ar' | 'en';
    agent_count?: number;
    iterations?: number;
    neutral_cap_pct?: number;
    cases?: DevLabSuiteCase[];
  }): Promise<DevLabSuiteStartResponse> {
    return this.request<DevLabSuiteStartResponse>('/devlab/reasoning-suite/start', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async getDevlabReasoningSuiteState(suiteId: string): Promise<DevLabSuiteStateResponse> {
    return this.request<DevLabSuiteStateResponse>(`/devlab/reasoning-suite/state?suite_id=${encodeURIComponent(suiteId)}`);
  }

  async listDevlabReasoningSuites(limit = 20, offset = 0): Promise<DevLabSuiteListResponse> {
    return this.request<DevLabSuiteListResponse>(`/devlab/reasoning-suite/list?limit=${limit}&offset=${offset}`);
  }

  async startSimulation(config: SimulationConfig): Promise<SimulationResponse> {
    // Backend contract: POST /simulation/start
    return this.request<SimulationResponse>('/simulation/start', {
      method: 'POST',
      body: JSON.stringify(config),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async simulationPreflightNext(payload: {
    draft_context: {
      idea: string;
      country: string;
      city: string;
      category: string;
      target_audience: string[];
      goals: string[];
      idea_maturity: string;
      risk_appetite: number;
      preflight_axis_answers?: Record<string, string>;
    };
    history?: Array<Record<string, unknown>>;
    answer?: {
      question_id: string;
      selected_option_id?: string;
      custom_text?: string;
    };
    language: 'ar' | 'en';
  }): Promise<SimulationPreflightNextResponse> {
    return this.request<SimulationPreflightNextResponse>('/simulation/preflight/next', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async simulationPreflightFinalize(payload: {
    normalized_context: Record<string, unknown>;
    history?: Array<Record<string, unknown>>;
    language: 'ar' | 'en';
  }): Promise<SimulationPreflightFinalizeResponse> {
    return this.request<SimulationPreflightFinalizeResponse>('/simulation/preflight/finalize', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async resumeSimulation(simulationId: string): Promise<SimulationResumeResponse> {
    return this.request<SimulationResumeResponse>('/simulation/resume', {
      method: 'POST',
      body: JSON.stringify({ simulation_id: simulationId }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async pauseSimulation(simulationId: string, reason?: string): Promise<SimulationPauseResponse> {
    return this.request<SimulationPauseResponse>('/simulation/pause', {
      method: 'POST',
      body: JSON.stringify({ simulation_id: simulationId, reason }),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async submitResearchAction(payload: {
    simulation_id: string;
    cycle_id: string;
    action: 'scrape_selected' | 'continue_search' | 'cancel_review';
    selected_url_ids?: string[];
    added_urls?: string[];
    query_refinement?: string;
  }): Promise<SimulationResearchActionResponse> {
    return this.request<SimulationResearchActionResponse>('/simulation/research/action', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async submitClarificationAnswer(payload: {
    simulation_id: string;
    question_id: string;
    selected_option_id?: string;
    custom_text?: string;
  }): Promise<SimulationClarificationAnswerResponse> {
    return this.request<SimulationClarificationAnswerResponse>('/simulation/clarification/answer', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async requestPostAction(payload: {
    simulation_id: string;
    action: 'make_acceptable' | 'bring_to_world';
  }): Promise<SimulationPostActionResponse> {
    return this.request<SimulationPostActionResponse>('/simulation/post-action', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async appendSimulationChatEvent(payload: {
    simulation_id: string;
    role: 'user' | 'system' | 'research' | 'status';
    content: string;
    message_id?: string;
    meta?: Record<string, unknown>;
  }): Promise<SimulationChatEventResponse> {
    return this.request<SimulationChatEventResponse>('/simulation/chat/event', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: ApiService.LONG_TIMEOUT_MS,
    });
  }

  async updateSimulationContext(simulationId: string, updates: Record<string, unknown>): Promise<{
    simulation_id: string;
    updated: boolean;
    user_context: Record<string, unknown>;
  }> {
    return this.request('/simulation/context', {
      method: 'POST',
      body: JSON.stringify({ simulation_id: simulationId, updates }),
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

  async getSimulationAgents(
    simulationId: string,
    options?: { stance?: 'accepted' | 'rejected' | 'neutral' | 'accept' | 'reject'; phase?: string; page?: number; pageSize?: number }
  ): Promise<SimulationAgentsResponse> {
    const params = new URLSearchParams();
    params.set('simulation_id', simulationId);
    if (options?.stance) params.set('stance', options.stance);
    if (options?.phase) params.set('phase', options.phase);
    params.set('page', String(Math.max(1, options?.page ?? 1)));
    params.set('page_size', String(Math.max(1, options?.pageSize ?? 50)));
    return this.request<SimulationAgentsResponse>(`/simulation/agents?${params.toString()}`);
  }

  async getSimulationResearchSources(simulationId: string): Promise<SimulationResearchSourcesResponse> {
    return this.request<SimulationResearchSourcesResponse>(
      `/simulation/research/sources?simulation_id=${encodeURIComponent(simulationId)}`
    );
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
