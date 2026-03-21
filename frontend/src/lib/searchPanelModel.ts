import type { SearchResponse } from '@/services/api';
import type {
  CoachIntervention,
  PendingClarification,
  PendingResearchReview,
  ReasoningMessage,
  SimulationChatEvent,
  SimulationPipeline,
  SimulationPersonaSource,
} from '@/types/simulation';

export type SearchLiveEvent = {
  eventSeq?: number;
  cycleId?: string | null;
  action?: string | null;
  status?: string | null;
  url?: string | null;
  domain?: string | null;
  faviconUrl?: string | null;
  title?: string | null;
  httpStatus?: number | null;
  contentChars?: number | null;
  relevanceScore?: number | null;
  progressPct?: number | null;
  snippet?: string | null;
  error?: string | null;
  metaJson?: Record<string, unknown> | null;
  timestamp?: number | null;
};

export type SearchPanelStage =
  | 'ready'
  | 'running'
  | 'review'
  | 'completed_with_content'
  | 'completed_empty'
  | 'failed'
  | 'hidden';

export interface SearchPanelPipelineStep {
  key: string;
  label: string;
  detail?: string | null;
  status: 'pending' | 'running' | 'completed' | 'blocked';
}

export type SearchPanelItem =
  | {
      kind: 'live_event';
      id: string;
      title: string;
      url?: string | null;
      domain?: string | null;
      faviconUrl?: string | null;
      badgeLabel: string;
      progress: number;
      preview: string;
      httpStatus?: number | null;
      contentChars?: number | null;
      relevanceScore?: number | null;
      highlighted?: boolean;
    }
  | {
      kind: 'result';
      id: string;
      title: string;
      url: string;
      domain?: string | null;
      faviconUrl?: string | null;
      badgeLabel: string;
      preview: string;
      relevanceScore?: number | null;
    }
  | {
      kind: 'summary';
      id: string;
      title: string;
      badgeLabel: string;
      content: string;
    }
  | {
      kind: 'note';
      id: string;
      title: string;
      badgeLabel: string;
      content: string;
      tone?: 'info' | 'success' | 'warning';
      bullets?: string[];
      cta?: string;
    };

export interface SearchPanelModel {
  stage: SearchPanelStage;
  visible: boolean;
  title: string;
  subtitle: string;
  description: string;
  statusLabel: string;
  isBusy: boolean;
  pipelineSteps: SearchPanelPipelineStep[];
  items: SearchPanelItem[];
  emptyTitle: string;
  emptyDescription: string;
}

type Language = 'ar' | 'en';

type SearchState = {
  status: 'idle' | 'searching' | 'complete' | 'timeout' | 'error';
  answer?: string;
  results?: SearchResponse['results'];
};

type ResearchContext = {
  summary: string;
  sources: SearchResponse['results'];
};

