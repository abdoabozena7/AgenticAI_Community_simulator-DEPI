import type { SimulationMetrics, SimulationPipeline, SimulationUiState, TopBarStep } from '@/types/simulation';

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

const STAGE_LABELS: Record<BusyStage, { ar: string; en: string }> = {
  extracting_schema: { ar: 'نحلل الفكرة ونرتب عناصرها', en: 'Structuring the idea' },
  detecting_mode: { ar: 'نحدد مسار التنفيذ', en: 'Detecting the execution flow' },
  assistant_reply: { ar: 'نحضّر الرد التالي', en: 'Preparing the next reply' },
  prestart_research: { ar: 'نحضّر البحث الإلزامي', en: 'Preparing mandatory research' },
  starting_simulation: { ar: 'نطلق خط أنابيب التنفيذ', en: 'Launching the execution pipeline' },
  checking_session: { ar: 'نتأكد من الجلسة الحالية', en: 'Checking the current session' },
};

const FALLBACK_BY_STATUS = {
  idle: { ar: 'جاهز للمتابعة', en: 'Ready to continue', tone: 'idle' as const },
  running: { ar: 'خط التنفيذ يعمل الآن', en: 'The execution pipeline is running', tone: 'info' as const },
  paused: { ar: 'التنفيذ متوقف مؤقتًا', en: 'Execution is paused', tone: 'warning' as const },
  completed: { ar: 'اكتملت المحاكاة', en: 'Simulation completed', tone: 'success' as const },
  error: { ar: 'يوجد خطأ يحتاج مراجعة', en: 'There is an issue that needs review', tone: 'error' as const },
} as const;

const EMPTY_COPY = {
  ar: {
    screenTitle: 'خط أنابيب تقييم الفكرة',
    graphTitle: 'خريطة الحوار بين الوكلاء',
    graphDescription: 'توضح كيف تنتقل الآراء بين الوكلاء أثناء النقاش.',
    graphEmptyTitle: 'ستظهر خريطة الحوار بعد اكتمال خط الأنابيب وبدء النقاش',
    graphEmptyDescription: 'ابدأ التشغيل ليتم تنفيذ البحث ثم بناء الشخصيات قبل النقاش.',
    metricsHeadline: 'مؤشرات القرار',
    metricsDescription: 'ملخص سريع يساعدك على فهم اتجاه التقييم الآن.',
    metricsEmptyLabel: 'بانتظار البيانات',
  },
  en: {
    screenTitle: 'Idea evaluation pipeline',
    graphTitle: 'Agent discussion map',
    graphDescription: 'Shows how opinions move between agents during debate.',
    graphEmptyTitle: 'The discussion map appears after the mandatory pipeline finishes',
    graphEmptyDescription: 'Start the run and the system will research, generate personas, and only then begin debate.',
    metricsHeadline: 'Decision metrics',
    metricsDescription: 'A compact summary to understand the current direction.',
    metricsEmptyLabel: 'Waiting for data',
  },
};

const pipelineStatusToStepState = (status: string): TopBarStep['state'] => {
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'current';
  return 'upcoming';
};

const pipelineStepLabel = (language: SupportedLanguage, step: NonNullable<SimulationPipeline>['steps'][number]) =>
  step.label?.[language] || step.label?.en || step.key;

const buildPipelineSteps = (language: SupportedLanguage, pipeline: SimulationPipeline): TopBarStep[] =>
  pipeline.steps.map((step) => ({
    key: step.key,
    label: pipelineStepLabel(language, step),
    state: pipelineStatusToStepState(step.status),
    subtleStatus: step.detail || undefined,
  }));

const currentPipelineStep = (pipeline?: SimulationPipeline | null) =>
  pipeline?.steps.find((step) => step.status === 'running')
  || pipeline?.steps.find((step) => step.status === 'pending')
  || [...(pipeline?.steps || [])].reverse().find((step) => step.status === 'completed')
  || null;

const getStatusCopy = ({
  language,
  simulationStatus,
  simulationError,
  searchState,
  uiProgress,
  pipeline,
}: {
  language: SupportedLanguage;
  simulationStatus: 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
  simulationError?: string | null;
  searchState?: SearchState;
  uiProgress?: UiProgress;
  pipeline?: SimulationPipeline | null;
}) => {
  if (simulationError) {
    return {
      label: language === 'ar' ? 'يوجد خطأ يحتاج مراجعة' : 'There is an error that needs review',
      tone: 'error' as const,
    };
  }
  if (pipeline?.blockers?.length) {
    return {
      label: language === 'ar'
        ? `المحاكاة محجوبة: ${pipeline.blockers.join('، ')}`
        : `Simulation blocked: ${pipeline.blockers.join(', ')}`,
      tone: 'warning' as const,
    };
  }
  const activeStep = currentPipelineStep(pipeline);
  if (activeStep) {
    return {
      label: activeStep.detail || pipelineStepLabel(language, activeStep),
      tone: activeStep.status === 'completed' ? 'success' as const : 'info' as const,
    };
  }
  if (searchState?.status === 'searching') {
    return {
      label: STAGE_LABELS[searchState.stage || 'prestart_research'][language],
      tone: 'info' as const,
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

export const buildSimulationUiState = ({
  language,
  phaseKey,
  simulationStatus,
  simulationError,
  searchState,
  uiProgress,
  pipeline,
}: {
  language: SupportedLanguage;
  phaseKey?: string | null;
  simulationStatus: 'idle' | 'configuring' | 'running' | 'paused' | 'completed' | 'error';
  simulationError?: string | null;
  searchState?: SearchState;
  uiProgress?: UiProgress;
  pipeline?: SimulationPipeline | null;
}): SimulationUiState => {
  const copy = EMPTY_COPY[language];
  const statusCopy = getStatusCopy({ language, simulationStatus, simulationError, searchState, uiProgress, pipeline });
  const activeStep = currentPipelineStep(pipeline);
  const steps = pipeline?.steps?.length
    ? buildPipelineSteps(language, pipeline)
    : [{
        key: phaseKey || 'idea_intake',
        label: language === 'ar' ? 'استقبال الفكرة' : 'Idea intake',
        state: simulationStatus === 'completed' ? 'completed' : 'current',
      }];
  return {
    screenTitle: copy.screenTitle,
    stageLabel: activeStep ? pipelineStepLabel(language, activeStep) : (language === 'ar' ? 'استقبال الفكرة' : 'Idea intake'),
    currentStatusLabel: statusCopy.label,
    currentStatusTone: statusCopy.tone,
    steps,
    currentStepLoading: Boolean(
      pipeline?.steps?.some((step) => step.status === 'running')
      || searchState?.status === 'searching'
      || uiProgress?.active
    ),
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

export const formatCount = (value: number | null | undefined, fallback = '0'): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : fallback;

export const formatPercent = (
  value: number | null | undefined,
  fallback = '0%',
  decimals = 0,
): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return `${value.toFixed(decimals)}%`;
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
