import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/Header';
import {
  CATEGORY_OPTIONS,
  AUDIENCE_OPTIONS,
  GOAL_OPTIONS,
  MATURITY_LEVELS,
} from '@/components/TopBar';
import { ChatPanel } from '@/components/ChatPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { SimulationArena } from '@/components/SimulationArena';
import { MetricsPanel } from '@/components/MetricsPanel';
import { IterationTimeline } from '@/components/IterationTimeline';
import { useSimulation } from '@/hooks/useSimulation';
import { ChatMessage, UserInput } from '@/types/simulation';
import { websocketService } from '@/services/websocket';
import { apiService, SearchResponse, UserMe } from '@/services/api';
import { cn } from '@/lib/utils';
import { addIdeaLogEntry, updateIdeaLogEntry } from '@/lib/ideaLog';

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
const SEARCH_TIMEOUT_BASE_MS = 10000;
const SEARCH_TIMEOUT_STEP_MS = 7000;
const SEARCH_TIMEOUT_MAX_MS = 30000;

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

const parseNumericQualityFields = (raw: string) => {
  const text = String(raw || '');
  const readPair = (key: string) => {
    const match = text.match(new RegExp(`${key}=([0-9.]+)/([0-9.]+)`, 'i'));
    if (!match) return null;
    return {
      current: Number(match[1]),
      required: Number(match[2]),
    };
  };
  const usable = readPair('usable_sources');
  const domains = readPair('domains');
  const chars = readPair('max_content_chars');
  const extraction = (() => {
    const match = text.match(/extraction_success_rate=([0-9.]+)/i);
    return match ? Number(match[1]) : null;
  })();
  return { usable, domains, chars, extraction };
};

const formatSearchFailureReason = (
  reason: string | null | undefined,
  language: 'ar' | 'en',
  searchQuality?: {
    usable_sources: number;
    domains: number;
    extraction_success_rate: number;
  } | null
) => {
  const raw = String(reason || '').trim();
  if (!raw) return '';
  const isQualityGate = /search quality below threshold/i.test(raw);
  if (!isQualityGate) return raw;

  const parsed = parseNumericQualityFields(raw);
  const usableCurrent = parsed.usable?.current ?? searchQuality?.usable_sources ?? 0;
  const usableRequired = parsed.usable?.required ?? 2;
  const domainsCurrent = parsed.domains?.current ?? searchQuality?.domains ?? 0;
  const domainsRequired = parsed.domains?.required ?? 2;
  const charsCurrent = parsed.chars?.current ?? 0;
  const charsRequired = parsed.chars?.required ?? 80;
  const extractionRate = parsed.extraction ?? searchQuality?.extraction_success_rate ?? 0;

  if (language === 'ar') {
    return `جودة البحث أقل من الحد المطلوب. المصادر الصالحة: ${usableCurrent}/${usableRequired}، النطاقات المختلفة: ${domainsCurrent}/${domainsRequired}، أكبر محتوى مستخرج: ${charsCurrent}/${charsRequired} حرف، ونسبة نجاح الاستخراج: ${(extractionRate * 100).toFixed(0)}%.`;
  }

  return `Search quality is below the required threshold. Usable sources: ${usableCurrent}/${usableRequired}, domains: ${domainsCurrent}/${domainsRequired}, max extracted content: ${charsCurrent}/${charsRequired} chars, extraction success: ${(extractionRate * 100).toFixed(0)}%.`;
};