const ACTION_LABELS: Record<string, { ar: string; en: string; progress: number }> = {
  research_started: { ar: 'بدء البحث', en: 'Research started', progress: 10 },
  query_started: { ar: 'تشغيل الاستعلام', en: 'Query started', progress: 14 },
  query_planned: { ar: 'تخطيط البحث', en: 'Query planned', progress: 18 },
  search_results_found: { ar: 'لقينا نتائج', en: 'Results found', progress: 28 },
  search_results_ready: { ar: 'النتائج جاهزة', en: 'Results ready', progress: 34 },
  query_result: { ar: 'استلام نتائج', en: 'Received results', progress: 38 },
  page_opened: { ar: 'فتح صفحة', en: 'Opened page', progress: 52 },
  page_opening: { ar: 'فتح صفحة', en: 'Opening page', progress: 52 },
  url_opened: { ar: 'فتح رابط', en: 'Opened URL', progress: 52 },
  fetch_started: { ar: 'سحب المحتوى', en: 'Fetching page', progress: 58 },
  page_scraped: { ar: 'استخراج إشارات', en: 'Extracting signals', progress: 78 },
  url_extracted: { ar: 'تم استخراج الرابط', en: 'URL extracted', progress: 82 },
  fetch_done: { ar: 'اكتمل جلب الصفحة', en: 'Fetch complete', progress: 84 },
  evidence_extracted: { ar: 'بناء الأدلة', en: 'Building evidence', progress: 88 },
  summary_ready: { ar: 'الملخص جاهز', en: 'Summary ready', progress: 92 },
  evidence_cards_ready: { ar: 'بطاقات الأدلة جاهزة', en: 'Evidence cards ready', progress: 94 },
  gaps_ready: { ar: 'الفجوات واضحة', en: 'Gaps identified', progress: 96 },
  review_required: { ar: 'مراجعة مطلوبة', en: 'Review required', progress: 97 },
  research_completed: { ar: 'اكتمل البحث', en: 'Research complete', progress: 100 },
  research_done: { ar: 'اكتمل البحث', en: 'Research complete', progress: 100 },
  search_completed: { ar: 'اكتمل البحث', en: 'Search complete', progress: 100 },
  search_failed: { ar: 'البحث فشل', en: 'Search failed', progress: 100 },
  url_failed: { ar: 'فشل فتح الرابط', en: 'URL failed', progress: 100 },
  persona_signal_extraction_started: { ar: 'استخراج إشارات الشخصيات', en: 'Extracting persona signals', progress: 22 },
  persona_signal_extraction_completed: { ar: 'إشارات الشخصيات جاهزة', en: 'Persona signals ready', progress: 28 },
  persona_batch_started: { ar: 'توليد دفعة شخصيات', en: 'Generating personas', progress: 58 },
  persona_batch_completed: { ar: 'دفعة الشخصيات اكتملت', en: 'Persona batch complete', progress: 78 },
  persona_duplicates_rejected: { ar: 'استبعاد شخصيات مكررة', en: 'Duplicate personas removed', progress: 80 },
  persona_validation_passed: { ar: 'تحقق الجودة نجح', en: 'Validation passed', progress: 90 },
  persona_validation_failed: { ar: 'تحقق الجودة فشل', en: 'Validation failed', progress: 100 },
  persona_persistence_started: { ar: 'حفظ مجموعة الشخصيات', en: 'Saving persona set', progress: 92 },
  persona_persistence_completed: { ar: 'تم حفظ مجموعة الشخصيات', en: 'Persona set saved', progress: 100 },
};

const PHASE_LABELS: Record<string, { ar: string; en: string }> = {
  idea_intake: { ar: 'استقبال الفكرة', en: 'Idea intake' },
  context_classification: { ar: 'فهم السياق', en: 'Context classification' },
  internet_research: { ar: 'البحث والإشارات', en: 'Research and signals' },
  persona_generation: { ar: 'توليد الشخصيات', en: 'Persona generation' },
  persona_persistence: { ar: 'حفظ المجموعة', en: 'Persona persistence' },
  clarification_questions: { ar: 'توضيح من المستخدم', en: 'User clarification' },
  simulation_initialization: { ar: 'تهيئة المجتمع', en: 'Simulation setup' },
  agent_deliberation: { ar: 'نقاش المجتمع', en: 'Agent deliberation' },
  convergence: { ar: 'استخلاص القرار', en: 'Convergence' },
  summary: { ar: 'الملخص النهائي', en: 'Final summary' },
};

const PHASE_ORDER = [
  'idea_intake',
  'context_classification',
  'internet_research',
  'persona_generation',
  'persona_persistence',
  'clarification_questions',
  'simulation_initialization',
  'agent_deliberation',
  'convergence',
  'summary',
] as const;

const FALLBACK_FAVICON = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

const trimText = (value?: string | null) => String(value || '').trim();

const toHost = (value?: string | null) => {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
  }
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const toStringList = (value: unknown, limit = 4): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : [];

const titleForPhase = (language: Language, phaseKey?: string | null) => {
  const key = trimText(phaseKey).toLowerCase();
  const label = PHASE_LABELS[key];
  return label ? label[language] : (language === 'ar' ? 'خطوات التنفيذ' : 'Execution activity');
};

const phaseIndex = (phaseKey?: string | null) => {
  const key = trimText(phaseKey).toLowerCase();
  const index = PHASE_ORDER.indexOf(key as (typeof PHASE_ORDER)[number]);
  return index >= 0 ? index : -1;
};

