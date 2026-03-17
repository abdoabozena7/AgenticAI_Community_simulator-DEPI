import type { SimulationMetrics, SimulationUiState, TopBarStep } from '@/types/simulation';

type SupportedLanguage = 'ar' | 'en';

type BusyStage =
  | 'extracting_schema'
  | 'detecting_mode'
  | 'assistant_reply'
  | 'prestart_research'
  | 'starting_simulation'
  | 'checking_session';

type SearchState = {
  status: 'idle' | 'searching' | 'complete' | 'timeout' | 'error';
  stage?: BusyStage;
  elapsedMs?: number;
};

type UiProgress = {
  active: boolean;
  stage: BusyStage;
  elapsedMs?: number;
};

const PHASES = [
  {
    key: 'idea_intake',
    aliases: ['intake', 'idea', 'schema', 'clarification', 'review', 'ready'],
    labels: { ar: 'توضيح الفكرة', en: 'Idea intake' },
  },
  {
    key: 'internet_research',
    aliases: ['search', 'research', 'evidence', 'location', 'persona'],
    labels: { ar: 'بحث الإنترنت', en: 'Internet research' },
  },
  {
    key: 'agent_deliberation',
    aliases: ['agent', 'debate', 'deliberation'],
    labels: { ar: 'نقاش الوكلاء', en: 'Agent debate' },
  },
  {
    key: 'convergence',
    aliases: ['convergence', 'resolution'],
    labels: { ar: 'التقارب', en: 'Convergence' },
  },
  {
    key: 'summary',
    aliases: ['summary', 'completed'],
    labels: { ar: 'الخلاصة', en: 'Summary' },
  },
] as const;

const STAGE_LABELS: Record<BusyStage, { ar: string; en: string }> = {
  extracting_schema: { ar: 'نحلل الفكرة ونرتب عناصرها', en: 'Structuring the idea' },
  detecting_mode: { ar: 'نحدد أفضل مسار للعمل', en: 'Detecting the best flow' },
  assistant_reply: { ar: 'نحضّر الرد التالي', en: 'Preparing the next reply' },
  prestart_research: { ar: 'نجمع مصادر من الإنترنت', en: 'Collecting internet sources' },
  starting_simulation: { ar: 'نطلق المحاكاة الآن', en: 'Starting the simulation' },
  checking_session: { ar: 'نتأكد من الجلسة الحالية', en: 'Checking the current session' },
};

const FALLBACK_BY_STATUS = {
  idle: { ar: 'جاهز للمتابعة', en: 'Ready to continue', tone: 'idle' as const },
  running: { ar: 'المحاكاة تعمل الآن', en: 'Simulation is running', tone: 'info' as const },
  paused: { ar: 'المحاكاة متوقفة مؤقتًا', en: 'Simulation is paused', tone: 'warning' as const },
  completed: { ar: 'اكتملت المحاكاة', en: 'Simulation completed', tone: 'success' as const },
  error: { ar: 'توجد مشكلة تحتاج تدخلًا', en: 'There is an issue that needs attention', tone: 'error' as const },
} as const;

const EMPTY_COPY = {
  ar: {
    screenTitle: 'مسار تقييم الفكرة',
    graphTitle: 'خريطة الحوار بين الوكلاء',
    graphDescription: 'توضح كيف تنتقل الآراء بين الوكلاء أثناء النقاش.',
    graphEmptyTitle: 'سيظهر ترابط الآراء هنا بعد بدء النقاش',
    graphEmptyDescription: 'ابدأ المحاكاة أو افتح النقاش لترى من يؤثر على من.',
    metricsHeadline: 'مؤشرات القرار',
    metricsDescription: 'ملخص سريع يساعدك على فهم اتجاه التقييم الآن.',
    metricsEmptyLabel: 'بانتظار البيانات',
  },
  en: {
    screenTitle: 'Idea evaluation flow',
    graphTitle: 'Agent discussion map',
    graphDescription: 'Shows how opinions move between agents during debate.',
    graphEmptyTitle: 'The relationship map will appear after debate starts',
    graphEmptyDescription: 'Start the simulation or open reasoning to see who influences whom.',
    metricsHeadline: 'Decision metrics',
    metricsDescription: 'A compact summary to understand the current direction.',
    metricsEmptyLabel: 'Waiting for data',
  },
};

export const formatPercent = (
  value: number | null | undefined,
  fallbackLabel: string,
  digits = 0,
): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallbackLabel;
  return `${value.toFixed(digits)}%`;
};

export const formatCount = (
  value: number | null | undefined,
  fallbackLabel: string,
): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallbackLabel;
  return `${Math.round(value)}`;
};

export const formatOptionalText = (
  value: string | null | undefined,
  fallbackLabel: string,
): string => {
  const next = value?.trim();
  return next ? next : fallbackLabel;
};

const findPhaseIndex = (phaseKey?: string | null) => {
  const current = String(phaseKey || '').toLowerCase();
  const index = PHASES.findIndex((phase) => phase.aliases.some((alias) => current.includes(alias)));
  return index >= 0 ? index : 0;
};

const labelForPhase = (language: SupportedLanguage, phaseKey?: string | null) =>
  PHASES[findPhaseIndex(phaseKey)].labels[language];

