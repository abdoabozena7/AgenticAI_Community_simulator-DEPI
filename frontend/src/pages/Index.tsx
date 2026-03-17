import { startTransition, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/Header';
import {
  TopBar,
  CATEGORY_OPTIONS,
  AUDIENCE_OPTIONS,
  GOAL_OPTIONS,
  MATURITY_LEVELS,
} from '@/components/TopBar';
import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel, SocietyControls } from '@/components/ConfigPanel';
import { SimulationArena } from '@/components/SimulationArena';
import { MetricsPanel } from '@/components/MetricsPanel';
import { IterationTimeline } from '@/components/IterationTimeline';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useSimulation } from '@/hooks/useSimulation';
import { useGuidedWorkflow } from '@/hooks/useGuidedWorkflow';
import { ChatMessage, GuidedWorkflowDraftContext, PendingIdeaConfirmation, PreflightQuestion, UserInput } from '@/types/simulation';
import { websocketService } from '@/services/websocket';
import { apiService, clearAuthTokens, SearchResponse, SimulationConfig, SimulationPreflightNextResponse, SocietyCatalogResponse, UserMe } from '@/services/api';
import { cn } from '@/lib/utils';
import { addIdeaLogEntry, updateIdeaLogEntry } from '@/lib/ideaLog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';


const CATEGORY_LABEL_BY_VALUE = new Map(
  CATEGORY_OPTIONS.map((label) => [label.toLowerCase(), label])
);

const CATEGORY_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  Technology: { ar: 'حلول تقنية وبرمجيات ومنتجات رقمية', en: 'Software and digital technology products' },
  Healthcare: { ar: 'خدمات صحية ورعاية وتقنية طبية', en: 'Healthcare services and medical tech' },
  Finance: { ar: 'خدمات مالية ومدفوعات واستثمارات', en: 'Financial services, payments, and investing' },
  Education: { ar: 'تعليم وتدريب ومنصات تعلم', en: 'Learning, training, and education platforms' },
  'E-commerce': { ar: 'متاجر رقمية وتجربة شراء', en: 'Online commerce and shopping experiences' },
  Entertainment: { ar: 'ترفيه ومحتوى', en: 'Entertainment and content products' },
  Social: { ar: 'مجتمعات وتواصل اجتماعي', en: 'Social communities and networks' },
  'B2B SaaS': { ar: 'برمجيات أعمال للشركات وخدمات SaaS', en: 'B2B SaaS tools for companies' },
  'Consumer Apps': { ar: 'تطبيقات للمستهلكين', en: 'Direct-to-consumer apps' },
  Hardware: { ar: 'أجهزة ومنتجات مادية', en: 'Hardware and physical products' },
};

const AUDIENCE_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  'Gen Z (18-24)': { ar: 'جيل شاب ومتفاعل مع التقنية', en: 'Young digital-native audience' },
  'Millennials (25-40)': { ar: 'شريحة نشطة اقتصادياً', en: 'Economically active cohort' },
  'Gen X (41-56)': { ar: 'خبرة عملية وقرارات محسوبة', en: 'Experienced, pragmatic decision-makers' },
  'Boomers (57-75)': { ar: 'يميلون للثقة والاستقرار', en: 'Trust and stability focused' },
  Developers: { ar: 'مطورون ومهندسو برمجيات', en: 'Software developers and engineers' },
  Enterprises: { ar: 'شركات كبرى وقرارات مؤسسية', en: 'Large enterprises with formal buying' },
  SMBs: { ar: 'شركات صغيرة ومتوسطة', en: 'Small & medium-sized businesses' },
  Consumers: { ar: 'مستهلكون أفراد', en: 'End consumers' },
  Students: { ar: 'طلاب وباحثون عن تعلم', en: 'Students and learners' },
  Professionals: { ar: 'محترفون في مجالات مختلفة', en: 'Professionals across sectors' },
};

const GOAL_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  'Market Validation': { ar: 'اختبار اهتمام السوق بالفكرة', en: 'Validate demand and interest' },
  'Funding Readiness': { ar: 'تجهيز الفكرة لجذب تمويل', en: 'Prepare to raise funding' },
  'User Acquisition': { ar: 'زيادة قاعدة المستخدمين', en: 'Grow user acquisition' },
  'Product-Market Fit': { ar: 'مواءمة المنتج مع احتياج السوق', en: 'Achieve product-market fit' },
  'Competitive Analysis': { ar: 'فهم المنافسين والتميّز', en: 'Understand competitors and differentiation' },
  'Growth Strategy': { ar: 'خطة نمو واستراتيجية توسع', en: 'Growth and expansion strategy' },
};

const MATURITY_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  concept: { ar: 'الفكرة في مرحلة التصور', en: 'Idea stage' },
  prototype: { ar: 'نموذج أولي قيد التجربة', en: 'Prototype being tested' },
  mvp: { ar: 'نسخة أولية قابلة للاستخدام', en: 'Minimum viable product' },
  launched: { ar: 'منتج مطلق في السوق', en: 'Already launched' },
};

const CATEGORY_KEYWORDS: Record<string, string> = {
  ai: 'technology',
  tech: 'technology',
  software: 'technology',
  health: 'healthcare',
  medical: 'healthcare',
  finance: 'finance',
  bank: 'finance',
  fintech: 'finance',
  education: 'education',
  edtech: 'education',
  'e-commerce': 'e-commerce',
  ecommerce: 'e-commerce',
  commerce: 'e-commerce',
  retail: 'e-commerce',
  entertainment: 'entertainment',
  media: 'entertainment',
  social: 'social',
  saas: 'b2b saas',
  b2b: 'b2b saas',
  consumer: 'consumer apps',
  hardware: 'hardware',
  device: 'hardware',
};

const DEFAULT_CATEGORY = 'technology';
const DEFAULT_AUDIENCE = ['Consumers'];
const DEFAULT_GOALS = ['Market Validation'];
const MAX_CHAT_MESSAGES = 40;
const SEARCH_TIMEOUT_BASE_MS = 60000;
const SEARCH_TIMEOUT_STEP_MS = 30000;
const SEARCH_TIMEOUT_MAX_MS = 120000;

type UiBusyStage =
  | 'extracting_schema'
  | 'detecting_mode'
  | 'assistant_reply'
  | 'prestart_research'
  | 'starting_simulation'
  | 'checking_session';

type RealtimeConnectionState = 'connected' | 'disconnected' | 'reconnecting';

const canonicalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const normalizeCategoryValue = (value?: string): string | undefined => {
  if (!value) return undefined;
  const raw = value.toLowerCase().trim();
  const rawKey = canonicalize(raw);
  if (CATEGORY_LABEL_BY_VALUE.has(raw)) return raw;
  const exact = CATEGORY_OPTIONS.find((cat) => cat.toLowerCase() === raw);
  if (exact) return exact.toLowerCase();
  for (const [key, mapped] of Object.entries(CATEGORY_KEYWORDS)) {
    if (raw.includes(key)) return mapped;
  }
  const fuzzy = CATEGORY_OPTIONS.find((cat) => {
    const lower = cat.toLowerCase();
    const normalized = canonicalize(lower);
    return raw.includes(lower) || lower.includes(raw) || rawKey.includes(normalized) || normalized.includes(rawKey);
  });
  return fuzzy ? fuzzy.toLowerCase() : undefined;
};

const normalizeOptionValue = (value: string, options: string[]): string | undefined => {
  const raw = value.toLowerCase().trim();
  const rawKey = canonicalize(raw);
  const exact = options.find((opt) => opt.toLowerCase() === raw);
  if (exact) return exact;
  const fuzzy = options.find((opt) => {
    const lower = opt.toLowerCase();
    const normalized = canonicalize(lower);
    return raw.includes(lower) || lower.includes(raw) || rawKey.includes(normalized) || normalized.includes(rawKey);
  });
  return fuzzy;
};

const normalizeOptionList = (values: unknown, options: string[]): string[] => {
  const list = Array.isArray(values)
    ? values
    : typeof values === 'string'
    ? values.split(',')
    : [];
  const normalized = list
    .map((value) => (typeof value === 'string' ? normalizeOptionValue(value, options) : undefined))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
};

const normalizeRiskValue = (value?: number): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  if (value <= 1) return Math.round(value * 100);
  return Math.round(value);
};

const normalizeMaturityValue = (value?: string): UserInput['ideaMaturity'] | undefined => {
  if (!value) return undefined;
  const raw = value.toLowerCase().trim();
  const match = MATURITY_LEVELS.find(
    (level) => level.value === raw || level.label.toLowerCase() === raw
  );
  if (match) return match.value as UserInput['ideaMaturity'];
  if (raw.includes('proto')) return 'prototype';
  if (raw.includes('mvp')) return 'mvp';
  if (raw.includes('launch')) return 'launched';
  if (raw.includes('concept') || raw.includes('idea')) return 'concept';
  return undefined;
};



const inferReplyLanguage = (
  text: string,
  fallback: 'ar' | 'en'
): 'ar' | 'en' | 'mixed' => {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasArabic && hasLatin) return 'mixed';
  if (hasArabic) return 'ar';
  if (hasLatin) return 'en';
  return fallback;
};