const buildPipelineSteps = (
  language: Language,
  pipeline: SimulationPipeline | null | undefined,
  currentPhaseKey?: string | null,
): SearchPanelPipelineStep[] => {
  if (pipeline?.steps?.length) {
    return pipeline.steps.map((step) => ({
      key: step.key,
      label: step.label?.[language] || step.label?.en || step.key,
      detail: step.detail || null,
      status: step.status,
    }));
  }

  const phase = trimText(currentPhaseKey).toLowerCase();
  if (!phase) return [];
  return [{
    key: phase,
    label: titleForPhase(language, phase),
    detail: null,
    status: 'running',
  }];
};

const buildLiveItems = (language: Language, liveEvents: SearchLiveEvent[]): SearchPanelItem[] => {
  const ordered = [...liveEvents]
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))
    .slice(-8);

  return ordered.map((event, index) => {
    const actionKey = trimText(event.action).toLowerCase();
    const mapping = ACTION_LABELS[actionKey] || ACTION_LABELS.page_scraped;
    const domain = trimText(event.domain) || toHost(event.url);
    const title = trimText(event.title) || domain || trimText(event.url) || actionKey || (language === 'ar' ? 'مصدر' : 'Source');
    const progress = typeof event.progressPct === 'number'
      ? Math.max(0, Math.min(100, Math.round(event.progressPct)))
      : mapping.progress;

    return {
      kind: 'live_event',
      id: `${event.eventSeq ?? index}-${event.url ?? title}-${actionKey}-${event.timestamp ?? index}`,
      title,
      url: event.url ?? null,
      domain: domain || null,
      faviconUrl: event.faviconUrl || (domain ? FALLBACK_FAVICON(domain) : null),
      badgeLabel: mapping[language],
      progress,
      preview: trimText(event.snippet) || trimText(event.error) || (language === 'ar' ? 'هيظهر هنا ملخص الخطوة دي.' : 'This step summary will appear here.'),
      httpStatus: typeof event.httpStatus === 'number' ? event.httpStatus : null,
      contentChars: typeof event.contentChars === 'number' ? event.contentChars : null,
      relevanceScore: typeof event.relevanceScore === 'number' ? event.relevanceScore : null,
      highlighted: index === ordered.length - 1,
    };
  });
};

const buildResultItems = (
  language: Language,
  results: SearchResponse['results'] | undefined,
  review: PendingResearchReview | null | undefined,
): SearchPanelItem[] => {
  const reviewItems = Array.isArray(review?.candidateUrls) ? review.candidateUrls : [];
  if (reviewItems.length > 0) {
    return reviewItems.slice(0, 6).map((item, index) => ({
      kind: 'result',
      id: item.id || `review-${index + 1}`,
      title: trimText(item.title) || trimText(item.domain) || item.url,
      url: item.url,
      domain: trimText(item.domain) || toHost(item.url) || null,
      faviconUrl: item.faviconUrl || (trimText(item.domain) ? FALLBACK_FAVICON(trimText(item.domain)) : null),
      badgeLabel: language === 'ar' ? 'رابط للمراجعة' : 'Review candidate',
      preview: trimText(item.snippet) || (language === 'ar' ? 'مصدر مرشح للاستخراج أو توسيع البحث.' : 'Candidate source for extraction or search expansion.'),
      relevanceScore: typeof item.score === 'number' ? item.score : null,
    }));
  }

  const sourceResults = Array.isArray(results) ? results : [];
  return sourceResults.slice(0, 6).map((item, index) => ({
    kind: 'result',
    id: `${item.url}-${index}`,
    title: trimText(item.title) || trimText(item.domain) || item.url,
    url: item.url,
    domain: trimText(item.domain) || toHost(item.url) || null,
    faviconUrl: trimText(item.domain) ? FALLBACK_FAVICON(trimText(item.domain)) : null,
    badgeLabel: language === 'ar' ? 'نتيجة بحث' : 'Search result',
    preview: trimText(item.snippet) || trimText(item.reason) || (language === 'ar' ? 'المصدر ظهر لكن لسه مفيش ملخص كفاية.' : 'Source found without a detailed preview yet.'),
    relevanceScore: typeof item.score === 'number' ? item.score : null,
  }));
};