const resolveDisplayPhaseKey = ({
  phaseKey,
  simulationStatus,
  searchState,
  uiProgress,
}: {
  phaseKey?: string | null;
  simulationStatus: 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
  searchState?: SearchState;
  uiProgress?: UiProgress;
}) => {
  const normalizedPhaseKey = String(phaseKey || '').trim();
  const phaseIndex = findPhaseIndex(phaseKey);

  if (simulationStatus === 'completed') {
    return 'summary';
  }

  if (normalizedPhaseKey && phaseIndex > 0) {
    return phaseKey;
  }

  if (uiProgress?.active && uiProgress.stage === 'starting_simulation') {
    return 'agent_deliberation';
  }

  if (simulationStatus === 'running' || simulationStatus === 'configuring' || simulationStatus === 'paused') {
    return normalizedPhaseKey || 'agent_deliberation';
  }

  if (searchState?.status && searchState.status !== 'idle') {
    return 'internet_research';
  }

  if (uiProgress?.active && uiProgress.stage === 'prestart_research') {
    return 'internet_research';
  }

  return normalizedPhaseKey || 'idea_intake';
};

const getStatusCopy = ({
  language,
  simulationStatus,
  simulationError,
  searchState,
  uiProgress,
}: {
  language: SupportedLanguage;
  simulationStatus: 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
  simulationError?: string | null;
  searchState?: SearchState;
  uiProgress?: UiProgress;
}) => {
  if (simulationError) {
    return {
      label: language === 'ar' ? 'يوجد خطأ يحتاج مراجعة' : 'There is an error that needs review',
      tone: 'error' as const,
    };
  }
  if (searchState?.status === 'searching') {
    return {
      label: STAGE_LABELS[searchState.stage || 'prestart_research'][language],
      tone: 'info' as const,
    };
  }
  if (searchState?.status === 'timeout') {
    return {
      label: language === 'ar' ? 'انتهت مهلة البحث ويمكنك إعادة المحاولة' : 'Search timed out and can be retried',
      tone: 'warning' as const,
    };
  }
  if (searchState?.status === 'error') {
    return {
      label: language === 'ar' ? 'تعذر إكمال البحث الحالي' : 'Could not complete the current search',
      tone: 'error' as const,
    };
  }
  if (searchState?.status === 'complete') {
    return {
      label: language === 'ar' ? 'اكتمل جمع النتائج ويمكنك المتابعة' : 'Results are ready and you can continue',
      tone: 'success' as const,
    };
  }
  if (uiProgress?.active) {
    return {
      label: STAGE_LABELS[uiProgress.stage][language],
      tone: 'info' as const,
    };
  }
  const fallback = FALLBACK_BY_STATUS[simulationStatus === 'configuring' ? 'running' : simulationStatus];
  return {
    label: fallback[language],
    tone: fallback.tone,
  };
};

const buildSteps = (language: SupportedLanguage, phaseKey?: string | null): TopBarStep[] => {
  const currentIndex = findPhaseIndex(phaseKey);
  return PHASES.map((phase, index) => ({
    key: phase.key,
    label: phase.labels[language],
    state: index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'upcoming',
  }));
};

export const buildSimulationUiState = ({
  language,
  phaseKey,
  simulationStatus,
  simulationError,
  searchState,
  uiProgress,
}: {
  language: SupportedLanguage;
  phaseKey?: string | null;
  simulationStatus: 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
  simulationError?: string | null;
  searchState?: SearchState;
  uiProgress?: UiProgress;
}): SimulationUiState => {
  const copy = EMPTY_COPY[language];
  const statusCopy = getStatusCopy({ language, simulationStatus, simulationError, searchState, uiProgress });
  const displayPhaseKey = resolveDisplayPhaseKey({
    phaseKey,
    simulationStatus,
    searchState,
    uiProgress,
  });
  return {
    screenTitle: copy.screenTitle,
    stageLabel: labelForPhase(language, displayPhaseKey),
    currentStatusLabel: statusCopy.label,
    currentStatusTone: statusCopy.tone,
    steps: buildSteps(language, displayPhaseKey),
    currentStepLoading: Boolean(searchState?.status === 'searching' || uiProgress?.active),
    graphTitle: copy.graphTitle,
    graphDescription: copy.graphDescription,
    graphLegend: [
      { key: 'accepted', label: language === 'ar' ? 'مؤيد' : 'Accepting', color: '#22c55e' },
      { key: 'neutral', label: language === 'ar' ? 'محايد' : 'Neutral', color: '#94a3b8' },
      { key: 'rejected', label: language === 'ar' ? 'رافض' : 'Rejecting', color: '#ef4444' },
      { key: 'active', label: language === 'ar' ? 'حوار نشط' : 'Active exchange', color: '#f59e0b' },
    ],
    graphEmptyTitle: copy.graphEmptyTitle,
    graphEmptyDescription: copy.graphEmptyDescription,
    metricsHeadline: copy.metricsHeadline,
    metricsDescription: copy.metricsDescription,
    metricsEmptyLabel: copy.metricsEmptyLabel,
  };
};

export const hasMetricsData = (metrics: SimulationMetrics): boolean =>
  [
    metrics.totalAgents,
    metrics.accepted,
    metrics.rejected,
    metrics.neutral,
    metrics.currentIteration,
    metrics.totalIterations,
  ].some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
