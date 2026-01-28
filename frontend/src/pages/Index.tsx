import { useState, useCallback, useEffect, useRef } from 'react';
import { Header } from '@/components/Header';
import {
  TopBar,
  CATEGORY_OPTIONS,
  AUDIENCE_OPTIONS,
  GOAL_OPTIONS,
  MATURITY_LEVELS,
} from '@/components/TopBar';
import { ChatPanel } from '@/components/ChatPanel';
import { SimulationArena } from '@/components/SimulationArena';
import { MetricsPanel } from '@/components/MetricsPanel';
import { IterationTimeline } from '@/components/IterationTimeline';
import { useSimulation } from '@/hooks/useSimulation';
import { ChatMessage, UserInput } from '@/types/simulation';
import { websocketService } from '@/services/websocket';
import { apiService, SearchResponse } from '@/services/api';

const CATEGORY_LABEL_BY_VALUE = new Map(
  CATEGORY_OPTIONS.map((label) => [label.toLowerCase(), label])
);

const CATEGORY_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  Technology: { ar: 'حلول تقنية وبرمجيات ومنتجات رقمية', en: 'Software and digital technology products' },
  Healthcare: { ar: 'خدمات صحية، رعاية، وتكنولوجيا طبية', en: 'Healthcare services and medical tech' },
  Finance: { ar: 'خدمات مالية، مدفوعات، واستثمارات', en: 'Financial services, payments, and investing' },
  Education: { ar: 'تعليم، تدريب، ومنصات تعلم', en: 'Learning, training, and education platforms' },
  'E-commerce': { ar: 'متاجر رقمية وتجربة شراء', en: 'Online commerce and shopping experiences' },
  Entertainment: { ar: 'تجربة ترفيهية ومحتوى', en: 'Entertainment and content products' },
  Social: { ar: 'مجتمعات وتواصل اجتماعي', en: 'Social communities and networks' },
  'B2B SaaS': { ar: 'برمجيات للشركات وخدمات SaaS', en: 'B2B SaaS tools for companies' },
  'Consumer Apps': { ar: 'تطبيقات مباشرة للمستخدمين', en: 'Direct-to-consumer apps' },
  Hardware: { ar: 'أجهزة ومنتجات مادية', en: 'Hardware and physical products' },
};

const AUDIENCE_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  'Gen Z (18-24)': { ar: 'جيل صغير ومتفاعل مع التقنية', en: 'Young digital-native audience' },
  'Millennials (25-40)': { ar: 'شريحة نشطة اقتصادياً', en: 'Economically active cohort' },
  'Gen X (41-56)': { ar: 'خبرة عملية وقرارات محسوبة', en: 'Experienced, pragmatic decision-makers' },
  'Boomers (57-75)': { ar: 'يميلون للثقة والاستقرار', en: 'Trust and stability focused' },
  Developers: { ar: 'مطورون ومهندسو برمجيات', en: 'Software developers and engineers' },
  Enterprises: { ar: 'شركات كبيرة وقرارات مؤسسية', en: 'Large enterprises with formal buying' },
  SMBs: { ar: 'شركات صغيرة ومتوسطة', en: 'Small & medium-sized businesses' },
  Consumers: { ar: 'مستخدمون نهائيون للأفراد', en: 'End consumers' },
  Students: { ar: 'طلبة وباحثون عن تعليم', en: 'Students and learners' },
  Professionals: { ar: 'محترفون في مجالات مختلفة', en: 'Professionals across sectors' },
};

const GOAL_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  'Market Validation': { ar: 'اختبار اهتمام السوق بالفكرة', en: 'Validate demand and interest' },
  'Funding Readiness': { ar: 'تجهيز الفكرة لجذب تمويل', en: 'Prepare to raise funding' },
  'User Acquisition': { ar: 'زيادة قاعدة المستخدمين', en: 'Grow user acquisition' },
  'Product-Market Fit': { ar: 'ضبط المنتج مع احتياج السوق', en: 'Achieve product-market fit' },
  'Competitive Analysis': { ar: 'فهم المنافسين والتميّز', en: 'Understand competitors and differentiation' },
  'Growth Strategy': { ar: 'خطة نمو واستراتيجية توسع', en: 'Growth and expansion strategy' },
};