const buildSummaryItems = (
  language: Language,
  researchSummary?: string | null,
  finalSummary?: string | null,
): SearchPanelItem[] => {
  const items: SearchPanelItem[] = [];
  if (trimText(researchSummary)) {
    items.push({
      kind: 'summary',
      id: 'research-summary',
      title: language === 'ar' ? 'ملخص الإشارات والبحث' : 'Research summary',
      badgeLabel: language === 'ar' ? 'بحث' : 'Research',
      content: trimText(researchSummary),
    });
  }
  if (trimText(finalSummary) && trimText(finalSummary) !== trimText(researchSummary)) {
    items.push({
      kind: 'summary',
      id: 'final-summary',
      title: language === 'ar' ? 'النتيجة الحالية' : 'Current outcome',
      badgeLabel: language === 'ar' ? 'ملخص' : 'Summary',
      content: trimText(finalSummary),
    });
  }
  return items;
};

const buildReasoningNote = (language: Language, reasoningFeed: ReasoningMessage[]): SearchPanelItem[] => {
  const latest = [...reasoningFeed]
    .filter((item) => trimText(item.message))
    .slice(-4)
    .reverse();
  if (!latest.length) return [];

  return [{
    kind: 'note',
    id: 'reasoning-latest',
    title: language === 'ar' ? 'آخر ردود المجتمع' : 'Latest community reactions',
    badgeLabel: language === 'ar' ? 'نقاش' : 'Debate',
    content: language === 'ar'
      ? 'دي آخر الرسائل اللي طلع بها المجتمع أثناء النقاش.'
      : 'These are the latest agent reactions from the ongoing discussion.',
    tone: 'info',
    bullets: latest.map((item) => {
      const label = item.agentLabel || item.agentShortId || item.agentId;
      return `@${label}: ${item.message}`;
    }),
  }];
};

const buildChatEventNote = (language: Language, chatEvents: SimulationChatEvent[]): SearchPanelItem[] => {
  const latest = [...chatEvents]
    .filter((item) => item.role !== 'user' && trimText(item.content))
    .slice(-3);
  if (!latest.length) return [];

  return [{
    kind: 'note',
    id: 'system-updates',
    title: language === 'ar' ? 'تحديثات مباشرة من النظام' : 'Live system updates',
    badgeLabel: language === 'ar' ? 'تحديث' : 'Update',
    content: language === 'ar'
      ? 'التحديثات دي بتتسجل لحظة بلحظة أثناء التشغيل.'
      : 'These updates are captured live as the run progresses.',
    tone: 'info',
    bullets: latest.map((item) => item.content),
  }];
};

const buildClarificationNote = (
  language: Language,
  pendingClarification: PendingClarification | null | undefined,
): SearchPanelItem[] => {
  if (!pendingClarification?.questionId) return [];
  return [{
    kind: 'note',
    id: 'clarification-needed',
    title: language === 'ar' ? 'فيه توضيح مطلوب قبل ما النظام يكمل' : 'A clarification is needed before continuing',
    badgeLabel: language === 'ar' ? 'توضيح' : 'Clarification',
    content: pendingClarification.question,
    tone: 'warning',
    bullets: pendingClarification.supportingSnippets?.slice(0, 2),
  }];
};

const buildResearchReviewNote = (
  language: Language,
  pendingResearchReview: PendingResearchReview | null | undefined,
): SearchPanelItem[] => {
  if (!pendingResearchReview?.cycleId) return [];
  return [{
    kind: 'note',
    id: 'research-review',
    title: language === 'ar' ? 'البحث محتاج مراجعة قبل المتابعة' : 'Research review is required',
    badgeLabel: language === 'ar' ? 'مراجعة' : 'Review',
    content: pendingResearchReview.gapSummary || (language === 'ar' ? 'اختار الروابط الأنسب أو وسّع البحث قبل ما نكمل.' : 'Select the strongest URLs or expand the search before continuing.'),
    tone: 'warning',
    bullets: pendingResearchReview.candidateUrls.slice(0, 3).map((item) => item.title || item.domain || item.url),
  }];
};

const buildCoachNote = (
  language: Language,
  coachIntervention: CoachIntervention | null | undefined,
): SearchPanelItem[] => {
  if (!coachIntervention?.interventionId) return [];
  return [{
    kind: 'note',
    id: 'coach-intervention',
    title: language === 'ar' ? 'تدخل ذكي في منتصف المحاكاة' : 'Live orchestration intervention',
    badgeLabel: language === 'ar' ? 'مشكلة مهمة' : 'Critical issue',
    content: coachIntervention.blockerSummary,
    tone: 'warning',
    bullets: coachIntervention.suggestions.slice(0, 3).map((item) => item.title),
    cta: coachIntervention.guideMessage || undefined,
  }];
};