const Index = () => {
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
  const [hasStarted, setHasStarted] = useState(false);
  const [autoStartPending, setAutoStartPending] = useState(false);
  const summaryRef = useRef<string | null>(null);
  const searchPromptedRef = useRef(false);
  const searchAttemptRef = useRef(0);
  const [settings, setSettings] = useState({
    language: 'ar' as 'ar' | 'en',
    theme: 'dark',
    autoFocusInput: true,
  });
  const [showSettings, setShowSettings] = useState(false);

  const [activePanel, setActivePanel] = useState<'config' | 'chat'>('chat');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [pendingConfigReview, setPendingConfigReview] = useState(false);
  const [isConfigSearching, setIsConfigSearching] = useState(false);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmRetryMessage, setLlmRetryMessage] = useState<string | null>(null);
  const [summaryAdvice, setSummaryAdvice] = useState<string>('');
  const [summaryReasons, setSummaryReasons] = useState<string[]>([]);
  const [pendingResearchReview, setPendingResearchReview] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [researchReviewBusy, setResearchReviewBusy] = useState(false);
  const [clarificationBusy, setClarificationBusy] = useState(false);
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
  const [searchState, setSearchState] = useState<{
    status: 'idle' | 'searching' | 'complete' | 'timeout' | 'error';
    query?: string;
    answer?: string;
    provider?: string;
    isLive?: boolean;
    results?: SearchResponse['results'];
    timeoutMs?: number;
    attempts?: number;
  }>({ status: 'idle' });
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

  const getAssistantMessage = useCallback(async (prompt: string) => {
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
    } catch {
      return '';
    }
  }, [chatMessages, settings.language]);

  const extractWithRetry = useCallback(async (message: string, schemaPayload: Record<string, unknown>) => {
    const timeoutMs = 10000;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await Promise.race([
          apiService.extractSchema(message, schemaPayload),
          new Promise<ReturnType<typeof apiService.extractSchema>>((_, reject) =>
            setTimeout(() => reject(new Error('Extract timeout')), timeoutMs)
          ),
        ]);
        return result;
      } catch (err) {
        if (attempt == 1) {
          throw err;
        }
      }
    }
    throw new Error('Extract failed');
  }, []);

  const addSystemMessage = useCallback((
    content: string,
    options?: ChatMessage['options'],
    mode: 'replace_previous_system' | 'append' = 'replace_previous_system'
  ) => {
    const cleanedContent = normalizeAssistantText(content);
    const message: ChatMessage = {
      id: `sys-${Date.now()}`,
      type: 'system',
      content: cleanedContent,
      timestamp: Date.now(),
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
      const next = [
        ...prev,
        {
          id: `user-${Date.now()}`,
          type: 'user' as const,
          content: trimmed,
          timestamp: Date.now(),
        },
      ];
      if (next.length <= MAX_CHAT_MESSAGES) return next;
      return next.slice(-MAX_CHAT_MESSAGES);
    });
  }, []);

  useEffect(() => {
    if (!requestedSimulationId) return;
    if (
      loadedFromQueryRef.current === requestedSimulationId
      && simulation.simulationId === requestedSimulationId
    ) {
      return;
    }
    loadedFromQueryRef.current = requestedSimulationId;
    setAutoStartPending(false);
      simulation.loadSimulation(requestedSimulationId).catch((err: unknown) => {
      const msg = err instanceof Error && err.message ? ` ${err.message}` : '';
      addSystemMessage(
        settings.language === 'ar'
          ? `تعذر تحميل جلسة المحاكاة.${msg}`.trim()
          : `Failed to load simulation session.${msg}`.trim()
      );
    });
  }, [
    addSystemMessage,
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
    addSystemMessage(simulation.summary);
    const arMatch = simulation.summary.split('صياغة إقناع الرافضين:')[1];
    const enMatch = simulation.summary.split('Advice to persuade rejecters:')[1];
    const advice = (arMatch || enMatch || '').trim();
    if (advice) {
      setSummaryAdvice(advice);
    }
    const reasonKeywords = settings.language === 'ar'
      ? ['خطر', 'قلق', 'رفض', 'غير واضح', 'غير حاسم', 'امتثال', 'ثقة', 'خصوصية', 'تكلفة', 'منافس']
      : ['risk', 'concern', 'reject', 'unclear', 'inconclusive', 'compliance', 'trust', 'privacy', 'cost', 'competition'];
    const sentences = simulation.summary
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const reasons = sentences.filter((s) => reasonKeywords.some((k) => s.toLowerCase().includes(k)));
    if (reasons.length) {
      setSummaryReasons(reasons.slice(0, 4));
    }
    summaryRef.current = simulation.summary;
  }, [simulation.summary, addSystemMessage, settings.language]);

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
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings((prev) => ({ ...prev, ...parsed }));
      } catch {
        // ignore
      }
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
    localStorage.setItem('appSettings', JSON.stringify(settings));
    const root = document.documentElement;
    root.lang = settings.language;
    root.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    root.classList.toggle('rtl', settings.language === 'ar');
    root.classList.toggle('lang-ar', settings.language === 'ar');
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${settings.theme}`);
  }, [settings]);

  const buildConfig = useCallback((input: UserInput) => {
    const trimmedIdea = input.idea.trim();
    const hasMatchingResearch = Boolean(trimmedIdea && researchIdea && researchIdea === trimmedIdea);
    const researchSummary = hasMatchingResearch ? researchContext.summary : '';
    const researchSources = hasMatchingResearch ? researchContext.sources : [];
    const researchStructured = hasMatchingResearch ? researchContext.structured : undefined;
    return {
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
    };
  }, [researchContext, researchIdea, settings.language, simulationSpeed]);

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
      .catch(() => {
        if (active) setCreditNotice(null);
      });
    return () => { active = false; };
  }, [isCreditsBlocked, settings.language]);


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

  const handleStart = useCallback(async () => {
    const missing = getMissingForStart(userInput);
    const asked = await promptForMissing(missing);
    if (asked) return;

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
    try {
      addSystemMessage(settings.language === 'ar' ? 'بدء المحاكاة...' : 'Starting simulation...');
      await simulation.startSimulation(buildConfig(userInput), { throwOnError: true });
      void apiService.getMe().then((me) => {
        setMeSnapshot(me);
        if (!isCreditsBlocked(me)) {
          setCreditNotice(null);
        }
      }).catch(() => undefined);
    } catch (err) {
      console.warn('Simulation start failed.', err);
      setReasoningActive(false);
      const status = err?.status;
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
        } catch {
          addSystemMessage(settings.language === 'ar'
            ? 'انتهت الحصة اليومية المجانية من التوكنز. اشحن Credits أو انتظر للغد.'
            : 'Daily free token quota reached. Add credits to continue.');
        }
        return;
      }
      if (status === 401) {
        addSystemMessage(settings.language === 'ar'
          ? 'فشل بدء الجلسة. سجّل الدخول مرة أخرى.'
          : 'Session expired. Please log in again.');
        return;
      }
      const msg = err?.message ? ` ${err.message}` : '';
      addSystemMessage(settings.language === 'ar'
        ? `Failed to start simulation.${msg}`.trim()
        : `Failed to start simulation.${msg}`.trim());
    }
  }, [
    addUserMessage,
    addSystemMessage,
    buildConfig,
    getMissingForStart,
    hasStarted,
    isCreditsBlocked,
    meSnapshot,
    promptForMissing,
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
    settings.language,
    simulation.resumeSimulation,
    simulation.simulationId,
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
    settings.language,
    simulation.pauseSimulation,
    simulation.simulationId,
    simulation.status,
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
      await simulation.submitResearchAction({
        simulationId: simulation.simulationId,
        cycleId: payload.cycleId,
        action: payload.action,
        selectedUrlIds: payload.selectedUrlIds,
        addedUrls: payload.addedUrls,
        queryRefinement: payload.queryRefinement,
      });
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
    } catch (err) {
      console.warn('Report generation failed', err);
      addSystemMessage(settings.language === 'ar'
        ? 'حصلت مشكلة أثناء تجهيز التقرير.'
        : 'Report generation failed.');
    } finally {
      setReportBusy(false);
    }
  }, [addSystemMessage, escapeHtml, reportBusy, researchContext.summary, researchContext.structured, settings.language, simulation.summary, userInput.city, userInput.country, userInput.idea]);

  const runSearch = useCallback(async (query: string, timeoutMs: number, options?: { promptOnTimeout?: boolean }) => {
    const promptOnTimeout = options?.promptOnTimeout ?? true;
    searchAttemptRef.current += 1;
    const attempt = searchAttemptRef.current;
    setResearchIdea(query.trim());
    setSearchState({ status: 'searching', query, timeoutMs, attempts: attempt });
    setIsConfigSearching(true);
    try {
      const locationLabel = getSearchLocationLabel();
      const search = await Promise.race([
        apiService.searchWeb(query, settings.language === 'ar' ? 'ar' : 'en', 5),
        new Promise<SearchResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
        ),
      ]);
      const searchData = search as SearchResponse;
      const hasStructured =
        Boolean(searchData.structured?.summary)
        || Boolean(searchData.structured?.signals?.length)
        || Boolean(searchData.structured?.gaps?.length)
        || Boolean(searchData.structured?.notable_locations?.length)
        || Boolean(searchData.structured?.competition_level)
        || Boolean(searchData.structured?.demand_level)
        || Boolean(searchData.structured?.price_sensitivity)
        || Boolean(searchData.structured?.regulatory_risk);
      const hasAnswer = Boolean(searchData.answer?.trim());
      if (!hasStructured && !hasAnswer) {
        setSearchState({
          status: 'timeout',
          query,
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
            query,
            timeoutMs,
            attempts: attempt,
          }));
          searchPromptedRef.current = true;
        }
        return { status: 'timeout' as const };
      }
      setSearchState({
        status: 'complete',
        query,
        answer: searchData.answer,
        provider: searchData.provider,
        isLive: searchData.is_live,
        results: searchData.results,
        timeoutMs,
        attempts: attempt,
      });
      const summary = searchData.structured?.summary
        || searchData.answer
        || searchData.results.map((r) => r.snippet).filter(Boolean).slice(0, 3).join(' ');
      setResearchContext({ summary, sources: searchData.results, structured: searchData.structured });
      const report = buildSearchSummary(searchData, locationLabel);
      if (report) {
        addSystemMessage(report);
      }
      searchPromptedRef.current = false;
      return { status: 'complete' as const };
    } catch {
      setSearchState({
        status: 'timeout',
        query,
        answer: '',
        provider: 'none',
        isLive: false,
        results: [],
        timeoutMs,
        attempts: attempt,
      });
      setResearchContext({ summary: '', sources: [], structured: undefined });
      if (promptOnTimeout && !searchPromptedRef.current) {
        addSystemMessage(getSearchTimeoutPrompt({
          locationLabel: getSearchLocationLabel(),
          query,
          timeoutMs,
          attempts: attempt,
        }));
        searchPromptedRef.current = true;
      }
      return { status: 'timeout' as const };
    } finally {
      setIsConfigSearching(false);
    }
  }, [addSystemMessage, buildSearchSummary, getSearchLocationLabel, getSearchTimeoutPrompt, settings.language, setSearchState, setResearchContext, setResearchIdea]);


  const handleConfigSubmit = useCallback(async () => {
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
    setActivePanel('chat');
    await handleStart();
  }, [getMissingForStart, handleStart, promptForMissing, userInput, setPendingConfigReview, setActivePanel]);

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

  const handleConfirmStart = useCallback(async () => {
    if (!pendingResearchReview) return;
    setPendingResearchReview(false);
    await handleStart();
  }, [handleStart, pendingResearchReview]);

  const handleSendMessage = useCallback(
    (content: string, options?: { skipUserMessage?: boolean }) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (!options?.skipUserMessage) {
        addUserMessage(trimmed);
      }

      void (async () => {
        try {
          if (pendingResearchReview) {
            if (trimmed) {
              const correctionPrefix = settings.language === 'ar' ? 'تصحيح المستخدم: ' : 'User correction: ';
              const nextSummary = `${researchContext.summary ? `${researchContext.summary}\n` : ''}${correctionPrefix}${trimmed}`;
              const nextStructured = researchContext.structured
                ? { ...researchContext.structured, summary: nextSummary }
                : { summary: nextSummary };
              setResearchContext({ summary: nextSummary, sources: researchContext.sources, structured: nextStructured });
              addSystemMessage(settings.language === 'ar'
                ? 'تم تحديث البيانات بناءً على ملاحظتك.'
                : 'Got it. I updated the data based on your note.');
              addSystemMessage(settings.language === 'ar'
                ? 'تحب أبدأ المحاكاة الآن ولا في تعديل إضافي؟'
                : 'Start the simulation, or correct anything else?');
            }
            return;
          }
          if (pendingConfigReview) {
            const lower = trimmed.toLowerCase();
            const confirm = ['yes', 'ok', 'okay', 'go', 'start', 'run', 'y', '\u062a\u0645', '\u062a\u0645\u0627\u0645', '\u0645\u0648\u0627\u0641\u0642', '\u0646\u0639\u0645', '\u0627\u0628\u062f\u0623', '\u0627\u0628\u062f\u0621'];
            const edit = ['تعديل', 'اعدادات', 'الإعدادات', 'settings', 'config'];
            if (confirm.includes(lower)) {
              await handleConfigSubmit();
              return;
            }
            if (edit.includes(lower)) {
              setActivePanel('config');
              addSystemMessage(settings.language === 'ar'
                ? 'عدّل الإعدادات ثم اضغط تأكيد البيانات.'
                : 'Update the configuration, then confirm.');
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
              setActivePanel('config');
              setMissingFields([]);
              addSystemMessage(settings.language === 'ar'
                ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
                : 'Review the configuration, then confirm to continue.');
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
            } catch {
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
            setActivePanel('config');
            setMissingFields([]);
            addSystemMessage(settings.language === 'ar'
              ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
              : 'Review the configuration, then confirm to continue.');
            return;
          }

          // If a simulation is already running, handle discussion vs. update directly.
          if (simulation.status === 'running' || simulation.status === 'completed') {
            const context = `Idea: ${userInput.idea}. Location: ${userInput.city}, ${userInput.country}.`;
            let mode: 'update' | 'discuss' = 'discuss';
            try {
              const res = await Promise.race([
                apiService.detectMessageMode(trimmed, context, settings.language),
                new Promise<{ mode: 'update' | 'discuss' }>((_, reject) =>
                  setTimeout(() => reject(new Error('Mode timeout')), 3000)
                ),
              ]);
              mode = res.mode;
            } catch {
              const isQuestion = /[?؟]/.test(trimmed);
              mode = isQuestion ? 'discuss' : 'update';
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
          setActivePanel('config');
          setMissingFields([]);
          addSystemMessage(settings.language === 'ar'
            ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
            : 'Review the configuration, then confirm to continue.');
        } catch (err) {
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
        extractWithRetry,
        getAssistantMessage,
        getMissingForStart,
        handleConfigSubmit,
        handleStart,
        pendingResearchReview,
        pendingConfigReview,
        pendingUpdate,
        promptForMissing,
        researchContext,
        setResearchContext,
        settings.language,
        simulation,
        isWaitingForLocationChoice,
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
          setActivePanel('config');
          setMissingFields([]);
          addSystemMessage(settings.language === 'ar'
            ? 'راجع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
            : 'Review the configuration, then confirm to continue.');
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
      simulation.pendingClarification,
      setActivePanel,
      setPendingConfigReview,
      setMissingFields,
      settings.language,
      userInput,
      userInput.goals,
      userInput.targetAudience,
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
    const needsResearchReview = Boolean(
      simulation.simulationId
      && simulation.status === 'paused'
      && simulation.statusReason === 'paused_research_review'
      && simulation.pendingResearchReview?.cycleId
    );
    if (!needsClarification && !needsResearchReview) return;
    setActivePanel('chat');
  }, [
    simulation.pendingClarification,
    simulation.pendingResearchReview,
    simulation.simulationId,
    simulation.status,
    simulation.statusReason,
  ]);

  useEffect(() => {
    if (simulation.status !== 'paused' || simulation.statusReason !== 'paused_credits_exhausted') return;
    const message = settings.language === 'ar'
      ? 'توقف التنفيذ لأن الرصيد نفد أثناء المحاكاة. اشحن Credits ثم اضغط استكمال للمتابعة من نفس النقطة.'
      : 'Token budget was exhausted mid-run. Add credits and press Resume.';
    setCreditNotice(message);
  }, [settings.language, simulation.status, simulation.statusReason]);

  const hasProgress = simulation.metrics.currentIteration > 0 || simulation.reasoningFeed.length > 0;
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
    && simulation.pendingResearchReview?.cycleId
  );
  const resumeBannerText = simulation.statusReason === 'paused_manual'
    ? (settings.language === 'ar'
      ? 'تم إيقاف الجلسة يدويًا. يمكنك المتابعة من آخر نقطة محفوظة.'
      : 'Simulation is paused manually. Resume from the last checkpoint.')
    : simulation.statusReason === 'paused_credits_exhausted'
      ? (settings.language === 'ar'
        ? 'توقفت الجلسة بسبب نفاد الرصيد. اشحن Credits ثم استكمل من نفس النقطة.'
        : 'Simulation paused because credits were exhausted. Recharge and resume from the same point.')
      : simulation.statusReason === 'paused_search_failed'
        ? (settings.language === 'ar'
          ? 'توقف البحث الأولي قبل اكتمال الجلسة. يمكنك إعادة الاستكمال من آخر نقطة.'
          : 'Search bootstrap failed before completion. You can resume from the latest checkpoint.')
        : (settings.language === 'ar'
          ? 'تم إيقاف الجلسة مؤقتًا. يمكنك المتابعة من آخر نقطة محفوظة.'
          : 'This simulation was interrupted. You can resume from the latest checkpoint.');
  const formattedResumeReason = formatSearchFailureReason(
    simulation.resumeReason,
    settings.language,
    simulation.searchQuality
  );
  const clarificationBannerText = settings.language === 'ar'
    ? 'المحاكاة متوقفة مؤقتًا لأن الوكلاء يحتاجون توضيحًا منك قبل الاستكمال.'
    : 'Simulation is paused because agents require clarification before continuing.';
  const researchReviewBannerText = settings.language === 'ar'
    ? 'تم إيقاف المحاكاة مؤقتًا لمراجعة روابط البحث. اختر روابط ثم واصل الاستخراج.'
    : 'Simulation is paused for research review. Select URLs then continue scraping.';
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

    if (simulation.status === 'running') {
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

    if (searchState.status === 'searching' || isConfigSearching || isChatThinking) {
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
        label: settings.language === 'ar' ? 'إعادة البحث' : 'Retry search',
        description: settings.language === 'ar' ? 'سنحاول بمصادر إضافية قبل الإيقاف' : 'Try again with expanded source queries',
        disabled: false,
        busy: false,
        tone: 'warning' as const,
        icon: 'retry' as const,
        onClick: () => { void handleSearchRetry(); },
      };
    }

    if (pendingConfigReview) {
      return {
        key: 'confirm_start',
        label: settings.language === 'ar' ? 'تأكيد البيانات وبدء المحاكاة' : 'Confirm data and start',
        description: settings.language === 'ar' ? 'سيبدأ البحث أولًا ثم التفكير' : 'Search starts first, then reasoning',
        disabled: isConfigSearching,
        busy: isConfigSearching,
        tone: 'primary' as const,
        icon: 'play' as const,
        onClick: () => { void handleConfigSubmit(); },
      };
    }

    if (pendingResearchReview) {
      return {
        key: 'start_reasoning',
        label: settings.language === 'ar' ? 'ابدأ المحاكاة الآن' : 'Start simulation now',
        description: settings.language === 'ar' ? 'سيتم تشغيل مرحلة التفكير مباشرة' : 'Reasoning phase will begin now',
        disabled: false,
        busy: false,
        tone: 'primary' as const,
        icon: 'play' as const,
        onClick: () => { void handleConfirmStart(); },
      };
    }

    return {
      key: 'start',
      label: settings.language === 'ar' ? 'ابدأ المحاكاة' : 'Start simulation',
      description: settings.language === 'ar' ? 'التحقق من البيانات ثم البحث ثم التفكير' : 'Validate data, run search, then reason',
      disabled: !hasIdea,
      busy: false,
      tone: 'primary' as const,
      icon: 'play' as const,
      onClick: () => { void handleConfigSubmit(); },
    };
  }, [
    clarificationBusy,
    handleConfigSubmit,
    handleConfirmStart,
    handleManualPause,
    handleManualResume,
    handleSearchRetry,
    isClarificationPause,
    isResearchReviewPause,
    isChatThinking,
    isConfigSearching,
    pauseBusy,
    pendingConfigReview,
    pendingResearchReview,
    researchReviewBusy,
    simulation.currentPhaseKey,
    resumeBusy,
    searchState.status,
    settings.language,
    showResumeAction,
    simulation.simulationId,
    simulation.status,
    setActivePanel,
    userInput.idea,
  ]);
  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <Header
        simulationStatus={simulation.status}
        isConnected={websocketService.isConnected()}
        language={settings.language}
        settings={settings}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((prev) => !prev)}
        onSettingsChange={(updates) => setSettings((prev) => ({ ...prev, ...updates }))}
        onExitDashboard={() => navigate('/dashboard')}
        onLogout={handleLogout}
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
      {simulation.status === 'running' && simulation.simulationId && (
        <div className="mx-4 mt-3 rounded-2xl border border-slate-400/30 bg-slate-500/10 px-4 py-3 text-sm text-slate-100">
          {settings.language === 'ar'
            ? 'المحاكاة تعمل الآن. يمكنك التحكم الكامل من زر التحكم الرئيسي داخل الدردشة.'
            : 'Simulation is running. Use the main controller button in chat for pause/resume actions.'}
        </div>
      )}
      {isClarificationPause && (
        <div className="mx-4 mt-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <p>{clarificationBannerText}</p>
          {simulation.pendingClarification?.reasonSummary && (
            <p className="text-xs text-cyan-200/80 mt-1">{simulation.pendingClarification.reasonSummary}</p>
          )}
        </div>
      )}
      {isResearchReviewPause && (
        <div className="mx-4 mt-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <p>{researchReviewBannerText}</p>
          {simulation.pendingResearchReview?.gapSummary && (
            <p className="text-xs text-cyan-200/80 mt-1">{simulation.pendingResearchReview.gapSummary}</p>
          )}
        </div>
      )}
      {showResumeAction && (
        <div className="mx-4 mt-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <p>{resumeBannerText}</p>
          {formattedResumeReason && (
            <p className="text-xs text-cyan-200/80 mt-1">{formattedResumeReason}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0 p-3 md:p-4">
        <div dir="ltr" className="h-full grid grid-cols-1 xl:grid-cols-[65%_35%] gap-4 min-h-0">
          <div className="order-2 xl:order-1 min-h-0 grid grid-rows-[minmax(0,1fr)_auto] gap-4">
            <div className="min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
              <div className="min-h-0 rounded-2xl border border-border/50 overflow-hidden">
                <SimulationArena
                  agents={Array.from(simulation.agents.values())}
                  activePulses={simulation.activePulses}
                />
              </div>
              <div className="min-h-0">
                <MetricsPanel
                  metrics={simulation.metrics}
                  language={settings.language}
                  onSelectStance={handleSelectStanceFilter}
                  selectedStance={selectedStanceFilter}
                  filteredAgents={filteredAgents}
                  filteredAgentsTotal={filteredAgentsTotal}
                />
              </div>
            </div>
            <IterationTimeline
              currentIteration={simulation.metrics.currentIteration}
              totalIterations={simulation.metrics.totalIterations}
              language={settings.language}
              currentPhaseKey={simulation.currentPhaseKey}
              phaseProgressPct={simulation.phaseProgressPct}
            />
          </div>

          <div className="order-1 xl:order-2 min-h-0 rounded-2xl border border-border/50 bg-card/20 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-background/50 backdrop-blur">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActivePanel('chat')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition',
                    activePanel === 'chat'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {settings.language === 'ar' ? 'الدردشة' : 'Chat'}
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('config')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition',
                    activePanel === 'config'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {settings.language === 'ar' ? 'الإعدادات' : 'Config'}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1" dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
              {activePanel === 'config' ? (
                <ConfigPanel
                  value={userInput}
                  onChange={(updates) => {
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
                  }}
                  onSubmit={handleConfigSubmit}
                  missingFields={missingFields}
                  language={settings.language}
                  isSearching={isConfigSearching}
                />
              ) : (
                <ChatPanel
                  messages={chatMessages}
                  reasoningFeed={simulation.reasoningFeed}
                  reasoningDebug={simulation.reasoningDebug}
                  onSendMessage={handleSendMessage}
                  onSelectOption={handleOptionSelect}
                  isWaitingForCity={isWaitingForCity}
                  isWaitingForCountry={isWaitingForCountry}
                  isWaitingForLocationChoice={isWaitingForLocationChoice}
                  searchState={searchState}
                  isThinking={isChatThinking}
                  showRetry={llmBusy}
                  onRetryLlm={handleRetryLlm}
                  simulationStatus={simulation.status}
                  reasoningActive={reasoningActive}
                  isSummarizing={isSummarizing}
                  rejectedCount={simulation.metrics.rejected}
                  phaseState={{
                    currentPhaseKey: simulation.currentPhaseKey,
                    progressPct: simulation.phaseProgressPct,
                  }}
                  researchSourcesLive={simulation.researchSources}
                  quickReplies={quickReplies || undefined}
                  onQuickReply={handleQuickReply}
                  primaryControl={primaryControl}
                  pendingClarification={simulation.pendingClarification}
                  canAnswerClarification={simulation.canAnswerClarification}
                  clarificationBusy={clarificationBusy}
                  onSubmitClarification={handleSubmitClarification}
                  pendingResearchReview={simulation.pendingResearchReview}
                  researchReviewBusy={researchReviewBusy}
                  onSubmitResearchReviewAction={handleSubmitResearchAction}
                  postActionsEnabled={simulation.status === 'completed' && Boolean(simulation.simulationId)}
                  recommendedPostAction={recommendedPostAction}
                  finalAcceptancePct={finalAcceptancePct}
                  postActionBusy={postActionBusy}
                  postActionResult={postActionResult}
                  onRunPostAction={(action) => { void handleRunPostAction(action); }}
                  onStartFollowupFromPostAction={() => { void handleStartFollowupFromAction(); }}
                  reportBusy={reportBusy}
                  onDownloadReport={handleDownloadReport}
                  insights={{
                    idea: userInput.idea,
                    location: `${userInput.city || ''}${userInput.city && userInput.country ? ', ' : ''}${userInput.country || ''}`.trim(),
                    category: userInput.category,
                    audience: userInput.targetAudience,
                    goals: userInput.goals,
                    maturity: userInput.ideaMaturity,
                    risk: userInput.riskAppetite,
                    summary: simulation.summary || '',
                    rejectReasons: summaryReasons,
                  }}
                  research={{
                    summary: researchContext.summary,
                    signals: researchContext.structured?.signals,
                    competition: researchContext.structured?.competition_level,
                    demand: researchContext.structured?.demand_level,
                    priceSensitivity: researchContext.structured?.price_sensitivity,
                    regulatoryRisk: researchContext.structured?.regulatory_risk,
                    gaps: researchContext.structured?.gaps,
                    notableLocations: researchContext.structured?.notable_locations,
                    sourcesCount: researchContext.sources.length,
                  }}
                  settings={settings}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;




