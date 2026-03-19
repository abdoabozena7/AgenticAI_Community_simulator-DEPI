import type { PendingResearchReview } from '@/types/simulation';
import type { SimulationPipeline } from '@/types/simulation';
import type { SearchResponse } from '@/services/api';

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
    };

export interface SearchPanelModel {
  stage: SearchPanelStage;
  visible: boolean;
  title: string;
  subtitle: string;
  description: string;
  statusLabel: string;
  isBusy: boolean;
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
  research_started: { ar: 'جاري البحث...', en: 'Searching...', progress: 10 },
  query_started: { ar: 'بدء الاستعلام', en: 'Starting query...', progress: 14 },
  query_planned: { ar: 'تخطيط الاستعلام', en: 'Planning query...', progress: 18 },
  search_results_found: { ar: 'تم العثور على النتائج', en: 'Found results...', progress: 28 },
  search_results_ready: { ar: 'نتائج البحث جاهزة', en: 'Search results ready', progress: 34 },
  query_result: { ar: 'تم جلب النتائج', en: 'Received results', progress: 38 },
  page_opened: { ar: 'فتح الصفحة', en: 'Opening page...', progress: 52 },
  page_opening: { ar: 'فتح الصفحة', en: 'Opening page...', progress: 52 },
  url_opened: { ar: 'فتح الرابط', en: 'Opening URL...', progress: 52 },
  fetch_started: { ar: 'بدء استخراج الصفحة', en: 'Fetching page...', progress: 58 },
  page_scraped: { ar: 'استخراج البيانات', en: 'Extracting data...', progress: 78 },
  url_extracted: { ar: 'اكتمل استخراج الرابط', en: 'URL extracted', progress: 82 },
  fetch_done: { ar: 'اكتمل جلب الصفحة', en: 'Fetch complete', progress: 84 },
  evidence_extracted: { ar: 'بناء الأدلة', en: 'Building evidence...', progress: 88 },
  summary_ready: { ar: 'الملخص جاهز', en: 'Summary ready', progress: 92 },
  evidence_cards_ready: { ar: 'بطاقات الأدلة جاهزة', en: 'Evidence cards ready', progress: 94 },
  gaps_ready: { ar: 'الفجوات التحليلية جاهزة', en: 'Gaps identified', progress: 96 },
  review_required: { ar: 'مراجعة النتائج مطلوبة', en: 'Review required', progress: 97 },
  research_completed: { ar: 'اكتمل البحث', en: 'Search completed', progress: 100 },
  research_done: { ar: 'اكتمل البحث', en: 'Search completed', progress: 100 },
  search_completed: { ar: 'اكتمل البحث', en: 'Search completed', progress: 100 },
  search_failed: { ar: 'تعذر البحث', en: 'Search failed', progress: 100 },
  url_failed: { ar: 'تعذر استخراج الرابط', en: 'URL extraction failed', progress: 100 },
  persona_signal_extraction_started: { ar: 'استخراج إشارات الشخصيات', en: 'Extracting persona signals...', progress: 18 },
  persona_signal_extraction_completed: { ar: 'اكتمل تحليل إشارات الشخصيات', en: 'Persona signals ready', progress: 24 },
  persona_batch_started: { ar: 'جارٍ توليد دفعة شخصيات', en: 'Generating persona batch...', progress: 58 },
  persona_batch_completed: { ar: 'اكتملت دفعة شخصيات', en: 'Persona batch complete', progress: 78 },
  persona_duplicates_rejected: { ar: 'تم رفض شخصيات مكررة', en: 'Rejected duplicate personas', progress: 80 },
  persona_validation_passed: { ar: 'تم اعتماد جودة الشخصيات', en: 'Persona validation passed', progress: 90 },
  persona_validation_failed: { ar: 'فشل التحقق من الشخصيات', en: 'Persona validation failed', progress: 100 },
  persona_persistence_started: { ar: 'جارٍ حفظ الشخصيات', en: 'Saving persona asset...', progress: 92 },
  persona_persistence_completed: { ar: 'تم حفظ أصل الشخصيات', en: 'Persona asset saved', progress: 100 },
};

const FALLBACK_FAVICON = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

const toHost = (value?: string | null) => {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
  }
};