const buildImprovementNote = (language: Language, schema: Record<string, unknown>): SearchPanelItem[] => {
  const evaluation = toRecord(schema.idea_improvement_evaluation);
  if (!evaluation) return [];
  const acceptanceBefore = Number(evaluation.acceptance_before ?? 0);
  const acceptanceAfter = Number(evaluation.acceptance_after ?? 0);
  const rejectionBefore = Number(evaluation.rejection_before ?? 0);
  const rejectionAfter = Number(evaluation.rejection_after ?? 0);
  const keyImprovements = toStringList(evaluation.key_improvements, 3);
  const remainingProblems = toStringList(evaluation.remaining_problems, 2);

  return [{
    kind: 'note',
    id: 'improvement-evaluation',
    title: language === 'ar' ? 'قياس التعديل قبل وبعد' : 'Before/after improvement check',
    badgeLabel: language === 'ar' ? 'مقارنة' : 'Comparison',
    content: language === 'ar'
      ? `القبول اتحرك من ${acceptanceBefore} إلى ${acceptanceAfter}، والرفض من ${rejectionBefore} إلى ${rejectionAfter}.`
      : `Acceptance moved from ${acceptanceBefore} to ${acceptanceAfter}, and rejection from ${rejectionBefore} to ${rejectionAfter}.`,
    tone: acceptanceAfter > acceptanceBefore ? 'success' : 'warning',
    bullets: [...keyImprovements, ...remainingProblems],
  }];
};

const buildExecutionNotes = (language: Language, schema: Record<string, unknown>): SearchPanelItem[] => {
  const items: SearchPanelItem[] = [];
  const executionSteps = toRecord(schema.execution_steps);
  if (executionSteps) {
    items.push({
      kind: 'note',
      id: 'execution-steps',
      title: language === 'ar' ? 'خطوات التنفيذ اللي طلعنا بها' : 'Execution steps derived from the simulation',
      badgeLabel: language === 'ar' ? 'تنفيذ' : 'Execution',
      content: String(executionSteps.intro || (language === 'ar' ? 'دي أول خطوات عملية نقدر ننفذها فورًا.' : 'These are the next practical steps to test immediately.')),
      tone: 'success',
      bullets: toStringList(executionSteps.steps, 5),
      cta: typeof executionSteps.cta === 'string' ? executionSteps.cta : undefined,
    });
  }

  const latestFollowup = toRecord(schema.latest_execution_followup);
  if (latestFollowup) {
    items.push({
      kind: 'note',
      id: 'execution-followup',
      title: language === 'ar' ? 'آخر متابعة تنفيذ' : 'Latest execution follow-up',
      badgeLabel: language === 'ar' ? 'متابعة' : 'Follow-up',
      content: String(latestFollowup.learning || (language === 'ar' ? 'تم تسجيل نتيجة جديدة من التجربة.' : 'A new execution signal was recorded.')),
      tone: latestFollowup.classification === 'positive_signal' || latestFollowup.classification === 'weak_positive_signal'
        ? 'success'
        : 'warning',
      bullets: [String(latestFollowup.next_step || '').trim()].filter(Boolean),
    });
  }

  const roadmap = toRecord(schema.execution_roadmap);
  if (roadmap) {
    items.push({
      kind: 'note',
      id: 'execution-roadmap',
      title: language === 'ar' ? 'الخطة العملية الحالية' : 'Current execution roadmap',
      badgeLabel: language === 'ar' ? 'خارطة طريق' : 'Roadmap',
      content: String(roadmap.best_first_version || (language === 'ar' ? 'تم بناء نسخة أولى عملية قابلة للتجربة.' : 'A practical first version is ready for testing.')),
      tone: 'success',
      bullets: toStringList(roadmap.first_five_steps, 4),
      cta: typeof roadmap.final_cta === 'string' ? roadmap.final_cta : undefined,
    });
  }

  return items;
};