const normalizeAssistantText = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const Index = () => {
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSimulationId = searchParams.get('simulation_id')?.trim() || '';
  const suppressAutoRestore = !requestedSimulationId && (() => {
    if (typeof window === 'undefined') return false;
    const pendingAutoStart = window.localStorage.getItem('pendingAutoStart') === 'true';
    const pendingIdea = (window.localStorage.getItem('pendingIdea') || '').trim();
    const routeState = location.state as { idea?: string; autoStart?: boolean } | null;
    const routeIdea = typeof routeState?.idea === 'string' ? routeState.idea.trim() : '';
    const routeAutoStart = Boolean(routeState?.autoStart && routeIdea);
    return Boolean(routeAutoStart || pendingAutoStart || pendingIdea);
  })();
  const simulation = useSimulation({ suppressAutoRestore });
  const guidedWorkflow = useGuidedWorkflow({
    suppressAutoRestore: Boolean(requestedSimulationId || simulation.simulationId),
  });
  const guidedWorkflowState = guidedWorkflow.workflow;
  const guidedWorkflowLoading = guidedWorkflow.loading;
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState<UserInput>({
    idea: '',
    category: '',
    targetAudience: [],
    country: '',
    city: '',
    riskAppetite: 50,
    ideaMaturity: 'concept',
    goals: [],
    agentCount: 20,
  });
  const [touched, setTouched] = useState({
    category: false,
    audience: false,
    goals: false,
    risk: false,
    maturity: false,
  });
  const [isWaitingForCity, setIsWaitingForCity] = useState(false);
  const [isWaitingForCountry, setIsWaitingForCountry] = useState(false);
  const [isWaitingForLocationChoice, setIsWaitingForLocationChoice] = useState(false);
  const [locationChoice, setLocationChoice] = useState<'yes' | 'no' | null>(null);
  const [guidedContextScope, setGuidedContextScope] = useState<GuidedWorkflowDraftContext['contextScope']>('');
  const [hasStarted, setHasStarted] = useState(false);
  const [autoStartPending, setAutoStartPending] = useState(false);
  const summaryRef = useRef<string | null>(null);
  const lastPhaseMarkerRef = useRef<string | null>(null);
  const lastIterationMarkerRef = useRef<number>(0);
  const messageIdCounterRef = useRef(0);
  const searchPromptedRef = useRef(false);
  const searchAttemptRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchAbortReasonRef = useRef<'superseded' | 'timeout' | null>(null);
  const runSearchRef = useRef<null | ((
    query: string,
    timeoutMs: number,
    options?: { promptOnTimeout?: boolean }
  ) => Promise<{ status: 'complete' | 'timeout' | 'aborted' }>)>(null);
  const [autoFocusInput, setAutoFocusInput] = useState(true);
  const settings = useMemo(() => ({
    language,
    theme,
    autoFocusInput,
  }), [autoFocusInput, language, theme]);
  const [showSettings, setShowSettings] = useState(false);

  const [activePanel, setActivePanel] = useState<'config' | 'chat' | 'reasoning'>('chat');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [pendingConfigReview, setPendingConfigReview] = useState(false);
  const [isConfigSearching, setIsConfigSearching] = useState(false);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmRetryMessage, setLlmRetryMessage] = useState<string | null>(null);
  const [pendingResearchReview, setPendingResearchReview] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [coachBusy, setCoachBusy] = useState(false);
  const [researchReviewBusy, setResearchReviewBusy] = useState(false);
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [pendingPreflightQuestion, setPendingPreflightQuestion] = useState<PreflightQuestion | null>(null);
  const [preflightRound, setPreflightRound] = useState(0);
  const [preflightMaxRounds, setPreflightMaxRounds] = useState(3);
  const [preflightClarityScore, setPreflightClarityScore] = useState(0);
  const [preflightMissingAxes, setPreflightMissingAxes] = useState<string[]>([]);
  const [preflightHistory, setPreflightHistory] = useState<Array<Record<string, unknown>>>([]);
  const [understandingQueue, setUnderstandingQueue] = useState<PreflightQuestion[]>([]);
  const [understandingAnswers, setUnderstandingAnswers] = useState<Array<{
    questionId: string;
    axis: string;
    selectedOptionId?: string;
    customText?: string;
  }>>([]);
  const [preflightNormalizedContext, setPreflightNormalizedContext] = useState<Record<string, unknown> | null>(null);
  const [preflightSummary, setPreflightSummary] = useState<string>('');
  const [pendingIdeaConfirmation, setPendingIdeaConfirmation] = useState<PendingIdeaConfirmation | null>(null);
  const [startChoiceModalOpen, setStartChoiceModalOpen] = useState(false);
  const [selectedStartPath, setSelectedStartPath] = useState<'default_start' | 'custom_build' | null>(null);
  const [showSocietyBuilder, setShowSocietyBuilder] = useState(false);
  const [societyCatalog, setSocietyCatalog] = useState<SocietyCatalogResponse | null>(null);
  const [societyControls, setSocietyControls] = useState<SocietyControls>({
    diversity: 60,
    skepticRatio: 35,
    innovationBias: 55,
    strictPolicy: true,
    humanDebate: true,
    personaHint: '',
  });
  const [societyAssistantBusy, setSocietyAssistantBusy] = useState(false);
  const [societyAssistantAnswer, setSocietyAssistantAnswer] = useState('');
  const [postActionBusy, setPostActionBusy] = useState<'make_acceptable' | 'bring_to_world' | null>(null);
  const [postActionResult, setPostActionResult] = useState<{
    action: 'make_acceptable' | 'bring_to_world';
    title: string;
    summary: string;
    steps: string[];
    risks: string[];
    kpis: string[];
    revised_idea?: string;
    followup_seed?: Record<string, unknown>;
  } | null>(null);
  const [reasoningActive, setReasoningActive] = useState(false);
  const [debateInviteVisible, setDebateInviteVisible] = useState(false);
  const [highlightedReasoningMessageIds, setHighlightedReasoningMessageIds] = useState<string[]>([]);
  const [selectedStanceFilter, setSelectedStanceFilter] = useState<'accepted' | 'rejected' | 'neutral' | null>(null);
  const [filteredAgents, setFilteredAgents] = useState<{
    agent_id: string;
    agent_label?: string;
    agent_short_id?: string;
    archetype?: string;
    opinion: 'accept' | 'reject' | 'neutral';
  }[]>([]);
  const [filteredAgentsTotal, setFilteredAgentsTotal] = useState(0);
  const [creditNotice, setCreditNotice] = useState<string | null>(null);
  const [meSnapshot, setMeSnapshot] = useState<UserMe | null>(null);
  const reasoningTimerRef = useRef<number | null>(null);
  const debateInviteShownForSimulationRef = useRef<string | null>(null);
  const guidedWorkflowBootstrappedForSimulationRef = useRef<string | null>(null);
  const guidedWorkflowAttachRequestRef = useRef<string | null>(null);
  const guidedWorkflowStartingSimulationRef = useRef(false);
  const autoReasoningSwitchedRef = useRef(false);
  const userOverrodeAutoRef = useRef(false);
  const configLockHintAtRef = useRef(0);
  const actionGuardHintAtRef = useRef(0);
  const sessionRedirectingRef = useRef(false);
  const uiBusyTokenRef = useRef(0);
  const [uiBusyStage, setUiBusyStage] = useState<UiBusyStage | null>(null);
  const [uiBusyStartedAt, setUiBusyStartedAt] = useState<number | null>(null);
  const [uiBusyClock, setUiBusyClock] = useState(() => Date.now());
  const [searchState, setSearchState] = useState<{
    status: 'idle' | 'searching' | 'complete' | 'timeout' | 'error';
    stage?: UiBusyStage;
    query?: string;
    answer?: string;
    provider?: string;
    isLive?: boolean;
    results?: SearchResponse['results'];
    timeoutMs?: number;
    attempts?: number;
    startedAt?: number;
    elapsedMs?: number;
  }>({ status: 'idle' });
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>(() => (
    websocketService.isConnected() ? 'connected' : 'disconnected'
  ));
  const lastRealtimeConnectedAtRef = useRef<number | null>(
    websocketService.isConnected() ? Date.now() : null
  );
  const hasEverConnectedRealtimeRef = useRef<boolean>(websocketService.isConnected());
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [researchContext, setResearchContext] = useState<{
    summary: string;
    sources: SearchResponse['results'];
    structured?: SearchResponse['structured'];
  }>({
    summary: '',
    sources: [],
    structured: undefined,
  });
  const [researchIdea, setResearchIdea] = useState('');
  const lastLoggedSimulationRef = useRef<string | null>(null);
  const loadedFromQueryRef = useRef<string | null>(null);
  const consumedRouteStartRef = useRef(false);
  const persistedChatKeysRef = useRef<Set<string>>(new Set());
  const persistChatBusyRef = useRef(false);
  const preflightResolvedKeyRef = useRef('');
  const preflightConfirmedKeyRef = useRef('');
  const understandingAttemptRef = useRef('');
  const researchReviewedKeyRef = useRef('');
  const lastResearchGateKeyRef = useRef('');
  const startChoiceResolvedKeyRef = useRef('');
  const preflightStartPayloadRef = useRef<{
    preflight_ready: boolean;
    preflight_summary: string;
    preferred_idea_description?: string;
    preflight_answers: Record<string, unknown>;
    preflight_clarity_score: number;
    preflight_assumptions: string[];
  } | null>(null);

  const guidedDraftInput = useMemo<GuidedWorkflowDraftContext>(() => ({
    idea: userInput.idea,
    category: userInput.category,
    targetAudience: userInput.targetAudience,
    country: userInput.country,
    city: userInput.city,
    placeName: userInput.city || userInput.country,
    riskAppetite: userInput.riskAppetite,
    ideaMaturity: userInput.ideaMaturity,
    goals: userInput.goals,
    contextScope: guidedContextScope,
    language: settings.language,
  }), [
    guidedContextScope,
    settings.language,
    userInput.category,
    userInput.city,
    userInput.country,
    userInput.goals,
    userInput.idea,
    userInput.ideaMaturity,
    userInput.riskAppetite,
    userInput.targetAudience,
  ]);

  const beginUiBusy = useCallback((stage: UiBusyStage) => {
    const token = uiBusyTokenRef.current + 1;
    uiBusyTokenRef.current = token;
    setUiBusyStage(stage);
    setUiBusyStartedAt(Date.now());
    setUiBusyClock(Date.now());
    return token;
  }, []);

  const endUiBusy = useCallback((token: number) => {
    if (uiBusyTokenRef.current !== token) return;
    setUiBusyStage(null);
    setUiBusyStartedAt(null);
  }, []);

  useEffect(() => {
    if (!uiBusyStage || !uiBusyStartedAt) return;
    const timer = window.setInterval(() => {
      setUiBusyClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [uiBusyStage, uiBusyStartedAt]);

  useEffect(() => {
    if (searchState.status !== 'searching' || !searchState.startedAt) return;
    const timer = window.setInterval(() => {
      setSearchState((prev) => (
        prev.status === 'searching' && prev.startedAt
          ? { ...prev, elapsedMs: Date.now() - prev.startedAt }
          : prev
      ));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [searchState.startedAt, searchState.status]);

  useEffect(() => {
    const simulationId = simulation.simulationId;
    if (!simulationId) {
      guidedWorkflowBootstrappedForSimulationRef.current = null;
      return;
    }
    if (guidedWorkflowLoading) return;
    if (guidedWorkflowStartingSimulationRef.current) return;
    if (guidedWorkflowBootstrappedForSimulationRef.current === simulationId) return;
    if (guidedWorkflowState?.simulation?.attached_simulation_id === simulationId) {
      guidedWorkflowBootstrappedForSimulationRef.current = simulationId;
      return;
    }
    guidedWorkflowBootstrappedForSimulationRef.current = simulationId;
    void guidedWorkflow.restoreBySimulation(simulationId).catch(() => {
      if (guidedWorkflowBootstrappedForSimulationRef.current === simulationId) {
        guidedWorkflowBootstrappedForSimulationRef.current = null;
      }
    });
  }, [
    guidedWorkflow.restoreBySimulation,
    guidedWorkflowLoading,
    guidedWorkflowState?.simulation?.attached_simulation_id,
    simulation.simulationId,
  ]);

  useEffect(() => {
    if (guidedWorkflowState || guidedWorkflowLoading) return;
    if (simulation.simulationId) {
      return;
    }
    void guidedWorkflow.ensureStarted({
      draftContext: guidedDraftInput,
      language: settings.language,
    }).catch(() => undefined);
  }, [
    guidedDraftInput,
    guidedWorkflow.ensureStarted,
    guidedWorkflow.restoreBySimulation,
    guidedWorkflowLoading,
    guidedWorkflowState,
    settings.language,
    simulation.simulationId,
  ]);

  useEffect(() => {
    const draft = guidedWorkflowState?.draft_context;
    if (!draft) return;
    setGuidedContextScope((prev) => (prev === draft.contextScope ? prev : draft.contextScope));
    setLocationChoice((prev) => {
      const next = draft.contextScope === 'specific_place' ? 'yes' : draft.contextScope ? 'no' : null;
      return prev === next ? prev : next;
    });
    setUserInput((prev) => {
      const next = {
        ...prev,
        idea: draft.idea || prev.idea,
        category: draft.category || prev.category,
        targetAudience: draft.targetAudience?.length ? draft.targetAudience : prev.targetAudience,
        country: draft.country ?? prev.country,
        city: draft.city ?? prev.city,
        riskAppetite: typeof draft.riskAppetite === 'number' ? draft.riskAppetite : prev.riskAppetite,
        ideaMaturity: (draft.ideaMaturity as UserInput['ideaMaturity']) || prev.ideaMaturity,
        goals: draft.goals?.length ? draft.goals : prev.goals,
      };
      const changed = JSON.stringify(prev) !== JSON.stringify(next);
      return changed ? next : prev;
    });
  }, [guidedWorkflowState?.draft_context]);

  useEffect(() => {
    const simulationId = simulation.simulationId;
    const workflowId = guidedWorkflowState?.workflow_id;
    if (!simulationId || !workflowId) {
      guidedWorkflowAttachRequestRef.current = null;
      return;
    }
    const attachKey = `${workflowId}:${simulationId}`;
    if (guidedWorkflowState.simulation?.attached_simulation_id === simulationId) {
      guidedWorkflowAttachRequestRef.current = attachKey;
      return;
    }
    if (guidedWorkflowAttachRequestRef.current === attachKey) return;
    guidedWorkflowAttachRequestRef.current = attachKey;
    void guidedWorkflow.attachSimulation(simulationId).catch(() => {
      if (guidedWorkflowAttachRequestRef.current === attachKey) {
        guidedWorkflowAttachRequestRef.current = null;
      }
    });
  }, [
    guidedWorkflow.attachSimulation,
    guidedWorkflowState?.simulation?.attached_simulation_id,
    guidedWorkflowState?.workflow_id,
    simulation.simulationId,
  ]);

  useEffect(() => {
    const syncRealtimeConnectionState = () => {
      const connected = websocketService.isConnected();
      if (connected) {
        hasEverConnectedRealtimeRef.current = true;
        lastRealtimeConnectedAtRef.current = Date.now();
        setConnectionState((prev) => (prev === 'connected' ? prev : 'connected'));
        return;
      }
      const lastConnectedAt = lastRealtimeConnectedAtRef.current;
      const reconnectWindowMs = 12000;
      const isReconnecting = Boolean(
        hasEverConnectedRealtimeRef.current
        && lastConnectedAt
        && (Date.now() - lastConnectedAt) < reconnectWindowMs
      );
      const nextState: RealtimeConnectionState = isReconnecting ? 'reconnecting' : 'disconnected';
      setConnectionState((prev) => (prev === nextState ? prev : nextState));
    };

    syncRealtimeConnectionState();
    const intervalId = window.setInterval(syncRealtimeConnectionState, 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncRealtimeConnectionState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const isAuthError = useCallback((err: unknown) => {
    if (!err) return false;
    const status = (err as { status?: number })?.status;
    if (status === 401) return true;
    const message = err instanceof Error
      ? err.message
      : String((err as { detail?: unknown })?.detail || '');
    return /unauthorized|session expired|missing or invalid token|invalid or expired token/i.test(message);
  }, []);

  const handleSessionExpired = useCallback(() => {
    if (sessionRedirectingRef.current) return;
    sessionRedirectingRef.current = true;
    const draftIdea = userInput.idea.trim();
    if (typeof window !== 'undefined') {
      try {
        if (draftIdea) {
          window.localStorage.setItem('pendingIdea', draftIdea);
          window.localStorage.setItem('pendingAutoStart', 'true');
        }
        window.localStorage.setItem('postLoginRedirect', '/simulate');
      } catch {
        // ignore
      }
    }
    searchAbortRef.current?.abort();
    setIsChatThinking(false);
    setIsConfigSearching(false);
    setLlmBusy(false);
    setReportBusy(false);
    setResumeBusy(false);
    setPauseBusy(false);
    setResearchReviewBusy(false);
    setClarificationBusy(false);
    setPreflightBusy(false);
    setSocietyAssistantBusy(false);
    setPostActionBusy(null);
    setSearchState({ status: 'idle' });
    setUiBusyStage(null);
    setUiBusyStartedAt(null);
    clearAuthTokens();
    navigate('/?auth=login', { replace: true });
  }, [navigate, userInput.idea]);

  const uiBusyElapsedMs = useMemo(
    () => (uiBusyStage && uiBusyStartedAt ? Math.max(0, uiBusyClock - uiBusyStartedAt) : undefined),
    [uiBusyClock, uiBusyStage, uiBusyStartedAt],
  );

  const getAssistantMessage = useCallback(async (prompt: string) => {
    const busyToken = beginUiBusy('assistant_reply');
    const context = chatMessages
      .slice(-6)
      .map((msg) => `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
    const userLanguageContext = chatMessages
      .filter((msg) => msg.type === 'user')
      .slice(-3)
      .map((msg) => msg.content)
      .join('\n');
    const inferredLanguage = inferReplyLanguage(
      `${prompt}\n${userLanguageContext}`,
      settings.language
    );
    const languageInstruction =
      inferredLanguage === 'mixed'
        ? 'Reply in a natural mixed Arabic-English style that mirrors the user wording.'
        : inferredLanguage === 'ar'
        ? 'Reply in Arabic.'
        : 'Reply in English.';
    const fullPrompt = context ? `Conversation:\n${context}\nUser: ${prompt}\nAssistant:` : prompt;
    const system = [
      'You are a concise assistant for a product simulation UI.',
      languageInstruction,
      'Keep responses short, practical, and natural.',
      'Output plain text only. Do not use Markdown formatting like **bold**, headings, or markdown bullets.',
    ].join(' ');
    try {
      const timeoutMs = 6000;
      const text = await Promise.race([
        apiService.generateMessage(fullPrompt, system),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout')), timeoutMs)
        ),
      ]);
      return normalizeAssistantText(String(text));
    } catch (err: unknown) {
      if (isAuthError(err)) {
        handleSessionExpired();
      }
      return '';
    } finally {
      endUiBusy(busyToken);
    }
  }, [beginUiBusy, chatMessages, endUiBusy, handleSessionExpired, isAuthError, settings.language]);

  const extractWithRetry = useCallback(async (message: string, schemaPayload: Record<string, unknown>) => {
    const busyToken = beginUiBusy('extracting_schema');
    const timeoutMs = 10000;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await Promise.race([
            apiService.extractSchema(message, schemaPayload),
            new Promise<ReturnType<typeof apiService.extractSchema>>((_, reject) =>
              setTimeout(() => reject(new Error('Extract timeout')), timeoutMs)
            ),
          ]);
          return result;
        } catch (err: unknown) {
          if (isAuthError(err)) {
            handleSessionExpired();
            throw err;
          }
          if (attempt === 1) {
            throw err;
          }
        }
      }
      throw new Error('Extract failed');
    } finally {
      endUiBusy(busyToken);
    }
  }, [beginUiBusy, endUiBusy, handleSessionExpired, isAuthError]);

  const addSystemMessage = useCallback((
    content: string,
    options?: ChatMessage['options'],
    mode: 'replace_previous_system' | 'append' = 'replace_previous_system'
  ) => {
    messageIdCounterRef.current += 1;
    const baseTs = Date.now();
    const cleanedContent = normalizeAssistantText(content);
    const message: ChatMessage = {
      id: `sys-${baseTs}-${messageIdCounterRef.current}`,
      type: 'system',
      content: cleanedContent,
      timestamp: baseTs,
      options,
    };
    setChatMessages((prev) => {
      const next =
        mode === 'replace_previous_system' && prev.length > 0 && prev[prev.length - 1]?.type === 'system'
          ? [...prev.slice(0, -1), message]
          : [...prev, message];
      if (next.length <= MAX_CHAT_MESSAGES) return next;
      return next.slice(-MAX_CHAT_MESSAGES);
    });
  }, []);

  const addUserMessage = useCallback((content: string, options?: { dedupe?: boolean }) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setChatMessages((prev) => {
      if (options?.dedupe) {
        const alreadyExists = prev.some(
          (msg) => msg.type === 'user' && msg.content.trim() === trimmed
        );
        if (alreadyExists) return prev;
      }
      messageIdCounterRef.current += 1;
      const baseTs = Date.now();
      const next = [
        ...prev,
        {
          id: `user-${baseTs}-${messageIdCounterRef.current}`,
          type: 'user' as const,
          content: trimmed,
          timestamp: baseTs,
        },
      ];
      if (next.length <= MAX_CHAT_MESSAGES) return next;
      return next.slice(-MAX_CHAT_MESSAGES);
    });
  }, []);

  useEffect(() => {
    if (!requestedSimulationId) return;
    if (simulation.simulationId && simulation.simulationId !== requestedSimulationId) return;
    if (loadedFromQueryRef.current === requestedSimulationId) return;
    loadedFromQueryRef.current = requestedSimulationId;
    setAutoStartPending(false);
    simulation.loadSimulation(requestedSimulationId).catch((err: unknown) => {
      if (isAuthError(err)) {
        handleSessionExpired();
        return;
      }
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تحميل جلسة المحاكاة.${msg}`.trim()
          : `Failed to load simulation session.${msg}`.trim()
      );
    });
  }, [
    addSystemMessage,
    handleSessionExpired,
    isAuthError,
    requestedSimulationId,
    settings.language,
    simulation.loadSimulation,
    simulation.simulationId,
  ]);

  useEffect(() => {
    const simulationId = simulation.simulationId?.trim();
    if (!simulationId) return;
    if (requestedSimulationId === simulationId) return;
    const next = new URLSearchParams(searchParams);
    next.set('simulation_id', simulationId);
    setSearchParams(next, { replace: true });
  }, [requestedSimulationId, searchParams, setSearchParams, simulation.simulationId]);

  useEffect(() => {
    const simulationId = simulation.simulationId?.trim();
    if (!simulationId) return;
    if (!simulation.chatEvents || simulation.chatEvents.length === 0) return;
    const mappedMessages: ChatMessage[] = simulation.chatEvents
      .map((event) => {
        const meta = (event.meta && typeof event.meta === 'object') ? event.meta as Record<string, unknown> : {};
        const optionMeta = meta.options;
        const options = optionMeta && typeof optionMeta === 'object'
          ? optionMeta as ChatMessage['options']
          : undefined;
        const sanitizedOptions = options?.field === 'clarification_choice'
          ? undefined
          : options;
        return {
          id: event.messageId || `chat-${event.eventSeq}`,
          type: event.role === 'user' ? 'user' : 'system',
          content: event.content || '',
          timestamp: event.timestamp || Date.now(),
          options: sanitizedOptions,
        } satisfies ChatMessage;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    setChatMessages(mappedMessages.slice(-MAX_CHAT_MESSAGES));
    const keys = persistedChatKeysRef.current;
    mappedMessages.forEach((message) => {
      keys.add(`${simulationId}:${message.id}`);
    });
  }, [simulation.chatEvents, simulation.simulationId]);

  useEffect(() => {
    const errorText = String(simulation.error || '').toLowerCase();
    if (!errorText) return;
    if (!errorText.includes('session expired') && !errorText.includes('unauthorized')) return;
    handleSessionExpired();
  }, [handleSessionExpired, simulation.error]);

  useEffect(() => {
    const simulationId = simulation.simulationId?.trim();
    if (!simulationId) return;
    if (persistChatBusyRef.current) return;
    let cancelled = false;
    const persistPending = async () => {
      if (persistChatBusyRef.current) return;
      persistChatBusyRef.current = true;
      try {
        for (const message of chatMessages) {
          if (cancelled) return;
          const key = `${simulationId}:${message.id}`;
          if (persistedChatKeysRef.current.has(key)) continue;
          persistedChatKeysRef.current.add(key);
          const role = message.type === 'user'
            ? 'user'
            : message.type === 'agent'
              ? 'status'
              : 'system';
          try {
            await apiService.appendSimulationChatEvent({
              simulation_id: simulationId,
              role,
              content: message.content,
              message_id: message.id,
              meta: {
                ui_type: message.type,
                options: message.options ?? null,
              },
            });
          } catch {
            persistedChatKeysRef.current.delete(key);
          }
        }
      } finally {
        persistChatBusyRef.current = false;
      }
    };
    void persistPending();
    return () => {
      cancelled = true;
    };
  }, [chatMessages, simulation.simulationId]);

  useEffect(() => {
    if (!simulation.summary) return;
    if (simulation.summary === summaryRef.current) return;
    addSystemMessage(simulation.summary, undefined, 'append');
    const arMatch = simulation.summary.split('صياغة إقناع الرافضين:')[1];
    const enMatch = simulation.summary.split('Advice to persuade rejecters:')[1];
    const advice = (arMatch || enMatch || '').trim();
    const reasonKeywords = settings.language === 'ar'
      ? ['خطر', 'قلق', 'رفض', 'غير واضح', 'غير حاسم', 'امتثال', 'ثقة', 'خصوصية', 'تكلفة', 'منافس']
      : ['risk', 'concern', 'reject', 'unclear', 'inconclusive', 'compliance', 'trust', 'privacy', 'cost', 'competition'];
    const sentences = simulation.summary
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const reasons = sentences.filter((s) => reasonKeywords.some((k) => s.toLowerCase().includes(k)));
    const acceptancePct = simulation.metrics.totalAgents > 0
      ? ((simulation.metrics.accepted / simulation.metrics.totalAgents) * 100)
      : 0;
    const recommendation = acceptancePct >= 60
      ? (settings.language === 'ar' ? 'التوصية: انطلق بالفكرة للسوق.' : 'Recommendation: bring this idea to market.')
      : (settings.language === 'ar' ? 'التوصية: حسّن الفكرة أولاً لتصبح مقبولة.' : 'Recommendation: make the idea acceptable first.');
    const statsLine = settings.language === 'ar'
      ? `النتيجة النهائية: قبول ${simulation.metrics.accepted} | رفض ${simulation.metrics.rejected} | محايد ${simulation.metrics.neutral} | نسبة القبول ${acceptancePct.toFixed(0)}%.`
      : `Final outcome: accepted ${simulation.metrics.accepted} | rejected ${simulation.metrics.rejected} | neutral ${simulation.metrics.neutral} | acceptance ${acceptancePct.toFixed(0)}%.`;
    addSystemMessage(`${statsLine}\n${recommendation}`, undefined, 'append');
    const actionPlan = settings.language === 'ar'
      ? acceptancePct >= 60
        ? [
            'خطوات التنفيذ: 1) أطلق Pilot مدفوع صغير خلال 30 يومًا.',
            'خطوات التحقق: 2) راقب KPI أساسي (تحويل/احتفاظ/تكلفة اكتساب).',
            'خطوات تحقيق الدخل: 3) ثبّت نموذج التسعير ثم وسّع السوق تدريجيًا.',
          ]
        : [
            'خطوات التحسين: 1) عالج سببَي الرفض الأعلى أولًا.',
            'خطوات التحقق: 2) اختبر فرضية القيمة مع عينة مستخدمين واضحة.',
            'خطوات تحقيق الدخل: 3) عدّل التسعير/النموذج الربحي قبل التوسع.',
          ]
      : acceptancePct >= 60
      ? [
          'Execution: 1) launch a paid pilot within 30 days.',
          'Validation: 2) track one core KPI (conversion/retention/CAC).',
          'Monetization: 3) lock pricing, then scale distribution gradually.',
        ]
      : [
          'Improve: 1) fix the top two rejection reasons first.',
          'Validate: 2) test your core value hypothesis with a clear target sample.',
          'Monetize: 3) revise pricing/revenue model before scaling.',
        ];
    addSystemMessage(actionPlan.join('\n'), undefined, 'append');
    if (reasons.length) {
      const reasonsText = settings.language === 'ar'
        ? `أبرز أسباب القرار:\n- ${reasons.slice(0, 4).join('\n- ')}`
        : `Top decision reasons:\n- ${reasons.slice(0, 4).join('\n- ')}`;
      addSystemMessage(reasonsText, undefined, 'append');
    }
    if (advice) {
      addSystemMessage(
        settings.language === 'ar'
          ? `نصيحة لتحسين الإقناع:\n${advice}`
          : `Advice to improve persuasiveness:\n${advice}`,
        undefined,
        'append'
      );
    }
    summaryRef.current = simulation.summary;
  }, [simulation.metrics.accepted, simulation.metrics.neutral, simulation.metrics.rejected, simulation.metrics.totalAgents, simulation.summary, addSystemMessage, settings.language]);

  useEffect(() => {
    const last = simulation.reasoningFeed.at(-1);
    if (!last) return;
    if (simulation.status !== 'running') return;
    setReasoningActive(true);
    if (reasoningTimerRef.current) {
      window.clearTimeout(reasoningTimerRef.current);
    }
    reasoningTimerRef.current = window.setTimeout(() => {
      setReasoningActive(false);
    }, 2200);
  }, [simulation.reasoningFeed, simulation.status]);

  useEffect(() => {
    if (simulation.status !== 'running') return;
    if (!simulation.reasoningFeed.length) return;

    const iteration = simulation.metrics.currentIteration || 0;
    const phaseKey = String(simulation.currentPhaseKey || '').trim();

    const phaseLabelAr: Record<string, string> = {
      intake: 'الآراء الفردية',
      search_bootstrap: 'الآراء الفردية',
      evidence_map: 'الآراء الفردية',
      research_digest: 'الآراء الفردية',
      agent_init: 'الآراء الفردية',
      debate: 'النقاش',
      deliberation: 'النقاش',
      convergence: 'تقليل الحياد',
      resolution: 'التقارب النهائي',
      verdict: 'التقارب النهائي',
      summary: 'التقارب النهائي',
      completed: 'التقارب النهائي',
    };
    const phaseLabelEn: Record<string, string> = {
      intake: 'Individual Opinions',
      search_bootstrap: 'Individual Opinions',
      evidence_map: 'Individual Opinions',
      research_digest: 'Individual Opinions',
      agent_init: 'Individual Opinions',
      debate: 'Discussion',
      deliberation: 'Discussion',
      convergence: 'Neutrality Reduction',
      resolution: 'Final Convergence',
      verdict: 'Final Convergence',
      summary: 'Final Convergence',
      completed: 'Final Convergence',
    };
    const phaseLabel = settings.language === 'ar'
      ? (phaseLabelAr[phaseKey] || phaseKey || 'مرحلة')
      : (phaseLabelEn[phaseKey] || phaseKey || 'Phase');

    if (iteration > 0 && iteration !== lastIterationMarkerRef.current) {
      const iterMarker = settings.language === 'ar'
        ? `التكرار ${iteration} - ${phaseLabel}`
        : `Iteration ${iteration} - ${phaseLabel}`;
      addSystemMessage(iterMarker, undefined, 'append');
      lastIterationMarkerRef.current = iteration;
      lastPhaseMarkerRef.current = phaseKey || null;
      return;
    }

    if (phaseKey && phaseKey !== lastPhaseMarkerRef.current) {
      const phaseMarker = settings.language === 'ar'
        ? `المرحلة الحالية: ${phaseLabel}`
        : `Current phase: ${phaseLabel}`;
      addSystemMessage(phaseMarker, undefined, 'append');
      lastPhaseMarkerRef.current = phaseKey;
    }
  }, [
    addSystemMessage,
    settings.language,
    simulation.currentPhaseKey,
    simulation.metrics.currentIteration,
    simulation.reasoningFeed,
    simulation.status,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('appSettings');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.autoFocusInput === 'boolean') {
        setAutoFocusInput(parsed.autoFocusInput);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const routeState = location.state as { idea?: string; autoStart?: boolean } | null;
    const canUseRouteState = !consumedRouteStartRef.current;
    const routeIdea = canUseRouteState && typeof routeState?.idea === 'string'
      ? routeState.idea.trim()
      : '';
    const routeAutoStart = Boolean(canUseRouteState && routeState?.autoStart && routeIdea);
    if (routeIdea || routeAutoStart) {
      consumedRouteStartRef.current = true;
    }

    const pendingIdea = (localStorage.getItem('pendingIdea') || '').trim();
    const dashboardIdea = (localStorage.getItem('dashboardIdea') || '').trim();
    const pendingAutoStart = localStorage.getItem('pendingAutoStart');
    const hasNewRunIntent = Boolean(routeAutoStart || pendingAutoStart || pendingIdea);
    if (requestedSimulationId && !hasNewRunIntent) return;
    if (requestedSimulationId && hasNewRunIntent) {
      const next = new URLSearchParams(searchParams);
      next.delete('simulation_id');
      setSearchParams(next, { replace: true });
    }
    const nextIdea = routeIdea || pendingIdea || ((routeAutoStart || pendingAutoStart) ? dashboardIdea : '');
    if (nextIdea) {
      setUserInput((prev) => ({ ...prev, idea: nextIdea }));
    }
    if (pendingIdea) localStorage.removeItem('pendingIdea');
    if (routeAutoStart || pendingAutoStart) {
      setAutoStartPending(true);
    }
    if (pendingAutoStart) {
      localStorage.removeItem('pendingAutoStart');
    }
  }, [location.state, requestedSimulationId, searchParams, setSearchParams]);

  useEffect(() => {
    const trimmedIdea = userInput.idea.trim();
    const hasResearch =
      Boolean(researchContext.summary)
      || researchContext.sources.length > 0
      || Boolean(researchContext.structured);
    if (!trimmedIdea) {
      if (researchIdea || hasResearch || searchState.status !== 'idle') {
        setResearchIdea('');
        setResearchContext({ summary: '', sources: [], structured: undefined });
        setSearchState({ status: 'idle' });
        setPendingResearchReview(false);
      }
      return;
    }
    if (researchIdea && trimmedIdea !== researchIdea) {
      setResearchContext({ summary: '', sources: [], structured: undefined });
      if (searchState.status !== 'idle') {
        setSearchState({ status: 'idle' });
      }
      setPendingResearchReview(false);
    }
  }, [
    userInput.idea,
    researchIdea,
    researchContext.summary,
    researchContext.sources.length,
    researchContext.structured,
    searchState.status,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('appSettings');
      const parsed = saved ? JSON.parse(saved) : {};
      window.localStorage.setItem('appSettings', JSON.stringify({
        ...parsed,
        autoFocusInput,
      }));
    } catch {
      // ignore
    }
  }, [autoFocusInput]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  const computePreflightKey = useCallback((input: UserInput) => JSON.stringify({
    idea: input.idea.trim(),
    category: input.category || DEFAULT_CATEGORY,
    targetAudience: [...input.targetAudience].sort(),
    country: input.country.trim(),
    city: input.city.trim(),
    riskAppetite: Math.max(0, Math.min(100, input.riskAppetite ?? 50)),
    ideaMaturity: input.ideaMaturity || 'concept',
    goals: [...input.goals].sort(),
    language: settings.language,
  }), [settings.language]);

  const preflightContextKey = useMemo(() => computePreflightKey(userInput), [computePreflightKey, userInput]);
  const researchGateKey = useMemo(() => JSON.stringify({
    idea: userInput.idea.trim(),
    category: userInput.category || DEFAULT_CATEGORY,
    targetAudience: [...userInput.targetAudience].sort(),
    goals: [...userInput.goals].sort(),
    country: userInput.country.trim(),
    city: userInput.city.trim(),
    language: settings.language,
  }), [settings.language, userInput]);
  const startChoiceKey = useMemo(
    () => `${preflightContextKey}|${researchGateKey}|${(userInput.agentCount ?? 20)}`,
    [preflightContextKey, researchGateKey, userInput.agentCount],
  );

  useEffect(() => {
    if (preflightResolvedKeyRef.current === preflightContextKey) return;
    preflightStartPayloadRef.current = null;
    preflightConfirmedKeyRef.current = '';
    setPendingPreflightQuestion(null);
    setPendingIdeaConfirmation(null);
    setPreflightRound(0);
    setPreflightMaxRounds(3);
    setPreflightClarityScore(0);
    setPreflightMissingAxes([]);
    setPreflightHistory([]);
    setUnderstandingQueue([]);
    setUnderstandingAnswers([]);
    setPreflightNormalizedContext(null);
    setPreflightSummary('');
    understandingAttemptRef.current = '';
  }, [preflightContextKey]);

  useEffect(() => {
    if (!lastResearchGateKeyRef.current) {
      lastResearchGateKeyRef.current = researchGateKey;
      return;
    }
    if (lastResearchGateKeyRef.current === researchGateKey) return;
    lastResearchGateKeyRef.current = researchGateKey;
    researchReviewedKeyRef.current = '';
    setPendingResearchReview(false);
  }, [researchGateKey]);

  useEffect(() => {
    if (startChoiceResolvedKeyRef.current === startChoiceKey) return;
    setStartChoiceModalOpen(false);
    setSelectedStartPath(null);
    setShowSocietyBuilder(false);
  }, [startChoiceKey]);

  useEffect(() => {
    if (!startChoiceModalOpen || societyCatalog) return;
    let active = true;
    apiService.getSocietyCatalog()
      .then((catalog) => {
        if (!active) return;
        setSocietyCatalog(catalog);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [societyCatalog, startChoiceModalOpen]);

  const mapPreflightQuestion = useCallback((question: SimulationPreflightNextResponse['question'] | Record<string, unknown> | null): PreflightQuestion | null => {
    if (!question || typeof question !== 'object') return null;
    const normalized = question as Record<string, unknown>;
    const questionId = String(normalized.question_id || normalized.id || '').trim();
    const text = String(normalized.question || '').trim();
    if (!questionId || !text) return null;
    const options = Array.isArray(normalized.options)
      ? normalized.options
          .map((item, idx) => {
            if (!item || typeof item !== 'object') return null;
            const raw = item as Record<string, unknown>;
            const id = String(raw.id || `opt_${idx + 1}`).trim();
            const label = String(raw.label || '').trim();
            if (!id || !label) return null;
            return { id, label };
          })
          .filter((item): item is { id: string; label: string } => Boolean(item))
          .slice(0, 3)
      : [];
    if (options.length < 3) return null;
    const questionQuality = normalized.question_quality && typeof normalized.question_quality === 'object'
      ? normalized.question_quality as Record<string, unknown>
      : null;
    return {
      questionId,
      axis: String(normalized.axis || '').trim() || 'decision_axis',
      question: text,
      options,
      reasonSummary: normalized.reason_summary ? String(normalized.reason_summary).trim() : undefined,
      required: true,
      questionQuality: questionQuality
        ? {
            score: typeof questionQuality.score === 'number' ? questionQuality.score : undefined,
            checksPassed: Array.isArray(questionQuality.checks_passed)
              ? questionQuality.checks_passed.map((item: unknown) => String(item || '').trim()).filter(Boolean)
              : undefined,
          }
        : null,
    };
  }, []);

  const buildPreflightDraftContext = useCallback((input: UserInput) => ({
    idea: input.idea.trim(),
    country: input.country.trim(),
    city: input.city.trim(),
    category: input.category || DEFAULT_CATEGORY,
    target_audience: input.targetAudience,
    goals: input.goals,
    idea_maturity: input.ideaMaturity || 'concept',
    risk_appetite: Math.max(0, Math.min(100, input.riskAppetite ?? 50)) / 100,
    preflight_axis_answers: (
      preflightNormalizedContext
      && typeof preflightNormalizedContext.preflight_axis_answers === 'object'
      && preflightNormalizedContext.preflight_axis_answers
    )
      ? (preflightNormalizedContext.preflight_axis_answers as Record<string, string>)
      : {},
  }), [preflightNormalizedContext]);

  const runPreflightGate = useCallback(async (answer?: {
    questionId: string;
    selectedOptionId?: string;
    customText?: string;
  }, inputOverride?: UserInput): Promise<boolean> => {
    const draftInput = inputOverride || userInput;
    const draftKey = computePreflightKey(draftInput);
    if (preflightResolvedKeyRef.current === draftKey && preflightStartPayloadRef.current && preflightConfirmedKeyRef.current === draftKey) {
      return true;
    }
    if (!answer && pendingPreflightQuestion) return false;
    if (preflightBusy) return false;

    setPreflightBusy(true);
    try {
      const draftContext = buildPreflightDraftContext(draftInput);
      if (!answer) {
        preflightStartPayloadRef.current = null;
        preflightResolvedKeyRef.current = '';
        preflightConfirmedKeyRef.current = '';
        setPendingIdeaConfirmation(null);
        understandingAttemptRef.current = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const analysis = await apiService.analyzeIdeaUnderstanding({
          idea: draftContext.idea,
          attempt_id: understandingAttemptRef.current,
          context: {
            category: draftContext.category,
            target_audience: draftContext.target_audience,
            goals: draftContext.goals,
            country: draftContext.country,
            city: draftContext.city,
            idea_maturity: draftContext.idea_maturity,
            risk_appetite: draftContext.risk_appetite,
            language: settings.language,
          },
        });
        setPreflightRound(analysis.clear_enough ? 0 : 1);
        setPreflightMaxRounds(Math.max(1, (analysis.questions || []).length || 1));
        setPreflightClarityScore(Number(analysis.clarity_score || 0));
        setPreflightMissingAxes(Array.isArray(analysis.missing_axes) ? analysis.missing_axes.map((item) => String(item || '').trim()) : []);
        setPreflightNormalizedContext(draftContext);
        if (analysis.clear_enough) {
          const payload = {
            preflight_ready: true,
            preflight_summary: String(analysis.summary || '').trim(),
            preferred_idea_description: String(analysis.preferred_idea_description || analysis.summary || '').trim(),
            preflight_answers: {},
            preflight_clarity_score: Number(analysis.clarity_score || 0),
            preflight_assumptions: [],
          };
          preflightStartPayloadRef.current = payload;
          preflightResolvedKeyRef.current = draftKey;
          preflightConfirmedKeyRef.current = '';
          setPendingPreflightQuestion(null);
          setPendingIdeaConfirmation({
            description: payload.preferred_idea_description || payload.preflight_summary,
            summary: payload.preflight_summary,
            clarityScore: payload.preflight_clarity_score,
          });
          return false;
        }
        const mappedQuestions = (analysis.questions || [])
          .map((question) => mapPreflightQuestion(question as Record<string, unknown>))
          .filter((question): question is PreflightQuestion => Boolean(question));
        if (!mappedQuestions.length) {
          addSystemMessage(
            settings.language === 'ar'
              ? 'تعذر توليد أسئلة توضيح مناسبة. حاول مرة أخرى.'
              : 'Unable to generate valid clarification questions. Please try again.'
          );
          return false;
        }
        setUnderstandingAnswers([]);
        setUnderstandingQueue(mappedQuestions.slice(1));
        setPendingPreflightQuestion(mappedQuestions[0]);
        setPendingIdeaConfirmation(null);
        return false;
      }

      const currentAnswer = {
        questionId: answer.questionId,
        axis: pendingPreflightQuestion?.axis || 'decision_axis',
        selectedOptionId: answer.selectedOptionId,
        customText: answer.customText,
      };
      const accumulatedAnswers = [...understandingAnswers, currentAnswer];
      if (understandingQueue.length > 0) {
        const [nextQuestion, ...restQueue] = understandingQueue;
        setUnderstandingAnswers(accumulatedAnswers);
        setUnderstandingQueue(restQueue);
        setPendingPreflightQuestion(nextQuestion);
        setPreflightRound((prev) => Math.max(prev + 1, accumulatedAnswers.length + 1));
        return false;
      }

      const submit = await apiService.submitIdeaUnderstanding({
        draft_context: draftContext,
        answers: accumulatedAnswers.map((item) => ({
          question_id: item.questionId,
          axis: item.axis,
          selected_option_id: item.selectedOptionId,
          selected_option_ids: item.selectedOptionId ? [item.selectedOptionId] : undefined,
          custom_text: item.customText,
        })),
        language: settings.language,
      });
      const payload = {
        preflight_ready: true,
        preflight_summary: String(submit.summary || '').trim(),
        preferred_idea_description: String(submit.preferred_idea_description || submit.summary || '').trim(),
        preflight_answers: (submit.preflight_answers && typeof submit.preflight_answers === 'object')
          ? submit.preflight_answers
          : {},
        preflight_clarity_score: Number(submit.preflight_clarity_score || 0),
        preflight_assumptions: Array.isArray(submit.assumptions)
          ? submit.assumptions.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
      };
      preflightStartPayloadRef.current = payload;
      preflightResolvedKeyRef.current = draftKey;
      preflightConfirmedKeyRef.current = '';
      setPreflightSummary(payload.preflight_summary);
      setUnderstandingQueue([]);
      setUnderstandingAnswers([]);
      setPendingPreflightQuestion(null);
      setPendingIdeaConfirmation({
        description: payload.preferred_idea_description || payload.preflight_summary,
        summary: payload.preflight_summary,
        clarityScore: payload.preflight_clarity_score,
      });
      setPreflightMissingAxes(Array.isArray(submit.missing_axes) ? submit.missing_axes.map((item) => String(item || '').trim()) : []);
      setPreflightClarityScore(payload.preflight_clarity_score);
      setPreflightHistory([
        ...accumulatedAnswers.map((item) => ({
          question_id: item.questionId,
          axis: item.axis,
          answer: item.customText || item.selectedOptionId || '',
        })),
      ]);
      return false;
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تشغيل مرحلة التوضيح قبل البدء.${msg}`.trim()
          : `Pre-start clarification failed.${msg}`.trim()
      );
      return false;
    } finally {
      setPreflightBusy(false);
    }
  }, [
    addSystemMessage,
    buildPreflightDraftContext,
    computePreflightKey,
    mapPreflightQuestion,
    pendingPreflightQuestion,
    preflightBusy,
    understandingAnswers,
    understandingQueue,
    settings.language,
    userInput,
  ]);

  const buildConfig = useCallback((input: UserInput) => {
    const trimmedIdea = input.idea.trim();
    const hasMatchingResearch = Boolean(trimmedIdea && researchIdea && researchIdea === trimmedIdea);
    const researchSummary = hasMatchingResearch ? researchContext.summary : '';
    const researchSources = hasMatchingResearch ? researchContext.sources : [];
    const researchStructured = hasMatchingResearch ? researchContext.structured : undefined;
    const preflightPayload = preflightResolvedKeyRef.current === preflightContextKey
      ? preflightStartPayloadRef.current
      : null;
    const payload: SimulationConfig = {
      idea: trimmedIdea,
      category: input.category || DEFAULT_CATEGORY,
      targetAudience: input.targetAudience,
      country: input.country.trim(),
      city: input.city.trim(),
      riskAppetite: (input.riskAppetite ?? 50) / 100,
      ideaMaturity: input.ideaMaturity ?? 'concept',
      goals: input.goals,
      research_summary: researchSummary,
      research_sources: researchSources,
      research_structured: researchStructured,
      language: settings.language,
      speed: simulationSpeed,
      agentCount: input.agentCount,
      society_mode: selectedStartPath === 'custom_build' ? 'custom' : 'default',
      start_path: selectedStartPath === 'custom_build' ? 'build_custom' : 'start_default',
      society_custom_spec: selectedStartPath === 'custom_build'
        ? {
            profile_name: settings.language === 'ar' ? 'مجتمع مخصص' : 'Custom society',
            agent_count: input.agentCount ?? 20,
            distribution: {
              skeptic_ratio: Math.max(0, Math.min(100, societyControls.skepticRatio)),
              optimist_ratio: Math.max(0, Math.min(100, 100 - societyControls.skepticRatio)),
              pragmatic_ratio: Math.max(0, Math.min(100, societyControls.diversity)),
              policy_guard_ratio: Math.max(0, Math.min(100, societyControls.strictPolicy ? 35 : 15)),
            },
            controls: {
              diversity: societyControls.diversity,
              innovation_bias: societyControls.innovationBias,
              risk_sensitivity: 100 - Math.max(0, Math.min(100, input.riskAppetite ?? 50)),
              strict_policy: societyControls.strictPolicy,
              human_debate_style: societyControls.humanDebate,
              persona_hint: societyControls.personaHint.trim(),
            },
          }
        : undefined,
      seed_context: {
        society_mode: selectedStartPath === 'custom_build' ? 'custom' : 'default',
        society_controls: selectedStartPath === 'custom_build'
          ? {
              diversity: societyControls.diversity,
              skeptic_ratio: societyControls.skepticRatio,
              innovation_bias: societyControls.innovationBias,
              strict_policy: societyControls.strictPolicy,
              human_debate: societyControls.humanDebate,
              persona_hint: societyControls.personaHint.trim(),
            }
          : {},
      },
    };
    if (preflightPayload) {
      payload.preflight_ready = preflightPayload.preflight_ready;
      payload.preflight_summary = preflightPayload.preflight_summary;
      payload.preflight_answers = preflightPayload.preflight_answers;
      payload.preflight_clarity_score = preflightPayload.preflight_clarity_score;
      payload.preflight_assumptions = preflightPayload.preflight_assumptions;
    }
    return payload;
  }, [preflightContextKey, researchContext, researchIdea, settings.language, simulationSpeed, selectedStartPath, societyControls]);

  const buildGuidedSimulationConfig = useCallback((input: UserInput) => {
    const config = buildConfig(input);
    const workflowDraft = guidedWorkflowState?.draft_context;
    const review = guidedWorkflowState?.review;
    const ideaResearch = guidedWorkflowState?.idea_research;
    const locationResearch = guidedWorkflowState?.location_research;
    const personaSnapshot = guidedWorkflowState?.persona_snapshot;
    config.research_summary = review?.summary || ideaResearch?.summary || config.research_summary;
    config.research_sources = (ideaResearch?.sources || config.research_sources || []) as SearchResponse['results'];
    config.preflight_ready = true;
    config.preflight_summary = review?.summary || config.preflight_summary || config.research_summary || input.idea;
    config.preflight_answers = {
      context_scope: workflowDraft?.contextScope || guidedContextScope,
      value_promise: workflowDraft?.valuePromise || null,
      adoption_trigger: workflowDraft?.adoptionTrigger || null,
    };
    config.preflight_clarity_score = 1;
    config.preflight_assumptions = [];
    config.seed_context = {
      ...(config.seed_context || {}),
      guided_workflow: {
        workflow_id: guidedWorkflowState?.workflow_id || null,
        context_scope: workflowDraft?.contextScope || guidedContextScope,
        place_name: workflowDraft?.placeName || input.city || input.country || '',
        review_summary: review?.summary || '',
        location_summary: locationResearch?.summary || '',
        persona_snapshot: personaSnapshot || null,
        corrections: guidedWorkflowState?.corrections || [],
      },
    };
    return config;
  }, [buildConfig, guidedContextScope, guidedWorkflowState]);

  const applyCoachContextPatch = useCallback((baseInput: UserInput, patch: Record<string, unknown>) => {
    const nextInput: UserInput = { ...baseInput };
    let nextLocationChoice = locationChoice;
    let nextContextScope = guidedContextScope;

    const readString = (...values: unknown[]) => {
      for (const value of values) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return '';
    };

    const patchedIdea = readString(patch.idea);
    if (patchedIdea) nextInput.idea = patchedIdea;

    const patchedCategory = normalizeCategoryValue(readString(patch.category));
    if (patchedCategory) nextInput.category = patchedCategory;

    const patchedCity = readString(patch.city);
    const patchedCountry = readString(patch.country);
    const patchedPlace = readString(patch.placeName, patch.place_name, patch.place);
    if (patchedCity || patchedCountry || patchedPlace) {
      nextInput.city = patchedCity || (!patchedCountry && patchedPlace ? patchedPlace : nextInput.city);
      nextInput.country = patchedCountry || nextInput.country;
      nextLocationChoice = 'yes';
      nextContextScope = 'specific_place';
    }

    const patchedAudience = normalizeOptionList(
      patch.targetAudience ?? patch.target_audience ?? patch.target_segment,
      AUDIENCE_OPTIONS,
    );
    if (patchedAudience.length) nextInput.targetAudience = patchedAudience;

    const patchedGoals = normalizeOptionList(patch.goals, GOAL_OPTIONS);
    if (patchedGoals.length) nextInput.goals = patchedGoals;

    const patchedRisk = normalizeRiskValue(
      typeof patch.riskAppetite === 'number'
        ? patch.riskAppetite
        : (typeof patch.risk_appetite === 'number' ? patch.risk_appetite : undefined),
    );
    if (typeof patchedRisk === 'number') nextInput.riskAppetite = patchedRisk;

    const patchedMaturity = normalizeMaturityValue(
      readString(patch.ideaMaturity, patch.idea_maturity),
    );
    if (patchedMaturity) nextInput.ideaMaturity = patchedMaturity;

    const patchedScope = readString(patch.contextScope, patch.context_scope, patch.location_scope);
    if (patchedScope === 'specific_place' || patchedScope === 'internet' || patchedScope === 'global') {
      nextContextScope = patchedScope;
      nextLocationChoice = patchedScope === 'specific_place' ? 'yes' : 'no';
    }

    return {
      nextInput,
      nextLocationChoice,
      nextContextScope,
      };
    }, [guidedContextScope, locationChoice]);

  const buildUserInputFromSimulationContext = useCallback((context: Record<string, unknown>): UserInput => {
    const readString = (...values: unknown[]) => {
      for (const value of values) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return '';
    };

    const readList = (...values: unknown[]) => {
      for (const value of values) {
        if (Array.isArray(value)) {
          const cleaned = value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
          if (cleaned.length) return cleaned;
        }
      }
      return [] as string[];
    };

    const audience = normalizeOptionList(
      readList(context.targetAudience, context.target_audience),
      AUDIENCE_OPTIONS,
    );
    const goals = normalizeOptionList(readList(context.goals), GOAL_OPTIONS);

    const rawRisk = typeof context.riskAppetite === 'number'
      ? context.riskAppetite
      : (typeof context.risk_appetite === 'number' ? context.risk_appetite : undefined);
    const normalizedRisk = typeof rawRisk === 'number'
      ? (rawRisk <= 1 ? Math.round(rawRisk * 100) : Math.round(rawRisk))
      : (userInput.riskAppetite ?? 50);

    const rawAgentCount = typeof context.agentCount === 'number'
      ? context.agentCount
      : (typeof context.agent_count === 'number' ? context.agent_count : undefined);

    return {
      idea: readString(context.idea) || userInput.idea,
      category: normalizeCategoryValue(readString(context.category)) || userInput.category || DEFAULT_CATEGORY,
      targetAudience: audience.length ? audience : userInput.targetAudience,
      country: readString(context.country) || userInput.country,
      city: readString(context.city) || userInput.city,
      riskAppetite: normalizedRisk,
      ideaMaturity: normalizeMaturityValue(readString(context.ideaMaturity, context.idea_maturity)) || userInput.ideaMaturity || 'concept',
      goals: goals.length ? goals : userInput.goals,
      agentCount: typeof rawAgentCount === 'number' && Number.isFinite(rawAgentCount)
        ? Math.max(1, Math.round(rawAgentCount))
        : userInput.agentCount,
    };
  }, [userInput]);

  const handleGuidedDraftChange = useCallback((updates: Partial<GuidedWorkflowDraftContext>) => {
    setUserInput((prev) => ({
      ...prev,
      ...(typeof updates.idea === 'string' ? { idea: updates.idea } : {}),
      ...(typeof updates.category === 'string' ? { category: updates.category } : {}),
      ...(Array.isArray(updates.targetAudience) ? { targetAudience: updates.targetAudience } : {}),
      ...(typeof updates.country === 'string' ? { country: updates.country } : {}),
      ...(typeof updates.city === 'string' ? { city: updates.city } : {}),
      ...(typeof updates.riskAppetite === 'number' ? { riskAppetite: updates.riskAppetite } : {}),
      ...(typeof updates.ideaMaturity === 'string' ? { ideaMaturity: updates.ideaMaturity as UserInput['ideaMaturity'] } : {}),
      ...(Array.isArray(updates.goals) ? { goals: updates.goals } : {}),
    }));
  }, []);

  const handleGuidedChooseScope = useCallback((scope: GuidedWorkflowDraftContext['contextScope']) => {
    setGuidedContextScope(scope);
    setLocationChoice(scope === 'specific_place' ? 'yes' : scope ? 'no' : null);
    void guidedWorkflow.updateContextScope(scope, scope === 'specific_place' ? (userInput.city || userInput.country) : undefined).catch(() => undefined);
  }, [guidedWorkflow, userInput.city, userInput.country]);

  const handleGuidedSubmitSchema = useCallback(async () => {
    await guidedWorkflow.submitSchema({
      ...guidedDraftInput,
      placeName: guidedDraftInput.contextScope === 'specific_place'
        ? (guidedDraftInput.city || guidedDraftInput.country || guidedDraftInput.placeName)
        : '',
    }).catch(() => undefined);
  }, [guidedDraftInput, guidedWorkflow]);

  const handleGuidedSubmitClarifications = useCallback(async (answers: Array<{ questionId: string; answer: string }>) => {
    await guidedWorkflow.answerClarifications(answers).catch(() => undefined);
  }, [guidedWorkflow]);

  const handleGuidedApproveReview = useCallback(async () => {
    await guidedWorkflow.approveReview().catch(() => undefined);
  }, [guidedWorkflow]);

  const handleGuidedPauseWorkflow = useCallback(() => {
    void guidedWorkflow.pause(settings.language === 'ar' ? 'تم إيقاف الـworkflow مؤقتًا بواسطة المستخدم.' : 'Workflow paused by user.').catch(() => undefined);
  }, [guidedWorkflow, settings.language]);

  const handleGuidedResumeWorkflow = useCallback(() => {
    void guidedWorkflow.resume().catch(() => undefined);
  }, [guidedWorkflow]);

  const handleGuidedCorrection = useCallback(async (text: string) => {
    await guidedWorkflow.submitCorrection(text).catch(() => undefined);
  }, [guidedWorkflow]);

  const getMissingForStart = useCallback((input: UserInput, overrideChoice?: 'yes' | 'no' | null) => {
    const missing: string[] = [];
    if (!input.idea.trim()) missing.push('idea');
    const hasLocation = Boolean(input.city.trim() || input.country.trim());
    const choice = overrideChoice ?? locationChoice;
    if (!hasLocation && choice === null) missing.push('location_choice');
    if (choice === 'yes' && !input.city.trim()) missing.push('city');
    if (!input.category) missing.push('category');
    if (!input.targetAudience.length) missing.push('target_audience');
    if (!input.goals.length) missing.push('goals');
    return missing;
  }, [locationChoice]);

  const isCreditsBlocked = useCallback((me?: UserMe | null) => {
    if (!me) return false;
    const remainingTokens = typeof me.daily_tokens_remaining === 'number'
      ? me.daily_tokens_remaining
      : (typeof me.daily_tokens_limit === 'number' && typeof me.daily_tokens_used === 'number'
        ? Math.max(0, me.daily_tokens_limit - me.daily_tokens_used)
        : null);
    if (remainingTokens !== null && remainingTokens > 0) return false;
    return (me.credits ?? 0) <= 0;
  }, []);

  useEffect(() => {
    let active = true;
    const busyToken = beginUiBusy('checking_session');
    apiService.getMe()
      .then((me) => {
        if (!active) return;
        setMeSnapshot(me);
        if (isCreditsBlocked(me)) {
          setCreditNotice(settings.language === 'ar'
            ? 'نفد رصيد التوكنز. اشحن Credits للمتابعة.'
            : 'Token budget exhausted. Add credits to continue.');
        } else {
          setCreditNotice(null);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (isAuthError(err)) {
          handleSessionExpired();
          return;
        }
        setCreditNotice(null);
      })
      .finally(() => {
        if (!active) return;
        endUiBusy(busyToken);
      });
    return () => {
      active = false;
      endUiBusy(busyToken);
    };
  }, [beginUiBusy, endUiBusy, handleSessionExpired, isAuthError, isCreditsBlocked, settings.language]);


  const addOptionsMessage = useCallback((
    field: 'category' | 'audience' | 'goals' | 'maturity',
    intro?: string
  ) => {
    const language = settings.language;
    if (field === 'category') {
      const items = CATEGORY_OPTIONS.map((cat) => ({
        value: cat.toLowerCase(),
        label: cat,
        description: language === 'ar' ? CATEGORY_DESCRIPTIONS[cat]?.ar : CATEGORY_DESCRIPTIONS[cat]?.en,
      }));
      addSystemMessage(intro || (language === 'ar' ? 'اختر الفئة المناسبة لفكرتك:' : 'Pick the closest category:'), {
        field: 'category',
        kind: 'single',
        items,
      });
      return true;
    }
    if (field === 'audience') {
      const items = AUDIENCE_OPTIONS.map((aud) => ({
        value: aud,
        label: language === 'ar' ? aud : aud,
        description: language === 'ar' ? AUDIENCE_DESCRIPTIONS[aud]?.ar : AUDIENCE_DESCRIPTIONS[aud]?.en,
      }));
      addSystemMessage(intro || (language === 'ar' ? 'من الجمهور المستهدف؟ اختر واحدًا أو أكثر:' : 'Who is the target audience? Choose one or more:'), {
        field: 'audience',
        kind: 'multi',
        items,
      });
      return true;
    }
    if (field === 'goals') {
      const items = GOAL_OPTIONS.map((goal) => ({
        value: goal,
        label: language === 'ar' ? goal : goal,
        description: language === 'ar' ? GOAL_DESCRIPTIONS[goal]?.ar : GOAL_DESCRIPTIONS[goal]?.en,
      }));
      addSystemMessage(intro || (language === 'ar' ? 'ما الأهداف الأساسية؟ اختر هدفًا أو أكثر:' : 'Select the primary goal(s):'), {
        field: 'goals',
        kind: 'multi',
        items,
      });
      return true;
    }
    if (field === 'maturity') {
      const items = MATURITY_LEVELS.map((level) => ({
        value: level.value,
        label: language === 'ar'
          ? (MATURITY_DESCRIPTIONS[level.value]?.ar || level.label)
          : level.label,
        description: language === 'ar'
          ? MATURITY_DESCRIPTIONS[level.value]?.ar
          : MATURITY_DESCRIPTIONS[level.value]?.en,
      }));
      addSystemMessage(intro || (language === 'ar' ? 'ما مرحلة نضج الفكرة الحالية؟' : 'What is the current maturity stage?'), {
        field: 'maturity',
        kind: 'single',
        items,
      });
      return true;
    }
    return false;
  }, [addSystemMessage, settings.language]);

  const requestCityIfNeeded = useCallback(async (missing: string[]) => {
    const needsCity = missing.includes('city');
    if (!needsCity) return false;
    const prompt = 'Ask the user for the target city. If helpful, mention they can add the country too. Keep it short and natural.';
    const question = await getAssistantMessage(prompt);
    if (question) {
      addSystemMessage(question);
    } else {
      const fallback = settings.language === 'ar'
        ? 'ما المدينة المستهدفة؟ (يمكنك إضافة الدولة أيضًا)'
        : 'Which city should we focus on? (You can add the country too)';
      addSystemMessage(fallback);
    }
    setIsWaitingForCountry(false);
    setIsWaitingForCity(true);
    setIsWaitingForLocationChoice(false);
    return true;
  }, [addSystemMessage, getAssistantMessage, settings.language]);

  const askLocationChoice = useCallback(() => {
    const question = settings.language === 'ar'
      ? 'هل لديك مكان محدد تريد تنفيذ الفكرة فيه؟'
      : 'Do you have a specific place in mind for this idea?';
    addSystemMessage(question, {
      field: 'location_choice',
      kind: 'single',
      items: [
        { value: 'yes', label: settings.language === 'ar' ? 'نعم' : 'Yes' },
        { value: 'no', label: settings.language === 'ar' ? 'لا' : 'No' },
      ],
    });
    setIsWaitingForCountry(false);
    setIsWaitingForCity(false);
    setIsWaitingForLocationChoice(true);
    return true;
  }, [addSystemMessage, settings.language]);

  const promptForMissing = useCallback(async (missing: string[], question?: string) => {
    setMissingFields(missing.filter((field) => field !== 'location_choice'));
    if (missing.length === 0) return false;

    if (missing.includes('idea')) {
      const prompt = 'Ask the user to describe their idea in one clear sentence.';
      const message = await getAssistantMessage(prompt);
      addSystemMessage(message || (settings.language === 'ar'
        ? 'من فضلك اكتب الفكرة في جملة واحدة واضحة.'
        : 'Please describe the idea in one clear sentence.'));
      return true;
    }

    if (missing.includes('location_choice')) {
      return askLocationChoice();
    }

    const needsCity = missing.includes('city');
    if (needsCity) {
      if (question) {
        addSystemMessage(question);
        setIsWaitingForCountry(false);
        setIsWaitingForCity(true);
        return true;
      }
      const asked = await requestCityIfNeeded(missing);
      return asked;
    }

    if (missing.includes('category')) {
      return addOptionsMessage('category');
    }
    if (missing.includes('target_audience')) {
      return addOptionsMessage('audience');
    }
    if (missing.includes('goals')) {
      return addOptionsMessage('goals');
    }
    if (missing.includes('idea_maturity')) {
      return addOptionsMessage('maturity');
    }
    return false;
  }, [addOptionsMessage, addSystemMessage, askLocationChoice, getAssistantMessage, requestCityIfNeeded, settings.language]);

  const hasRunProgress = simulation.metrics.currentIteration > 0
    || simulation.metrics.totalAgents > 0
    || simulation.reasoningFeed.length > 0;
  const isRunActive = simulation.status === 'running';
  const isRunStarting = uiBusyStage === 'starting_simulation' || (isRunActive && !hasRunProgress);
  const isPrestartSearchActive = searchState.status === 'searching' || isConfigSearching;
  const isConfigLocked = isPrestartSearchActive || isRunStarting || isRunActive;
  const configLockReason = settings.language === 'ar'
    ? 'أوقف المحاكاة أو انتظر الإيقاف المؤقت لتعديل الإعدادات.'
    : 'Pause or stop the simulation to edit settings.';

  const notifyConfigLocked = useCallback(() => {
    const now = Date.now();
    if (now - configLockHintAtRef.current < 2000) return;
    configLockHintAtRef.current = now;
    addSystemMessage(configLockReason);
  }, [addSystemMessage, configLockReason]);

  const notifyActionBlocked = useCallback(() => {
    const now = Date.now();
    if (now - actionGuardHintAtRef.current < 1800) return;
    actionGuardHintAtRef.current = now;
    if (isPrestartSearchActive) {
      addSystemMessage(
        settings.language === 'ar'
          ? 'جاري تحليل المصادر بالفعل. انتظر اكتمال البحث قبل محاولة جديدة.'
          : 'Research is already running. Wait for it to finish before triggering a new action.'
      );
      return;
    }
    addSystemMessage(
      settings.language === 'ar'
        ? 'المحاكاة تعمل الآن. أوقفها أو انتظر الإيقاف المؤقت قبل تنفيذ إجراء جديد.'
        : 'Simulation is currently running. Pause it first before starting another flow.'
    );
  }, [addSystemMessage, isPrestartSearchActive, settings.language]);

  const requestConfigPanel = useCallback((options?: { silent?: boolean }) => {
    if (isConfigLocked) {
      if (!options?.silent) {
        notifyConfigLocked();
      }
      return false;
    }
    setActivePanel('config');
    return true;
  }, [isConfigLocked, notifyConfigLocked]);

  const handleStart = useCallback(async () => {
    if (isPrestartSearchActive || isRunStarting || isRunActive) {
      notifyActionBlocked();
      return;
    }
    const missing = getMissingForStart(userInput);
    const asked = await promptForMissing(missing);
    if (asked) return;

    const preflightReady = await runPreflightGate();
    if (!preflightReady) {
      setActivePanel('chat');
      const waitingIdeaConfirmation = Boolean(
        preflightStartPayloadRef.current
        && preflightConfirmedKeyRef.current !== preflightContextKey
      );
      if (pendingPreflightQuestion) return;
      if (waitingIdeaConfirmation || pendingIdeaConfirmation) {
        addSystemMessage(
          settings.language === 'ar'
            ? 'راجع وصف الفكرة المقترح ثم اضغط تأكيد الوصف قبل بدء التنفيذ.'
            : 'Review the proposed idea description, then confirm it before execution.'
        );
        return;
      }
      addSystemMessage(
        settings.language === 'ar'
          ? 'قبل التشغيل نحتاج توضيح سريع لبعض النقاط الأساسية.'
          : 'Before execution, we need a quick clarification on key decisions.'
      );
      return;
    }

    const ideaQuery = userInput.idea.trim();
    const hasCurrentResearchData = Boolean(
      researchContext.summary
      || researchContext.sources.length > 0
      || researchContext.structured
    );
    const hasSearchForCurrentIdea = (
      searchState.status === 'complete'
      && researchIdea === ideaQuery
      && hasCurrentResearchData
    );
    const researchReviewed = researchReviewedKeyRef.current === researchGateKey;

    if (!researchReviewed) {
      if (!hasSearchForCurrentIdea) {
        const runSearchCurrent = runSearchRef.current;
        if (!runSearchCurrent) return;
        const result = await runSearchCurrent(ideaQuery, SEARCH_TIMEOUT_BASE_MS, { promptOnTimeout: true });
        if (result.status !== 'complete') {
          setActivePanel('chat');
          return;
        }
      }
      if (!pendingResearchReview) {
        setPendingResearchReview(true);
        setActivePanel('chat');
        addSystemMessage(
          settings.language === 'ar'
            ? 'أجريت بحثًا خفيفًا لربط المحاكاة ببيانات واقعية. هل أبدأ المحاكاة الآن بناءً على هذه النتائج؟'
            : 'I ran a light research pass to ground the simulation in real signals. Should I start the simulation now based on these findings?'
        );
      }
      return;
    }

    if (startChoiceResolvedKeyRef.current !== startChoiceKey) {
      setStartChoiceModalOpen(true);
      if (!requestConfigPanel({ silent: true })) {
        notifyConfigLocked();
        return;
      }
      addSystemMessage(
        settings.language === 'ar'
          ? 'اختر طريقة التشغيل: استعراض المجتمع الحالي، بناء مجتمعك، أو البدء بالمجتمع الافتراضي.'
          : 'Choose run mode: inspect current society, build your own, or start with default society.'
      );
      return;
    }

    if (hasStarted || simulation.status === 'running') return;
    if (isCreditsBlocked(meSnapshot)) {
      const msg = settings.language === 'ar'
        ? 'نفد رصيد التوكنز. اشحن Credits للمتابعة.'
        : 'Token budget exhausted. Add credits to continue.';
      setCreditNotice(msg);
      addSystemMessage(msg);
      return;
    }
    if (
      simulation.status === 'completed'
      || simulation.status === 'error'
      || simulation.status === 'paused'
      || simulation.reasoningFeed.length > 0
      || simulation.metrics.currentIteration > 0
    ) {
      simulation.stopSimulation();
    }
    addUserMessage(userInput.idea, { dedupe: true });
    setHasStarted(true);
    setActivePanel('chat');
    setReasoningActive(false);
    if (reasoningTimerRef.current) {
      window.clearTimeout(reasoningTimerRef.current);
    }
    const startBusyToken = beginUiBusy('starting_simulation');
    try {
      addSystemMessage(settings.language === 'ar' ? 'بدء المحاكاة...' : 'Starting simulation...');
      const config = buildConfig(userInput);
      if (selectedStartPath === 'custom_build') {
        try {
          const built = await apiService.buildCustomSociety({
            profile_name: settings.language === 'ar' ? 'مجتمع مخصص' : 'Custom society',
            agent_count: userInput.agentCount ?? 20,
            distribution: {
              skeptic_ratio: Math.max(0, Math.min(100, societyControls.skepticRatio)),
              optimist_ratio: Math.max(0, Math.min(100, 100 - societyControls.skepticRatio)),
              pragmatic_ratio: Math.max(0, Math.min(100, societyControls.diversity)),
              policy_guard_ratio: Math.max(0, Math.min(100, societyControls.strictPolicy ? 35 : 15)),
            },
            controls: {
              diversity: societyControls.diversity,
              innovation_bias: societyControls.innovationBias,
              risk_sensitivity: 100 - Math.max(0, Math.min(100, userInput.riskAppetite ?? 50)),
              strict_policy: societyControls.strictPolicy,
              human_debate_style: societyControls.humanDebate,
              persona_hint: societyControls.personaHint.trim(),
            },
          });
          config.society_profile_id = built.society_profile_id;
        } catch {
          // Custom profile build is best-effort; simulation can still start with inline custom spec.
        }
      }
      await simulation.startSimulation(config, { throwOnError: true });
      researchReviewedKeyRef.current = '';
      setPendingResearchReview(false);
      void apiService.getMe().then((me) => {
        setMeSnapshot(me);
        if (!isCreditsBlocked(me)) {
          setCreditNotice(null);
        }
      }).catch((err: unknown) => {
        if (isAuthError(err)) {
          handleSessionExpired();
        }
      });
    } catch (err: unknown) {
      console.warn('Simulation start failed.', err);
      setReasoningActive(false);
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        try {
          const me = await apiService.getMe();
          setMeSnapshot(me);
          const exhausted = isCreditsBlocked(me);
          addSystemMessage(settings.language === 'ar'
            ? exhausted
              ? 'نفد رصيد التوكنز. اشحن Credits للمتابعة.'
              : 'انتهت الحصة اليومية المجانية من التوكنز. اشحن Credits أو انتظر للغد.'
            : exhausted
              ? 'Token budget exhausted. Add credits to continue.'
              : 'Daily free token quota reached. Add credits or wait until tomorrow.');
          if (exhausted) {
            setCreditNotice(settings.language === 'ar'
              ? 'نفد رصيد التوكنز. اشحن Credits للمتابعة.'
              : 'Token budget exhausted. Add credits to continue.');
          }
        } catch (meErr: unknown) {
          if (isAuthError(meErr)) {
            handleSessionExpired();
            return;
          }
          addSystemMessage(settings.language === 'ar'
            ? 'انتهت الحصة اليومية المجانية من التوكنز. اشحن Credits أو انتظر للغد.'
            : 'Daily free token quota reached. Add credits to continue.');
        }
        return;
      }
      if (isAuthError(err)) {
        handleSessionExpired();
        return;
      }
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(settings.language === 'ar'
        ? `Failed to start simulation.${msg}`.trim()
        : `Failed to start simulation.${msg}`.trim());
    } finally {
      endUiBusy(startBusyToken);
    }
  }, [
    addUserMessage,
    addSystemMessage,
    beginUiBusy,
    buildConfig,
    endUiBusy,
    getMissingForStart,
    hasStarted,
    handleSessionExpired,
    isAuthError,
    isCreditsBlocked,
    isPrestartSearchActive,
    isRunActive,
    isRunStarting,
    meSnapshot,
    notifyActionBlocked,
    notifyConfigLocked,
    pendingIdeaConfirmation,
    pendingPreflightQuestion,
    pendingResearchReview,
    promptForMissing,
    preflightContextKey,
    researchContext.sources.length,
    researchContext.structured,
    researchContext.summary,
    researchGateKey,
    researchIdea,
    runPreflightGate,
    requestConfigPanel,
    searchState.status,
    selectedStartPath,
    settings.language,
    societyControls,
    startChoiceKey,
    simulation,
    userInput,
  ]);

  const handleGuidedStartSimulation = useCallback(async () => {
    if (!guidedWorkflow.canStartSimulation) return;
    if (simulation.status === 'running') return;
    const config = buildGuidedSimulationConfig(userInput);
    setHasStarted(true);
    setDebateInviteVisible(false);
    const startBusyToken = beginUiBusy('starting_simulation');
    guidedWorkflowStartingSimulationRef.current = true;
    try {
      addSystemMessage(settings.language === 'ar' ? 'Starting guided simulation...' : 'Starting guided simulation...');
      const response = await simulation.startSimulation(config, { throwOnError: true });
      const simulationId = typeof response === 'object' && response && 'simulation_id' in response
        ? String(response.simulation_id || '')
        : '';
      if (simulationId) {
        await guidedWorkflow.attachSimulation(simulationId).catch(() => undefined);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start simulation';
      addSystemMessage(`${settings.language === 'ar' ? 'تعذر بدء المحاكاة الموجهة.' : 'Failed to start guided simulation.'} ${msg}`.trim());
    } finally {
      guidedWorkflowStartingSimulationRef.current = false;
      endUiBusy(startBusyToken);
    }
  }, [
    addSystemMessage,
    beginUiBusy,
    buildGuidedSimulationConfig,
    endUiBusy,
    guidedWorkflow,
    settings.language,
    simulation,
    userInput,
  ]);

  const handleApplyGuidedCorrectionToSimulation = useCallback(async () => {
    if (!guidedWorkflowState?.last_correction || guidedWorkflowState.last_correction.apply_mode !== 'factual_update') return;
    const rerunBusyToken = beginUiBusy('starting_simulation');
    guidedWorkflowStartingSimulationRef.current = true;
    try {
      if (simulation.status === 'running' && simulation.simulationId) {
        try {
          await simulation.pauseSimulation(
            simulation.simulationId,
            settings.language === 'ar' ? 'Pausing current run to apply factual correction.' : 'Pausing current run to apply factual correction.'
          );
        } catch {
          // Best-effort pause before rerun.
        }
      }
      const nextConfig = buildGuidedSimulationConfig(userInput);
      if (simulation.simulationId) {
        nextConfig.parent_simulation_id = simulation.simulationId;
      }
      const response = await simulation.startSimulation(nextConfig, { carryOver: true, throwOnError: true }).catch(() => null);
      const nextSimulationId = typeof response === 'object' && response && 'simulation_id' in response
        ? String(response.simulation_id || '')
        : '';
      if (nextSimulationId) {
        await guidedWorkflow.attachSimulation(nextSimulationId).catch(() => undefined);
      }
    } finally {
      guidedWorkflowStartingSimulationRef.current = false;
      endUiBusy(rerunBusyToken);
    }
  }, [beginUiBusy, buildGuidedSimulationConfig, endUiBusy, guidedWorkflow.attachSimulation, guidedWorkflowState?.last_correction, settings.language, simulation, userInput]);

  const handleOpenCoachEvidence = useCallback((messageIds: string[]) => {
    const nextIds = Array.from(new Set(messageIds.map((item) => item.trim()).filter(Boolean)));
    if (!nextIds.length) return;
    setDebateInviteVisible(false);
    setHighlightedReasoningMessageIds(nextIds);
    startTransition(() => {
      setActivePanel('reasoning');
    });
  }, []);

  const handleCoachRequestMoreIdeas = useCallback(async () => {
    const simulationId = simulation.simulationId;
    const interventionId = simulation.coachIntervention?.interventionId;
    if (!simulationId || !interventionId || coachBusy) return;
    setCoachBusy(true);
    try {
      await simulation.respondToCoachIntervention({
        simulationId,
        interventionId,
        action: 'request_more_ideas',
      });
      addSystemMessage(
        settings.language === 'ar'
          ? 'جهزت 5 اقتراحات بديلة مبنية على نفس الاعتراض الحالي.'
          : 'Prepared 5 alternative fixes grounded in the same blocker.'
      );
      startTransition(() => {
        setActivePanel('chat');
      });
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تحديث الاقتراحات.${msg}`.trim()
          : `Failed to refresh coach suggestions.${msg}`.trim()
      );
    } finally {
      setCoachBusy(false);
    }
  }, [addSystemMessage, coachBusy, settings.language, simulation]);

  const handleCoachContinueWithoutChange = useCallback(async () => {
    const simulationId = simulation.simulationId;
    const interventionId = simulation.coachIntervention?.interventionId;
    if (!simulationId || !interventionId || coachBusy) return;
    setCoachBusy(true);
    try {
      const response = await simulation.respondToCoachIntervention({
        simulationId,
        interventionId,
        action: 'continue_without_change',
      });
      addSystemMessage(
        response?.guide_message
          || (settings.language === 'ar'
            ? 'تم استكمال المحاكاة دون تعديل السياق الحالي.'
            : 'Simulation resumed without changing the current context.')
      );
      setHighlightedReasoningMessageIds([]);
      startTransition(() => {
        setActivePanel('chat');
      });
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر استكمال المحاكاة.${msg}`.trim()
          : `Failed to continue the simulation.${msg}`.trim()
      );
    } finally {
      setCoachBusy(false);
    }
  }, [addSystemMessage, coachBusy, settings.language, simulation]);

  const handleCoachApplySuggestion = useCallback(async (suggestionId: string) => {
    const simulationId = simulation.simulationId;
    const interventionId = simulation.coachIntervention?.interventionId;
    if (!simulationId || !interventionId || !suggestionId || coachBusy) return;
    setCoachBusy(true);
    try {
      const response = await simulation.respondToCoachIntervention({
        simulationId,
        interventionId,
        action: 'apply_suggestion',
        suggestionId,
      });
      addSystemMessage(
        response?.guide_message
          || (settings.language === 'ar'
            ? 'تم تجهيز تعديل السياق. راجع الفرق ثم أعد التشغيل.'
            : 'Context patch is ready. Review it, then rerun.')
      );
      startTransition(() => {
        setActivePanel('chat');
      });
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تجهيز التعديل.${msg}`.trim()
          : `Failed to prepare the coach patch.${msg}`.trim()
      );
    } finally {
      setCoachBusy(false);
    }
  }, [addSystemMessage, coachBusy, settings.language, simulation]);

  const handleCoachCustomFix = useCallback(async (text: string) => {
    const simulationId = simulation.simulationId;
    const interventionId = simulation.coachIntervention?.interventionId;
    if (!simulationId || !interventionId || !text.trim() || coachBusy) return;
    setCoachBusy(true);
    try {
      const response = await simulation.respondToCoachIntervention({
        simulationId,
        interventionId,
        action: 'custom_fix',
        customText: text.trim(),
      });
      addSystemMessage(
        response?.neutralized_text
          || response?.guide_message
          || (settings.language === 'ar'
            ? 'تمت فلترة التعديل إلى صياغة محايدة. راجع الفرق قبل الإعادة.'
            : 'The custom fix was neutralized into factual context. Review the patch before rerun.')
      );
      startTransition(() => {
        setActivePanel('chat');
      });
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تطبيق التعديل الحر.${msg}`.trim()
          : `Failed to process the custom fix.${msg}`.trim()
      );
    } finally {
      setCoachBusy(false);
    }
  }, [addSystemMessage, coachBusy, settings.language, simulation]);

  const handleCoachConfirmRerun = useCallback(async () => {
      const simulationId = simulation.simulationId;
      const intervention = simulation.coachIntervention;
      const patchPreview = intervention?.patchPreview;
      if (!simulationId || !intervention?.interventionId || !patchPreview || coachBusy) return;

    const rerunBusyToken = beginUiBusy('starting_simulation');
      guidedWorkflowStartingSimulationRef.current = true;
      setCoachBusy(true);

      try {
        const contextResponse = await apiService.getSimulationContext(simulationId).catch(() => null);
        const simulationContext = contextResponse?.user_context && typeof contextResponse.user_context === 'object'
          ? contextResponse.user_context
          : {};
        const baseInput = Object.keys(simulationContext).length
          ? buildUserInputFromSimulationContext(simulationContext)
          : userInput;
        const { nextInput, nextLocationChoice, nextContextScope } = applyCoachContextPatch(
          baseInput,
          patchPreview.contextPatch || {},
        );
        const preservedResearchSummary = typeof simulationContext.research_summary === 'string'
          ? simulationContext.research_summary
          : '';
        const preservedResearchSources = Array.isArray(simulationContext.research_sources)
          ? simulationContext.research_sources as SearchResponse['results']
          : [];
        const preservedResearchStructured = simulationContext.research_structured && typeof simulationContext.research_structured === 'object'
          ? simulationContext.research_structured as SearchResponse['structured']
          : undefined;
        const currentSeedContext = simulationContext.seed_context && typeof simulationContext.seed_context === 'object'
          ? simulationContext.seed_context as Record<string, unknown>
          : {};

        setUserInput(nextInput);
        setGuidedContextScope(nextContextScope);
        setLocationChoice(nextLocationChoice);
        if (preservedResearchSummary || preservedResearchSources.length || preservedResearchStructured) {
          setResearchIdea(nextInput.idea.trim());
          setResearchContext({
            summary: preservedResearchSummary,
            sources: preservedResearchSources,
            structured: preservedResearchStructured,
          });
        }
        setMissingFields(getMissingForStart(nextInput, nextLocationChoice));
        setPendingConfigReview(false);
        setPendingResearchReview(false);
      setIsWaitingForLocationChoice(false);
      setIsWaitingForCountry(false);
      setIsWaitingForCity(false);
      setHighlightedReasoningMessageIds([]);
      setDebateInviteVisible(false);
      setHasStarted(true);
      startTransition(() => {
        setActivePanel('chat');
      });

      addSystemMessage(
        patchPreview.guideMessage
          || (settings.language === 'ar'
            ? 'أعدت صياغة السياق وسأبدأ جولة جديدة من أقرب مرحلة مناسبة.'
              : 'Context patch applied. Starting a fresh run from the closest valid stage.')
        );

        const nextConfig: SimulationConfig = {
          ...(simulationContext as SimulationConfig),
          ...((patchPreview.contextPatch || {}) as Partial<SimulationConfig>),
          idea: nextInput.idea.trim(),
          category: nextInput.category || DEFAULT_CATEGORY,
          targetAudience: nextInput.targetAudience,
          country: nextInput.country.trim(),
          city: nextInput.city.trim(),
          riskAppetite: (nextInput.riskAppetite ?? 50) / 100,
          ideaMaturity: nextInput.ideaMaturity ?? 'concept',
          goals: nextInput.goals,
          agentCount: nextInput.agentCount,
          language: typeof simulationContext.language === 'string' ? simulationContext.language as 'ar' | 'en' : settings.language,
          research_summary: preservedResearchSummary || undefined,
          research_sources: preservedResearchSources,
          research_structured: preservedResearchStructured,
        };
        nextConfig.parent_simulation_id = simulationId;
        nextConfig.seed_context = {
          ...currentSeedContext,
          coach_intervention_id: intervention.interventionId,
          coach_suggestion_id: patchPreview.selectedSuggestionId || null,
          coach_context_patch: patchPreview.contextPatch,
        coach_neutralized_text: patchPreview.neutralizedText || null,
        coach_rerun_from_stage: patchPreview.rerunFromStage,
      };

      const response = await simulation.startSimulation(nextConfig, { carryOver: true, throwOnError: true }).catch(() => null);
      const nextSimulationId = typeof response === 'object' && response && 'simulation_id' in response
        ? String(response.simulation_id || '')
        : '';
      if (nextSimulationId) {
        await guidedWorkflow.attachSimulation(nextSimulationId).catch(() => undefined);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر بدء جولة التعديل الجديدة.${msg}`.trim()
          : `Failed to start the coach rerun.${msg}`.trim()
      );
    } finally {
      guidedWorkflowStartingSimulationRef.current = false;
      endUiBusy(rerunBusyToken);
      setCoachBusy(false);
    }
    }, [
      addSystemMessage,
      apiService,
      applyCoachContextPatch,
      beginUiBusy,
      buildUserInputFromSimulationContext,
      coachBusy,
      endUiBusy,
      getMissingForStart,
      guidedWorkflow,
      settings.language,
    simulation,
    userInput,
  ]);

  const handleManualResume = useCallback(async () => {
    const simulationId = simulation.simulationId;
    if (!simulationId || resumeBusy) return;
    setResumeBusy(true);
    try {
      await simulation.resumeSimulation(simulationId);
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم استكمال الجلسة من آخر نقطة محفوظة.'
          : 'Simulation resumed from the last saved checkpoint.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر استكمال الجلسة.${msg}`.trim()
          : `Failed to resume simulation.${msg}`.trim()
      );
    } finally {
      setResumeBusy(false);
    }
  }, [
    addSystemMessage,
    resumeBusy,
    simulation,
    settings.language,
  ]);

  const handleManualPause = useCallback(async () => {
    const simulationId = simulation.simulationId;
    if (!simulationId || pauseBusy || simulation.status !== 'running') return;
    setPauseBusy(true);
    try {
      await simulation.pauseSimulation(
        simulationId,
        settings.language === 'ar' ? 'تم إيقاف الجلسة يدويًا.' : 'Paused manually by user.',
      );
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم إيقاف التفكير مؤقتًا. يمكنك الاستكمال في أي وقت.'
          : 'Reasoning paused. You can resume anytime.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر إيقاف الجلسة.${msg}`.trim()
          : `Failed to pause simulation.${msg}`.trim()
      );
    } finally {
      setPauseBusy(false);
    }
  }, [
    addSystemMessage,
    pauseBusy,
    simulation,
    settings.language,
  ]);

  const handleSubmitClarification = useCallback(async (payload: {
    questionId: string;
    selectedOptionId?: string;
    customText?: string;
  }) => {
    if (!simulation.simulationId || clarificationBusy) return;
    setClarificationBusy(true);
    try {
      await simulation.submitClarificationAnswer({
        simulationId: simulation.simulationId,
        questionId: payload.questionId,
        selectedOptionId: payload.selectedOptionId,
        customText: payload.customText,
      });
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم استلام التوضيح واستكمال المحاكاة من نفس النقطة.'
          : 'Clarification received. Simulation resumed from the same checkpoint.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر إرسال التوضيح.${msg}`.trim()
          : `Failed to submit clarification.${msg}`.trim()
      );
    } finally {
      setClarificationBusy(false);
    }
  }, [
    addSystemMessage,
    clarificationBusy,
    settings.language,
    simulation,
  ]);

  const handleSubmitPreflight = useCallback(async (payload: {
    questionId: string;
    selectedOptionId?: string;
    customText?: string;
  }) => {
    if (preflightBusy) return;
    const ready = await runPreflightGate(payload);
    if (ready) {
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم حفظ توضيحات ما قبل البدء. جاري تشغيل المحاكاة.'
          : 'Pre-start clarifications saved. Starting simulation now.'
      );
      await handleStart();
      return;
    }
    if (preflightStartPayloadRef.current && preflightConfirmedKeyRef.current !== preflightContextKey) {
      addSystemMessage(
        settings.language === 'ar'
          ? 'راجع وصف الفكرة المقترح واضغط تأكيد الوصف للانتقال للبحث.'
          : 'Review the proposed idea description and confirm it to proceed to research.'
      );
    }
  }, [addSystemMessage, handleStart, preflightBusy, preflightContextKey, runPreflightGate, settings.language]);

  const handleConfirmPreflightIdea = useCallback(async () => {
    if (!preflightStartPayloadRef.current) return;
    preflightConfirmedKeyRef.current = preflightContextKey;
    setPendingIdeaConfirmation(null);
    addSystemMessage(
      settings.language === 'ar'
        ? 'تم تأكيد وصف الفكرة. سنبدأ التنفيذ الآن.'
        : 'Idea description confirmed. Starting execution now.'
    );
    await handleStart();
  }, [addSystemMessage, handleStart, preflightContextKey, settings.language]);

  const handleOpenStartChoice = useCallback(() => {
    if (!requestConfigPanel()) return;
    setStartChoiceModalOpen(true);
  }, [requestConfigPanel]);

  const handleSelectStartPath = useCallback((path: 'inspect_default' | 'build_custom' | 'start_default') => {
    if (path === 'inspect_default') {
      setStartChoiceModalOpen(false);
      setShowSocietyBuilder(false);
      setSelectedStartPath(null);
      if (requestConfigPanel()) {
        addSystemMessage(
          settings.language === 'ar'
            ? 'يمكنك الآن استعراض المجتمع الافتراضي. عندما تصبح جاهزًا، اختر طريقة التشغيل.'
            : 'You can inspect the default society now. Choose the run path when ready.'
        );
      }
      return;
    }

    if (path === 'build_custom') {
      startChoiceResolvedKeyRef.current = startChoiceKey;
      setStartChoiceModalOpen(false);
      setShowSocietyBuilder(true);
      setSelectedStartPath('custom_build');
      if (requestConfigPanel()) {
        addSystemMessage(
          settings.language === 'ar'
            ? 'فعّلت وضع بناء المجتمع المخصص. عدّل الإعدادات ثم ابدأ المحاكاة.'
            : 'Custom society builder enabled. Adjust settings, then start simulation.'
        );
      }
      return;
    }

    startChoiceResolvedKeyRef.current = startChoiceKey;
    setStartChoiceModalOpen(false);
    setShowSocietyBuilder(false);
    setSelectedStartPath('default_start');
    setActivePanel('chat');
    addSystemMessage(
      settings.language === 'ar'
        ? 'تم اختيار التشغيل بالمجتمع الافتراضي.'
        : 'Default society start selected.'
    );
    void handleStart();
  }, [addSystemMessage, handleStart, requestConfigPanel, settings.language, startChoiceKey]);

  const handleAskSocietyAssistant = useCallback(async (question: string) => {
    if (!question.trim() || societyAssistantBusy) return;
    setSocietyAssistantBusy(true);
    try {
      const response = await apiService.askSocietyAssistant({
        question: question.trim(),
        spec: {
          agent_count: userInput.agentCount ?? 20,
          controls: {
            diversity: societyControls.diversity,
            skeptic_ratio: societyControls.skepticRatio,
            innovation_bias: societyControls.innovationBias,
            strict_policy: societyControls.strictPolicy,
            human_debate: societyControls.humanDebate,
            persona_hint: societyControls.personaHint.trim(),
          },
        },
        language: settings.language,
      });
      setSocietyAssistantAnswer(String(response.answer || '').trim());
    } catch {
      setSocietyAssistantAnswer(
        settings.language === 'ar'
          ? 'تعذر الحصول على اقتراح الآن. حاول مرة أخرى.'
          : 'Unable to get a suggestion right now. Please try again.'
      );
    } finally {
      setSocietyAssistantBusy(false);
    }
  }, [
    settings.language,
    societyAssistantBusy,
    societyControls.diversity,
    societyControls.humanDebate,
    societyControls.innovationBias,
    societyControls.personaHint,
    societyControls.skepticRatio,
    societyControls.strictPolicy,
    userInput.agentCount,
  ]);

  const handleSubmitResearchAction = useCallback(async (payload: {
    cycleId: string;
    action: 'scrape_selected' | 'continue_search' | 'cancel_review';
    selectedUrlIds?: string[];
    addedUrls?: string[];
    queryRefinement?: string;
  }) => {
    if (!simulation.simulationId || researchReviewBusy) return;
    setResearchReviewBusy(true);
    try {
      const response = await simulation.submitResearchAction({
        simulationId: simulation.simulationId,
        cycleId: payload.cycleId,
        action: payload.action,
        selectedUrlIds: payload.selectedUrlIds,
        addedUrls: payload.addedUrls,
        queryRefinement: payload.queryRefinement,
        researchGateVersion: simulation.researchGateVersion ?? undefined,
      });
      if (response && response.action_applied === false) {
        addSystemMessage(
          settings.language === 'ar'
            ? 'تم تحديث الحالة تلقائيًا. الإجراء السابق أصبح غير مطلوب.'
            : 'State was refreshed automatically. Previous review action is no longer needed.'
        );
        return;
      }
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم اعتماد إجراء البحث. جاري استكمال جمع الأدلة.'
          : 'Research action accepted. Continuing evidence collection.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تنفيذ إجراء البحث.${msg}`.trim()
          : `Failed to apply research action.${msg}`.trim()
      );
    } finally {
      setResearchReviewBusy(false);
    }
  }, [addSystemMessage, researchReviewBusy, settings.language, simulation]);

  const handleRunPostAction = useCallback(async (action: 'make_acceptable' | 'bring_to_world') => {
    if (!simulation.simulationId || postActionBusy) return;
    setPostActionBusy(action);
    try {
      const response = await apiService.requestPostAction({
        simulation_id: simulation.simulationId,
        action,
      });
      setPostActionResult({
        action: response.action,
        title: response.title,
        summary: response.summary,
        steps: Array.isArray(response.steps) ? response.steps : [],
        risks: Array.isArray(response.risks) ? response.risks : [],
        kpis: Array.isArray(response.kpis) ? response.kpis : [],
        revised_idea: response.revised_idea,
        followup_seed: response.followup_seed,
      });
      addSystemMessage(response.summary || (settings.language === 'ar' ? 'تم تجهيز خطة المتابعة.' : 'Follow-up plan is ready.'));
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تجهيز خطة المتابعة.${msg}`.trim()
          : `Failed to build follow-up action.${msg}`.trim()
      );
    } finally {
      setPostActionBusy(null);
    }
  }, [addSystemMessage, postActionBusy, settings.language, simulation.simulationId]);

  const handleStartFollowupFromAction = useCallback(async () => {
    if (!postActionResult || !simulation.simulationId) return;
    const followupMode = postActionResult.action;
    const followupIdea = (
      (typeof postActionResult.followup_seed?.idea === 'string' && postActionResult.followup_seed.idea)
      || postActionResult.revised_idea
      || userInput.idea
    ).trim();
    if (!followupIdea) return;

    const nextInput: UserInput = {
      ...userInput,
      idea: followupIdea,
    };
    setUserInput(nextInput);
    setHasStarted(true);
    setActivePanel('chat');
    setReasoningActive(false);
    if (reasoningTimerRef.current) {
      window.clearTimeout(reasoningTimerRef.current);
    }
    try {
      addSystemMessage(settings.language === 'ar' ? 'بدء جلسة متابعة...' : 'Starting follow-up simulation...');
      const preflightReady = await runPreflightGate(undefined, nextInput);
      if (!preflightReady) {
        addSystemMessage(
          settings.language === 'ar'
            ? 'أجب على أسئلة التوضيح قبل البدء ثم أكمل.'
            : 'Please answer the pre-start clarification, then continue.'
        );
        return;
      }
      await simulation.startSimulation(
        {
          ...buildConfig(nextInput),
          parent_simulation_id: simulation.simulationId,
          followup_mode: followupMode,
          seed_context: {
            source_action: followupMode,
            source_simulation_id: simulation.simulationId,
            followup_seed: postActionResult.followup_seed ?? {},
          },
        },
        { throwOnError: true },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر بدء جلسة المتابعة.${msg}`.trim()
          : `Failed to start follow-up simulation.${msg}`.trim()
      );
    }
  }, [
    addSystemMessage,
    buildConfig,
    postActionResult,
    runPreflightGate,
    settings.language,
    simulation,
    userInput,
  ]);

  const fetchFilteredAgents = useCallback(async (stance: 'accepted' | 'rejected' | 'neutral') => {
    if (!simulation.simulationId) return;
    try {
      const response = await apiService.getSimulationAgents(simulation.simulationId, {
        stance,
        phase: simulation.currentPhaseKey || undefined,
        page: 1,
        pageSize: 80,
      });
      setFilteredAgents(response.items || []);
      setFilteredAgentsTotal(response.total || 0);
    } catch (err) {
      console.warn('Failed to load filtered agent list', err);
      setFilteredAgents([]);
      setFilteredAgentsTotal(0);
    }
  }, [simulation.currentPhaseKey, simulation.simulationId]);

  const handleSelectStanceFilter = useCallback(async (stance: 'accepted' | 'rejected' | 'neutral') => {
    if (!simulation.simulationId) return;
    if (selectedStanceFilter === stance) {
      setSelectedStanceFilter(null);
      setFilteredAgents([]);
      setFilteredAgentsTotal(0);
      return;
    }
    setSelectedStanceFilter(stance);
    await fetchFilteredAgents(stance);
  }, [fetchFilteredAgents, selectedStanceFilter, simulation.simulationId]);

  useEffect(() => {
    setSelectedStanceFilter(null);
    setFilteredAgents([]);
    setFilteredAgentsTotal(0);
    setPostActionResult(null);
    setPostActionBusy(null);
    setResearchReviewBusy(false);
    setClarificationBusy(false);
  }, [simulation.simulationId]);

  useEffect(() => {
    if (!selectedStanceFilter || !simulation.simulationId) return;
    let cancelled = false;
    let intervalId: number | null = null;

    const refresh = async () => {
      if (cancelled) return;
      try {
        const response = await apiService.getSimulationAgents(simulation.simulationId!, {
          stance: selectedStanceFilter,
          phase: simulation.currentPhaseKey || undefined,
          page: 1,
          pageSize: 80,
        });
        if (cancelled) return;
        setFilteredAgents(response.items || []);
        setFilteredAgentsTotal(response.total || 0);
      } catch {
        if (!cancelled) {
          setFilteredAgents([]);
          setFilteredAgentsTotal(0);
        }
      }
    };

    void refresh();
    if (simulation.status === 'running') {
      intervalId = window.setInterval(() => {
        void refresh();
      }, 1200);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    selectedStanceFilter,
    simulation.currentPhaseKey,
    simulation.simulationId,
    simulation.status,
  ]);

  useEffect(() => {
    const simulationId = simulation.simulationId;
    if (!simulationId) return;
    if (lastLoggedSimulationRef.current === simulationId) return;
    lastLoggedSimulationRef.current = simulationId;
    const ideaValue = userInput.idea.trim();
    const fallbackIdea = (() => {
      try {
        return localStorage.getItem('dashboardIdea') || '';
      } catch {
        return '';
      }
    })();
    addIdeaLogEntry(ideaValue || fallbackIdea || 'Untitled idea', {
      simulationId,
      status: 'running',
      category: userInput.category || undefined,
    });
  }, [simulation.simulationId, userInput.idea, userInput.category]);

  useEffect(() => {
    const simulationId = simulation.simulationId;
    if (!simulationId) return;
    if (simulation.status !== 'completed' && simulation.status !== 'error') return;
    const ideaValue = userInput.idea.trim();
    const patch: { idea?: string } = {};
    if (ideaValue) {
      patch.idea = ideaValue;
    }
    updateIdeaLogEntry(simulationId, {
      status: simulation.status === 'completed' ? 'completed' : 'error',
      acceptanceRate: simulation.metrics.acceptanceRate,
      totalAgents: simulation.metrics.totalAgents,
      summary: simulation.summary || undefined,
      category: userInput.category || undefined,
      ...patch,
    });
  }, [
    simulation.simulationId,
    simulation.status,
    simulation.metrics.acceptanceRate,
    simulation.metrics.totalAgents,
    simulation.summary,
    userInput.category,
    userInput.idea,
  ]);

  const getSearchLocationLabel = useCallback(() => {
    const city = userInput.city?.trim();
    const country = userInput.country?.trim();
    const label = [city, country].filter(Boolean).join(', ');
    if (label) return label;
    if (locationChoice === 'no') {
      return settings.language === 'ar' ? 'بدون مكان محدد' : 'no specific location';
    }
    return settings.language === 'ar' ? 'المكان الذي أدخلته' : 'the location you entered';
  }, [locationChoice, settings.language, userInput.city, userInput.country]);

  const getSearchTimeoutPrompt = useCallback((params: {
    locationLabel: string;
    query: string;
    timeoutMs: number;
    attempts: number;
  }) => {
    const ideaLabel =
      params.query?.trim() ||
      userInput.idea.trim() ||
      (settings.language === 'ar' ? 'الفكرة الحالية' : 'the current idea');
    const timeoutSeconds = Math.max(1, Math.round((params.timeoutMs || SEARCH_TIMEOUT_BASE_MS) / 1000));
    const attempts = Math.max(1, Number(params.attempts || 1));

    const constraints = settings.language === 'ar'
      ? [
          `التصنيف: ${userInput.category || 'غير محدد'}`,
          `الجمهور: ${userInput.targetAudience.length ? userInput.targetAudience.join(', ') : 'غير محدد'}`,
          `الأهداف: ${userInput.goals.length ? userInput.goals.join(', ') : 'غير محدد'}`,
          `مرحلة الفكرة: ${userInput.ideaMaturity || 'غير محدد'}`,
          `شهية المخاطرة: ${Math.max(0, Math.min(100, userInput.riskAppetite ?? 50))}%`,
          `المكان: ${params.locationLabel}`,
        ].join(' | ')
      : [
          `Category: ${userInput.category || 'not set'}`,
          `Audience: ${userInput.targetAudience.length ? userInput.targetAudience.join(', ') : 'not set'}`,
          `Goals: ${userInput.goals.length ? userInput.goals.join(', ') : 'not set'}`,
          `Maturity: ${userInput.ideaMaturity || 'not set'}`,
          `Risk appetite: ${Math.max(0, Math.min(100, userInput.riskAppetite ?? 50))}%`,
          `Location: ${params.locationLabel}`,
        ].join(' | ');

    return settings.language === 'ar'
      ? `بحثت ${attempts} محاولة عن "${ideaLabel}" في "${params.locationLabel}" (مهلة ${timeoutSeconds} ثانية لكل محاولة) ولم أصل بعد لبيانات محلية كافية مرتبطة بالفكرة. الناقص تحديدًا: وجود الفكرة في السوق المحلي، نطاق أسعار واقعي، مستوى الطلب، آراء المستخدمين، وملاحظات تنظيمية مرتبطة بالموقع. قيود البحث: ${constraints}. هل تريد إعادة البحث بوقت أطول؟`
      : `I searched ${attempts} attempt(s) for "${ideaLabel}" in "${params.locationLabel}" (${timeoutSeconds}s timeout per attempt) but still don't have enough location-specific evidence for this idea. Missing specifically: local market presence, realistic price range, demand level, user/public sentiment, and location-related regulatory notes. Search constraints used: ${constraints}. Do you want me to retry with more time?`;
  }, [
    settings.language,
    userInput.idea,
    userInput.category,
    userInput.targetAudience,
    userInput.goals,
    userInput.ideaMaturity,
    userInput.riskAppetite,
  ]);

  const formatLevel = useCallback((value?: 'low' | 'medium' | 'high') => {
    if (!value) return '';
    if (settings.language === 'ar') {
      if (value === 'low') return 'منخفض';
      if (value === 'medium') return 'متوسط';
      return 'مرتفع';
    }
    return value;
  }, [settings.language]);

  const buildSearchSummary = useCallback((data: SearchResponse, locationLabel: string) => {
    const structured = data.structured;
    const answer = data.answer?.trim();
    if (!structured && !answer) return '';

    const prefix = settings.language === 'ar'
      ? `لقيت بيانات عن ${locationLabel} بخصوص الفكرة دي:`
      : `I found data about ${locationLabel} for this idea:`;
    const parts: string[] = [];

    if (structured?.competition_level) {
      parts.push(settings.language === 'ar'
        ? `انتشار الفكرة حاليًا: ${formatLevel(structured.competition_level)}`
        : `Current presence: ${formatLevel(structured.competition_level)}`);
    }
    if (structured?.demand_level) {
      parts.push(settings.language === 'ar'
        ? `مستوى الطلب: ${formatLevel(structured.demand_level)}`
        : `Demand: ${formatLevel(structured.demand_level)}`);
    }
    if (structured?.price_sensitivity) {
      parts.push(settings.language === 'ar'
        ? `نطاق الأسعار/حساسية السعر: ${formatLevel(structured.price_sensitivity)}`
        : `Price sensitivity: ${formatLevel(structured.price_sensitivity)}`);
    }
    if (structured?.regulatory_risk) {
      parts.push(settings.language === 'ar'
        ? `المخاطر التنظيمية: ${formatLevel(structured.regulatory_risk)}`
        : `Regulatory risk: ${formatLevel(structured.regulatory_risk)}`);
    }
    if (structured?.signals?.length) {
      const signals = structured.signals.slice(0, 3).join(settings.language === 'ar' ? '، ' : ', ');
      parts.push(settings.language === 'ar'
        ? `إشارات السوق/آراء الناس: ${signals}`
        : `Market signals: ${signals}`);
    }
    if (structured?.gaps?.length) {
      const gaps = structured.gaps.slice(0, 3).join(settings.language === 'ar' ? '، ' : ', ');
      parts.push(settings.language === 'ar'
        ? `فرص/ثغرات: ${gaps}`
        : `Gaps/opportunities: ${gaps}`);
    }
    if (structured?.notable_locations?.length) {
      const notable = structured.notable_locations.slice(0, 3).join(settings.language === 'ar' ? '، ' : ', ');
      parts.push(settings.language === 'ar'
        ? `أماكن ملحوظة: ${notable}`
        : `Notable locations: ${notable}`);
    }
    if (structured?.summary) {
      parts.push(settings.language === 'ar'
        ? `الخلاصة: ${structured.summary}`
        : `Summary: ${structured.summary}`);
    }
    if (!parts.length && structured?.summary) {
      parts.push(structured.summary);
    }
    if (!parts.length && answer) {
      parts.push(answer);
    }

    return parts.length ? `${prefix} ${parts.join(settings.language === 'ar' ? ' | ' : ' | ')}` : '';
  }, [formatLevel, settings.language]);

  const escapeHtml = useCallback((value: string) => (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  ), []);

  const handleDownloadReport = useCallback(async () => {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const structured = researchContext.structured || {};
      const prompt = settings.language === 'ar'
        ? `أريد تقرير تحليل عميق للفكرة في ملف منظم بعناوين واضحة ونقاط قصيرة.
لا تبالغ في السلبية، واذكر النواقص فقط إذا كانت ظاهرة في البيانات.
اربط التحليل بنتائج البحث وملخص المحاكاة إن وُجد.

الفكرة: ${userInput.idea}
المكان: ${userInput.city || '-'}, ${userInput.country || '-'}
ملخص البحث: ${researchContext.summary || 'لا يوجد'}
إشارات السوق: ${(structured.signals || []).join('، ') || 'غير متاح'}
المنافسة: ${structured.competition_level || 'غير متاح'}
الطلب: ${structured.demand_level || 'غير متاح'}
حساسية السعر: ${structured.price_sensitivity || 'غير متاح'}
المخاطر التنظيمية: ${structured.regulatory_risk || 'غير متاح'}
الفجوات: ${(structured.gaps || []).join('، ') || 'غير متاح'}
أماكن ملحوظة: ${(structured.notable_locations || []).join('، ') || 'غير متاح'}
ملخص المحاكاة: ${simulation.summary || 'غير متاح'}

المطلوب بالترتيب:
1) ملخص تنفيذي
2) تحليل السوق والطلب
3) المنافسة والتموضع
4) التسعير وحساسية السعر
5) المخاطر التنظيمية
6) فرص التحسين (إن وجدت)
7) أسباب تجعل الفكرة قابلة للتنفيذ
8) توصيات عملية قصيرة`
        : `Write a deep analysis report for this idea with clear headings and concise bullet points.
Avoid unnecessary negativity; mention gaps only if data indicates them.
Tie the analysis to the research context and simulation summary if available.

Idea: ${userInput.idea}
Location: ${userInput.city || '-'}, ${userInput.country || '-'}
Research summary: ${researchContext.summary || 'N/A'}
Market signals: ${(structured.signals || []).join(', ') || 'N/A'}
Competition: ${structured.competition_level || 'N/A'}
Demand: ${structured.demand_level || 'N/A'}
Price sensitivity: ${structured.price_sensitivity || 'N/A'}
Regulatory risk: ${structured.regulatory_risk || 'N/A'}
Gaps: ${(structured.gaps || []).join(', ') || 'N/A'}
Notable locations: ${(structured.notable_locations || []).join(', ') || 'N/A'}
Simulation summary: ${simulation.summary || 'N/A'}

Required sections:
1) Executive summary
2) Market & demand
3) Competition & positioning
4) Pricing & sensitivity
5) Regulatory risk
6) Gaps/opportunities (if any)
7) Why the idea is feasible
8) Actionable recommendations`;

      const text = await apiService.generateMessage(prompt);
      const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</pre></body></html>`;
      const blob = new Blob([html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = settings.language === 'ar' ? 'تحليل-الفكرة.doc' : 'idea-analysis.doc';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      if (isAuthError(err)) {
        handleSessionExpired();
        return;
      }
      console.warn('Report generation failed', err);
      addSystemMessage(settings.language === 'ar'
        ? 'حصلت مشكلة أثناء تجهيز التقرير.'
        : 'Report generation failed.');
    } finally {
      setReportBusy(false);
    }
  }, [
    addSystemMessage,
    escapeHtml,
    handleSessionExpired,
    isAuthError,
    reportBusy,
    researchContext.summary,
    researchContext.structured,
    settings.language,
    simulation.summary,
    userInput.city,
    userInput.country,
    userInput.idea,
  ]);

  const runSearch = useCallback(async (
    query: string,
    timeoutMs: number,
    options?: { promptOnTimeout?: boolean },
  ) => {
    const promptOnTimeout = options?.promptOnTimeout ?? true;
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;
    if (searchAbortRef.current && !searchAbortRef.current.signal.aborted) {
      searchAbortReasonRef.current = 'superseded';
      searchAbortRef.current.abort('superseded');
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    searchAbortReasonRef.current = null;
    let timeoutId: number | null = null;

    searchAttemptRef.current += 1;
    const attempt = searchAttemptRef.current;
    const trimmedQuery = query.trim();
    const startedAt = Date.now();
    setResearchIdea(trimmedQuery);
    setSearchState({
      status: 'searching',
      stage: 'prestart_research',
      query: trimmedQuery,
      timeoutMs,
      attempts: attempt,
      startedAt,
      elapsedMs: 0,
    });
    setIsConfigSearching(true);
    const locationLabel = getSearchLocationLabel();
    addSystemMessage(
      settings.language === 'ar'
        ? 'بدء تحليل المصادر قبل التشغيل...'
        : 'Starting live pre-run research...'
    );

    try {
      timeoutId = window.setTimeout(() => {
        searchAbortReasonRef.current = 'timeout';
        controller.abort('timeout');
      }, timeoutMs);
      const searchData = await apiService.runPrestartResearch(
        {
          idea: trimmedQuery,
          category: userInput.category || DEFAULT_CATEGORY,
          country: userInput.country.trim(),
          city: userInput.city.trim(),
          language: settings.language === 'ar' ? 'ar' : 'en',
        },
        { signal: controller.signal },
      ) as SearchResponse & {
        summary?: string;
        highlights?: string[];
        gaps?: string[];
      };

      if (requestSeq !== searchRequestSeqRef.current) {
        return { status: 'aborted' as const };
      }

      if (!searchData.answer && searchData.summary) {
        searchData.answer = searchData.summary;
      }
      const hasStructured =
        Boolean(searchData.structured?.summary)
        || Boolean(searchData.structured?.signals?.length)
        || Boolean(searchData.structured?.gaps?.length)
        || Boolean(searchData.structured?.notable_locations?.length)
        || Boolean(searchData.structured?.competition_level)
        || Boolean(searchData.structured?.demand_level)
        || Boolean(searchData.structured?.price_sensitivity)
        || Boolean(searchData.structured?.regulatory_risk);
      const hasAnswer = Boolean(searchData.answer?.trim() || searchData.summary?.trim());

      if (!hasStructured && !hasAnswer) {
        setSearchState({
          status: 'timeout',
          query: trimmedQuery,
          answer: '',
          provider: searchData.provider || 'none',
          isLive: searchData.is_live,
          results: searchData.results,
          timeoutMs,
          attempts: attempt,
        });
        setResearchContext({ summary: '', sources: [], structured: undefined });
        if (promptOnTimeout && !searchPromptedRef.current) {
          addSystemMessage(getSearchTimeoutPrompt({
            locationLabel,
            query: trimmedQuery,
            timeoutMs,
            attempts: attempt,
          }));
          searchPromptedRef.current = true;
        }
        return { status: 'timeout' as const };
      }

      setSearchState({
        status: 'complete',
        query: trimmedQuery,
        answer: searchData.answer || searchData.summary || '',
        provider: searchData.provider,
        isLive: searchData.is_live,
        results: searchData.results,
        timeoutMs,
        attempts: attempt,
      });
      const summary = searchData.summary
        || searchData.structured?.summary
        || searchData.answer
        || (searchData.results || []).map((r) => r.snippet).filter(Boolean).slice(0, 3).join(' ');
      const sources = Array.isArray(searchData.results) ? searchData.results : [];
      setResearchContext({ summary, sources, structured: searchData.structured });
      const report = buildSearchSummary(searchData, locationLabel);
      if (report) {
        addSystemMessage(report);
      }
      searchPromptedRef.current = false;
      return { status: 'complete' as const };
    } catch (err: unknown) {
      const abortReason = String(
        (controller.signal as AbortSignal & { reason?: unknown }).reason
        ?? searchAbortReasonRef.current
        ?? ''
      );
      const isAbortError = Boolean(
        controller.signal.aborted
        || (err instanceof DOMException && err.name === 'AbortError')
      );
      if (requestSeq !== searchRequestSeqRef.current || abortReason === 'superseded') {
        return { status: 'aborted' as const };
      }
      if (isAbortError && abortReason !== 'timeout') {
        setSearchState({
          status: 'timeout',
          stage: 'prestart_research',
          query: trimmedQuery,
          answer: '',
          provider: 'none',
          isLive: false,
          results: [],
          timeoutMs,
          attempts: attempt,
          startedAt,
          elapsedMs: Date.now() - startedAt,
        });
        setResearchContext({ summary: '', sources: [], structured: undefined });
        if (promptOnTimeout && !searchPromptedRef.current) {
          addSystemMessage(getSearchTimeoutPrompt({
            locationLabel,
            query: trimmedQuery,
            timeoutMs,
            attempts: attempt,
          }));
          searchPromptedRef.current = true;
        }
        return { status: 'timeout' as const };
      }
      if (isAuthError(err)) {
        handleSessionExpired();
        return { status: 'aborted' as const };
      }

      setSearchState({
        status: 'timeout',
        stage: 'prestart_research',
        query: trimmedQuery,
        answer: '',
        provider: 'none',
        isLive: false,
        results: [],
        timeoutMs,
        attempts: attempt,
        startedAt,
        elapsedMs: Date.now() - startedAt,
      });
      setResearchContext({ summary: '', sources: [], structured: undefined });
      if (promptOnTimeout && !searchPromptedRef.current) {
        addSystemMessage(getSearchTimeoutPrompt({
          locationLabel,
          query: trimmedQuery,
          timeoutMs,
          attempts: attempt,
        }));
        searchPromptedRef.current = true;
      }
      return { status: 'timeout' as const };
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (requestSeq === searchRequestSeqRef.current) {
        setIsConfigSearching(false);
      }
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
      if (searchAbortReasonRef.current !== 'superseded') {
        searchAbortReasonRef.current = null;
      }
    }
  }, [
    addSystemMessage,
    buildSearchSummary,
    getSearchLocationLabel,
    getSearchTimeoutPrompt,
    settings.language,
    userInput.category,
    userInput.city,
    userInput.country,
    searchAbortReasonRef,
    handleSessionExpired,
    isAuthError,
  ]);
  runSearchRef.current = runSearch;


  const handleConfigSubmit = useCallback(async () => {
    if (isPrestartSearchActive || isRunStarting || isRunActive) {
      notifyActionBlocked();
      return;
    }
    const missing = getMissingForStart(userInput);
    const visibleMissing = missing.filter((field) => field !== 'location_choice');
    setMissingFields(visibleMissing);
    if (missing.length > 0) {
      if (missing.includes('location_choice')) {
        setActivePanel('chat');
        await promptForMissing(missing);
      }
      return;
    }

    setPendingConfigReview(false);
    setPendingResearchReview(false);
    // Always regenerate pre-start understanding questions on each fresh start attempt.
    preflightStartPayloadRef.current = null;
    preflightResolvedKeyRef.current = '';
    preflightConfirmedKeyRef.current = '';
    understandingAttemptRef.current = '';
    setPendingPreflightQuestion(null);
    setPendingIdeaConfirmation(null);
    setUnderstandingQueue([]);
    setUnderstandingAnswers([]);
    setActivePanel('chat');
    await handleStart();
  }, [getMissingForStart, handleStart, isPrestartSearchActive, isRunActive, isRunStarting, notifyActionBlocked, promptForMissing, userInput, setPendingConfigReview, setActivePanel]);

  const handleSearchRetry = useCallback(async () => {
    if (searchState.status !== 'timeout') return;
    const query = searchState.query || userInput.idea.trim();
    if (!query) return;
    const nextTimeout = Math.min(
      (searchState.timeoutMs ?? SEARCH_TIMEOUT_BASE_MS) + SEARCH_TIMEOUT_STEP_MS,
      SEARCH_TIMEOUT_MAX_MS
    );
    const result = await runSearch(query, nextTimeout);
    if (result.status === 'complete') {
      await handleStart();
    }
  }, [handleStart, runSearch, searchState, userInput.idea]);

  const handleSearchUseLlm = useCallback(async () => {
    if (searchState.status !== 'timeout') return;
    const query = (searchState.query || userInput.idea || '').trim();
    if (!query) return;

    const timeoutMs = searchState.timeoutMs ?? SEARCH_TIMEOUT_BASE_MS;
    const attempts = searchState.attempts ?? Math.max(1, searchAttemptRef.current);
    const startedAt = Date.now();
    const locationLabel = getSearchLocationLabel();

    setSearchState({
      status: 'searching',
      stage: 'prestart_research',
      query,
      timeoutMs,
      attempts,
      startedAt,
      elapsedMs: 0,
    });
    setIsConfigSearching(true);
    addSystemMessage(
      settings.language === 'ar'
        ? 'تعذر الوصول إلى بحث مباشر كافٍ. سأستخدم النموذج البديل لتجهيز ملخص بحثي مبدئي حتى لا يتوقف التدفق.'
        : 'Live search did not return enough data. I will use the fallback model to prepare a provisional research brief so the flow can continue.'
    );

    const systemPrompt = settings.language === 'ar'
      ? 'أنت محلل سوق موجز داخل واجهة محاكاة. اكتب ملخصاً قصيراً وعملياً بالعربية فقط. كن صريحاً أن هذا تقدير استدلالي من النموذج البديل وليس تصفحاً مباشراً. ركز على السوق والمنافسة والطلب والتسعير والمخاطر.'
      : 'You are a concise market analyst inside a simulation UI. Write a short practical brief in English only. Be explicit that this is a model-based estimate from the fallback model, not direct browsing. Focus on market presence, competition, demand, pricing, and risks.';
    const prompt = settings.language === 'ar'
      ? `الفكرة: ${query}
المكان: ${locationLabel}
التصنيف: ${userInput.category || 'غير محدد'}
الجمهور: ${userInput.targetAudience.length ? userInput.targetAudience.join(', ') : 'غير محدد'}
الأهداف: ${userInput.goals.length ? userInput.goals.join(', ') : 'غير محدد'}
مرحلة الفكرة: ${userInput.ideaMaturity || 'غير محدد'}
شهية المخاطرة: ${Math.max(0, Math.min(100, userInput.riskAppetite ?? 50))}%

اكتب 4 إلى 6 جمل قصيرة تلخص تقديراً أولياً للسوق المحلي، مع الإشارة بوضوح إلى أن هذا fallback model estimate وليس بحث ويب مباشر.`
      : `Idea: ${query}
Location: ${locationLabel}
Category: ${userInput.category || 'not set'}
Audience: ${userInput.targetAudience.length ? userInput.targetAudience.join(', ') : 'not set'}
Goals: ${userInput.goals.length ? userInput.goals.join(', ') : 'not set'}
Maturity: ${userInput.ideaMaturity || 'not set'}
Risk appetite: ${Math.max(0, Math.min(100, userInput.riskAppetite ?? 50))}%

Write 4 to 6 short sentences that summarize an initial local market estimate. State clearly that this is a fallback model estimate, not live web browsing.`;

    try {
      const summaryText = normalizeAssistantText(String(await Promise.race([
        apiService.generateMessage(prompt, systemPrompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Fallback research timeout')), 12000)
        ),
      ])));

      if (!summaryText) {
        throw new Error('Empty fallback research summary');
      }

      setResearchIdea(query);
      setResearchContext({
        summary: summaryText,
        sources: [],
        structured: {
          summary: summaryText,
          evidence_cards: [summaryText],
          gaps: settings.language === 'ar'
            ? ['هذا الملخص مبني على استدلال النموذج البديل وليس صفحات ويب مباشرة']
            : ['This brief is based on the fallback model rather than direct web pages'],
        },
      });
      setSearchState({
        status: 'complete',
        query,
        answer: summaryText,
        provider: 'llm_fallback',
        isLive: false,
        results: [],
        timeoutMs,
        attempts,
      });
      searchPromptedRef.current = false;
      addSystemMessage(summaryText);
      await handleStart();
    } catch (err: unknown) {
      if (isAuthError(err)) {
        handleSessionExpired();
        return;
      }
      console.warn('Fallback research synthesis failed.', err);
      setSearchState({
        status: 'timeout',
        stage: 'prestart_research',
        query,
        answer: '',
        provider: 'none',
        isLive: false,
        results: [],
        timeoutMs,
        attempts,
        startedAt,
        elapsedMs: Date.now() - startedAt,
      });
      addSystemMessage(
        settings.language === 'ar'
          ? 'تعذر تجهيز fallback research حالياً. يمكنك إعادة البحث أو المحاولة مرة أخرى لاحقاً.'
          : 'The fallback research brief could not be generated right now. You can retry the search or try again later.'
      );
    } finally {
      setIsConfigSearching(false);
    }
  }, [
    addSystemMessage,
    getSearchLocationLabel,
    handleSessionExpired,
    handleStart,
    isAuthError,
    searchState,
    settings.language,
    userInput.category,
    userInput.goals,
    userInput.idea,
    userInput.ideaMaturity,
    userInput.riskAppetite,
    userInput.targetAudience,
  ]);

  const handleStartAnywayAfterWeakResearch = useCallback(async () => {
    const warningText = settings.language === 'ar'
      ? 'جودة البحث الحالية أقل من الحد المطلوب، وقد تكون دقة المحاكاة أقل. هل تريد بدء المحاكاة رغم ذلك؟'
      : 'Research quality is below threshold and simulation confidence may be lower. Start anyway?';
    if (typeof window !== 'undefined' && !window.confirm(warningText)) {
      return;
    }
    researchReviewedKeyRef.current = researchGateKey;
    setPendingResearchReview(false);
    addSystemMessage(
      settings.language === 'ar'
        ? 'تم تجاوز بوابة جودة البحث بتحذير صريح. سيتم بدء المحاكاة بالبيانات المتاحة.'
        : 'Research gate was bypassed with warning confirmation. Starting with available evidence.'
    );
    await handleStart();
  }, [addSystemMessage, handleStart, researchGateKey, settings.language]);

  const handleRetryPrestartResearch = useCallback(async () => {
    const query = userInput.idea.trim();
    if (!query) return;
    setPendingResearchReview(false);
    const result = await runSearch(query, SEARCH_TIMEOUT_BASE_MS, { promptOnTimeout: true });
    if (result.status === 'complete') {
      setPendingResearchReview(true);
      addSystemMessage(
        settings.language === 'ar'
          ? 'تم تحديث البحث المبدئي. هل أبدأ المحاكاة الآن؟'
          : 'Prestart research was refreshed. Should I start simulation now?'
      );
    }
  }, [addSystemMessage, runSearch, settings.language, userInput.idea]);

  const handleConfirmStart = useCallback(async () => {
    if (!pendingResearchReview) return;
    researchReviewedKeyRef.current = researchGateKey;
    setPendingResearchReview(false);
    await handleStart();
  }, [handleStart, pendingResearchReview, researchGateKey]);

  const handleSendMessage = useCallback(
    (content: string, options?: { skipUserMessage?: boolean }) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (!options?.skipUserMessage) {
        addUserMessage(trimmed);
      }

      void (async () => {
        try {
          if (pendingConfigReview) {
            const lower = trimmed.toLowerCase();
            const confirm = ['yes', 'ok', 'okay', 'go', 'start', 'run', 'y', '\u062a\u0645', '\u062a\u0645\u0627\u0645', '\u0645\u0648\u0627\u0641\u0642', '\u0646\u0639\u0645', '\u0627\u0628\u062f\u0623', '\u0627\u0628\u062f\u0621'];
            const edit = ['تعديل', 'اعدادات', 'الإعدادات', 'settings', 'config'];
            if (confirm.includes(lower)) {
              await handleConfigSubmit();
              return;
            }
            if (edit.includes(lower)) {
              if (requestConfigPanel()) {
                addSystemMessage(settings.language === 'ar'
                  ? 'عدّل الإعدادات ثم اضغط تأكيد البيانات.'
                  : 'Update the configuration, then confirm.');
              }
              return;
            }
          }
          if (pendingUpdate) {
            const yes = ['yes', 'ok', 'okay', 'go', 'start', 'run', 'y', 'نعم', 'اه', 'ابدأ', 'ابدا', 'موافق', 'حاضر', 'تمام'];
            const no = ['no', 'nope', 'cancel', 'stop', 'لا', 'مش', 'مش موافق', 'رفض'];
            const lower = trimmed.toLowerCase();
            if (yes.includes(lower)) {
              const nextIdea = userInput.idea
                ? `${userInput.idea}\nUpdate: ${pendingUpdate}`
                : pendingUpdate;
              const nextInput = { ...userInput, idea: nextIdea };
              setUserInput(nextInput);
              setPendingUpdate(null);
              addSystemMessage(settings.language === 'ar'
                ? 'تم تأكيد التحديث. سأرسله للوكلاء الآن.'
                : 'Update confirmed. Sending it to the agents now.');
              setReasoningActive(false);
              if (reasoningTimerRef.current) {
                window.clearTimeout(reasoningTimerRef.current);
              }
              await simulation.startSimulation(buildConfig(nextInput), { carryOver: true });
              return;
            }
            if (no.includes(lower)) {
              setPendingUpdate(null);
              const reply = await getAssistantMessage(
                settings.language === 'ar'
                  ? `تمام، هنكمل النقاش بدون إرسال التحديث. رد على: "${trimmed}".`
                  : `Okay, we won't send the update. Reply to: "${trimmed}".`
              );
              addSystemMessage(reply || (settings.language === 'ar' ? 'تمام، لن أرسل التحديث.' : 'Okay, no update will be sent.'));
              return;
            }
            addSystemMessage(settings.language === 'ar'
              ? 'هل تريد إرسال هذا التحديث للوكلاء؟ اكتب نعم أو لا.'
              : 'Do you want to send this update to the agents? Type yes or no.');
            return;
          }

          if (isWaitingForLocationChoice) {
            const yes = ['yes', 'y', 'ok', 'okay', 'نعم', 'اه', 'ابدأ', 'ابدا', 'موافق', 'تمام'];
            const no = ['no', 'n', 'nope', 'cancel', 'لا', 'مش', 'مش عايز', 'رفض'];
            const lower = trimmed.toLowerCase();
            if (yes.includes(lower)) {
              setLocationChoice('yes');
              setIsWaitingForLocationChoice(false);
              setIsWaitingForCountry(false);
              setIsWaitingForCity(true);
              addSystemMessage(settings.language === 'ar'
                ? 'تمام، اكتب المدينة المستهدفة الآن. (ممكن تضيف الدولة أيضًا)'
                : 'Great, what city are you targeting? (You can add the country too)');
              return;
            }
            if (no.includes(lower)) {
              setLocationChoice('no');
              setIsWaitingForLocationChoice(false);
              setIsWaitingForCountry(false);
              setIsWaitingForCity(false);
              const missing = getMissingForStart(userInput, 'no');
              const asked = await promptForMissing(missing);
              if (asked) return;
              setPendingConfigReview(true);
              setMissingFields([]);
              if (requestConfigPanel()) {
                addSystemMessage(settings.language === 'ar'
                  ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
                  : 'Review the configuration, then confirm to continue.');
              }
              return;
            }
            addSystemMessage(settings.language === 'ar'
              ? 'اختر نعم أو لا عشان نكمل.'
              : 'Please reply with yes or no so we can continue.');
            return;
          }

          // If we're explicitly waiting for location, handle it directly without search.
          if (isWaitingForCountry || isWaitingForCity) {
            const schemaPayload = {
              idea: userInput.idea,
              country: userInput.country,
              city: userInput.city,
              category: userInput.category,
              target_audience: userInput.targetAudience,
              goals: userInput.goals,
              risk_appetite: (userInput.riskAppetite ?? 50) / 100,
              idea_maturity: userInput.ideaMaturity,
            };
            let extraction = null;
            try {
              extraction = await extractWithRetry(trimmed, schemaPayload);
            } catch (err: unknown) {
              if (isAuthError(err)) {
                handleSessionExpired();
                return;
              }
              addSystemMessage(settings.language === 'ar'
                ? 'الـ LLM مشغول الآن. حاول مرة أخرى بعد قليل.'
                : 'LLM is busy right now. Please try again in a moment.');
              setLlmBusy(true);
              setLlmRetryMessage(trimmed);
              return;
            }
            setLlmBusy(false);
            setLlmRetryMessage(null);

            const nextInput: UserInput = {
              ...userInput,
              country: extraction.country || userInput.country,
              city: extraction.city || userInput.city,
            };
            setUserInput(nextInput);
            setIsWaitingForCountry(false);
            setIsWaitingForCity(false);
            const hasLocation = Boolean(nextInput.city.trim() || nextInput.country.trim());
            if (hasLocation) {
              setLocationChoice('yes');
            }

            const missing = getMissingForStart(nextInput, hasLocation ? 'yes' : undefined);
            const asked = await promptForMissing(missing, extraction.question || undefined);
            if (asked) return;

            setPendingConfigReview(true);
            setMissingFields([]);
            if (requestConfigPanel()) {
              addSystemMessage(settings.language === 'ar'
                ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
                : 'Review the configuration, then confirm to continue.');
            }
            return;
          }

          // If a simulation is already running, handle discussion vs. update directly.
          if (simulation.status === 'running' || simulation.status === 'completed') {
            const context = `Idea: ${userInput.idea}. Location: ${userInput.city}, ${userInput.country}.`;
            let mode: 'update' | 'discuss' = 'discuss';
            const modeBusyToken = beginUiBusy('detecting_mode');
            try {
              const res = await Promise.race([
                apiService.detectMessageMode(trimmed, context, settings.language),
                new Promise<{ mode: 'update' | 'discuss' }>((_, reject) =>
                  setTimeout(() => reject(new Error('Mode timeout')), 3000)
                ),
              ]);
              mode = res.mode;
            } catch (err: unknown) {
              if (isAuthError(err)) {
                handleSessionExpired();
                return;
              }
              const isQuestion = /[?؟]/.test(trimmed);
              mode = isQuestion ? 'discuss' : 'update';
            } finally {
              endUiBusy(modeBusyToken);
            }

            if (mode === 'discuss') {
              const reasoningContext = simulation.reasoningFeed
                .slice(-8)
                .map((r) => `Agent ${r.agentId.slice(0, 4)}: ${r.message}`)
                .join(' | ');
              const constraintsContext = `Category=${userInput.category}; Audience=${userInput.targetAudience.join(', ')}; Goals=${userInput.goals.join(', ')}; Maturity=${userInput.ideaMaturity}; Location=${userInput.city}, ${userInput.country}`;
              const researchContextText = researchContext.summary || '';
              setIsChatThinking(true);
              const reply = await getAssistantMessage(
                settings.language === 'ar'
                  ? `جاوب بشكل طبيعي على: "${trimmed}". اربط الإجابة بما قاله الوكلاء ونتائج البحث. لا تعرض إعدادات خام أو أرقام بدون سياق.
سياق الوكلاء: ${reasoningContext}
سياق البحث: ${researchContextText}
القيود (للفهم فقط): ${constraintsContext}
لو سبب الرفض هو المنافسة أو المكان، اقترح البحث عن موقع أفضل واسأل المستخدم.`
                  : `Reply naturally to: "${trimmed}". Tie your answer to agent reasoning and research. Do not list raw settings or numbers. Use simulation context to explain rejections.
Reasoning context: ${reasoningContext}
Research context: ${researchContextText}
Constraints (for understanding only): ${constraintsContext}
If rejection is about competition or location, suggest searching for a better location and ask the user.`
              );
              setIsChatThinking(false);
              addSystemMessage(reply || (settings.language === 'ar' ? 'حسنًا، دعنا نناقش ذلك.' : "Sure, let's discuss that."));
              return;
            }

            setPendingUpdate(trimmed);
            addSystemMessage(settings.language === 'ar'
              ? 'هل تريد إرسال هذا التحديث للوكلاء لإعادة التقييم؟ (نعم/لا)'
              : 'Do you want to send this update to the agents for re-evaluation? (yes/no)');
            return;
          }

          const schemaPayload = {
            idea: userInput.idea,
            country: userInput.country,
            city: userInput.city,
            category: userInput.category,
            target_audience: userInput.targetAudience,
            goals: userInput.goals,
            risk_appetite: (userInput.riskAppetite ?? 50) / 100,
            idea_maturity: userInput.ideaMaturity,
          };
          let extraction = null;
          try {
            extraction = await extractWithRetry(trimmed, schemaPayload);
          } catch (extractErr) {
            if (isAuthError(extractErr)) {
              handleSessionExpired();
              return;
            }
            console.warn('Schema extraction failed.', extractErr);
            addSystemMessage(settings.language === 'ar'
              ? 'الـ LLM مشغول الآن. حاول مرة أخرى بعد قليل.'
              : 'LLM is busy right now. Please try again in a moment.');
            setLlmBusy(true);
            setLlmRetryMessage(trimmed);
            return;
          }
          setLlmBusy(false);
          setLlmRetryMessage(null);

          const normalizedCategory = normalizeCategoryValue(extraction.category);
          const normalizedAudiences = normalizeOptionList(extraction.target_audience, AUDIENCE_OPTIONS);
          const normalizedGoals = normalizeOptionList(extraction.goals, GOAL_OPTIONS);
          const normalizedRisk = normalizeRiskValue(extraction.risk_appetite);
          const normalizedMaturity = normalizeMaturityValue(extraction.idea_maturity);

          const nextInput: UserInput = {
            ...userInput,
            idea: extraction.idea || userInput.idea || trimmed,
            country: userInput.country || extraction.country || '',
            city: userInput.city || extraction.city || '',
            category: touched.category
              ? userInput.category
              : normalizedCategory || userInput.category || DEFAULT_CATEGORY,
            targetAudience: touched.audience
              ? userInput.targetAudience
              : normalizedAudiences.length
              ? normalizedAudiences
              : userInput.targetAudience.length
              ? userInput.targetAudience
              : DEFAULT_AUDIENCE,
            goals: touched.goals
              ? userInput.goals
              : normalizedGoals.length
              ? normalizedGoals
              : userInput.goals.length
              ? userInput.goals
              : DEFAULT_GOALS,
            riskAppetite: touched.risk
              ? userInput.riskAppetite
              : normalizedRisk ?? userInput.riskAppetite,
            ideaMaturity: touched.maturity
              ? userInput.ideaMaturity
              : normalizedMaturity ?? userInput.ideaMaturity,
          };

          setUserInput(nextInput);
          setIsWaitingForCountry(false);
          setIsWaitingForCity(false);
          const hasLocation = Boolean(nextInput.city.trim() || nextInput.country.trim());
          if (hasLocation) {
            setLocationChoice('yes');
            setIsWaitingForLocationChoice(false);
          }

          const missing = getMissingForStart(nextInput, hasLocation ? 'yes' : undefined);
          const asked = await promptForMissing(missing, extraction.question || undefined);
          if (asked) return;

          setPendingConfigReview(true);
          setMissingFields([]);
          if (requestConfigPanel()) {
            addSystemMessage(settings.language === 'ar'
              ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
              : 'Review the configuration, then confirm to continue.');
          }
        } catch (err: unknown) {
          if (isAuthError(err)) {
            handleSessionExpired();
            return;
          }
          console.error('Schema extraction failed', err);
          addSystemMessage(settings.language === 'ar'
            ? 'الـ LLM غير متاح الآن. أعد تشغيل الخلفية ثم حاول مرة أخرى.'
            : 'LLM unavailable. Please restart the backend.');
        }
      })();
    },
      [
        addUserMessage,
        addSystemMessage,
        beginUiBusy,
        buildConfig,
        endUiBusy,
        extractWithRetry,
        getAssistantMessage,
        getMissingForStart,
        handleConfigSubmit,
        handleSessionExpired,
        isAuthError,
        pendingConfigReview,
        pendingUpdate,
        promptForMissing,
        requestConfigPanel,
        researchContext,
        settings.language,
        simulation,
        isWaitingForLocationChoice,
        isWaitingForCity,
        isWaitingForCountry,
        touched,
        userInput,
      ]
  );

  useEffect(() => {
    if (!autoStartPending) return;
    const ideaText = userInput.idea.trim();
    if (!ideaText) return;
    if (simulation.status === 'running') return;
    setAutoStartPending(false);
    // Match manual chat behavior so schema extraction/analysis runs first.
    handleSendMessage(ideaText);
  }, [autoStartPending, handleSendMessage, simulation.status, userInput.idea]);

  const handleCategoryChange = useCallback((value: string) => {
    setTouched((prev) => ({ ...prev, category: true }));
    setUserInput((prev) => ({ ...prev, category: value }));
  }, []);

  const handleAudienceChange = useCallback((value: string[]) => {
    setTouched((prev) => ({ ...prev, audience: true }));
    setUserInput((prev) => ({ ...prev, targetAudience: value }));
  }, []);

  const handleRiskChange = useCallback((value: number) => {
    setTouched((prev) => ({ ...prev, risk: true }));
    setUserInput((prev) => ({ ...prev, riskAppetite: value }));
  }, []);

  const handleMaturityChange = useCallback((value: string) => {
    setTouched((prev) => ({ ...prev, maturity: true }));
    setUserInput((prev) => ({ ...prev, ideaMaturity: value as UserInput['ideaMaturity'] }));
  }, []);

  const handleGoalsChange = useCallback((value: string[]) => {
    setTouched((prev) => ({ ...prev, goals: true }));
    setUserInput((prev) => ({ ...prev, goals: value }));
  }, []);

  const toggleSpeed = useCallback(() => {
    setSimulationSpeed((prev) => (prev === 10 ? 1 : 10));
  }, []);

  const handleOptionSelect = useCallback(
    async (field: 'category' | 'audience' | 'goals' | 'maturity' | 'location_choice' | 'clarification_choice', value: string) => {
      if (field === 'clarification_choice') {
        const pending = simulation.pendingClarification;
        if (!pending?.questionId) return;
        await handleSubmitClarification({
          questionId: pending.questionId,
          selectedOptionId: value,
        });
        return;
      }
      if (isConfigLocked) {
        notifyConfigLocked();
        return;
      }
      if (field === 'location_choice') {
        const nextChoice = value === 'yes' ? 'yes' : 'no';
        if (locationChoice === nextChoice && !isWaitingForLocationChoice) {
          return;
        }
        setLocationChoice(nextChoice);
        setIsWaitingForLocationChoice(false);
        if (nextChoice === 'yes') {
          setIsWaitingForCountry(false);
          setIsWaitingForCity(true);
          addSystemMessage(settings.language === 'ar'
            ? 'تمام، اكتب المدينة المستهدفة الآن. (ممكن تضيف الدولة أيضًا)'
            : 'Great, what city are you targeting? (You can add the country too)');
          return;
        } else {
          setIsWaitingForCountry(false);
          setIsWaitingForCity(false);
          addSystemMessage(settings.language === 'ar'
            ? 'تمام، لا نحتاج مكانًا محددًا.'
            : 'Got it, no specific location needed.');
          const missing = getMissingForStart(userInput, nextChoice);
          const asked = await promptForMissing(missing);
          if (asked) return;
          setPendingConfigReview(true);
          setMissingFields([]);
          if (requestConfigPanel()) {
            addSystemMessage(settings.language === 'ar'
              ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
              : 'Review the configuration, then confirm to continue.');
          }
        }
        return;
      }
      if (field === 'category') {
        handleCategoryChange(value);
        addSystemMessage(settings.language === 'ar' ? `تم اختيار الفئة: ${value}` : `Category selected: ${value}`);
        return;
      }
      if (field === 'maturity') {
        handleMaturityChange(value);
        addSystemMessage(settings.language === 'ar' ? `تم اختيار مرحلة النضج: ${value}` : `Maturity selected: ${value}`);
        return;
      }
      if (field === 'audience') {
        const exists = userInput.targetAudience.includes(value);
        const next = exists
          ? userInput.targetAudience.filter((item) => item !== value)
          : [...userInput.targetAudience, value];
        handleAudienceChange(next);
        addSystemMessage(settings.language === 'ar'
          ? `تم تحديث الجمهور: ${next.join(', ') || 'غير محدد'}`
          : `Audience updated: ${next.join(', ') || 'Not set'}`);
        return;
      }
      if (field === 'goals') {
        const exists = userInput.goals.includes(value);
        const next = exists
          ? userInput.goals.filter((item) => item !== value)
          : [...userInput.goals, value];
        handleGoalsChange(next);
        addSystemMessage(settings.language === 'ar'
          ? `تم تحديث الأهداف: ${next.join(', ') || 'غير محدد'}`
          : `Goals updated: ${next.join(', ') || 'Not set'}`);
      }
    },
    [
      addSystemMessage,
      handleSubmitClarification,
      handleAudienceChange,
      handleCategoryChange,
      handleGoalsChange,
      handleMaturityChange,
      getMissingForStart,
      isWaitingForLocationChoice,
      locationChoice,
      promptForMissing,
      requestConfigPanel,
      isConfigLocked,
      notifyConfigLocked,
      simulation.pendingClarification,
      setPendingConfigReview,
      setMissingFields,
      settings.language,
      userInput,
    ]
  );

  const handleRetryLlm = useCallback(() => {
    if (!llmRetryMessage) return;
    setLlmBusy(false);
    const retryText = llmRetryMessage;
    setLlmRetryMessage(null);
    handleSendMessage(retryText, { skipUserMessage: true });
  }, [handleSendMessage, llmRetryMessage]);

  const handleQuickReply = useCallback((value: string) => {
    handleSendMessage(value);
  }, [handleSendMessage]);

  const handleLogout = useCallback(async () => {
    await apiService.logout();
    navigate('/');
  }, [navigate]);

  const handleManualPanelSwitch = useCallback((panel: 'chat' | 'reasoning' | 'config') => {
    if (panel === 'config') {
      setHighlightedReasoningMessageIds([]);
      requestConfigPanel();
      return;
    }
    if (panel !== 'reasoning') {
      setHighlightedReasoningMessageIds([]);
    } else {
      setDebateInviteVisible(false);
    }
    startTransition(() => {
      setActivePanel(panel);
    });
  }, [requestConfigPanel]);

  useEffect(() => {
    if (simulation.status === 'running') return;
    debateInviteShownForSimulationRef.current = null;
    setDebateInviteVisible(false);
  }, [simulation.status]);

  useEffect(() => {
    const simulationId = simulation.simulationId;
    if (
      simulation.status !== 'running'
      || !simulationId
      || !reasoningActive
      || simulation.reasoningFeed.length < 2
    ) {
      return;
    }
    if (debateInviteShownForSimulationRef.current === simulationId) return;
    debateInviteShownForSimulationRef.current = simulationId;
    setDebateInviteVisible(true);
  }, [reasoningActive, simulation.reasoningFeed.length, simulation.simulationId, simulation.status]);

  useEffect(() => {
    if (
      simulation.status === 'error' ||
      simulation.status === 'idle' ||
      simulation.status === 'paused' ||
      simulation.status === 'completed'
    ) {
      setHasStarted(false);
    }
  }, [simulation.status]);

  useEffect(() => {
    const needsClarification = Boolean(
      simulation.simulationId
      && simulation.status === 'paused'
      && simulation.statusReason === 'paused_clarification_needed'
      && simulation.pendingClarification?.questionId
    );
    const needsCoachAction = Boolean(
      simulation.simulationId
      && simulation.status === 'paused'
      && simulation.statusReason === 'paused_coach_intervention'
      && simulation.coachIntervention?.interventionId
    );
    const needsResearchReview = Boolean(
      simulation.simulationId
      && simulation.status === 'paused'
      && simulation.statusReason === 'paused_research_review'
      && simulation.researchGate === 'runtime_review'
      && simulation.pendingResearchReview?.cycleId
    );
    if (!needsClarification && !needsCoachAction && !needsResearchReview) return;
    setActivePanel('chat');
  }, [
    simulation.coachIntervention,
    simulation.pendingClarification,
    simulation.pendingResearchReview,
    simulation.researchGate,
    simulation.simulationId,
    simulation.status,
    simulation.statusReason,
  ]);

  useEffect(() => {
    setHighlightedReasoningMessageIds([]);
  }, [simulation.simulationId]);

  useEffect(() => {
    if (simulation.status !== 'paused' || simulation.statusReason !== 'paused_credits_exhausted') return;
    const message = settings.language === 'ar'
      ? 'توقف التنفيذ لأن الرصيد نفد أثناء المحاكاة. اشحن Credits ثم اضغط استكمال للمتابعة من نفس النقطة.'
      : 'Token budget was exhausted mid-run. Add credits and press Resume.';
    setCreditNotice(message);
  }, [settings.language, simulation.status, simulation.statusReason]);

  const hasProgress = hasRunProgress;
  const simulationActuallyStarted = hasRunProgress;
  const isSummarizing = simulation.status === 'running'
    && hasProgress
    && !simulation.summary
    && !reasoningActive;
  const showResumeAction = Boolean(
    simulation.simulationId
    && simulation.canResume
    && (simulation.status === 'paused' || simulation.status === 'error')
    && (
      simulation.statusReason === 'interrupted'
      || simulation.statusReason === 'error'
      || simulation.statusReason === 'paused_manual'
      || simulation.statusReason === 'paused_search_failed'
      || simulation.statusReason === 'paused_credits_exhausted'
    )
  );
  const isClarificationPause = Boolean(
    simulation.simulationId
    && simulation.status === 'paused'
    && simulation.statusReason === 'paused_clarification_needed'
    && simulation.pendingClarification?.questionId
  );
  const isResearchReviewPause = Boolean(
    simulation.simulationId
    && simulation.status === 'paused'
    && simulation.statusReason === 'paused_research_review'
    && simulation.researchGate === 'runtime_review'
    && simulation.pendingResearchReview?.cycleId
  );
  const isCoachPause = Boolean(
    simulation.simulationId
    && simulation.status === 'paused'
    && simulation.statusReason === 'paused_coach_intervention'
    && simulation.coachIntervention?.interventionId
  );
  const clarificationBannerText = settings.language === 'ar'
    ? 'المحاكاة متوقفة مؤقتًا لأن الوكلاء يحتاجون توضيحًا منك قبل الاستكمال.'
    : 'Simulation is paused because agents require clarification before continuing.';
  const researchReviewBannerText = settings.language === 'ar'
    ? 'تم إيقاف المحاكاة مؤقتًا لمراجعة روابط البحث. اختر روابط ثم واصل الاستخراج.'
    : 'Simulation is paused for research review. Select URLs then continue scraping.';
  const coachBannerText = settings.language === 'ar'
    ? 'أوقفنا المحاكاة لأن الوكلاء وصلوا لاعتراض متقارب يحتاج قرارًا منك قبل الإعادة.'
    : 'Simulation is paused because agents converged on a blocker and need your decision before rerun.';
  const quickReplies = pendingUpdate
    ? [
        { label: settings.language === 'ar' ? 'نعم' : 'Yes', value: 'yes' },
        { label: settings.language === 'ar' ? 'لا' : 'No', value: 'no' },
      ]
    : pendingConfigReview
    ? [
        { label: settings.language === 'ar' ? 'ابدأ' : 'Start', value: 'yes' },
        { label: settings.language === 'ar' ? 'تعديل' : 'Edit', value: 'edit' },
      ]
    : null;
  const finalAcceptancePct = simulation.metrics.totalAgents > 0
    ? (simulation.metrics.accepted / simulation.metrics.totalAgents) * 100
    : 0;
  const recommendedPostAction: 'make_acceptable' | 'bring_to_world' =
    finalAcceptancePct >= 60 ? 'bring_to_world' : 'make_acceptable';

  const primaryControl = useMemo(() => {
    const hasIdea = Boolean(userInput.idea.trim());

    if (isRunActive && simulationActuallyStarted) {
      return {
        key: 'pause_reasoning',
        label: settings.language === 'ar' ? 'إيقاف التفكير مؤقتًا' : 'Pause reasoning',
        description: settings.language === 'ar' ? 'يمكنك الاستكمال لاحقًا من نفس النقطة' : 'Resume later from the same checkpoint',
        disabled: pauseBusy || !simulation.simulationId,
        busy: pauseBusy,
        tone: 'warning' as const,
        icon: 'pause' as const,
        onClick: () => { void handleManualPause(); },
      };
    }

    if (isRunStarting) {
      return {
        key: 'starting',
        label: settings.language === 'ar' ? 'جاري تجهيز المحاكاة...' : 'Preparing simulation...',
        description: settings.language === 'ar' ? 'سيظهر زر الإيقاف بعد بداية التكرارات.' : 'Stop control appears after iterations begin.',
        disabled: true,
        busy: true,
        tone: 'secondary' as const,
        icon: 'sparkles' as const,
      };
    }

    if (isClarificationPause) {
      return {
        key: 'clarification_required',
        label: settings.language === 'ar' ? 'مطلوب توضيح للاستكمال' : 'Clarification required to continue',
        description: settings.language === 'ar' ? 'أجب على سؤال التوضيح داخل الدردشة' : 'Answer the clarification card in chat',
        disabled: false,
        busy: clarificationBusy,
        tone: 'warning' as const,
        icon: 'reasoning' as const,
        onClick: () => { setActivePanel('chat'); },
      };
    }

    if (isResearchReviewPause) {
      return {
        key: 'research_review_required',
        label: settings.language === 'ar' ? 'مراجعة نتائج البحث' : 'Review search results',
        description: settings.language === 'ar' ? 'استخدم بطاقة مراجعة الروابط داخل الدردشة' : 'Use the URL review card in chat',
        disabled: false,
        busy: researchReviewBusy,
        tone: 'warning' as const,
        icon: 'sparkles' as const,
        onClick: () => { setActivePanel('chat'); },
      };
    }

    if (isCoachPause) {
      return {
        key: 'coach_required',
        label: settings.language === 'ar' ? 'راجع تشخيص الأوركستريتور' : 'Review orchestrator diagnosis',
        description: settings.language === 'ar'
          ? 'افتح الدليل لمراجعة الأدلة والاقتراحات أو الاستكمال بدون تعديل.'
          : 'Open the guide to inspect evidence, fixes, or continue without changes.',
        disabled: false,
        busy: coachBusy,
        tone: 'warning' as const,
        icon: 'sparkles' as const,
        onClick: () => { setActivePanel('chat'); },
      };
    }

    if (showResumeAction) {
      const isSearchFailure = simulation.statusReason === 'paused_search_failed';
      return {
        key: 'resume_reasoning',
        label: isSearchFailure
          ? (settings.language === 'ar' ? 'إعادة البحث' : 'Retry search')
          : (settings.language === 'ar' ? 'استكمال التفكير' : 'Resume reasoning'),
        description: isSearchFailure
          ? (settings.language === 'ar' ? 'إعادة محاولة البحث من نفس النقطة' : 'Retry search from the same checkpoint')
          : (settings.language === 'ar' ? 'الاستكمال من آخر نقطة محفوظة' : 'Continue from last checkpoint'),
        disabled: resumeBusy || !simulation.simulationId,
        busy: resumeBusy,
        tone: (isSearchFailure ? 'warning' : 'success') as const,
        icon: (isSearchFailure ? 'retry' : 'play') as const,
        onClick: () => { void handleManualResume(); },
      };
    }

    if (pendingPreflightQuestion) {
      return {
        key: 'preflight_required',
        label: settings.language === 'ar' ? 'مطلوب توضيح للاستكمال' : 'Clarification needed to continue',
        description: settings.language === 'ar'
          ? 'أجب على سؤال التوضيح داخل الدردشة قبل بدء البحث.'
          : 'Answer the clarification card in chat before running research.',
        disabled: false,
        busy: preflightBusy,
        tone: 'warning' as const,
        icon: 'reasoning' as const,
        onClick: () => { setActivePanel('chat'); },
      };
    }

    if (pendingIdeaConfirmation) {
      return {
        key: 'idea_confirmation_required',
        label: settings.language === 'ar' ? 'مراجعة وصف الفكرة أولًا' : 'Review idea description first',
        description: settings.language === 'ar'
          ? 'أكد وصف الفكرة من الدردشة قبل تشغيل البحث.'
          : 'Confirm the idea description in chat before running research.',
        disabled: false,
        busy: false,
        tone: 'warning' as const,
        icon: 'reasoning' as const,
        onClick: () => { setActivePanel('chat'); },
      };
    }

    if (isPrestartSearchActive) {
      return {
        key: 'searching',
        label: settings.language === 'ar' ? 'جاري البحث...' : 'Searching...',
        description: simulation.currentPhaseKey || (settings.language === 'ar' ? 'يتم تحليل المصادر الآن' : 'Collecting and extracting sources'),
        disabled: true,
        busy: true,
        tone: 'secondary' as const,
        icon: 'sparkles' as const,
      };
    }

    if (searchState.status === 'timeout') {
      return {
        key: 'retry_search',
        label: settings.language === 'ar' ? 'إعادة البحث' : 'Retry research',
        description: settings.language === 'ar'
          ? 'سيظهر بدء المحاكاة بعد بحث كافٍ أو بعد تجاوز التحذير.'
          : 'Start simulation unlocks after sufficient research or warning-confirm bypass.',
        disabled: false,
        busy: false,
        tone: 'warning' as const,
        icon: 'retry' as const,
        onClick: () => { void handleSearchRetry(); },
        secondary: {
          label: settings.language === 'ar' ? 'ابدأ المحاكاة رغم ذلك' : 'Start anyway',
          onClick: () => { void handleStartAnywayAfterWeakResearch(); },
        },
      };
    }

    if (pendingConfigReview) {
      return {
        key: 'confirm_start',
        label: settings.language === 'ar' ? 'ابدأ البحث' : 'Run research',
        description: settings.language === 'ar' ? 'سيتم تنفيذ البحث أولًا ثم ستظهر لك خطوة بدء المحاكاة' : 'Research runs first, then start simulation appears',
        disabled: isPrestartSearchActive,
        busy: isPrestartSearchActive,
        tone: 'primary' as const,
        icon: 'sparkles' as const,
        onClick: () => { void handleConfigSubmit(); },
        secondary: {
          label: settings.language === 'ar' ? 'تعديل' : 'Edit',
          onClick: () => { requestConfigPanel(); },
        },
      };
    }

    if (pendingResearchReview) {
      return {
        key: 'start_reasoning',
        label: selectedStartPath === 'custom_build'
          ? (settings.language === 'ar' ? 'ابدأ المحاكاة بالمجتمع المخصص' : 'Start with your custom society')
          : (settings.language === 'ar' ? 'ابدأ المحاكاة الآن' : 'Start simulation now'),
        description: settings.language === 'ar' ? 'سيتم تشغيل مرحلة التفكير مباشرة' : 'Reasoning phase will begin now',
        disabled: false,
        busy: false,
        tone: 'success' as const,
        icon: 'play' as const,
        onClick: () => { void handleConfirmStart(); },
        secondary: {
          label: settings.language === 'ar' ? 'إعادة البحث' : 'Retry research',
          onClick: () => { void handleRetryPrestartResearch(); },
        },
      };
    }

    return {
      key: 'start',
      label: selectedStartPath === 'custom_build'
        ? (settings.language === 'ar' ? 'ابدأ البحث بالمجتمع المخصص' : 'Run research with your custom society')
        : (settings.language === 'ar' ? 'ابدأ البحث' : 'Run research'),
      description: settings.language === 'ar' ? 'ابدأ ببحث واقعي أولًا، ثم سنعرض زر بدء المحاكاة' : 'Start with real research first; start simulation comes next',
      disabled: !hasIdea,
      busy: false,
      tone: 'primary' as const,
      icon: 'sparkles' as const,
      onClick: () => { void handleConfigSubmit(); },
    };
  }, [
    coachBusy,
    clarificationBusy,
    handleConfigSubmit,
    handleConfirmStart,
    handleManualPause,
    handleManualResume,
    handleStartAnywayAfterWeakResearch,
    handleRetryPrestartResearch,
    handleSearchRetry,
    isClarificationPause,
    isCoachPause,
    isPrestartSearchActive,
    isResearchReviewPause,
    isRunActive,
    isRunStarting,
    pauseBusy,
    preflightBusy,
    pendingConfigReview,
    pendingResearchReview,
    researchReviewBusy,
    simulation.currentPhaseKey,
    resumeBusy,
    searchState.status,
    selectedStartPath,
    settings.language,
    showResumeAction,
    pendingIdeaConfirmation,
    pendingPreflightQuestion,
    requestConfigPanel,
    simulation.simulationId,
    simulation.statusReason,
    simulationActuallyStarted,
    userInput.idea,
  ]);
  const uiProgress = useMemo(() => {
    if (searchState.status === 'searching') {
      return {
        active: true,
        stage: searchState.stage ?? 'prestart_research',
        elapsedMs: searchState.elapsedMs,
        timeoutMs: searchState.timeoutMs,
      };
    }
    if (!uiBusyStage) {
      return undefined;
    }
    return {
      active: true,
      stage: uiBusyStage,
      elapsedMs: uiBusyElapsedMs,
      timeoutMs: undefined,
    };
  }, [searchState.elapsedMs, searchState.stage, searchState.status, searchState.timeoutMs, uiBusyElapsedMs, uiBusyStage]);

  const topBarPhaseLabel = useMemo(() => {
    const current = String(simulation.currentPhaseKey || '').toLowerCase();
    if (current.includes('search') || current.includes('research') || current.includes('evidence')) {
      return settings.language === 'ar' ? 'بحث الإنترنت' : 'Internet research';
    }
    if (current.includes('debate') || current.includes('deliberation') || current.includes('agent')) {
      return settings.language === 'ar' ? 'نقاش الوكلاء' : 'Agent debate';
    }
    if (current.includes('convergence') || current.includes('resolution')) {
      return settings.language === 'ar' ? 'التقارب' : 'Convergence';
    }
    if (current.includes('summary') || simulation.status === 'completed') {
      return settings.language === 'ar' ? 'الخلاصة النهائية' : 'Final summary';
    }
    return settings.language === 'ar' ? 'استقبال الفكرة' : 'Idea intake';
  }, [settings.language, simulation.currentPhaseKey, simulation.status]);

  const topBarSearchLabel = useMemo(() => {
    if (searchState.status === 'searching') return settings.language === 'ar' ? 'البحث يعمل الآن' : 'Search is running';
    if (searchState.status === 'timeout') return settings.language === 'ar' ? 'انتهت مهلة البحث' : 'Search timed out';
    if (searchState.status === 'error') return settings.language === 'ar' ? 'تعذر البحث' : 'Search failed';
    if (searchState.status === 'complete') return settings.language === 'ar' ? 'اكتملت جولة البحث' : 'Search completed';
    return settings.language === 'ar' ? 'جاهز للبحث' : 'Ready for search';
  }, [searchState.status, settings.language]);

  const handleConfigChange = useCallback((updates: Partial<UserInput>) => {
    if (isConfigLocked) {
      notifyConfigLocked();
      return;
    }
    setUserInput((prev) => {
      const next = { ...prev, ...updates };
      const hasLocation = Boolean(next.city.trim() || next.country.trim());
      if (hasLocation) {
        setLocationChoice('yes');
        setIsWaitingForLocationChoice(false);
      }
      const missing = getMissingForStart(next, hasLocation ? 'yes' : undefined);
      setMissingFields(missing.filter((field) => field !== 'location_choice'));
      return next;
    });
  }, [getMissingForStart, isConfigLocked, notifyConfigLocked]);

  const sharedChatPanelProps = {
    messages: chatMessages,
    reasoningFeed: simulation.reasoningFeed,
    highlightReasoningMessageIds: highlightedReasoningMessageIds,
    reasoningDebug: simulation.reasoningDebug,
    onSendMessage: handleSendMessage,
    onSelectOption: handleOptionSelect,
    isWaitingForCity,
    isWaitingForCountry,
    isWaitingForLocationChoice,
    searchState,
    uiProgress,
    isThinking: isChatThinking,
    showRetry: llmBusy || searchState.status === 'timeout',
    onRetryLlm: handleRetryLlm,
    onSearchRetry: handleSearchRetry,
    onSearchUseLlm: handleSearchUseLlm,
    simulationStatus: simulation.status,
    simulationError: simulation.error,
    reasoningActive,
    isSummarizing,
    phaseState: {
      currentPhaseKey: simulation.currentPhaseKey,
      progressPct: simulation.phaseProgressPct,
    },
    researchSourcesLive: simulation.researchSources,
    quickReplies: quickReplies || undefined,
    onQuickReply: handleQuickReply,
    primaryControl,
    pendingClarification: simulation.pendingClarification,
    canAnswerClarification: simulation.canAnswerClarification,
    clarificationBusy,
    onSubmitClarification: handleSubmitClarification,
    pendingPreflightQuestion,
    preflightRound,
    preflightMaxRounds,
    preflightBusy,
    onSubmitPreflight: handleSubmitPreflight,
    pendingIdeaConfirmation,
    onConfirmIdeaForStart: handleConfirmPreflightIdea,
    pendingResearchReview: isResearchReviewPause ? simulation.pendingResearchReview : null,
    researchReviewBusy,
    onSubmitResearchReviewAction: handleSubmitResearchAction,
    postActionsEnabled: simulation.status === 'completed' && Boolean(simulation.simulationId),
    recommendedPostAction,
    finalAcceptancePct,
    postActionBusy,
    postActionResult,
    onRunPostAction: (action: 'make_acceptable' | 'bring_to_world') => { void handleRunPostAction(action); },
    onStartFollowupFromPostAction: () => { void handleStartFollowupFromAction(); },
    onRequestReasoningView: () => {
      setDebateInviteVisible(false);
      handleManualPanelSwitch('reasoning');
    },
    settings,
  };

  const sidePanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[34px] border border-border/60 bg-card/35 shadow-[0_18px_60px_-42px_rgba(0,0,0,0.72)] backdrop-blur-xl">
      <div className="border-b border-border/40 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleManualPanelSwitch('chat')}
            className={cn('h-11 rounded-full text-sm font-semibold transition', activePanel === 'chat' ? 'bg-primary text-primary-foreground' : 'bg-background/60 text-muted-foreground hover:text-foreground')}
          >
            {settings.language === 'ar' ? 'الدردشة' : 'Chat'}
          </button>
          <button
            type="button"
            onClick={() => handleManualPanelSwitch('reasoning')}
            className={cn('h-11 rounded-full text-sm font-semibold transition', activePanel === 'reasoning' ? 'bg-primary text-primary-foreground' : 'bg-background/60 text-muted-foreground hover:text-foreground')}
          >
            {settings.language === 'ar' ? 'النقاش' : 'Reasoning'}
          </button>
          <button
            type="button"
            onClick={() => handleManualPanelSwitch('config')}
            disabled={isConfigLocked}
            title={isConfigLocked ? configLockReason : undefined}
            className={cn('h-11 rounded-full text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', activePanel === 'config' ? 'bg-primary text-primary-foreground' : 'bg-background/60 text-muted-foreground hover:text-foreground')}
          >
            {settings.language === 'ar' ? 'الإعدادات' : 'Config'}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-1">
        {activePanel === 'config' ? (
          <ConfigPanel
            value={userInput}
            onChange={handleConfigChange}
            onSubmit={handleConfigSubmit}
            missingFields={missingFields}
            language={settings.language}
            isSearching={isConfigSearching}
            isLocked={isConfigLocked}
            lockReason={configLockReason}
            showSocietyBuilder={showSocietyBuilder}
            onToggleSocietyBuilder={setShowSocietyBuilder}
            societyControls={societyControls}
            onSocietyControlsChange={(updates) => setSocietyControls((prev) => ({ ...prev, ...updates }))}
            onOpenStartChoice={handleOpenStartChoice}
            societyAssistantBusy={societyAssistantBusy}
            societyAssistantAnswer={societyAssistantAnswer}
            onAskSocietyAssistant={handleAskSocietyAssistant}
          />
        ) : activePanel === 'reasoning' ? (
          <ChatPanel {...sharedChatPanelProps} viewMode="reasoning" />
        ) : (
          <ChatPanel {...sharedChatPanelProps} viewMode="chat" />
        )}
      </div>
    </div>
  );

  const arenaPanel = (
    <div className="grid min-h-0 gap-4 xl:grid-rows-[minmax(460px,1fr)_minmax(0,240px)]">
      <div className="min-h-[380px] overflow-hidden rounded-[32px]">
        <SimulationArena
          agents={Array.from(simulation.agents.values())}
          activePulses={simulation.activePulses}
          language={settings.language}
          reasoningActive={reasoningActive}
          debateReady={debateInviteVisible}
          reasoningFeed={simulation.reasoningFeed}
          onOpenReasoning={() => {
            setDebateInviteVisible(false);
            handleManualPanelSwitch('reasoning');
          }}
        />
      </div>
      <div className="min-h-0 overflow-y-auto rounded-[32px] border border-border/60 bg-card/35 p-3 scrollbar-thin">
        <IterationTimeline
          currentIteration={simulation.metrics.currentIteration}
          totalIterations={simulation.metrics.totalIterations}
          language={settings.language}
          currentPhaseKey={simulation.currentPhaseKey}
          phaseProgressPct={simulation.phaseProgressPct}
        />
      </div>
    </div>
  );

  const metricsPane = (
    <div className="h-full min-h-0 overflow-hidden rounded-[32px] border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
      <MetricsPanel
        metrics={simulation.metrics}
        language={settings.language}
        onSelectStance={handleSelectStanceFilter}
        selectedStance={selectedStanceFilter}
        filteredAgents={filteredAgents}
        filteredAgentsTotal={filteredAgentsTotal}
      />
    </div>
  );

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden bg-background" dir="rtl">
      <Header
        simulationStatus={simulation.status}
        connectionState={connectionState}
        connectionScope="realtime"
        language={settings.language}
        settings={settings}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((prev) => !prev)}
        onSettingsChange={(updates) => {
          if (updates.language) {
            setLanguage(updates.language);
          }
          if (updates.theme === 'dark' || updates.theme === 'light') {
            setTheme(updates.theme);
          }
          if (typeof updates.autoFocusInput === 'boolean') {
            setAutoFocusInput(updates.autoFocusInput);
          }
        }}
        onExitDashboard={() => navigate('/dashboard')}
        onLogout={handleLogout}
      />
      <TopBar
        language={settings.language}
        theme={settings.theme}
        selectedCategory={userInput.category}
        selectedAudiences={userInput.targetAudience}
        selectedGoals={userInput.goals}
        riskLevel={userInput.riskAppetite}
        maturity={userInput.ideaMaturity}
        activePanel={activePanel}
        reasoningCount={simulation.reasoningFeed.length}
        currentPhaseLabel={topBarPhaseLabel}
        searchLabel={topBarSearchLabel}
        onPanelChange={handleManualPanelSwitch}
      />
      {creditNotice && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3">
          <span>{creditNotice}</span>
          <button
            type="button"
            onClick={() => navigate('/bonus')}
            className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-900"
          >
            {settings.language === 'ar' ? 'شحن رصيد' : 'Buy credits'}
          </button>
        </div>
      )}
      {isClarificationPause && (
        <div className="mx-4 mt-3 rounded-xl border border-orange-400/35 bg-orange-500/12 px-4 py-2 text-xs text-orange-100">
          <p className="leading-5">{clarificationBannerText}</p>
          {simulation.pendingClarification?.reasonSummary && (
            <p className="mt-0.5 text-[11px] leading-5 text-orange-100/75">{simulation.pendingClarification.reasonSummary}</p>
          )}
        </div>
      )}
      {isResearchReviewPause && (
        <div className="mx-4 mt-3 rounded-xl border border-orange-400/35 bg-orange-500/12 px-4 py-2 text-xs text-orange-100">
          <p className="leading-5">{researchReviewBannerText}</p>
          {simulation.pendingResearchReview?.gapSummary && (
            <p className="mt-0.5 text-[11px] leading-5 text-orange-100/75">{simulation.pendingResearchReview.gapSummary}</p>
          )}
        </div>
      )}
      {isCoachPause && simulation.coachIntervention && (
        <div className="mx-4 mt-3 rounded-xl border border-orange-400/35 bg-orange-500/12 px-4 py-2 text-xs text-orange-100">
          <p className="leading-5">{coachBannerText}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-orange-100/80">{simulation.coachIntervention.blockerSummary}</p>
          {simulation.coachIntervention.guideMessage && (
            <p className="mt-0.5 text-[11px] leading-5 text-orange-100/70">{simulation.coachIntervention.guideMessage}</p>
          )}
        </div>
      )}
      {startChoiceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-background/95 shadow-2xl p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground">
                {settings.language === 'ar' ? 'كيف تريد تشغيل المحاكاة؟' : 'How would you like to run the simulation?'}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {settings.language === 'ar'
                  ? 'اختر المسار المناسب قبل بدء التنفيذ.'
                  : 'Choose a run path before execution starts.'}
              </p>
              {societyCatalog && (
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-2">
                  {settings.language === 'ar'
                    ? `المجتمع الحالي يحتوي ${societyCatalog.total_templates} قالب شخصية عبر ${societyCatalog.categories.length} فئات.`
                    : `Current society has ${societyCatalog.total_templates} persona templates across ${societyCatalog.categories.length} categories.`}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => handleSelectStartPath('inspect_default')}
                className="rounded-xl border border-border/50 bg-secondary/25 hover:bg-secondary/40 p-3 text-start transition"
              >
                <div className="text-sm font-medium text-foreground">
                  {settings.language === 'ar' ? 'استعرض المجتمع الحالي' : 'View current society'}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {settings.language === 'ar' ? 'افتح الإعدادات وراجع المجتمع الافتراضي.' : 'Inspect default setup first.'}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSelectStartPath('build_custom')}
                className="rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/15 p-3 text-start transition"
              >
                <div className="text-sm font-medium text-foreground">
                  {settings.language === 'ar' ? 'ابنِ مجتمعك الخاص' : 'Create your own society'}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {settings.language === 'ar' ? 'فعّل لوحة التحكم المتقدمة وعدّل الشخصيات.' : 'Open advanced builder controls.'}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSelectStartPath('start_default')}
                className="rounded-xl border border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/15 p-3 text-start transition"
              >
                <div className="text-sm font-medium text-emerald-200">
                  {settings.language === 'ar' ? 'ابدأ بالمجتمع الافتراضي' : 'Start with default society'}
                </div>
                <div className="text-xs text-emerald-100/80 mt-1">
                  {settings.language === 'ar' ? 'ابدأ التنفيذ فورًا بالإعدادات الحالية.' : 'Run immediately with current defaults.'}
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4 xl:overflow-hidden">
        <div className="flex min-h-full flex-col gap-4 xl:hidden">
          <div className="h-[74dvh] min-h-[420px]">{arenaPanel}</div>
          <div className="h-[68dvh] min-h-[420px]">{sidePanel}</div>
          <div className="h-[62dvh] min-h-[360px]">{metricsPane}</div>
        </div>

        <div className="hidden h-full min-h-0 xl:block">
          <ResizablePanelGroup direction="horizontal" className="gap-0 rounded-[36px] border border-border/60 bg-card/20 p-3">
            <ResizablePanel defaultSize={32} minSize={24}>
              <div className="h-full min-h-0 pe-3">{sidePanel}</div>
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-1.5 rounded-full bg-border/70" />
            <ResizablePanel defaultSize={43} minSize={30}>
              <div className="h-full min-h-0 px-3">{arenaPanel}</div>
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-1.5 rounded-full bg-border/70" />
            <ResizablePanel defaultSize={25} minSize={18}>
              <div className="h-full min-h-0 ps-3">{metricsPane}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
};

export default Index;