const trimText = (value?: string | null) => String(value || '').trim();

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
      badgeLabel: language === 'ar' ? mapping.ar : mapping.en,
      progress,
      preview: trimText(event.snippet) || trimText(event.error) || (language === 'ar' ? 'سيظهر الملخص هنا بعد الاستخراج.' : 'Summary preview will appear here once extracted.'),
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
  const reviewItems = Array.isArray(review?.candidateUrls) ? review!.candidateUrls : [];
  if (reviewItems.length > 0) {
    return reviewItems.slice(0, 8).map((item, index) => ({
      kind: 'result',
      id: item.id || `review-${index + 1}`,
      title: trimText(item.title) || trimText(item.domain) || item.url,
      url: item.url,
      domain: trimText(item.domain) || toHost(item.url) || null,
      faviconUrl: item.faviconUrl || (trimText(item.domain) ? FALLBACK_FAVICON(trimText(item.domain)) : null),
      badgeLabel: language === 'ar' ? 'نتيجة للمراجعة' : 'Review candidate',
      preview: trimText(item.snippet) || (language === 'ar' ? 'مرشح للاستخراج أو التوسيع.' : 'Candidate source for extraction or follow-up.'),
      relevanceScore: typeof item.score === 'number' ? item.score : null,
    }));
  }

  const sourceResults = Array.isArray(results) ? results : [];
  return sourceResults.slice(0, 8).map((item, index) => ({
    kind: 'result',
    id: `${item.url}-${index}`,
    title: trimText(item.title) || trimText(item.domain) || item.url,
    url: item.url,
    domain: trimText(item.domain) || toHost(item.url) || null,
    faviconUrl: trimText(item.domain) ? FALLBACK_FAVICON(trimText(item.domain)) : null,
    badgeLabel: language === 'ar' ? 'نتيجة بحث' : 'Search result',
    preview: trimText(item.snippet) || trimText(item.reason) || (language === 'ar' ? 'لا يوجد ملخص متاح لهذا المصدر بعد.' : 'No preview is available for this source yet.'),
    relevanceScore: typeof item.score === 'number' ? item.score : null,
  }));
};

const buildSummaryItem = (language: Language, summaryText?: string | null): SearchPanelItem[] => {
  const summary = trimText(summaryText);
  if (!summary) return [];
  return [{
    kind: 'summary',
    id: 'search-summary',
    title: language === 'ar' ? 'ملخص البحث' : 'Research summary',
    badgeLabel: language === 'ar' ? 'ملخص' : 'Summary',
    content: summary,
  }];
};