const buildAutomationNotes = (
  language: Language,
  schema: Record<string, unknown>,
  personaSource: SimulationPersonaSource | null | undefined,
): SearchPanelItem[] => {
  const items: SearchPanelItem[] = [];
  if (String(schema.research_estimation_mode || '').trim().toLowerCase() === 'ai_estimation') {
    items.push({
      kind: 'note',
      id: 'research-estimation',
      title: language === 'ar' ? 'البحث الحقيقي كان ضعيف فكمّلنا بتقدير ذكي منخفض الثقة' : 'Live search was weak, so the system used low-confidence AI estimation',
      badgeLabel: language === 'ar' ? 'تقدير بحثي' : 'Estimated research',
      content: language === 'ar'
        ? 'النظام ما وقفش المسار؛ كوّن structured research usable مع توضيح إن الثقة أقل من البحث القوي.'
        : 'The pipeline continued with a downstream-usable structured research state, marked as lower confidence.',
      tone: 'warning',
      bullets: Array.isArray(schema.research_visible_insights)
        ? schema.research_visible_insights.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
        : undefined,
    });
  }
  if (personaSource?.auto_selected && personaSource.mode) {
    items.push({
      kind: 'note',
      id: 'persona-source-auto-selected',
      title: language === 'ar' ? 'تم اختيار مصدر الشخصيات تلقائيًا' : 'Persona source was auto-selected',
      badgeLabel: language === 'ar' ? 'اختيار تلقائي' : 'Auto-selected',
      content: language === 'ar'
        ? `تم اعتماد المصدر الحالي تلقائيًا: ${personaSource.mode}.`
        : `The current persona source was resolved automatically: ${personaSource.mode}.`,
      tone: 'success',
    });
  }
  return items;
};

const buildPipelineBlockerNote = (
  language: Language,
  pipeline: SimulationPipeline | null | undefined,
): SearchPanelItem[] => {
  const details = Array.isArray(pipeline?.blocker_details) ? pipeline?.blocker_details : [];
  if (!details.length) return [];
  const primary = details[0];
  const bullets = details.slice(0, 3).map((item) => {
    const action = String(item.action || '').trim();
    return action ? `${item.message} ${action}` : item.message;
  });
  return [{
    kind: 'note',
    id: 'pipeline-blocker',
    title: language === 'ar' ? 'سبب توقف الخط الحالي' : 'Why the pipeline stopped',
    badgeLabel: language === 'ar' ? 'تعطّل' : 'Blocked',
    content: primary?.title || (language === 'ar' ? 'فيه خطوة مانعة المحاكاة من الاستمرار.' : 'A blocker is preventing the simulation from continuing.'),
    tone: 'warning',
    bullets,
    cta: primary?.action || undefined,
  }];
};

const hasActivePipelineBlocker = ({
  pipeline,
  currentPhaseKey,
  pipelineSteps,
  pendingInputKind,
  isRunStarting,
  isRunActive,
  searchState,
}: {
  pipeline: SimulationPipeline | null | undefined;
  currentPhaseKey?: string | null;
  pipelineSteps: SearchPanelPipelineStep[];
  pendingInputKind?: string | null;
  isRunStarting: boolean;
  isRunActive: boolean;
  searchState: SearchState;
}): boolean => {
  if (!pipeline?.blockers?.length || !pipeline.actively_blocked) return false;
  if (pendingInputKind) return false;
  if (searchState.status === 'searching' || isRunStarting || isRunActive) return false;
  if (pipelineSteps.some((step) => step.status === 'running')) return false;
  const currentIndex = phaseIndex(currentPhaseKey);
  const blockedIndex = phaseIndex(pipeline.blocked_phase);
  if (currentIndex >= 0 && blockedIndex >= 0 && currentIndex < blockedIndex) return false;
  return true;
};