const MATURITY_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  concept: { ar: 'الفكرة في مرحلة التصوّر', en: 'Idea stage' },
  prototype: { ar: 'نموذج أولي قيد التجربة', en: 'Prototype being tested' },
  mvp: { ar: 'نسخة أولية قابلة للاستخدام', en: 'Minimum viable product' },
  launched: { ar: 'منتج مطلق بالفعل في السوق', en: 'Already launched' },
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

const getRiskLabel = (value: number, language: 'ar' | 'en' = 'en') => {
  if (language === 'ar') {
    if (value < 30) return 'محافظ';
    if (value < 70) return 'متوسط';
    return 'مغامر';
  }
  if (value < 30) return 'Conservative';
  if (value < 70) return 'Moderate';
  return 'Aggressive';
};

const getMaturityLabel = (value?: string) => {
  if (!value) return 'Concept';
  const match = MATURITY_LEVELS.find((level) => level.value === value);
  return match?.label ?? value;
};

const getCategoryLabel = (value?: string) => {
  if (!value) return 'Technology';
  return CATEGORY_LABEL_BY_VALUE.get(value) ?? value;
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
  const [lastSuggestionKey, setLastSuggestionKey] = useState<string | null>(null);
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

  const getMaturityLabelLocalized = useCallback((value: string | undefined, language: 'ar' | 'en') => {
    if (language === 'ar') {
      return ({
        concept: 'فكرة',
        prototype: 'نموذج',
        mvp: 'نسخة أولية',
        launched: 'أُطلق',
      } as Record<string, string>)[value || 'concept'] || 'فكرة';
    }
    return getMaturityLabel(value);
  }, []);

  const buildSuggestionMessage = useCallback((input: UserInput) => {
    const locationLine = input.city && input.country
      ? (settings.language === 'ar'
        ? `الموقع: ${input.city}, ${input.country}.`
        : `Location detected: ${input.city}, ${input.country}.`)
      : (settings.language === 'ar' ? 'الموقع: (غير محدد)' : 'Location detected: (missing)');
    const categoryLabel = input.category ? getCategoryLabel(input.category) : (settings.language === 'ar' ? 'غير محدد' : 'Not set');
    const audienceLabel = input.targetAudience.length ? input.targetAudience.join(', ') : (settings.language === 'ar' ? 'غير محدد' : 'Not set');
    const goalsLabel = input.goals.length ? input.goals.join(', ') : (settings.language === 'ar' ? 'غير محدد' : 'Not set');
    const lines = settings.language === 'ar'
      ? [
        locationLine,
        'تم ملء الشريط العلوي بناءً على فكرتك. عدّل إن احتجت ثم أخبرني أنك جاهز للبدء.',
        '',
        `1) الفئة: ${categoryLabel}`,
        `3) الجمهور: ${audienceLabel}`,
        `5) الهدف: ${goalsLabel}`,
        `7) المخاطرة: ${getRiskLabel(input.riskAppetite, 'ar')}`,
        `9) النضج: ${getMaturityLabelLocalized(input.ideaMaturity, 'ar')}`,
      ]
      : [
        locationLine,
        'I pre-filled the top bar based on your idea. Adjust if needed, then tell me you are ready to start.',
        '',
        `1) Category: ${categoryLabel}`,
        `3) Audience: ${audienceLabel}`,
        `5) Goals: ${goalsLabel}`,
        `7) Risk: ${getRiskLabel(input.riskAppetite, 'en')}`,
        `9) Maturity: ${getMaturityLabelLocalized(input.ideaMaturity, 'en')}`,
      ];
    return lines.join('\n');
  }, [getMaturityLabelLocalized, settings.language]);

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

  const handleStart = useCallback(async () => {
    const missing = getMissingForStart(userInput);
      if (missing.length > 0) {
        if (missing.includes('idea')) {
          const prompt = 'Ask the user to describe their idea in one clear sentence.';
          const message = await getAssistantMessage(prompt);
          addSystemMessage(message || (settings.language === 'ar'
            ? 'من فضلك اكتب الفكرة في جملة واحدة.'
            : 'Please describe the idea in one clear sentence.'));
          return;
        }
        const asked = await requestLocationIfNeeded(missing);
        if (asked) return;
        if (missing.includes('category')) {
          if (addOptionsMessage('category')) return;
        }
        if (missing.includes('target_audience')) {
          if (addOptionsMessage('audience')) return;
        }
        if (missing.includes('goals')) {
          if (addOptionsMessage('goals')) return;
        }
        if (missing.includes('idea_maturity')) {
          if (addOptionsMessage('maturity')) return;
        }
        const prompt = `Tell the user to review the top bar and fill these fields: ${missing.join(', ')}. Do not ask questions; just instruct them to adjust the top bar and say they are ready to start.`;
        const message = await getAssistantMessage(prompt);
        addSystemMessage(message || buildSuggestionMessage(userInput));
        return;
      }

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
  }, [addOptionsMessage, addSystemMessage, buildConfig, getAssistantMessage, getMissingForStart, hasStarted, requestLocationIfNeeded, simulation, userInput]);

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
            if (missing.length > 0) {
              if (missing.includes('city')) {
                addSystemMessage(extraction.question || (settings.language === 'ar'
                  ? 'ما هي المدينة المستهدفة؟'
                  : 'Which city should we focus on?'));
                setIsWaitingForCity(true);
                return;
              }
              if (missing.includes('country')) {
                addSystemMessage(extraction.question || (settings.language === 'ar'
                  ? 'ما هي الدولة المستهدفة؟'
                  : 'Which country should we focus on?'));
                setIsWaitingForCountry(true);
                return;
              }
              if (missing.includes('category')) {
                if (addOptionsMessage('category')) return;
              }
              if (missing.includes('target_audience')) {
                if (addOptionsMessage('audience')) return;
              }
              if (missing.includes('goals')) {
                if (addOptionsMessage('goals')) return;
              }
              if (missing.includes('idea_maturity')) {
                if (addOptionsMessage('maturity')) return;
              }
            }

            const prompt = [
              `Summarize the inferred settings and tell the user to adjust the top bar if needed, then say they are ready to start.`,
              `Location: ${nextInput.city}, ${nextInput.country}.`,
              `Category: ${getCategoryLabel(nextInput.category)}.`,
              `Audience: ${nextInput.targetAudience.join(', ') || 'Not set'}.`,
              `Goals: ${nextInput.goals.join(', ') || 'Not set'}.`,
              `Risk: ${getRiskLabel(nextInput.riskAppetite, settings.language)}.`,
              `Maturity: ${getMaturityLabelLocalized(nextInput.ideaMaturity, settings.language)}.`,
              `Use a short intro and a numbered list with items 1,3,5,7,9 (odd numbers only).`,
            ].join(' ');
            const assistantMessage = await getAssistantMessage(prompt);
            addSystemMessage(assistantMessage || buildSuggestionMessage(nextInput));
            return;
          }

          // If user is likely confirming readiness, detect intent before search.
          if (userInput.idea && userInput.country && userInput.city) {
            const intentContext = `Idea: ${userInput.idea}. Location: ${userInput.city}, ${userInput.country}.`;
            try {
              const intent = await Promise.race([
                apiService.detectStartIntent(trimmed, intentContext),
                new Promise<{ start: boolean }>((_, reject) =>
                  setTimeout(() => reject(new Error('Intent timeout')), 3000)
                ),
              ]);
              if (intent.start) {
                await handleStart();
                return;
              }
            } catch {
              // ignore intent failure
            }
            const quickYes = ['yes', 'ok', 'okay', 'go', 'start', 'run', 'y', 'تمام', 'حاضر', 'ماشي', 'ايوه', 'نعم', 'ايوا'];
            if (trimmed.length <= 5 && quickYes.includes(trimmed.toLowerCase())) {
              await handleStart();
              return;
            }
          }

          const socialBoost = '(site:twitter.com OR site:reddit.com OR site:tiktok.com OR site:facebook.com OR site:linkedin.com)';
          const searchQuery = `${trimmed} ${socialBoost}`;
          setSearchState({ status: 'searching', query: trimmed });
          let search: SearchResponse | null = null;
          try {
            const timeoutMs = 6000;
            search = await Promise.race([
              apiService.searchWeb(searchQuery, settings.language === 'ar' ? 'ar' : 'en', 5),
              new Promise<SearchResponse>((_, reject) =>
                setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
              ),
            ]);
          } catch (searchErr) {
            console.warn('Search failed, continuing without live sources.', searchErr);
          }
          if (search) {
            setSearchState({
              status: 'done',
              query: trimmed,
              answer: search.answer,
              provider: search.provider,
              isLive: search.is_live,
              results: search.results,
            });
            const summary = search.answer || search.results.map((r) => r.snippet).filter(Boolean).slice(0, 3).join(' ');
            setResearchContext({ summary, sources: search.results });
          } else {
            setSearchState({ status: 'done', query: trimmed, answer: '', provider: 'none', isLive: false, results: [] });
            setResearchContext({ summary: '', sources: [] });
            addSystemMessage(settings.language === 'ar'
              ? 'لم أجد معلومات كافية سريعًا، سأستخدم الـ LLM مباشرة.'
              : 'Not enough information quickly; asking the LLM directly.');
          }

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
              // fallback heuristic
              const isQuestion = /[?؟]/.test(trimmed);
              mode = isQuestion ? 'discuss' : 'update';
            }

            if (mode === 'discuss') {
              const reasoningContext = simulation.reasoningFeed
                .slice(-8)
                .map((r) => `Agent ${r.agentId.slice(0, 4)}: ${r.message}`)
                .join(' | ');
              const constraintsContext = `Category=${userInput.category}; Audience=${userInput.targetAudience.join(', ')}; Goals=${userInput.goals.join(', ')}; Maturity=${userInput.ideaMaturity}; Location=${userInput.city}, ${userInput.country}`;
              const researchContextText = researchContext.summary || "";
              const reply = await getAssistantMessage(
                settings.language === 'ar'
                  ? `?? ???? ????? ???? ??? ???????: "${trimmed}". ???? ?????? ????? ??????? ??????? ?????. ?? ???? ????? ?? ????? ??????? ??????. ?????? ???? ???????? ?????? ????? ?? ?????? ?????? ?????.
???? ???????: ${reasoningContext}
???? ?????: ${researchContextText}
???? ?????? (????? ??? ?? ?????): ${constraintsContext}
??? ??? ????? ???? ???????? ?? ??????? ????? ????? ?? ???? ???? ????? ???????? ?? ??? ???? ???.`
                  : `Reply naturally to: "${trimmed}". Tie your answer to agent reasoning and research. Do not list raw settings or numbers. Use simulation context to explain rejections.
Reasoning context: ${reasoningContext}
Research context: ${researchContextText}
Constraints (for understanding only): ${constraintsContext}
If rejection is about competition or location, suggest searching for a better location and ask the user.`
              );
              addSystemMessage(reply || (settings.language === 'ar' ? 'حسنًا، دعنا نناقش ذلك.' : 'Sure, let’s discuss that.'));
              return;
            }

            setPendingUpdate(trimmed);
            addSystemMessage(settings.language === 'ar'
              ? 'هل تريد إرسال هذا التحديث للمجتمع ليعيدوا تقييم الفكرة؟ (نعم/لا)'
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

          const missingLocation = getMissingForStart(nextInput).filter(
            (field) => field === 'country' || field === 'city'
          );
          if (missingLocation.length > 0) {
            setIsWaitingForCountry(missingLocation.includes('country'));
            setIsWaitingForCity(missingLocation.includes('city'));
            if (extraction.question) {
              addSystemMessage(extraction.question);
            } else {
              await requestLocationIfNeeded(missingLocation);
            }
            return;
          }

          setIsWaitingForCountry(false);
          setIsWaitingForCity(false);

          const suggestionKey = [
            nextInput.idea,
            nextInput.country,
            nextInput.city,
            nextInput.category,
            nextInput.targetAudience.join(','),
            nextInput.goals.join(','),
            String(nextInput.riskAppetite),
            nextInput.ideaMaturity,
          ].join('|');

          if (suggestionKey !== lastSuggestionKey) {
            const prompt = [
              `Summarize the inferred settings and tell the user to adjust the top bar if needed, then say they are ready to start.`,
              `Location: ${nextInput.city}, ${nextInput.country}.`,
              `Category: ${getCategoryLabel(nextInput.category)}.`,
              `Audience: ${nextInput.targetAudience.join(', ') || 'Not set'}.`,
              `Goals: ${nextInput.goals.join(', ') || 'Not set'}.`,
              `Risk: ${getRiskLabel(nextInput.riskAppetite, settings.language)}.`,
              `Maturity: ${getMaturityLabel(nextInput.ideaMaturity)}.`,
              `Use a short intro and a numbered list with items 1,3,5,7,9 (odd numbers only).`,
            ].join(' ');
            try {
              const assistantMessage = await getAssistantMessage(prompt);
              addSystemMessage(assistantMessage || buildSuggestionMessage(nextInput));
            } catch (err) {
              console.warn('LLM suggestion message failed, using fallback.', err);
              addSystemMessage(buildSuggestionMessage(nextInput));
            }
            setLastSuggestionKey(suggestionKey);
          }
          const intentContext = `Idea: ${nextInput.idea}. Location: ${nextInput.city}, ${nextInput.country}.`;
          try {
            const intent = await Promise.race([
              apiService.detectStartIntent(trimmed, intentContext),
              new Promise<{ start: boolean }>((_, reject) =>
                setTimeout(() => reject(new Error('Intent timeout')), 4000)
              ),
            ]);
            if (intent.start) {
              await handleStart();
            }
          } catch {
            // ignore intent failure
          }
        } catch (err) {
          console.error('Schema extraction failed', err);
          addSystemMessage(settings.language === 'ar'
            ? 'الـ LLM غير متاح. رجاءً أعد تشغيل الباك إند.'
            : 'LLM unavailable. Please restart the backend.');
        }
      })();
    },
      [
        addOptionsMessage,
        addSystemMessage,
        buildConfig,
        buildSuggestionMessage,
        getAssistantMessage,
        getMissingForStart,
      handleStart,
      inferLocation,
      lastSuggestionKey,
      requestLocationIfNeeded,
      settings.language,
      simulation,
      touched,
      userInput,
    ]
  );

  const handleCategoryChange = useCallback((value: string) => {
    setTouched((prev) => ({ ...prev, category: true }));
    setUserInput((prev) => ({ ...prev, category: value }));
    setLastSuggestionKey(null);
  }, []);

  const handleAudienceChange = useCallback((value: string[]) => {
    setTouched((prev) => ({ ...prev, audience: true }));
    setUserInput((prev) => ({ ...prev, targetAudience: value }));
    setLastSuggestionKey(null);
  }, []);

  const handleRiskChange = useCallback((value: number) => {
    setTouched((prev) => ({ ...prev, risk: true }));
    setUserInput((prev) => ({ ...prev, riskAppetite: value }));
    setLastSuggestionKey(null);
  }, []);

  const handleMaturityChange = useCallback((value: string) => {
    setTouched((prev) => ({ ...prev, maturity: true }));
    setUserInput((prev) => ({ ...prev, ideaMaturity: value as UserInput['ideaMaturity'] }));
    setLastSuggestionKey(null);
  }, []);

  const handleGoalsChange = useCallback((value: string[]) => {
    setTouched((prev) => ({ ...prev, goals: true }));
    setUserInput((prev) => ({ ...prev, goals: value }));
    setLastSuggestionKey(null);
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
    <div className="h-screen bg-background flex flex-col overflow-hidden">
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

      {/* Top Bar - Filters */}
      <TopBar
        selectedCategory={userInput.category}
        selectedAudiences={userInput.targetAudience}
        selectedGoals={userInput.goals}
        riskLevel={userInput.riskAppetite}
        maturity={userInput.ideaMaturity}
        language={settings.language}
        onCategoryChange={handleCategoryChange}
        onAudienceChange={handleAudienceChange}
        onRiskChange={handleRiskChange}
        onMaturityChange={handleMaturityChange}
        onGoalsChange={handleGoalsChange}
      />

      {/* Main Content */}
      <div
        ref={containerRef}
        className="flex-1 grid overflow-hidden min-h-0"
        style={{
          gridTemplateColumns: `${leftWidth}px 6px 1fr 6px ${rightWidth}px`,
        }}
      >
        {/* Left Panel - Chat */}
        <div className="border-r border-border/50 flex flex-col min-h-0">
          <ChatPanel
            messages={chatMessages}
            reasoningFeed={simulation.reasoningFeed}
            onSendMessage={handleSendMessage}
            onSelectOption={handleOptionSelect}
            isWaitingForCity={isWaitingForCity}
            isWaitingForCountry={isWaitingForCountry}
            searchState={searchState}
            isThinking={simulation.status === 'running' && simulation.reasoningFeed.length > 0}
            settings={settings}
          />
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
          agents={simulation.agents}
          status={simulation.status}
          currentIteration={simulation.metrics.currentIteration}
          totalIterations={simulation.metrics.totalIterations}
          onReset={simulation.stopSimulation}
          onToggleSpeed={toggleSpeed}
          speed={simulationSpeed}
          language={settings.language}
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
