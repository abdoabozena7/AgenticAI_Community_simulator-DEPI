import { useState, useCallback, useEffect } from 'react';
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
import { apiService } from '@/services/api';

const CATEGORY_LABEL_BY_VALUE = new Map(
  CATEGORY_OPTIONS.map((label) => [label.toLowerCase(), label])
);

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

const getRiskLabel = (value: number) => {
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

  const inferLocation = useCallback((text: string): { country?: string; city?: string } => {
    const matchComma = /in\s+([a-zA-Z\s]+?),\s*([a-zA-Z\s]+?)([\.!]|$)/i.exec(text);
    if (matchComma) return { city: matchComma[1].trim(), country: matchComma[2].trim() };
    const matchInIn = /in\s+([a-zA-Z\s]+?)\s+in\s+([a-zA-Z\s]+?)([\.!]|$)/i.exec(text);
    if (matchInIn) return { city: matchInIn[1].trim(), country: matchInIn[2].trim() };
    const lower = text.toLowerCase();
    if (lower.includes('egypt')) return { country: 'Egypt' };
    if (lower.includes('cairo')) return { city: 'Cairo' };
    return {};
  }, []);

  const isStartCommand = (text: string) => {
    const t = text.trim().toLowerCase();
    return t === 'go'
      || t === 'start'
      || t === 'run'
      || t === 'ok'
      || t === 'okay'
      || t === 'yes'
      || t === 'y'
      || t === 'ابدأ'
      || t === 'ابدء'
      || t === 'شغل'
      || t === 'شغّل'
      || t === 'تمام'
      || t === 'حاضر'
      || t === 'ماشي';
  };

  const getAssistantMessage = useCallback(async (prompt: string) => {
    const text = await apiService.generateMessage(
      prompt,
      'You are a concise assistant for a product simulation UI. Avoid markdown formatting like **bold**.'
    );
    return text.replace(/\*\*/g, '').trim();
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: `sys-${Date.now()}`,
      type: 'system',
      content,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, message]);
  }, []);

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
    };
  }, []);

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

  const buildSuggestionMessage = useCallback((input: UserInput) => {
    const locationLine = input.city && input.country
      ? `Location detected: ${input.city}, ${input.country}.`
      : 'Location detected: (missing)';
    const categoryLabel = input.category ? getCategoryLabel(input.category) : 'Not set';
    const audienceLabel = input.targetAudience.length ? input.targetAudience.join(', ') : 'Not set';
    const goalsLabel = input.goals.length ? input.goals.join(', ') : 'Not set';
    const lines = [
      locationLine,
      'I pre-filled the top bar based on your idea. Adjust if needed, then type "go" to start.',
      '',
      `1) Category: ${categoryLabel}`,
      `3) Audience: ${audienceLabel}`,
      `5) Goals: ${goalsLabel}`,
      `7) Risk: ${getRiskLabel(input.riskAppetite)}`,
      `9) Maturity: ${getMaturityLabel(input.ideaMaturity)}`,
    ];
    return lines.join('\n');
  }, []);

  const requestLocationIfNeeded = useCallback(async (missing: string[]) => {
    const needsCountry = missing.includes('country');
    const needsCity = missing.includes('city');
    if (!needsCountry && !needsCity) return false;
    const prompt = `Ask the user for the missing location fields: ${needsCountry ? 'country' : ''}${needsCountry && needsCity ? ' and ' : ''}${needsCity ? 'city' : ''}. Keep it short and natural.`;
    const question = await getAssistantMessage(prompt);
    addSystemMessage(question);
    setIsWaitingForCountry(needsCountry);
    setIsWaitingForCity(needsCity);
    return true;
  }, [addSystemMessage, getAssistantMessage]);

  const handleStart = useCallback(async () => {
    const missing = getMissingForStart(userInput);
    if (missing.length > 0) {
      if (missing.includes('idea')) {
        const prompt = 'Ask the user to describe their idea in one clear sentence.';
        const message = await getAssistantMessage(prompt);
        addSystemMessage(message);
        return;
      }
      const asked = await requestLocationIfNeeded(missing);
      if (asked) return;
      const prompt = `Tell the user to review the top bar and fill these fields: ${missing.join(', ')}. Do not ask questions; just instruct them to adjust the top bar and type "go" when ready.`;
      const message = await getAssistantMessage(prompt);
      addSystemMessage(message);
      return;
    }

    if (hasStarted || simulation.status === 'running') return;
    setHasStarted(true);
    try {
      const startMessage = await getAssistantMessage('Confirm you are starting the simulation now in one short sentence.');
      addSystemMessage(startMessage);
    } catch (err) {
      console.warn('LLM start message failed, using fallback.', err);
      addSystemMessage('Starting simulation...');
    }
    await simulation.startSimulation(buildConfig(userInput));
  }, [addSystemMessage, buildConfig, getAssistantMessage, getMissingForStart, hasStarted, requestLocationIfNeeded, simulation, userInput]);

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

      if (isStartCommand(trimmed)) {
        void handleStart();
        return;
      }

      void (async () => {
        try {
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
          const extraction = await apiService.extractSchema(trimmed, schemaPayload);

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
              `Summarize the inferred settings and tell the user to adjust the top bar if needed, then type \"go\" to start.`,
              `Location: ${nextInput.city}, ${nextInput.country}.`,
              `Category: ${getCategoryLabel(nextInput.category)}.`,
              `Audience: ${nextInput.targetAudience.join(', ') || 'Not set'}.`,
              `Goals: ${nextInput.goals.join(', ') || 'Not set'}.`,
              `Risk: ${getRiskLabel(nextInput.riskAppetite)}.`,
              `Maturity: ${getMaturityLabel(nextInput.ideaMaturity)}.`,
              `Use a short intro and a numbered list with items 1,3,5,7,9 (odd numbers only).`,
            ].join(' ');
            try {
              const assistantMessage = await getAssistantMessage(prompt);
              addSystemMessage(assistantMessage);
            } catch (err) {
              console.warn('LLM suggestion message failed, using fallback.', err);
              addSystemMessage(buildSuggestionMessage(nextInput));
            }
            setLastSuggestionKey(suggestionKey);
          }
        } catch (err) {
          console.error('Schema extraction failed', err);
          addSystemMessage('LLM unavailable. Please restart the backend.');
        }
      })();
    },
    [
      addSystemMessage,
      buildSuggestionMessage,
      getAssistantMessage,
      getMissingForStart,
      handleStart,
      inferLocation,
      lastSuggestionKey,
      requestLocationIfNeeded,
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <Header
        simulationStatus={simulation.status}
        isConnected={websocketService.isConnected()}
      />

      {/* Top Bar - Filters */}
      <TopBar
        selectedCategory={userInput.category}
        selectedAudiences={userInput.targetAudience}
        selectedGoals={userInput.goals}
        riskLevel={userInput.riskAppetite}
        maturity={userInput.ideaMaturity}
        onCategoryChange={handleCategoryChange}
        onAudienceChange={handleAudienceChange}
        onRiskChange={handleRiskChange}
        onMaturityChange={handleMaturityChange}
        onGoalsChange={handleGoalsChange}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="w-80 min-w-[320px] border-r border-border/50 flex flex-col min-h-0">
          <ChatPanel
            messages={chatMessages}
            reasoningFeed={simulation.reasoningFeed}
            onSendMessage={handleSendMessage}
            isWaitingForCity={isWaitingForCity}
            isWaitingForCountry={isWaitingForCountry}
          />
        </div>

        {/* Center - Simulation Arena */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
          <div className="flex-1">
            <SimulationArena
              agents={simulation.agents}
              status={simulation.status}
              currentIteration={simulation.metrics.currentIteration}
              totalIterations={simulation.metrics.totalIterations}
              onReset={simulation.stopSimulation}
            />
          </div>

          {/* Iteration Timeline */}
          <IterationTimeline
            currentIteration={simulation.metrics.currentIteration}
            totalIterations={simulation.metrics.totalIterations}
          />
        </div>

        {/* Right Panel - Metrics */}
        <div className="w-80 min-w-[320px] border-l border-border/50">
          <MetricsPanel metrics={simulation.metrics} />
        </div>
      </div>
    </div>
  );
};

export default Index;