const getStageCopy = (language: Language, stage: Exclude<SearchPanelStage, 'hidden'>, hasItems: boolean) => {
  const copy = {
    ready: {
      subtitle: language === 'ar' ? 'اللوحة جاهزة وهتبدأ تعرض كل مرحلة أول ما التشغيل يبدأ.' : 'The panel is ready and will show each stage once the run starts.',
      statusLabel: language === 'ar' ? 'جاهز للبدء' : 'Ready to start',
      emptyTitle: language === 'ar' ? 'لسه مفيش نشاط ظاهر' : 'No activity yet',
      emptyDescription: language === 'ar' ? 'أول ما التشغيل يبدأ، هتشوف البحث، بناء الشخصيات، النقاش، والتنفيذ خطوة بخطوة.' : 'Once the run starts, you will see research, persona building, debate, and execution step by step.',
    },
    running: {
      subtitle: language === 'ar' ? 'النظام شغال دلوقتي وبيحدّث اللوحة لحظة بلحظة.' : 'The system is active and updating this panel live.',
      statusLabel: language === 'ar' ? 'شغال الآن' : 'Running live',
      emptyTitle: language === 'ar' ? 'فيه تشغيل جاري' : 'A run is in progress',
      emptyDescription: language === 'ar' ? 'بمجرد وصول أول حدث، هيتعرض هنا مباشرة.' : 'The first activity card will appear here as soon as it arrives.',
    },
    review: {
      subtitle: language === 'ar' ? 'فيه خطوة محتاجة قرار منك قبل ما باقي الخطوات تكمل.' : 'A decision from you is needed before the flow can continue.',
      statusLabel: language === 'ar' ? 'بانتظار قرارك' : 'Waiting for your input',
      emptyTitle: language === 'ar' ? 'المحاكاة واقفة على مراجعة' : 'The run is paused for review',
      emptyDescription: language === 'ar' ? 'راجع المطلوب من اللوحة أو من الشات وبعدها كمل.' : 'Review the required action from the panel or chat, then continue.',
    },
    completed_with_content: {
      subtitle: language === 'ar' ? (hasItems ? 'الرحلة مكتملة وكل المخرجات موجودة قدامك.' : 'التشغيل اكتمل.') : (hasItems ? 'The run finished and the output is available.' : 'Run completed.'),
      statusLabel: language === 'ar' ? 'اكتمل' : 'Completed',
      emptyTitle: language === 'ar' ? 'التشغيل اكتمل' : 'Run completed',
      emptyDescription: language === 'ar' ? 'اكتملت الخطوات ونتيجتها متاحة.' : 'The flow is complete and the output is available.',
    },
    completed_empty: {
      subtitle: language === 'ar' ? 'التشغيل خلص لكن مفيش عناصر كفاية تتعرض.' : 'The run finished without enough content to render.',
      statusLabel: language === 'ar' ? 'اكتمل بدون محتوى' : 'Completed without content',
      emptyTitle: language === 'ar' ? 'مفيش عناصر معروضة' : 'No renderable items',
      emptyDescription: language === 'ar' ? 'الخطوات خلصت لكن ماوصلناش لمحتوى مناسب للعرض هنا.' : 'The flow completed but did not produce enough panel-ready content.',
    },
    failed: {
      subtitle: language === 'ar' ? 'فيه مشكلة أوقفت المسار الحالي.' : 'An issue stopped the current flow.',
      statusLabel: language === 'ar' ? 'فيه مشكلة' : 'Needs attention',
      emptyTitle: language === 'ar' ? 'التشغيل اتعطل' : 'The run was interrupted',
      emptyDescription: language === 'ar' ? 'راجع الرسائل أو أعد المحاولة من جديد.' : 'Review the messages or retry the run.',
    },
  } as const;

  return copy[stage];
};

