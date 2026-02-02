import { useState, useCallback, useEffect, useRef } from 'react';
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
import { apiService, SearchResponse } from '@/services/api';
import { cn } from '@/lib/utils';

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
  Developers: { ar: 'مطوّرون ومهندسو برمجيات', en: 'Software developers and engineers' },
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




const Index = () => {
  const simulation = useSimulation();
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
    agentCount: 30,
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
  const summaryRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchPromptedRef = useRef(false);
  const searchAttemptRef = useRef(0);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
  const dragRef = useRef<{ side: 'left' | 'right' | null; startX: number; startLeft: number; startRight: number }>({
    side: null,
    startX: 0,
    startLeft: 320,
    startRight: 320,
  });
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
  const [reasoningActive, setReasoningActive] = useState(false);
  const reasoningTimerRef = useRef<number | null>(null);
  const [searchState, setSearchState] = useState<{
    status: 'idle' | 'searching' | 'done' | 'timeout';
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

  const getAssistantMessage = useCallback(async (prompt: string) => {
    const context = chatMessages
      .slice(-6)
      .map((msg) => `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
    const fullPrompt = context ? `Conversation:\n${context}\nUser: ${prompt}\nAssistant:` : prompt;
    const system = settings.language === 'ar'
      ? 'أنت مساعد موجز لواجهة محاكاة منتجات. أجب بالعربية وبدون تنسيق Markdown.'
      : 'You are a concise assistant for a product simulation UI. Avoid markdown formatting like **bold**.';
    try {
      const timeoutMs = 6000;
      const text = await Promise.race([
        apiService.generateMessage(fullPrompt, system),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout')), timeoutMs)
        ),
      ]);
      return String(text).replace(/\*\*/g, '').trim();
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

  const addSystemMessage = useCallback((content: string, options?: ChatMessage['options']) => {
    const message: ChatMessage = {
      id: `sys-${Date.now()}`,
      type: 'system',
      content,
      timestamp: Date.now(),
      options,
    };
    setChatMessages((prev) => [...prev, message]);
  }, []);

  useEffect(() => {
    if (!simulation.summary) return;
    if (simulation.summary === summaryRef.current) return;
    addSystemMessage(simulation.summary);
    const arMatch = simulation.summary.split('نصيحة لإقناع المعارضين:')[1];
    const enMatch = simulation.summary.split('Advice to persuade rejecters:')[1];
    const advice = (arMatch || enMatch || '').trim();
    if (advice) {
      setSummaryAdvice(advice);
    }
    const reasonKeywords = settings.language === 'ar'
      ? ['مخاطر', 'قلق', 'رفض', 'غير واضح', 'غير حاسم', 'امتثال', 'ثقة', 'خصوصية', 'تكلفة', 'منافس']
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
    const savedLayout = localStorage.getItem('layoutWidths');
    if (savedLayout) {
      try {
        const parsed = JSON.parse(savedLayout);
        if (parsed.left) setLeftWidth(parsed.left);
        if (parsed.right) setRightWidth(parsed.right);
      } catch {
        // ignore
      }
    }
  }, []);

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

  useEffect(() => {
    localStorage.setItem('layoutWidths', JSON.stringify({ left: leftWidth, right: rightWidth }));
  }, [leftWidth, rightWidth]);

  const buildConfig = useCallback((input: UserInput) => {
    return {
      idea: input.idea.trim(),
      category: input.category || DEFAULT_CATEGORY,
      targetAudience: input.targetAudience,
      country: input.country.trim(),
      city: input.city.trim(),
      riskAppetite: (input.riskAppetite ?? 50) / 100,
      ideaMaturity: input.ideaMaturity ?? 'concept',
      goals: input.goals,
      research_summary: researchContext.summary,
      research_sources: researchContext.sources,
      research_structured: researchContext.structured,
      language: settings.language,
      speed: simulationSpeed,
      agentCount: input.agentCount,
    };
  }, [researchContext, settings.language, simulationSpeed]);

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


  const addOptionsMessage = useCallback((
    field: 'category' | 'audience' | 'goals' | 'maturity',
    intro?: string
  ) => {
    const language = settings.language;
    if (field === 'category') {
      const items = CATEGORY_OPTIONS.map((cat) => ({
        value: cat.toLowerCase(),
        label: language === 'ar'
          ? (CATEGORY_DESCRIPTIONS[cat]?.ar ? `${cat} — ${CATEGORY_DESCRIPTIONS[cat].ar}` : cat)
          : cat,
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
      addSystemMessage(intro || (language === 'ar' ? 'مين الجمهور المستهدف؟ اختر واحد أو أكثر:' : 'Who is the target audience? Choose one or more:'), {
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
      addSystemMessage(intro || (language === 'ar' ? 'ما الهدف الأساسي؟ اختر هدفًا أو أكثر:' : 'Select the primary goal(s):'), {
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
      addSystemMessage(intro || (language === 'ar' ? 'ما مرحلة النضج الحالية؟' : 'What is the current maturity stage?'), {
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
        ? 'ما هي المدينة المستهدفة؟ (لو حابب اذكر الدولة كمان)'
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
      ? 'فيه مكان معين ف دماغك حابب تنفذ فيه الفكرة دي؟'
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
        ? 'من فضلك اكتب الفكرة في جملة واحدة.'
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
    setHasStarted(true);
    setReasoningActive(false);
    if (reasoningTimerRef.current) {
      window.clearTimeout(reasoningTimerRef.current);
    }
    try {
      await simulation.startSimulation(buildConfig(userInput));
      const startMessage = await getAssistantMessage('Confirm you are starting the simulation now in one short sentence.');
      addSystemMessage(startMessage || (settings.language === 'ar' ? 'تم بدء المحاكاة.' : 'Starting simulation...'));
    } catch (err) {
      console.warn('Simulation start failed.', err);
      addSystemMessage(settings.language === 'ar' ? 'تعذر بدء المحاكاة. تحقق من الباك إند.' : 'Failed to start simulation. Check the backend.');
    }
  }, [addSystemMessage, buildConfig, getAssistantMessage, getMissingForStart, hasStarted, promptForMissing, settings.language, simulation, userInput]);

  const getSearchLocationLabel = useCallback(() => {
    const city = userInput.city?.trim();
    const country = userInput.country?.trim();
    const label = [city, country].filter(Boolean).join(', ');
    if (label) return label;
    if (locationChoice === 'no') {
      return settings.language === 'ar' ? 'بدون مكان محدد' : 'no specific location';
    }
    return settings.language === 'ar' ? 'المكان اللي كتبته' : 'the location you entered';
  }, [locationChoice, settings.language, userInput.city, userInput.country]);

  const getSearchTimeoutPrompt = useCallback((locationLabel: string) => (
    settings.language === 'ar'
      ? `قعدت ادور كتير ومش لاقي بيانات كفاية عن ${locationLabel} (زي وجود الفكرة، رينج الاسعار، أو رأي الناس). تحب ادور تاني بس اخد وقت اكتر ولا ممكن استخدم حاجة زي ChatGPT اسأله؟`
      : `I searched for a while but couldn't find enough data for ${locationLabel} (like whether the idea exists, price ranges, or public sentiment). Want me to search longer, or should I use the LLM instead?`
  ), [settings.language]);

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
        ? `رينج الأسعار/حساسية السعر: ${formatLevel(structured.price_sensitivity)}`
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

  const parseStructuredFromLlm = useCallback((text: string): SearchResponse['structured'] | undefined => {
    if (!text) return undefined;
    const trimmed = text.trim();
    const direct = (() => {
      try {
        return JSON.parse(trimmed);
      } catch {
        return undefined;
      }
    })();
    if (direct && typeof direct === 'object') return direct as SearchResponse['structured'];

    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[0]) as SearchResponse['structured'];
    } catch {
      return undefined;
    }
  }, []);

  const normalizeStructured = useCallback((structured?: SearchResponse['structured']) => {
    if (!structured) return undefined;
    const normalizeLevel = (value?: string) => {
      const lower = value?.toLowerCase().trim();
      if (lower === 'low' || lower === 'medium' || lower === 'high') return lower as 'low' | 'medium' | 'high';
      return undefined;
    };
    return {
      ...structured,
      competition_level: normalizeLevel(structured.competition_level),
      demand_level: normalizeLevel(structured.demand_level),
      regulatory_risk: normalizeLevel(structured.regulatory_risk),
      price_sensitivity: normalizeLevel(structured.price_sensitivity),
    } as SearchResponse['structured'];
  }, []);

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
        ? `عايز تقرير تحليل عميق للفكرة دي في ملف منظم بعناوين واضحة ونقاط قصيرة.
لا تبالغ في السلبية؛ اذكر النواقص فقط لو موجودة في البيانات.
اربط التحليل بالبحث التالي وبملخص المحاكاة لو موجود.

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
6) فرص التحسين (لو موجودة)
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
        ? 'حصل مشكلة أثناء تجهيز التقرير.'
        : 'Report generation failed.');
    } finally {
      setReportBusy(false);
    }
  }, [addSystemMessage, escapeHtml, reportBusy, researchContext.summary, researchContext.structured, settings.language, simulation.summary, userInput.city, userInput.country, userInput.idea]);

  const runSearch = useCallback(async (query: string, timeoutMs: number) => {
    searchAttemptRef.current += 1;
    const attempt = searchAttemptRef.current;
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
        if (!searchPromptedRef.current) {
          addSystemMessage(getSearchTimeoutPrompt(locationLabel));
          searchPromptedRef.current = true;
        }
        return { status: 'timeout' as const };
      }
      setSearchState({
        status: 'done',
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
      return { status: 'done' as const };
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
      if (!searchPromptedRef.current) {
        addSystemMessage(getSearchTimeoutPrompt(getSearchLocationLabel()));
        searchPromptedRef.current = true;
      }
      return { status: 'timeout' as const };
    } finally {
      setIsConfigSearching(false);
    }
  }, [addSystemMessage, buildSearchSummary, getSearchLocationLabel, getSearchTimeoutPrompt, settings.language, setSearchState, setResearchContext]);


  const handleConfigSubmit = useCallback(async () => {
    const missing = getMissingForStart(userInput);
    const visibleMissing = missing.filter((field) => field !== 'location_choice');
    setMissingFields(visibleMissing);
    if (missing.length > 0) {
      if (missing.includes('location_choice')) {
        setActivePanel('chat');
        await promptForMissing(['location_choice']);
      }
      return;
    }

    setPendingConfigReview(false);
    setPendingResearchReview(false);
    setActivePanel('chat');
    const ideaText = userInput.idea.trim();
    searchAttemptRef.current = 0;
    searchPromptedRef.current = false;

    const result = await runSearch(ideaText, SEARCH_TIMEOUT_BASE_MS);
    if (result.status === 'done') {
      await handleStart();
    }
  }, [getMissingForStart, handleStart, promptForMissing, runSearch, userInput, setPendingConfigReview, setActivePanel]);

  const handleSearchRetry = useCallback(async () => {
    if (searchState.status !== 'timeout') return;
    const query = searchState.query || userInput.idea.trim();
    if (!query) return;
    const nextTimeout = Math.min(
      (searchState.timeoutMs ?? SEARCH_TIMEOUT_BASE_MS) + SEARCH_TIMEOUT_STEP_MS,
      SEARCH_TIMEOUT_MAX_MS
    );
    const result = await runSearch(query, nextTimeout);
    if (result.status === 'done') {
      await handleStart();
    }
  }, [handleStart, runSearch, searchState, userInput.idea]);

  const handleSearchUseLlm = useCallback(async () => {
    if (searchState.status !== 'timeout') return;
    const locationLabel = getSearchLocationLabel();
    setSearchState({
      status: 'done',
      query: searchState.query,
      answer: '',
      provider: 'llm',
      isLive: false,
      results: [],
    });
    setResearchContext({ summary: '', sources: [], structured: undefined });
    searchPromptedRef.current = false;
    setIsChatThinking(true);
    let structured: SearchResponse['structured'] | undefined;
    let summaryText = '';
    try {
      const prompt = settings.language === 'ar'
        ? `انت مساعد بحث. مطلوب منك توليد بيانات مبدئية عن الفكرة حسب المكان.
الفكرة: "${userInput.idea}"
المكان: "${locationLabel}"
ارجع JSON فقط بدون شرح. استخدم هذا الشكل:
{
  "summary": "",
  "signals": ["", ""],
  "competition_level": "low|medium|high",
  "demand_level": "low|medium|high",
  "regulatory_risk": "low|medium|high",
  "price_sensitivity": "low|medium|high",
  "notable_locations": ["", ""],
  "gaps": ["", ""]
}
لو مش متأكد، خليك صريح في summary.`
        : `You are a research assistant. Produce initial data about the idea for the given location.
Idea: "${userInput.idea}"
Location: "${locationLabel}"
Return JSON only, no explanation, using:
{
  "summary": "",
  "signals": ["", ""],
  "competition_level": "low|medium|high",
  "demand_level": "low|medium|high",
  "regulatory_risk": "low|medium|high",
  "price_sensitivity": "low|medium|high",
  "notable_locations": ["", ""],
  "gaps": ["", ""]
}
If unsure, say so in summary.`;

      const raw = await apiService.generateMessage(prompt);
      structured = normalizeStructured(parseStructuredFromLlm(raw));
      summaryText = structured?.summary?.trim() || raw.trim();
    } catch (err) {
      console.warn('LLM research fallback failed', err);
      summaryText = settings.language === 'ar'
        ? 'لم أستطع توليد بيانات كافية الآن.'
        : 'I could not generate enough data right now.';
    }

    setIsChatThinking(false);
    if (summaryText) {
      setResearchContext({ summary: summaryText, sources: [], structured });
      const report = buildSearchSummary(
        {
          provider: 'llm',
          is_live: false,
          answer: summaryText,
          results: [],
          structured,
        },
        locationLabel
      );
      if (report) {
        addSystemMessage(report);
      }
    }

    setPendingResearchReview(true);
    addSystemMessage(settings.language === 'ar'
      ? 'تحب أبدأ المحاكاة؟ ولا عايز تصححلي معلومة معينة؟'
      : 'Do you want me to start the simulation, or do you want to correct any specific detail?');
  }, [
    addSystemMessage,
    buildSearchSummary,
    getSearchLocationLabel,
    normalizeStructured,
    parseStructuredFromLlm,
    searchState,
    setSearchState,
    setResearchContext,
    settings.language,
    userInput.idea,
  ]);

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
        const userMessage: ChatMessage = {
          id: `user-${Date.now()}`,
          type: 'user',
          content,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => [...prev, userMessage]);
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
                ? 'تمام، حدثت البيانات بناءً على ملاحظتك.'
                : 'Got it. I updated the data based on your note.');
              addSystemMessage(settings.language === 'ar'
                ? 'تحب أبدأ المحاكاة؟ ولا عايز تصحح حاجة تانية؟'
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
                ? 'عدل الإعدادات ثم اضغط تأكيد البيانات.'
                : 'Update the configuration, then confirm.');
              return;
            }
          }
          if (pendingUpdate) {
            const yes = ['yes', 'ok', 'okay', 'go', 'start', 'run', 'y', 'نعم', 'اه', 'أيوه', 'ايوه', 'تمام', 'حاضر', 'ماشي'];
            const no = ['no', 'nope', 'cancel', 'stop', 'لا', 'مش', 'مش موافق', 'ارفض'];
            const lower = trimmed.toLowerCase();
            if (yes.includes(lower)) {
              const nextIdea = userInput.idea
                ? `${userInput.idea}\nUpdate: ${pendingUpdate}`
                : pendingUpdate;
              const nextInput = { ...userInput, idea: nextIdea };
              setUserInput(nextInput);
              setPendingUpdate(null);
              addSystemMessage(settings.language === 'ar'
                ? 'تم تأكيد التحديث، سأرسله للمجتمع الآن.'
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
                  ? `تمام، سنكمل النقاش بدون إرسال التحديث. رد على: "${trimmed}".`
                  : `Okay, we won't send the update. Reply to: "${trimmed}".`
              );
              addSystemMessage(reply || (settings.language === 'ar' ? 'تمام، لن أرسل التحديث.' : 'Okay, no update will be sent.'));
              return;
            }
            addSystemMessage(settings.language === 'ar'
              ? 'هل تريد إرسال هذا التحديث للمجتمع؟ اكتب نعم أو لا.'
              : 'Do you want to send this update to the agents? Type yes or no.');
            return;
          }

          if (isWaitingForLocationChoice) {
            const yes = ['yes', 'y', 'ok', 'okay', 'نعم', 'اه', 'أيوه', 'ايوه', 'تمام', 'ماشي'];
            const no = ['no', 'n', 'nope', 'cancel', 'لا', 'مش', 'مش عايز', 'ارفض'];
            const lower = trimmed.toLowerCase();
            if (yes.includes(lower)) {
              setLocationChoice('yes');
              setIsWaitingForLocationChoice(false);
              setIsWaitingForCountry(false);
              setIsWaitingForCity(true);
              addSystemMessage(settings.language === 'ar'
                ? 'تمام، اكتب المدينة اللي في دماغك. (ولو حابب اذكر الدولة كمان)'
                : 'Great—what city are you targeting? (You can add the country too)');
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
              ? 'اختار نعم أو لا بس عشان نكمل.'
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
              ? 'راجِع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
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
                  ? `جاوب بشكل طبيعي على: "${trimmed}". اربط إجابتك بما قاله الوكلاء وبنتائج البحث. لا تذكر إعدادات خام أو أرقام. استخدم السياق لتفسير الرفض إن وجد.
سياق الوكلاء: ${reasoningContext}
سياق البحث: ${researchContextText}
القيود (للفهم فقط): ${constraintsContext}
إذا كان الرفض بسبب المنافسة أو الموقع، اقترح بحثاً عن موقع أفضل واسأل المستخدم.`
                  : `Reply naturally to: "${trimmed}". Tie your answer to agent reasoning and research. Do not list raw settings or numbers. Use simulation context to explain rejections.
Reasoning context: ${reasoningContext}
Research context: ${researchContextText}
Constraints (for understanding only): ${constraintsContext}
If rejection is about competition or location, suggest searching for a better location and ask the user.`
              );
              setIsChatThinking(false);
              addSystemMessage(reply || (settings.language === 'ar' ? 'حسناً، دعنا نناقش ذلك.' : "Sure, let's discuss that."));
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
            ? 'راجِع الإعدادات ثم اضغط تأكيد البيانات للمتابعة.'
            : 'Review the configuration, then confirm to continue.');
        } catch (err) {
          console.error('Schema extraction failed', err);
          addSystemMessage(settings.language === 'ar'
            ? 'الـ LLM غير متاح. رجاءً أعد تشغيل الباك إند.'
            : 'LLM unavailable. Please restart the backend.');
        }
      })();
    },
      [
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
    async (field: 'category' | 'audience' | 'goals' | 'maturity' | 'location_choice', value: string) => {
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
            ? 'تمام، اكتب المدينة اللي في دماغك. (ولو حابب اذكر الدولة كمان)'
            : 'Great—what city are you targeting? (You can add the country too)');
          return;
        } else {
          setIsWaitingForCountry(false);
          setIsWaitingForCity(false);
          addSystemMessage(settings.language === 'ar'
            ? 'تمام، مش هنحتاج مكان محدد.'
            : 'Got it—no specific location needed.');
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
      handleAudienceChange,
      handleCategoryChange,
      handleGoalsChange,
      handleMaturityChange,
      getMissingForStart,
      isWaitingForLocationChoice,
      locationChoice,
      promptForMissing,
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

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current.side || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const minSide = 260;
      const minCenter = 360;
      const dx = event.clientX - dragRef.current.startX;
      if (dragRef.current.side === 'left') {
        const maxLeft = rect.width - rightWidth - minCenter - 12;
        const nextLeft = Math.min(Math.max(dragRef.current.startLeft + dx, minSide), maxLeft);
        setLeftWidth(nextLeft);
      } else if (dragRef.current.side === 'right') {
        const maxRight = rect.width - leftWidth - minCenter - 12;
        const nextRight = Math.min(Math.max(dragRef.current.startRight - dx, minSide), maxRight);
        setRightWidth(nextRight);
      }
    };
    const handleUp = () => {
      dragRef.current.side = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    if (
      simulation.status === 'error' ||
      simulation.status === 'idle' ||
      simulation.status === 'completed'
    ) {
      setHasStarted(false);
    }
  }, [simulation.status]);

  const hasProgress = simulation.metrics.currentIteration > 0 || simulation.reasoningFeed.length > 0;
  const isSummarizing = simulation.status === 'running'
    && hasProgress
    && !simulation.summary
    && !reasoningActive;
  const quickReplies = pendingUpdate
    ? [
        { label: settings.language === 'ar' ? 'موافق' : 'Yes', value: 'yes' },
        { label: settings.language === 'ar' ? 'مش موافق' : 'No', value: 'no' },
      ]
    : pendingConfigReview
    ? [
        { label: settings.language === 'ar' ? 'ابدأ' : 'Start', value: 'yes' },
        { label: settings.language === 'ar' ? 'تعديل' : 'Edit', value: 'edit' },
      ]
    : null;

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
      />

      {/* Main Content */}
      <div
        ref={containerRef}
        className="flex-1 grid overflow-hidden min-h-0"
        style={{
          gridTemplateColumns: `${leftWidth}px 6px 1fr 6px ${rightWidth}px`,
        }}
      >
        {/* Left Panel - Config / Chat */}
        <div className="border-r border-border/50 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
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
                {settings.language === 'ar' ? '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a' : 'Config'}
              </button>
            </div>
          </div>

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
              onSendMessage={handleSendMessage}
              onSelectOption={handleOptionSelect}
              isWaitingForCity={isWaitingForCity}
              isWaitingForCountry={isWaitingForCountry}
              isWaitingForLocationChoice={isWaitingForLocationChoice}
              searchState={searchState}
              isThinking={isChatThinking}
              showRetry={llmBusy}
              onRetryLlm={handleRetryLlm}
              onSearchRetry={handleSearchRetry}
              onSearchUseLlm={handleSearchUseLlm}
              canConfirmStart={pendingResearchReview}
              onConfirmStart={handleConfirmStart}
              simulationStatus={simulation.status}
              reasoningActive={reasoningActive}
              isSummarizing={isSummarizing}
              rejectedCount={simulation.metrics.rejected}
              quickReplies={quickReplies || undefined}
              onQuickReply={handleQuickReply}
              reportBusy={reportBusy}
              onDownloadReport={handleDownloadReport}
              insights={{
                idea: userInput.idea,
                location: `${userInput.city || ""}${userInput.city && userInput.country ? ", " : ""}${userInput.country || ""}`.trim(),
                category: userInput.category,
                audience: userInput.targetAudience,
                goals: userInput.goals,
                maturity: userInput.ideaMaturity,
                risk: userInput.riskAppetite,
                summary: simulation.summary || "",
                rejectAdvice: summaryAdvice,
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
        <div
          className="resize-handle"
          onMouseDown={(e) => {
            dragRef.current = {
              side: 'left',
              startX: e.clientX,
              startLeft: leftWidth,
              startRight: rightWidth,
            };
          }}
        />

        {/* Center - Simulation Arena */}
        <div className="flex flex-col p-4 gap-4 overflow-hidden min-h-0">
          <div className="flex-1">
        <SimulationArena
          agents={Array.from(simulation.agents.values())}
          activePulses={simulation.activePulses}
        />
          </div>

          {/* Iteration Timeline */}
          <IterationTimeline
            currentIteration={simulation.metrics.currentIteration}
            totalIterations={simulation.metrics.totalIterations}
            language={settings.language}
          />
        </div>

        <div
          className="resize-handle"
          onMouseDown={(e) => {
            dragRef.current = {
              side: 'right',
              startX: e.clientX,
              startLeft: leftWidth,
              startRight: rightWidth,
            };
          }}
        />

        {/* Right Panel - Metrics */}
        <div className="border-l border-border/50 flex flex-col min-h-0">
          <MetricsPanel metrics={simulation.metrics} language={settings.language} />
        </div>
      </div>
    </div>
  );
};

export default Index;
