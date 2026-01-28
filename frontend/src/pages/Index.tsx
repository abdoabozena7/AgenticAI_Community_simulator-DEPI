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
  const [hasStarted, setHasStarted] = useState(false);
  const summaryRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const [activePanel, setActivePanel] = useState<'config' | 'chat'>('chat');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [pendingConfigReview, setPendingConfigReview] = useState(false);
  const [isConfigSearching, setIsConfigSearching] = useState(false);
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [searchState, setSearchState] = useState<{
    status: 'idle' | 'searching' | 'done';
    query?: string;
    answer?: string;
    provider?: string;
    isLive?: boolean;
    results?: SearchResponse['results'];
  }>({ status: 'idle' });
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [researchContext, setResearchContext] = useState<{ summary: string; sources: SearchResponse['results'] }>({
    summary: '',
    sources: [],
  });

  const inferLocation = useCallback((_text: string): { country?: string; city?: string } => {
    return {};
  }, []);

  

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
    summaryRef.current = simulation.summary;
  }, [simulation.summary, addSystemMessage]);

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
      language: settings.language,
      speed: simulationSpeed,
    };
  }, [researchContext, settings.language, simulationSpeed]);

  const getMissingForStart = useCallback((input: UserInput) => {
    const missing: string[] = [];
    if (!input.idea.trim()) missing.push('idea');
    if (!input.country.trim()) missing.push('country');
    if (!input.city.trim()) missing.push('city');
    if (!input.category) missing.push('category');
    if (!input.targetAudience.length) missing.push('target_audience');
    if (!input.goals.length) missing.push('goals');
    return missing;
  }, []);


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

  const requestLocationIfNeeded = useCallback(async (missing: string[]) => {
    const needsCountry = missing.includes('country');
    const needsCity = missing.includes('city');
    if (!needsCountry && !needsCity) return false;
    const prompt = `Ask the user for the missing location fields: ${needsCountry ? 'country' : ''}${needsCountry && needsCity ? ' and ' : ''}${needsCity ? 'city' : ''}. Keep it short and natural.`;
    const question = await getAssistantMessage(prompt);
    if (question) {
      addSystemMessage(question);
    } else {
      const fallback = needsCountry && needsCity
        ? (settings.language === 'ar' ? 'ما هي الدولة والمدينة المستهدفة؟' : 'Which country and city should we focus on?')
        : needsCity
        ? (settings.language === 'ar' ? 'ما هي المدينة المستهدفة؟' : 'Which city should we focus on?')
        : (settings.language === 'ar' ? 'ما هي الدولة المستهدفة؟' : 'Which country should we focus on?');
      addSystemMessage(fallback);
    }
    setIsWaitingForCountry(needsCountry);
    setIsWaitingForCity(needsCity);
    return true;
  }, [addSystemMessage, getAssistantMessage, settings.language]);

  const promptForMissing = useCallback(async (missing: string[], question?: string) => {
    setMissingFields(missing);
    if (missing.length === 0) return false;

    if (missing.includes('idea')) {
      const prompt = 'Ask the user to describe their idea in one clear sentence.';
      const message = await getAssistantMessage(prompt);
      addSystemMessage(message || (settings.language === 'ar'
        ? 'من فضلك اكتب الفكرة في جملة واحدة.'
        : 'Please describe the idea in one clear sentence.'));
      return true;
    }

    const needsCountry = missing.includes('country');
    const needsCity = missing.includes('city');
    if (needsCountry || needsCity) {
      if (question) {
        addSystemMessage(question);
        setIsWaitingForCountry(needsCountry);
        setIsWaitingForCity(needsCity);
        return true;
      }
      const asked = await requestLocationIfNeeded(missing);
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
  }, [addOptionsMessage, addSystemMessage, getAssistantMessage, requestLocationIfNeeded, settings.language]);

  const handleStart = useCallback(async () => {
    const missing = getMissingForStart(userInput);
    const asked = await promptForMissing(missing);
    if (asked) return;

    if (hasStarted || simulation.status === 'running') return;
    setHasStarted(true);
    try {
      await simulation.startSimulation(buildConfig(userInput));
      const startMessage = await getAssistantMessage('Confirm you are starting the simulation now in one short sentence.');
      addSystemMessage(startMessage || (settings.language === 'ar' ? 'تم بدء المحاكاة.' : 'Starting simulation...'));
    } catch (err) {
      console.warn('Simulation start failed.', err);
      addSystemMessage(settings.language === 'ar' ? 'تعذر بدء المحاكاة. تحقق من الباك إند.' : 'Failed to start simulation. Check the backend.');
    }
  }, [addSystemMessage, buildConfig, getAssistantMessage, getMissingForStart, hasStarted, promptForMissing, settings.language, simulation, userInput]);


  const handleConfigSubmit = useCallback(async () => {
    const missing = getMissingForStart(userInput);
    setMissingFields(missing);
    if (missing.length > 0) {
      return;
    }

    setPendingConfigReview(false);
    setActivePanel('chat');
    setIsConfigSearching(true);
    const ideaText = userInput.idea.trim();
    setSearchState({ status: 'searching', query: ideaText });

    try {
      const timeoutMs = 10000;
      const search = await Promise.race([
        apiService.searchWeb(ideaText, settings.language === 'ar' ? 'ar' : 'en', 5),
        new Promise<SearchResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
        ),
      ]);
      const searchData = search as SearchResponse;
      setSearchState({
        status: 'done',
        query: ideaText,
        answer: searchData.answer,
        provider: searchData.provider,
        isLive: searchData.is_live,
        results: searchData.results,
      });
      const summary = searchData.answer
        || searchData.results.map((r) => r.snippet).filter(Boolean).slice(0, 3).join(' ');
      setResearchContext({ summary, sources: searchData.results });
    } catch {
      setSearchState({ status: 'done', query: ideaText, answer: '', provider: 'none', isLive: false, results: [] });
      setResearchContext({ summary: '', sources: [] });
      addSystemMessage(settings.language === 'ar'
        ? 'لم أجد معلومات كافية سريعاً، سأكمل بالـ LLM مباشرة.'
        : 'Not enough information quickly; asking the LLM directly.');
    } finally {
      setIsConfigSearching(false);
    }

    await handleStart();
  }, [addSystemMessage, getMissingForStart, handleStart, settings.language, userInput, setSearchState, setResearchContext, setPendingConfigReview, setActivePanel]);

  const handleSendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        type: 'user',
        content,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, userMessage]);

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
              await simulation.stopSimulation();
              await simulation.startSimulation(buildConfig(nextInput));
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
              extraction = await Promise.race([
                apiService.extractSchema(trimmed, schemaPayload),
                new Promise<ReturnType<typeof apiService.extractSchema>>((_, reject) =>
                  setTimeout(() => reject(new Error('Extract timeout')), 6000)
                ),
              ]);
            } catch {
              extraction = {
                country: null,
                city: null,
                question: null,
              } as any;
            }

            const nextInput: UserInput = {
              ...userInput,
              country: isWaitingForCountry ? (extraction.country || userInput.country) : userInput.country,
              city: isWaitingForCity ? (extraction.city || userInput.city) : userInput.city,
            };
            setUserInput(nextInput);
            setIsWaitingForCountry(false);
            setIsWaitingForCity(false);

            const missing = getMissingForStart(nextInput);
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

          const inferred = inferLocation(trimmed);
          const schemaPayload = {
            idea: userInput.idea,
            country: userInput.country,
            city: userInput.city,
            category: userInput.category,
            target_audience: userInput.targetAudience,
            goals: userInput.goals,
            risk_appetite: (userInput.riskAppetite ?? 50) / 100,
            idea_maturity: userInput.ideaMaturity,
            ...inferred,
          };
          let extraction = null;
          try {
            const timeoutMs = 6000;
            extraction = await Promise.race([
              apiService.extractSchema(trimmed, schemaPayload),
              new Promise<ReturnType<typeof apiService.extractSchema>>((_, reject) =>
                setTimeout(() => reject(new Error('Extract timeout')), timeoutMs)
              ),
            ]);
          } catch (extractErr) {
            console.warn('Schema extraction timed out, using heuristic fallback.', extractErr);
            extraction = {
              idea: trimmed,
              country: inferred.country || userInput.country,
              city: inferred.city || userInput.city,
              category: userInput.category,
              target_audience: userInput.targetAudience,
              goals: userInput.goals,
              risk_appetite: (userInput.riskAppetite ?? 50) / 100,
              idea_maturity: userInput.ideaMaturity,
              missing: [],
              question: null,
            };
          }

          const normalizedCategory = normalizeCategoryValue(extraction.category);
          const normalizedAudiences = normalizeOptionList(extraction.target_audience, AUDIENCE_OPTIONS);
          const normalizedGoals = normalizeOptionList(extraction.goals, GOAL_OPTIONS);
          const normalizedRisk = normalizeRiskValue(extraction.risk_appetite);
          const normalizedMaturity = normalizeMaturityValue(extraction.idea_maturity);

          const nextInput: UserInput = {
            ...userInput,
            idea: extraction.idea || userInput.idea || trimmed,
            country: userInput.country || extraction.country || inferred.country || '',
            city: userInput.city || extraction.city || inferred.city || '',
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

          const missing = getMissingForStart(nextInput);
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
        getAssistantMessage,
        getMissingForStart,
        handleConfigSubmit,
        handleStart,
        inferLocation,
        pendingConfigReview,
        pendingUpdate,
        promptForMissing,
        researchContext,
        settings.language,
        simulation,
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
    (field: 'category' | 'audience' | 'goals' | 'maturity', value: string) => {
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
      settings.language,
      userInput.goals,
      userInput.targetAudience,
    ]
  );

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

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <Header
        simulationStatus={simulation.status}
        isConnected={websocketService.isConnected()}
        language={settings.language}
      />

      <div className="glass-panel border-b border-border/50 px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{settings.language === 'ar' ? 'اللغة' : 'Language'}</span>
            <button
              type="button"
              className={settings.language === 'ar' ? 'px-3 py-1 rounded-md bg-primary text-primary-foreground' : 'px-3 py-1 rounded-md bg-secondary text-foreground'}
              onClick={() => setSettings((prev) => ({ ...prev, language: 'ar' }))}
            >
              عربي
            </button>
            <button
              type="button"
              className={settings.language === 'en' ? 'px-3 py-1 rounded-md bg-primary text-primary-foreground' : 'px-3 py-1 rounded-md bg-secondary text-foreground'}
              onClick={() => setSettings((prev) => ({ ...prev, language: 'en' }))}
            >
              English
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{settings.language === 'ar' ? 'الثيم' : 'Theme'}</span>
            <select
              className="rounded-md bg-secondary border border-border/50 px-2 py-1"
              value={settings.theme}
              onChange={(e) => setSettings((prev) => ({ ...prev, theme: e.target.value }))}
            >
              <option value="dark">{settings.language === 'ar' ? 'داكن' : 'Dark'}</option>
              <option value="light">{settings.language === 'ar' ? 'فاتح' : 'Light'}</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{settings.language === 'ar' ? 'تركيز تلقائي' : 'Auto focus'}</span>
            <input
              type="checkbox"
              checked={settings.autoFocusInput}
              onChange={(e) => setSettings((prev) => ({ ...prev, autoFocusInput: e.target.checked }))}
            />
          </div>
        </div>
      </div>

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
                  setMissingFields(getMissingForStart(next));
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
              searchState={searchState}
              isThinking={isChatThinking}
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