const getStageCopy = (language: Language, stage: Exclude<SearchPanelStage, 'hidden'>, hasItems: boolean) => {
  const copy = {
    ready: {
      subtitle: language === 'ar' ? 'لوحة البحث جاهزة وستبدأ بعد تشغيل الخطوة' : 'The search panel is ready and will start after you trigger the flow',
      statusLabel: language === 'ar' ? 'جاهز للبدء' : 'Ready to start',
      emptyTitle: language === 'ar' ? 'البحث لم يبدأ بعد' : 'Search has not started yet',
      emptyDescription: language === 'ar' ? 'عندما يبدأ البحث فعليًا ستظهر هنا المواقع وخطوات الاستخراج.' : 'When search actually starts, opened pages and extraction progress will appear here.',
    },
    running: {
      subtitle: language === 'ar' ? 'يجمع النظام المصادر ويفتح الصفحات الآن.' : 'The system is collecting sources and opening pages now.',
      statusLabel: language === 'ar' ? 'يعمل الآن' : 'Running now',
      emptyTitle: language === 'ar' ? 'البحث جارٍ' : 'Search is running',
      emptyDescription: language === 'ar' ? 'سيظهر التقدم هنا بمجرد وصول أول مصدر أو خطوة استخراج.' : 'Progress will appear here as soon as the first source or extraction step arrives.',
    },
    review: {
      subtitle: language === 'ar' ? 'نتائج البحث جاهزة وتحتاج مراجعة قبل المتابعة.' : 'Search results are ready and need review before continuing.',
      statusLabel: language === 'ar' ? 'بانتظار المراجعة' : 'Waiting for review',
      emptyTitle: language === 'ar' ? 'المراجعة مطلوبة' : 'Review required',
      emptyDescription: language === 'ar' ? 'لا توجد عناصر قابلة للعرض بعد، لكن النظام يطلب مراجعة قرار البحث الحالي.' : 'No renderable items are available yet, but the system requires a review decision.',
    },
    completed_with_content: {
      subtitle: language === 'ar'
        ? (hasItems ? 'اكتملت النتائج وأصبحت قابلة للعرض.' : 'اكتمل البحث.')
        : (hasItems ? 'Results are complete and ready to inspect.' : 'Search completed.'),
      statusLabel: language === 'ar' ? 'اكتملت الجولة' : 'Run complete',
      emptyTitle: language === 'ar' ? 'اكتمل البحث' : 'Search completed',
      emptyDescription: language === 'ar' ? 'تم الانتهاء من البحث.' : 'Search finished successfully.',
    },
    completed_empty: {
      subtitle: language === 'ar' ? 'اكتمل البحث لكن لم يصل أي محتوى قابل للعرض.' : 'Search completed but there is no renderable content.',
      statusLabel: language === 'ar' ? 'اكتمل بدون محتوى' : 'Completed without content',
      emptyTitle: language === 'ar' ? 'لا توجد نتائج قابلة للعرض' : 'No renderable results',
      emptyDescription: language === 'ar' ? 'انتهى البحث بدون مصادر أو ملخص صالحين للعرض في الواجهة.' : 'The search finished without sources or a summary that can be rendered in the panel.',
    },
    failed: {
      subtitle: language === 'ar' ? 'توقف البحث قبل اكتماله.' : 'Search stopped before completion.',
      statusLabel: language === 'ar' ? 'فشل البحث' : 'Search failed',
      emptyTitle: language === 'ar' ? 'تعذر إكمال البحث' : 'Could not complete search',
      emptyDescription: language === 'ar' ? 'أعد المحاولة أو استخدم المسار البديل إذا كان متاحًا.' : 'Retry the search or use the fallback path if available.',
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
  isRunStarting,
  isRunActive,
  simulationActuallyStarted,
  reasoningPanelAvailable,
  currentPhaseKey,
  pipeline,
}: {
  language: Language;
  activePanel: 'chat' | 'reasoning' | 'config';
  searchState: SearchState;
  researchContext: ResearchContext;
  liveEvents: SearchLiveEvent[];
  reviewRequired: boolean;
  pendingResearchReview?: PendingResearchReview | null;
  isRunStarting: boolean;
  isRunActive: boolean;
  simulationActuallyStarted: boolean;
  reasoningPanelAvailable: boolean;
  currentPhaseKey?: string | null;
  pipeline?: SimulationPipeline | null;
}): SearchPanelModel => {
  const phaseKey = String(currentPhaseKey || '').trim().toLowerCase();
  const pipelineActive = Boolean(
    pipeline
    && !pipeline.ready_for_simulation
    && pipeline.steps.some((step) => step.status === 'running' || step.status === 'completed')
  );
  const researchPhases = ['context_classification', 'internet_research', 'persona_generation', 'persona_persistence'];
  const visible = activePanel === 'chat'
    && !reasoningPanelAvailable
    && (
      pipelineActive
      || searchState.status !== 'idle'
      || reviewRequired
      || (!simulationActuallyStarted && !isRunStarting && !isRunActive)
      || researchPhases.includes(phaseKey)
    );

  if (!visible) {
    return {
      stage: 'hidden',
      visible: false,
      title: language === 'ar' ? 'البحث المباشر' : 'Live search',
      subtitle: '',
      description: '',
      statusLabel: '',
      isBusy: false,
      items: [],
      emptyTitle: '',
      emptyDescription: '',
    };
  }

  const liveItems = buildLiveItems(language, liveEvents);
  const resultItems = buildResultItems(
    language,
    searchState.results?.length ? searchState.results : researchContext.sources,
    pendingResearchReview,
  );
  const summaryItems = buildSummaryItem(
    language,
    reviewRequired ? pendingResearchReview?.gapSummary || researchContext.summary || searchState.answer : researchContext.summary || searchState.answer,
  );

  const contentItems = liveItems.length
    ? liveItems
    : resultItems.length
      ? resultItems
      : summaryItems;

  let stage: Exclude<SearchPanelStage, 'hidden'> = 'ready';
  if (reviewRequired) {
    stage = 'review';
  } else if (searchState.status === 'searching') {
    stage = 'running';
  } else if (searchState.status === 'timeout' || searchState.status === 'error') {
    stage = 'failed';
  } else if (searchState.status === 'complete') {
    stage = contentItems.length > 0 ? 'completed_with_content' : 'completed_empty';
  }

  const copy = getStageCopy(language, stage, contentItems.length > 0);
  const latestLive = liveItems.at(-1);

  return {
    stage,
    visible: true,
    title: language === 'ar' ? 'البحث المباشر' : 'Live search',
    subtitle: latestLive?.badgeLabel || copy.subtitle,
    description: language === 'ar'
      ? 'يمكنك متابعة الصفحات التي يفتحها النظام خطوة بخطوة.'
      : 'Watch each source as it is opened and processed.',
    statusLabel: copy.statusLabel,
    isBusy: stage === 'running',
    items: stage === 'ready' ? [] : contentItems,
    emptyTitle: copy.emptyTitle,
    emptyDescription: copy.emptyDescription,
  };
};