export const buildSearchPanelModel = ({
  language,
  activePanel,
  searchState,
  researchContext,
  liveEvents,
  reviewRequired,
  pendingResearchReview,
  pendingClarification,
  coachIntervention,
  chatEvents,
  reasoningFeed,
  summary,
  schema,
  pendingInputKind,
  isRunStarting,
  isRunActive,
  simulationActuallyStarted,
  currentPhaseKey,
  pipeline,
  personaSource,
}: {
  language: Language;
  activePanel: 'chat' | 'reasoning' | 'config';
  searchState: SearchState;
  researchContext: ResearchContext;
  liveEvents: SearchLiveEvent[];
  reviewRequired: boolean;
  pendingResearchReview?: PendingResearchReview | null;
  pendingClarification?: PendingClarification | null;
  coachIntervention?: CoachIntervention | null;
  chatEvents?: SimulationChatEvent[];
  reasoningFeed?: ReasoningMessage[];
  summary?: string | null;
  schema?: Record<string, unknown>;
  pendingInputKind?: string | null;
  isRunStarting: boolean;
  isRunActive: boolean;
  simulationActuallyStarted: boolean;
  reasoningPanelAvailable: boolean;
  currentPhaseKey?: string | null;
  pipeline?: SimulationPipeline | null;
  personaSource?: SimulationPersonaSource | null;
}): SearchPanelModel => {
  void activePanel;

  const safeSchema = schema && typeof schema === 'object' ? schema : {};
  const pipelineSteps = buildPipelineSteps(language, pipeline, currentPhaseKey);
  const activePipelineBlocker = hasActivePipelineBlocker({
    pipeline,
    currentPhaseKey,
    pipelineSteps,
    pendingInputKind,
    isRunStarting,
    isRunActive,
    searchState,
  });
  const liveItems = buildLiveItems(language, liveEvents);
  const resultItems = buildResultItems(
    language,
    searchState.results?.length ? searchState.results : researchContext.sources,
    pendingResearchReview,
  );
  const summaryItems = buildSummaryItems(
    language,
    reviewRequired ? pendingResearchReview?.gapSummary || researchContext.summary || searchState.answer : researchContext.summary || searchState.answer,
    summary,
  );
  const noteItems: SearchPanelItem[] = [
    ...(activePipelineBlocker ? buildPipelineBlockerNote(language, pipeline) : []),
    ...buildResearchReviewNote(language, pendingResearchReview),
    ...buildClarificationNote(language, pendingClarification),
    ...buildCoachNote(language, coachIntervention),
    ...buildImprovementNote(language, safeSchema),
    ...buildExecutionNotes(language, safeSchema),
    ...buildAutomationNotes(language, safeSchema, personaSource),
    ...buildReasoningNote(language, reasoningFeed || []),
    ...buildChatEventNote(language, chatEvents || []),
  ];

  const hasActivity = Boolean(
    pipelineSteps.length
    || liveItems.length
    || resultItems.length
    || noteItems.length
    || summaryItems.length
    || searchState.status !== 'idle'
    || simulationActuallyStarted
    || isRunStarting
    || isRunActive
    || pendingInputKind
  );

  if (!hasActivity && activePanel === 'config') {
    return {
      stage: 'hidden',
      visible: false,
      title: language === 'ar' ? 'المراحل المباشرة' : 'Live activity',
      subtitle: '',
      description: '',
      statusLabel: '',
      isBusy: false,
      pipelineSteps: [],
      items: [],
      emptyTitle: '',
      emptyDescription: '',
    };
  }

  let stage: Exclude<SearchPanelStage, 'hidden'> = 'ready';
  if (reviewRequired || pendingClarification?.questionId || coachIntervention?.interventionId || pendingInputKind === 'execution_followup') {
    stage = 'review';
  } else if (searchState.status === 'searching' || isRunStarting || isRunActive || pipelineSteps.some((item) => item.status === 'running')) {
    stage = 'running';
  } else if (searchState.status === 'timeout' || searchState.status === 'error' || activePipelineBlocker) {
    stage = 'failed';
  } else if (simulationActuallyStarted || summaryItems.length || noteItems.length || liveItems.length || resultItems.length) {
    stage = (summaryItems.length || noteItems.length || liveItems.length || resultItems.length) ? 'completed_with_content' : 'completed_empty';
  }

  const copy = getStageCopy(language, stage, Boolean(liveItems.length || resultItems.length || noteItems.length || summaryItems.length));
  const currentRunningStep = pipelineSteps.find((item) => item.status === 'running');
  const latestLive = liveItems.at(-1);
  const items = [
    ...noteItems.slice(0, 5),
    ...liveItems,
    ...(liveItems.length ? [] : resultItems),
    ...summaryItems,
  ].slice(0, 12);

  return {
    stage,
    visible: true,
    title: language === 'ar' ? 'المراحل المباشرة' : 'Live activity',
    subtitle: currentRunningStep?.detail || currentRunningStep?.label || latestLive?.badgeLabel || titleForPhase(language, currentPhaseKey) || copy.subtitle,
    description: language === 'ar'
      ? 'تابع كل اللي بيحصل في البحث، الشخصيات، النقاش، والتنفيذ لحظة بلحظة.'
      : 'Track research, personas, debate, and execution as they happen.',
    statusLabel: copy.statusLabel,
    isBusy: stage === 'running',
    pipelineSteps,
    items: stage === 'ready' ? [] : items,
    emptyTitle: copy.emptyTitle,
    emptyDescription: copy.emptyDescription,
  };
};
