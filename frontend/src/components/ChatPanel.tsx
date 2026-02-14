import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  ChevronDown,
  Play,
  Pause,
  RefreshCcw,
  Loader2,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage, PendingClarification, PendingResearchReview, ReasoningMessage, SimulationStatus } from '@/types/simulation';
import { cn } from '@/lib/utils';
import { SearchResult } from '@/services/api';

/* ------------------------------------------------------------------
   PROP-TYPES
------------------------------------------------------------------- */
interface ChatPanelProps {
  /** chat messages (user & bot) */
  messages: ChatMessage[];
  /** stream of reasoning messages from the agents */
  reasoningFeed: ReasoningMessage[];
  /** real-time debug rejections from LLM reasoning */
  reasoningDebug?: { id: string; agentShortId?: string; reason: string; stage?: string; attempt?: number; phase?: string; timestamp: number }[];
  /** send a new chat message */
  onSendMessage: (msg: string) => void;
  /** user selected an option in a poll / multi-select */
  onSelectOption?: (field: string, value: string) => void;
  /** waiting for a city name */
  isWaitingForCity?: boolean;
  /** waiting for a country name */
  isWaitingForCountry?: boolean;
  /** waiting for location choice (yes/no) */
  isWaitingForLocationChoice?: boolean;
  /** agents are thinking (typing indicator) */
  isThinking?: boolean;
  /** LLM generation error - show retry button */
  showRetry?: boolean;
  onRetryLlm?: () => void;
  /** Searching timed-out - allow "retry" */
  onSearchRetry?: () => void;
  /** Use LLM instead of web search */
  onSearchUseLlm?: () => void;
  /** "Start" button should appear even if no text typed */
  canConfirmStart?: boolean;
  onConfirmStart?: () => void;
  /** Pre-defined quick-reply chips */
  quickReplies?: { label: string; value: string }[];
  onQuickReply?: (value: string) => void;
  /** overall simulation state */
  simulationStatus?: SimulationStatus;
  /** backend error message surfaced via polling */
  simulationError?: string | null;
  /** agents are currently reasoning */
  reasoningActive?: boolean;
  /** summarisation phase */
  isSummarizing?: boolean;
  /** how many agents rejected */
  rejectedCount?: number;
  /** market-research data */
  research?: {
    summary?: string;
    signals?: string[];
    competition?: string;
    demand?: string;
    priceSensitivity?: string;
    regulatoryRisk?: string;
    gaps?: string[];
    notableLocations?: string[];
    sourcesCount?: number;
  };
  /** "download report" button state */
  reportBusy?: boolean;
  onDownloadReport?: () => void;
  /** top-level insights shown in the "Insights" tab */
  insights?: {
    idea?: string;
    location?: string;
    category?: string;
    audience?: string[];
    goals?: string[];
    maturity?: string;
    risk?: number;
    rejectReasons?: string[];
    summary?: string;
  };
  /** current status of the web-search routine */
  searchState?: {
    status: 'idle' | 'searching' | 'timeout' | 'error' | 'complete';
  };
  phaseState?: {
    currentPhaseKey?: string | null;
    progressPct?: number;
  };
  researchSourcesLive?: {
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
  }[];
  primaryControl?: {
    key: string;
    label: string;
    description?: string;
    disabled?: boolean;
    busy?: boolean;
    tone?: 'primary' | 'secondary' | 'warning' | 'success';
    icon?: 'play' | 'pause' | 'retry' | 'sparkles' | 'reasoning';
    onClick?: () => void;
    secondary?: {
      label: string;
      disabled?: boolean;
      onClick?: () => void;
    };
  } | null;
  pendingClarification?: PendingClarification | null;
  canAnswerClarification?: boolean;
  clarificationBusy?: boolean;
  onSubmitClarification?: (payload: {
    questionId: string;
    selectedOptionId?: string;
    customText?: string;
  }) => void;
  pendingResearchReview?: PendingResearchReview | null;
  researchReviewBusy?: boolean;
  onSubmitResearchReviewAction?: (payload: {
    cycleId: string;
    action: 'scrape_selected' | 'continue_search' | 'cancel_review';
    selectedUrlIds?: string[];
    addedUrls?: string[];
    queryRefinement?: string;
  }) => void;
  postActionsEnabled?: boolean;
  recommendedPostAction?: 'make_acceptable' | 'bring_to_world';
  finalAcceptancePct?: number;
  postActionBusy?: 'make_acceptable' | 'bring_to_world' | null;
  postActionResult?: {
    action: 'make_acceptable' | 'bring_to_world';
    title: string;
    summary: string;
    steps: string[];
    risks: string[];
    kpis: string[];
    revised_idea?: string;
  } | null;
  onRunPostAction?: (action: 'make_acceptable' | 'bring_to_world') => void;
  onStartFollowupFromPostAction?: () => void;
  /** user settings (language, auto-focus, ...) */
  settings: {
    language: 'ar' | 'en';
    autoFocusInput?: boolean;
  };
}

/* ------------------------------------------------------------------
   READ-MORE COMPONENT (unchanged)
------------------------------------------------------------------- */
function ReadMoreText({
  text,
  collapsedLines = 6,
  language,
  className,
  expanded,
  onToggleExpanded,
}: {
  text: string;
  collapsedLines?: number;
  language: 'ar' | 'en';
  className?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const apply = () => setIsMobile(window.innerWidth < 768);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  const isExpanded = typeof expanded === 'boolean' ? expanded : internalExpanded;
  const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const shouldClamp = words > (isMobile ? 55 : 85);
  const clampStyle = shouldClamp && !isExpanded
    ? ({
        display: '-webkit-box',
        WebkitLineClamp: collapsedLines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      } as const)
    : undefined;

  return (
    <div className={cn('min-w-0', className)}>
      <div className="whitespace-pre-wrap break-words overflow-visible" style={clampStyle}>
        {text}
      </div>

      {shouldClamp && (
        <span
          className="readmore"
          onClick={() => {
            if (onToggleExpanded) {
              onToggleExpanded();
              return;
            }
            setInternalExpanded((prev) => !prev);
          }}
          role="button"
          tabIndex={0}
        >
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')}
          />
          {isExpanded
            ? (language === 'ar' ? 'عرض أقل' : 'Read less')
            : (language === 'ar' ? 'اقرأ المزيد' : 'Read more')}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   INLINE DISCLOSURE (unchanged)
------------------------------------------------------------------- */
function InlineDisclosure({
  label,
  steps,
  open,
  onToggle,
  onClickLabel,
  language,
}: {
  label: string;
  steps: string[];
  open: boolean;
  onToggle: () => void;
  onClickLabel?: () => void;
  language: 'ar' | 'en';
}) {
  return (
    <div className={cn('mt-2', open && 'inline-disclosure-open')}>
      <div className="inline-disclosure" onClick={onClickLabel ?? onToggle}>
        <span className="thinking-icon" />
        <span>{label}</span>
        <ChevronDown
          className={cn('w-4 h-4 transition-transform', open && 'rotate-180')}
        />
      </div>

      {/* No borders-/boxes - expandable area */}
      <div className="inline-disclosure-content">
        <div className="inline-steps">
          {steps.map((s, i) => (
            <div
              key={`${i}-${s}`}
              className="inline-step"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              &rarr; {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   MAIN CHAT PANEL
------------------------------------------------------------------- */
export function ChatPanel({
  messages,
  reasoningFeed,
  reasoningDebug = [],
  onSendMessage,
  onSelectOption,
  isWaitingForCity = false,
  isWaitingForCountry = false,
  isWaitingForLocationChoice = false,
  isThinking = false,
  showRetry = false,
  onRetryLlm,
  quickReplies,
  onQuickReply,
  simulationStatus = 'idle',
  simulationError = null,
  reasoningActive = false,
  isSummarizing = false,
  rejectedCount = 0,
  research,
  reportBusy = false,
  onDownloadReport,
  insights,
  searchState,
  phaseState,
  researchSourcesLive = [],
  primaryControl = null,
  pendingClarification = null,
  canAnswerClarification = false,
  clarificationBusy = false,
  onSubmitClarification,
  pendingResearchReview = null,
  researchReviewBusy = false,
  onSubmitResearchReviewAction,
  postActionsEnabled = false,
  recommendedPostAction,
  finalAcceptancePct,
  postActionBusy = null,
  postActionResult = null,
  onRunPostAction,
  onStartFollowupFromPostAction,
  settings,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning' | 'insights'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [selectedClarificationOption, setSelectedClarificationOption] = useState<string | null>(null);
  const [clarificationInput, setClarificationInput] = useState('');
  const [selectedResearchUrlIds, setSelectedResearchUrlIds] = useState<string[]>([]);
  const [addedResearchUrlsInput, setAddedResearchUrlsInput] = useState('');
  const [researchRefinementInput, setResearchRefinementInput] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [expandedTextMap, setExpandedTextMap] = useState<Record<string, boolean>>({});
  const [brokenFaviconMap, setBrokenFaviconMap] = useState<Record<string, boolean>>({});

  const isSimulationDone =
    simulationStatus === 'completed' ||
    simulationStatus === 'error';
  const hasInsights =
    Boolean(insights?.summary) ||
    Boolean(insights?.idea) ||
    Boolean(insights?.category) ||
    Boolean(insights?.audience?.length) ||
    Boolean(insights?.goals?.length) ||
    Boolean(insights?.maturity) ||
    typeof insights?.risk === 'number' ||
    Boolean(research?.summary) ||
    Boolean(research?.signals?.length);
  const hasReasoningContent = reasoningFeed.length > 0;
  const reasoningUnavailable = !hasReasoningContent && !reasoningActive && isSimulationDone;
  const hasPendingClarification = Boolean(
    canAnswerClarification
    && pendingClarification
    && pendingClarification.questionId
  );
  const hasPendingResearchReview = Boolean(
    pendingResearchReview
    && pendingResearchReview.cycleId
    && pendingResearchReview.required
  );
  const recentResearchSources = useMemo(
    () => [...researchSourcesLive]
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-6)
      .reverse(),
    [researchSourcesLive]
  );
  const phaseLabel = useMemo(() => {
    const key = phaseState?.currentPhaseKey?.trim();
    if (!key) return null;
    const labelsAr: Record<string, string> = {
      intake: 'التهيئة',
      research_digest: 'تلخيص الأدلة',
      agent_init: 'تهيئة الوكلاء',
      deliberation: 'النقاش',
      convergence: 'تقليل الحياد',
      verdict: 'الحسم',
      summary: 'الملخص',
      search_bootstrap: 'البحث الأولي',
      evidence_map: 'جمع الأدلة',
      debate: 'النقاش',
      resolution: 'الحسم',
      completed: 'مكتمل',
    };
    const labelsEn: Record<string, string> = {
      intake: 'Intake',
      research_digest: 'Research Digest',
      agent_init: 'Agent Init',
      deliberation: 'Deliberation',
      convergence: 'Convergence',
      verdict: 'Verdict',
      summary: 'Summary',
      search_bootstrap: 'Search Bootstrap',
      evidence_map: 'Evidence Mapping',
      debate: 'Debate',
      resolution: 'Resolution',
      completed: 'Completed',
    };
    return settings.language === 'ar'
      ? (labelsAr[key] || key)
      : (labelsEn[key] || key);
  }, [phaseState?.currentPhaseKey, settings.language]);
  const effectivePostAction: 'make_acceptable' | 'bring_to_world' =
    recommendedPostAction
    || ((finalAcceptancePct ?? 0) >= 60 ? 'bring_to_world' : 'make_acceptable');
  const acceptancePctValue = Number.isFinite(finalAcceptancePct)
    ? Math.max(0, Math.min(100, finalAcceptancePct as number))
    : null;
  const toggleExpandedText = useCallback((key: string) => {
    setExpandedTextMap((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);


  const formatResearchError = useCallback((errorText?: string | null) => {
    const raw = String(errorText || '').trim();
    if (!raw) return '';
    if (!/search quality below threshold/i.test(raw)) return raw;

    const readPair = (key: string) => {
      const match = raw.match(new RegExp(`${key}=([0-9.]+)/([0-9.]+)`, 'i'));
      if (!match) return null;
      return { current: Number(match[1]), required: Number(match[2]) };
    };

    const usable = readPair('usable_sources');
    const domains = readPair('domains');
    const chars = readPair('max_content_chars');
    const extractionMatch = raw.match(/extraction_success_rate=([0-9.]+)/i);
    const extractionRate = extractionMatch ? Number(extractionMatch[1]) : 0;

    const usableCurrent = usable?.current ?? 0;
    const usableRequired = usable?.required ?? 2;
    const domainsCurrent = domains?.current ?? 0;
    const domainsRequired = domains?.required ?? 2;
    const charsCurrent = chars?.current ?? 0;
    const charsRequired = chars?.required ?? 80;

    if (settings.language === 'ar') {
      return `جودة البحث أقل من الحد المطلوب. المصادر الصالحة: ${usableCurrent}/${usableRequired}، النطاقات المختلفة: ${domainsCurrent}/${domainsRequired}، أكبر محتوى مستخرج: ${charsCurrent}/${charsRequired} حرف، ونسبة نجاح الاستخراج: ${(extractionRate * 100).toFixed(0)}%.`;
    }

    return `Search quality is below the required threshold. Usable sources: ${usableCurrent}/${usableRequired}, domains: ${domainsCurrent}/${domainsRequired}, max extracted content: ${charsCurrent}/${charsRequired} chars, extraction success: ${(extractionRate * 100).toFixed(0)}%.`;
  }, [settings.language]);

  const toSafeHttpUrl = useCallback((value?: string | null): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }, []);

  const extractSafeHost = useCallback((value?: string | null): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
      return parsed.hostname || null;
    } catch {
      return null;
    }
  }, []);

  const getFavicon = useCallback((item: NonNullable<ChatPanelProps['researchSourcesLive']>[number]) => {
    const providedFavicon = toSafeHttpUrl(item.faviconUrl);
    if (providedFavicon) return providedFavicon;
    const host = extractSafeHost(item.domain) || extractSafeHost(item.url);
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  }, [extractSafeHost, toSafeHttpUrl]);

  const [hiddenOptionIds, setHiddenOptionIds] = useState<Set<string>>(new Set());
  const hideTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setSelectedClarificationOption(null);
    setClarificationInput('');
  }, [pendingClarification?.questionId]);

  useEffect(() => {
    if (activeTab === 'reasoning' && reasoningUnavailable) {
      setActiveTab(hasInsights ? 'insights' : 'chat');
    }
  }, [activeTab, reasoningUnavailable, hasInsights]);

  // Keep scroll locked to bottom when we are near the bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, reasoningFeed, activeTab, isNearBottom]);

  // Autofocus the input when a new chat message arrives
  const lastMessageCount = useRef(0);
  useEffect(() => {
    if (!settings.autoFocusInput) return;
    if (activeTab !== 'chat') return;
    if (messages.length !== lastMessageCount.current) {
      lastMessageCount.current = messages.length;
      inputRef.current?.focus();
    }
  }, [messages.length, settings.autoFocusInput, activeTab]);

  useEffect(() => () => {
    Object.values(hideTimersRef.current).forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    hideTimersRef.current = {};
  }, []);

  const scheduleHideOptions = (messageId: string) => {
    if (hideTimersRef.current[messageId]) return;
    hideTimersRef.current[messageId] = window.setTimeout(() => {
      setHiddenOptionIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
      delete hideTimersRef.current[messageId];
    }, 3000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    onSendMessage(inputValue);
    setInputValue('');
    if (settings.autoFocusInput)
      requestAnimationFrame(() => inputRef.current?.focus());
  };

  const formatLevel = (value?: string) => {
    if (!value) return '-';
    if (settings.language === 'ar') {
      if (value === 'low') return 'منخفض';
      if (value === 'medium') return 'متوسط';
      if (value === 'high') return 'مرتفع';
    }
    return value;
  };

  const rejectTitle =
    settings.language === 'ar'
      ? rejectedCount === 1
        ? 'ليه فيه رافض واحد؟'
        : rejectedCount === 2
        ? 'ليه فيه 2 رافضين؟'
        : `ليه فيه ${rejectedCount} رافض؟`
      : rejectedCount === 1
      ? 'Why 1 rejects'
      : `Why ${rejectedCount} reject`;

  const statusLabel = reasoningActive
    ? settings.language === 'ar'
      ? 'الوكلاء بيفكروا دلوقتي...'
      : 'Agents are reasoning...'
    : isSummarizing
    ? settings.language === 'ar'
      ? 'الوكلاء خلصوا، جاري التلخيص...'
      : 'Agents finished; summarizing now...'
    : '';

  const thinkingLabel =
    searchState?.status === 'searching'
      ? settings.language === 'ar'
        ? 'Search'
        : 'Searching'
      : settings.language === 'ar'
      ? 'Reasoning'
      : 'Reasoning';

  const thinkingSteps = useMemo(() => {
    if (searchState?.status === 'searching') {
      return [
        settings.language === 'ar' ? 'جمع مصادر سريعة' : 'Collecting quick sources',
        settings.language === 'ar' ? 'تلخيص إشارات السوق' : 'Summarizing market signals',
        settings.language === 'ar' ? 'تحضير سياق الوكلاء' : 'Preparing agent context',
      ];
    }
    return [
      settings.language === 'ar' ? 'قراءة آراء الوكلاء' : 'Reading agent views',
      settings.language === 'ar' ? 'مقارنة الحجج' : 'Comparing arguments',
      settings.language === 'ar' ? 'صياغة رد واضح' : 'Drafting a clear reply',
    ];
  }, [searchState?.status, settings.language]);

  const thinkingActive = Boolean(isThinking || searchState?.status === 'searching' || reasoningActive);
  const stepsKey = useMemo(() => thinkingSteps.join('|'), [thinkingSteps]);

  useEffect(() => {
    setThinkingStepIndex(0);
  }, [stepsKey]);

  useEffect(() => {
    if (!thinkingActive || thinkingSteps.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setThinkingStepIndex((prev) => (prev + 1) % thinkingSteps.length);
    }, 1200);
    return () => window.clearInterval(intervalId);
  }, [thinkingActive, thinkingSteps]);

  const visibleThinkingStep = thinkingSteps.length
    ? [thinkingSteps[thinkingStepIndex] || thinkingSteps[0]]
    : [];

  const phaseLabelMap = useMemo(() => ({
    'Information Shock': 'الصدمة المعلوماتية (Information Shock)',
    'Polarization Phase': 'الاستقطاب (Polarization Phase)',
    'Clash of Values': 'صدام القيم (Clash of Values)',
    'Resolution Pressure': 'ضغط الحسم (Resolution Pressure)',
  }), []);

  const phaseGroups = useMemo(() => {
    const groups: { phase: string; items: ReasoningMessage[] }[] = [];
    reasoningFeed.forEach((msg) => {
      const phase = msg.phase || 'Phase';
      const last = groups[groups.length - 1];
      if (!last || last.phase !== phase) {
        groups.push({ phase, items: [msg] });
      } else {
        last.items.push(msg);
      }
    });
    return groups;
  }, [reasoningFeed]);

  const reasoningIndex = useMemo(() => {
    return new Map(reasoningFeed.map((msg, index) => [msg.id, index]));
  }, [reasoningFeed]);

  const handleThinkingClick = () => {
    setThinkingOpen((p) => !p);
  };

  const canSubmitClarification = useMemo(() => {
    if (!hasPendingClarification || !pendingClarification) return false;
    const hasCustomText = clarificationInput.trim().length > 0;
    return hasCustomText || Boolean(selectedClarificationOption);
  }, [clarificationInput, hasPendingClarification, pendingClarification, selectedClarificationOption]);

  const handleSubmitClarification = useCallback(() => {
    if (!hasPendingClarification || !pendingClarification || !onSubmitClarification) return;
    const customText = clarificationInput.trim();
    onSubmitClarification({
      questionId: pendingClarification.questionId,
      selectedOptionId: customText ? undefined : (selectedClarificationOption || undefined),
      customText: customText || undefined,
    });
  }, [
    clarificationInput,
    hasPendingClarification,
    onSubmitClarification,
    pendingClarification,
    selectedClarificationOption,
  ]);

  useEffect(() => {
    if (!hasPendingResearchReview || !pendingResearchReview) {
      setSelectedResearchUrlIds([]);
      setAddedResearchUrlsInput('');
      setResearchRefinementInput('');
      setBrokenFaviconMap({});
      return;
    }
    const defaults = pendingResearchReview.candidateUrls.slice(0, 2).map((item) => item.id);
    const initialPreview =
      pendingResearchReview.candidateUrls
        .map((item) => toSafeHttpUrl(item.url))
        .find((item): item is string => Boolean(item))
      || '';
    setSelectedResearchUrlIds(defaults);
    setPreviewUrl(initialPreview);
    setBrokenFaviconMap({});
  }, [hasPendingResearchReview, pendingResearchReview, toSafeHttpUrl]);

  const parsedAddedUrls = useMemo(
    () => addedResearchUrlsInput
      .split(/\n|,/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8),
    [addedResearchUrlsInput]
  );

  const toggleResearchUrlSelection = useCallback((id: string) => {
    setSelectedResearchUrlIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      return [...prev, id];
    });
  }, []);

  const handleScrapeSelected = useCallback(() => {
    if (!hasPendingResearchReview || !pendingResearchReview || !onSubmitResearchReviewAction) return;
    onSubmitResearchReviewAction({
      cycleId: pendingResearchReview.cycleId,
      action: 'scrape_selected',
      selectedUrlIds: selectedResearchUrlIds,
      addedUrls: parsedAddedUrls,
      queryRefinement: researchRefinementInput.trim() || undefined,
    });
  }, [
    hasPendingResearchReview,
    onSubmitResearchReviewAction,
    parsedAddedUrls,
    pendingResearchReview,
    researchRefinementInput,
    selectedResearchUrlIds,
  ]);

  const handleContinueSearch = useCallback(() => {
    if (!hasPendingResearchReview || !pendingResearchReview || !onSubmitResearchReviewAction) return;
    onSubmitResearchReviewAction({
      cycleId: pendingResearchReview.cycleId,
      action: 'continue_search',
      queryRefinement: researchRefinementInput.trim() || undefined,
    });
  }, [
    hasPendingResearchReview,
    onSubmitResearchReviewAction,
    pendingResearchReview,
    researchRefinementInput,
  ]);

  const handleCancelReview = useCallback(() => {
    if (!hasPendingResearchReview || !pendingResearchReview || !onSubmitResearchReviewAction) return;
    onSubmitResearchReviewAction({
      cycleId: pendingResearchReview.cycleId,
      action: 'cancel_review',
    });
  }, [hasPendingResearchReview, onSubmitResearchReviewAction, pendingResearchReview]);

  const previewFallbackText = useMemo(() => {
    if (!previewUrl) return '';
    const fromPending = pendingResearchReview?.candidateUrls.find((item) => item.url === previewUrl);
    if (fromPending?.snippet) return fromPending.snippet;
    const fromTimeline = researchSourcesLive.find((item) => item.url === previewUrl);
    return String(fromTimeline?.snippet || '');
  }, [pendingResearchReview?.candidateUrls, previewUrl, researchSourcesLive]);
  const safePreviewUrl = useMemo(() => toSafeHttpUrl(previewUrl), [previewUrl, toSafeHttpUrl]);

  return (
    <div className="glass-panel h-full flex flex-col min-h-0">
      {/* -------------------- TABS -------------------- */}
      <div className="flex border-b border-border/50">
        {/* Chat */}
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            'flex-1 px-3 py-3 text-sm font-medium transition-all relative',
            activeTab === 'chat'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          data-testid="tab-chat"
        >
          <span className="flex items-center justify-center gap-2">
            <User className="w-4 h-4" />
            {settings.language === 'ar' ? 'الدردشة' : 'Chat'}
          </span>
          {activeTab === 'chat' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>

        {/* Reasoning */}
        <button
          onClick={() => {
            if (!hasReasoningContent) return;
            setActiveTab('reasoning');
          }}
          className={cn(
            'flex-1 px-3 py-3 text-sm font-medium transition-all relative',
            activeTab === 'reasoning'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
            !hasReasoningContent && 'opacity-50 cursor-not-allowed'
          )}
          disabled={!hasReasoningContent}
          data-testid="tab-reasoning"
        >
          <span className="flex items-center justify-center gap-2">
            <Bot className="w-4 h-4" />
            {settings.language === 'ar' ? 'تفكير الوكلاء' : 'Agent Reasoning'}
            {hasReasoningContent && (
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </span>
          {activeTab === 'reasoning' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>

        {/* Insights */}
        <button
          onClick={() => setActiveTab('insights')}
          className={cn(
            'flex-1 px-3 py-3 text-sm font-medium transition-all relative',
            activeTab === 'insights'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          data-testid="tab-insights"
        >
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" />
            {settings.language === 'ar' ? 'ملخص الفكرة' : 'Idea Insights'}
          </span>
          {activeTab === 'insights' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* -------------------- MESSAGE LIST -------------------- */}
      <div
        // **IMPORTANT change** - added bottom padding (pb-24) so the last message
        // never gets hidden behind the pop-over that appears on timeout.
        className="messages-container scrollbar-thin pb-6"
        ref={scrollRef}
        data-testid={activeTab === 'chat' ? 'chat-messages' : 'reasoning-messages'}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          setIsNearBottom(distance < 120);
        }}
      >
        {activeTab === 'chat' ? (
          <div className="space-y-3">
            {/* Empty state */}
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <Sparkles className="w-10 h-10 mx-auto text-primary/40 mb-3" />
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {settings.language === 'ar' ? 'ابدأ المحاكاة' : 'Start Your Simulation'}
                </h3>
                <p className="text-sm text-muted-foreground max-w-[260px] mx-auto">
                  {settings.language === 'ar'
                    ? 'اكتب فكرتك وسيقودك النظام لإكمال الإعدادات'
                    : 'Describe your idea and the system will guide you through the configuration'}
                </p>
              </div>
            ) : (
              /* ------------ LIST OF CHAT MESSAGES ------------ */
              messages.map((msg, idx) => (
                <div
                  key={msg.id || `msg-${idx}`}
                  className={cn(
                    'message message-compact',
                    msg.type === 'user' ? 'user' : 'bot'
                  )}
                >
                  {/* Simple text bubbles */}
                  {!msg.options && (
                    <div className="bubble bubble-compact">
                      <ReadMoreText
                        text={msg.content}
                        collapsedLines={6}
                        language={settings.language}
                        expanded={Boolean(expandedTextMap[`chat-${msg.id}`])}
                        onToggleExpanded={() => toggleExpandedText(`chat-${msg.id}`)}
                      />
                    </div>
                  )}

                  {/* Poll / multi-select messages */}
                  {msg.options && msg.options.items.length > 0 && !hiddenOptionIds.has(msg.id) && (
                    <div
                      className={
                        msg.options.kind === 'single' ? 'poll-card' : 'multi-select-card'
                      }
                    >
                      <p className="text-sm text-muted-foreground">{msg.content}</p>
                      <div
                        className={
                          msg.options.kind === 'single' ? 'poll-options' : 'multi-options'
                        }
                      >
                        {msg.options.items.map((opt, idx) => (
                          <button
                            key={`${msg.options?.field}-${opt.value}`}
                            type="button"
                            className={msg.options.kind === 'single' ? 'poll-option' : 'multi-option'}
                            style={{ animationDelay: `${80 + idx * 45}ms` }}
                            onClick={() =>
                              (onSelectOption?.(msg.options!.field, opt.value), scheduleHideOptions(msg.id))
                            }
                          >
                            <span className="option-label">{opt.label}</span>
                            {opt.description && (
                              <span className="option-desc">{opt.description}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Inline thinking / searching row */}
            {(isThinking || searchState?.status === 'searching' || reasoningActive) && (
              <InlineDisclosure
                label={thinkingLabel}
                steps={visibleThinkingStep}
                open={thinkingOpen}
                onToggle={() => setThinkingOpen((p) => !p)}
                onClickLabel={handleThinkingClick}
                language={settings.language}
              />
            )}

            {(phaseState?.currentPhaseKey || recentResearchSources.length > 0) && (
              <div className="rounded-lg border border-border/50 bg-card/70 p-3 space-y-2">
                {phaseState?.currentPhaseKey && (
                  <div className="text-xs text-muted-foreground">
                    {settings.language === 'ar' ? 'المرحلة الحالية:' : 'Current phase:'}{' '}
                    <span className="text-foreground font-medium">{phaseLabel || phaseState.currentPhaseKey}</span>
                    {typeof phaseState.progressPct === 'number' && (
                      <span className="ml-2 text-primary">{Math.round(phaseState.progressPct)}%</span>
                    )}
                  </div>
                )}
                {recentResearchSources.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">
                      {settings.language === 'ar' ? 'مصادر البحث المباشرة' : 'Live research sources'}
                    </div>
                    {(() => {
                      const actionAr: Record<string, string> = {
                        research_started: 'بدء البحث',
                        query_planned: 'تخطيط الاستعلام',
                        search_results_ready: 'نتائج البحث جاهزة',
                        review_required: 'مطلوب مراجعة',
                        fetch_started: 'بدء الاستخراج',
                        fetch_done: 'اكتمل جلب الصفحة',
                        summary_ready: 'ملخص الصفحة',
                        evidence_cards_ready: 'بطاقات الأدلة',
                        gaps_ready: 'تحليل الفجوات',
                        research_done: 'اكتمل البحث',
                        research_failed: 'فشل البحث',
                        query_started: 'بدء الاستعلام',
                        query_result: 'نتيجة الاستعلام',
                        url_opened: 'فتح الرابط',
                        url_extracted: 'استخراج المحتوى',
                        url_failed: 'فشل الاستخراج',
                        search_completed: 'اكتمل البحث',
                        search_failed: 'فشل البحث',
                      };
                      const actionEn: Record<string, string> = {
                        research_started: 'Research started',
                        query_planned: 'Query planned',
                        search_results_ready: 'Search results ready',
                        review_required: 'Review required',
                        fetch_started: 'Fetch started',
                        fetch_done: 'Fetch completed',
                        summary_ready: 'Page summary ready',
                        evidence_cards_ready: 'Evidence cards ready',
                        gaps_ready: 'Gap analysis ready',
                        research_done: 'Research done',
                        research_failed: 'Research failed',
                        query_started: 'Query started',
                        query_result: 'Query result',
                        url_opened: 'URL opened',
                        url_extracted: 'Content extracted',
                        url_failed: 'Extraction failed',
                        search_completed: 'Search completed',
                        search_failed: 'Search failed',
                      };
                      const statusAr: Record<string, string> = {
                        running: 'جاري',
                        completed: 'مكتمل',
                        failed: 'فشل',
                      };
                      const statusEn: Record<string, string> = {
                        running: 'Running',
                        completed: 'Completed',
                        failed: 'Failed',
                      };
                      return recentResearchSources.map((item, idx) => (
                        <div
                          key={`${item.eventSeq ?? 'x'}-${item.timestamp ?? 0}-${item.url ?? ''}-${item.action ?? ''}`}
                          className={cn(
                            'search-trace-card rounded-lg border border-border/40 px-2.5 py-2 text-xs space-y-1.5 transition-all',
                            item.status === 'running' && 'bg-primary/5 border-primary/30 animate-pulse'
                          )}
                          style={{ animationDelay: `${Math.min(idx * 70, 350)}ms` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex items-start gap-2">
                              {(() => {
                                const iconKey = `${item.eventSeq ?? 'x'}-${item.domain ?? item.url ?? ''}`;
                                const faviconSrc = getFavicon(item);
                                if (!faviconSrc || brokenFaviconMap[iconKey]) {
                                  return (
                                    <span className="w-5 h-5 rounded-sm border border-border/40 bg-card flex items-center justify-center mt-0.5">
                                      <Globe className="w-3 h-3 text-muted-foreground" />
                                    </span>
                                  );
                                }
                                return (
                                  <img
                                    src={faviconSrc}
                                    alt=""
                                    className="w-5 h-5 rounded-sm mt-0.5 border border-border/40 bg-card"
                                    loading="lazy"
                                    onError={() => {
                                      setBrokenFaviconMap((prev) => ({ ...prev, [iconKey]: true }));
                                    }}
                                  />
                                );
                              })()}
                              <div className="min-w-0">
                                <div className="text-foreground truncate font-medium">
                                  {settings.language === 'ar'
                                    ? (actionAr[item.action || ''] || item.action || 'حدث بحث')
                                    : (actionEn[item.action || ''] || item.action || 'Research event')}
                                </div>
                                {(item.domain || item.url) && (
                                  <div className="text-muted-foreground truncate">
                                    {item.domain || item.url}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/50 text-muted-foreground whitespace-nowrap">
                              {settings.language === 'ar'
                                ? (statusAr[item.status || ''] || item.status || '')
                                : (statusEn[item.status || ''] || item.status || '')}
                            </span>
                          </div>
                          {item.title && (
                            <div className="text-foreground/90 line-clamp-1">{item.title}</div>
                          )}
                          {(item.snippet || item.error) && (
                            <div className="text-muted-foreground line-clamp-2">
                              {item.error ? formatResearchError(item.error) : item.snippet}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {typeof item.httpStatus === 'number' && <span>HTTP {item.httpStatus}</span>}
                            {typeof item.contentChars === 'number' && <span>{item.contentChars} ch</span>}
                            {typeof item.relevanceScore === 'number' && <span>rel {item.relevanceScore.toFixed(2)}</span>}
                          </div>
                          {typeof item.progressPct === 'number' && (
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-500"
                                style={{ width: `${Math.max(0, Math.min(100, item.progressPct))}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {hasPendingResearchReview && pendingResearchReview && (
              <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 space-y-3">
                <div className="text-sm font-semibold text-cyan-100">
                  {settings.language === 'ar'
                    ? 'مراجعة نتائج البحث قبل المتابعة'
                    : 'Review search results before continuing'}
                </div>
                {pendingResearchReview.gapSummary && (
                  <div className="text-xs text-cyan-100/80">{pendingResearchReview.gapSummary}</div>
                )}
                {pendingResearchReview.queryPlan?.length > 0 && (
                  <div className="text-xs text-cyan-100/80">
                    {settings.language === 'ar' ? 'خطة الاستعلام:' : 'Query plan:'}{' '}
                    {pendingResearchReview.queryPlan.slice(0, 3).join(' | ')}
                  </div>
                )}

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {pendingResearchReview.candidateUrls.map((item) => {
                    const checked = selectedResearchUrlIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={cn(
                          'flex items-start gap-2 rounded-lg border px-2 py-2 cursor-pointer transition',
                          checked ? 'border-primary/40 bg-primary/10' : 'border-border/50 bg-card/60 hover:border-primary/30'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleResearchUrlSelection(item.id)}
                          disabled={researchReviewBusy}
                          className="mt-0.5"
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-start"
                          onClick={() => setPreviewUrl(toSafeHttpUrl(item.url) || '')}
                        >
                          <div className="text-xs text-foreground truncate">{item.title || item.url}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{item.domain || item.url}</div>
                        </button>
                      </label>
                    );
                  })}
                </div>

                <Input
                  value={addedResearchUrlsInput}
                  onChange={(event) => setAddedResearchUrlsInput(event.target.value)}
                  dir="ltr"
                  placeholder={settings.language === 'ar' ? 'أضف روابط إضافية (كل رابط في سطر)' : 'Add custom URLs (one per line)'}
                  disabled={researchReviewBusy}
                />
                <Input
                  value={researchRefinementInput}
                  onChange={(event) => setResearchRefinementInput(event.target.value)}
                  dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
                  placeholder={settings.language === 'ar' ? 'تحسين الاستعلام (اختياري)' : 'Query refinement (optional)'}
                  disabled={researchReviewBusy}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button
                    type="button"
                    onClick={handleScrapeSelected}
                    disabled={researchReviewBusy || (!selectedResearchUrlIds.length && !parsedAddedUrls.length)}
                    className="w-full"
                  >
                    {settings.language === 'ar' ? 'استخراج المحدد' : 'Scrape selected'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleContinueSearch}
                    disabled={researchReviewBusy}
                    className="w-full"
                  >
                    {settings.language === 'ar' ? 'متابعة البحث' : 'Continue search'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelReview}
                    disabled={researchReviewBusy}
                    className="w-full"
                  >
                    {settings.language === 'ar' ? 'إبقاء الإيقاف' : 'Keep paused'}
                  </Button>
                </div>

                {previewUrl && (
                  <div className="rounded-lg border border-border/50 bg-card/70 p-2 space-y-2">
                    <div className="text-xs text-muted-foreground truncate">{previewUrl}</div>
                    {safePreviewUrl ? (
                      <div className="h-48 rounded-md overflow-hidden border border-border/40 bg-background/60">
                        <iframe
                          src={safePreviewUrl}
                          title="page-preview"
                          className="w-full h-full"
                          loading="lazy"
                          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-amber-300/90">
                        {settings.language === 'ar'
                          ? 'تعذر معاينة الرابط مباشرة. افتحه في تبويب جديد أو استخدم النص المستخرج.'
                          : 'Unable to preview this URL directly. Open it in a new tab or use extracted text.'}
                      </div>
                    )}
                    {previewFallbackText && (
                      <div className="text-xs text-muted-foreground line-clamp-4">{previewFallbackText}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {statusLabel && <div className="status-chip">{statusLabel}</div>}

            {hasPendingClarification && pendingClarification && (
              <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 space-y-3">
                <div className="text-sm font-semibold text-cyan-100">
                  {settings.language === 'ar'
                    ? 'الوكلاء محتاجين توضيح قبل استكمال التفكير'
                    : 'Agents need clarification before reasoning can continue'}
                </div>
                <div className="text-sm text-foreground whitespace-pre-wrap">
                  {pendingClarification.question}
                </div>
                {pendingClarification.reasonSummary && (
                  <div className="text-xs text-cyan-100/80">
                    {pendingClarification.reasonSummary}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2">
                  {pendingClarification.options.slice(0, 3).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm text-start transition-all',
                        selectedClarificationOption === option.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 bg-card/70 text-foreground hover:border-primary/40'
                      )}
                      onClick={() => setSelectedClarificationOption(option.id)}
                      disabled={clarificationBusy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <Input
                  value={clarificationInput}
                  onChange={(event) => setClarificationInput(event.target.value)}
                  dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
                  placeholder={
                    settings.language === 'ar'
                      ? 'أو اكتب توضيحك الخاص (له أولوية على الاختيارات)'
                      : 'Or type your own clarification (overrides selected option)'
                  }
                  disabled={clarificationBusy}
                />

                <Button
                  type="button"
                  className="w-full"
                  onClick={handleSubmitClarification}
                  disabled={!canSubmitClarification || clarificationBusy}
                >
                  {clarificationBusy
                    ? (settings.language === 'ar' ? 'جاري الإرسال والاستكمال...' : 'Submitting and resuming...')
                    : (settings.language === 'ar' ? 'إرسال التوضيح واستكمال المحاكاة' : 'Submit clarification & resume')}
                </Button>
              </div>
            )}

            {postActionsEnabled && (
              <div className="rounded-xl border border-border/50 bg-card/70 p-3 space-y-3">
                <div className="text-sm font-semibold text-foreground">
                  {settings.language === 'ar'
                    ? 'الخطوات التالية بعد انتهاء المحاكاة'
                    : 'Next actions after simulation completion'}
                </div>
                {acceptancePctValue !== null && (
                  <div className="text-xs text-muted-foreground">
                    {settings.language === 'ar'
                      ? `نسبة القبول النهائية: ${acceptancePctValue.toFixed(0)}%`
                      : `Final acceptance rate: ${acceptancePctValue.toFixed(0)}%`}
                  </div>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-center"
                  disabled={Boolean(postActionBusy)}
                  onClick={() => onRunPostAction?.(effectivePostAction)}
                >
                  {postActionBusy
                    ? (settings.language === 'ar' ? 'جاري التحضير...' : 'Preparing...')
                    : effectivePostAction === 'make_acceptable'
                    ? (settings.language === 'ar' ? 'اجعل فكرتك مقبولة' : 'Make your idea acceptable')
                    : (settings.language === 'ar' ? 'انطلق بالفكرة للسوق' : 'Bring your idea to world')}
                </Button>

                {postActionResult && (
                  <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2">
                    <div className="text-sm font-semibold text-foreground">{postActionResult.title}</div>
                    <ReadMoreText
                      text={postActionResult.summary}
                      collapsedLines={4}
                      language={settings.language}
                      expanded={Boolean(expandedTextMap['post-action-summary'])}
                      onToggleExpanded={() => toggleExpandedText('post-action-summary')}
                    />
                    {postActionResult.steps?.length > 0 && (
                      <div className="space-y-1">
                        {postActionResult.steps.slice(0, 4).map((step) => (
                          <div key={step} className="text-xs text-muted-foreground">
                            • {step}
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      className="w-full"
                      onClick={onStartFollowupFromPostAction}
                    >
                      {settings.language === 'ar' ? 'جرّب هذا الآن' : 'Try this now'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Typing indicator */}
            {isThinking && (
              <div className="typing-indicator">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
          </div>
        ) : activeTab === 'reasoning' ? (
          /* -------------------- REASONING TAB -------------------- */
          <div className="space-y-3">
            {reasoningDebug.length > 0 && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
                <div className="flex items-center justify-between text-xs text-amber-200">
                  <span>
                    {settings.language === 'ar' ? 'سجل الرفض (Debug)' : 'Rejection Debug Log'}
                  </span>
                  <button
                    type="button"
                    className="text-amber-200/80 hover:text-amber-100"
                    onClick={() => setShowDebug((p) => !p)}
                  >
                    {showDebug
                      ? settings.language === 'ar'
                        ? 'إخفاء'
                        : 'Hide'
                      : settings.language === 'ar'
                      ? 'عرض'
                      : 'Show'}
                  </button>
                </div>
                {showDebug && (
                  <div className="mt-2 max-h-40 overflow-y-auto text-xs text-amber-100/90 space-y-1">
                    {reasoningDebug.slice(-50).map((item) => (
                      <div key={item.id} className="flex flex-wrap gap-2">
                        <span className="font-mono text-amber-200/80">{item.agentShortId}</span>
                        {item.phase && <span className="text-amber-200/60">{item.phase}</span>}
                        {typeof item.attempt === 'number' && (
                          <span className="text-amber-200/60">#{item.attempt}</span>
                        )}
                        {item.stage && <span className="text-amber-200/60">{item.stage}</span>}
                        <span className="text-amber-100">{item.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {reasoningFeed.length === 0 ? (
              reasoningUnavailable ? null : (
                <div className="text-center py-4">
                  <Bot className="w-8 h-8 mx-auto text-muted-foreground/25 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {simulationError ? (
                      settings.language === 'ar'
                        ? `خطأ في المحاكاة: ${simulationError}`
                        : `Simulation error: ${simulationError}`
                    ) : settings.language === 'ar' ? (
                      'تفكير الوكلاء سيظهر هنا أثناء المحاكاة'
                    ) : (
                      'Agent reasoning will appear here during simulation'
                    )}
                  </p>
                </div>
              )
            ) : (
              phaseGroups.map((group) => (
                <div key={group.phase} className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground/80">
                    {phaseLabelMap[group.phase] ?? group.phase}
                  </div>
                  {group.items.map((msg) => {
                    const idx = reasoningIndex.get(msg.id) ?? 0;
                    const side = idx % 2 === 0 ? 'user' : 'bot';
                    const opinion = msg.opinion ?? 'neutral';
                    const statusLabel =
                      opinion === 'accept'
                        ? settings.language === 'ar'
                          ? 'موافق'
                          : 'Agreed'
                        : opinion === 'reject'
                        ? settings.language === 'ar'
                          ? 'مرفوض'
                          : 'Rejected'
                        : settings.language === 'ar'
                        ? 'محايد'
                        : 'Neutral';
                    const statusBadge =
                      opinion === 'accept'
                        ? 'bg-success/15 text-success border-success/30'
                        : opinion === 'reject'
                        ? 'bg-destructive/15 text-destructive border-destructive/30'
                        : 'bg-primary/10 text-primary border-primary/20';
                    const bubbleBg = side === 'user' ? 'bg-secondary' : 'bg-card';
                    const shortId = msg.agentShortId ?? msg.agentId.slice(0, 4);
                    const agentLabel = msg.agentLabel
                      || (settings.language === 'ar' ? `الوكيل ${shortId}` : `Agent ${shortId}`);
                    const replyShort =
                      msg.replyToShortId ?? (msg.replyToAgentId ? msg.replyToAgentId.slice(0, 4) : undefined);
                    const opinionSource = msg.opinionSource ?? 'llm';
                    const sourceLabel =
                      opinionSource === 'llm'
                        ? 'LLM'
                        : opinionSource === 'llm_classified'
                        ? 'LLM+Classifier'
                        : 'Fallback';

                    return (
                      <div
                        key={msg.id}
                        className={cn('message message-compact reasoning', side)}
                      >
                        <div
                          className={cn(
                            'bubble bubble-compact',
                            bubbleBg,
                            'text-foreground'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                                <Bot className="w-3 h-3 text-primary" />
                              </div>
                              <span className="text-xs font-semibold text-foreground truncate">
                                {agentLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', statusBadge)}>
                                {statusLabel}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground">
                                {sourceLabel}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                Iter {msg.iteration}
                              </span>
                              {replyShort && (
                                <span className="text-[11px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground">
                                  {settings.language === 'ar' ? `رد على ${replyShort}` : `Reply to ${replyShort}`}
                                </span>
                              )}
                              {opinionSource === 'fallback' && msg.fallbackReason && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400/40 text-amber-300">
                                  {msg.fallbackReason}
                                </span>
                              )}
                            </div>
                          </div>

                          <ReadMoreText
                            text={msg.message}
                            collapsedLines={7}
                            language={settings.language}
                            expanded={Boolean(expandedTextMap[`reasoning-${msg.id}`])}
                            onToggleExpanded={() => toggleExpandedText(`reasoning-${msg.id}`)}
                            className="text-sm text-foreground/95"
                          />
                          {msg.archetype && (
                            <div className="text-[11px] text-muted-foreground mt-2">
                              {msg.archetype}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : (
          /* -------------------- INSIGHTS TAB -------------------- */
          <div className="space-y-4">
            {/* ---- IDEA DETAILS ---- */}
            <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {settings.language === 'ar' ? 'تفاصيل الفكرة' : 'Idea Details'}
              </h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {settings.language === 'ar' ? 'الفكرة:' : 'Idea:'}{' '}
                  <span className="text-foreground">{insights?.idea || '-'}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'الموقع:' : 'Location:'}{' '}
                  <span className="text-foreground">{insights?.location || '-'}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'الفئة:' : 'Category:'}{' '}
                  <span className="text-foreground">{insights?.category || '-'}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'الجمهور:' : 'Audience:'}{' '}
                  <span className="text-foreground">
                    {(insights?.audience || []).join(', ') || '-'}
                  </span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'الأهداف:' : 'Goals:'}{' '}
                  <span className="text-foreground">
                    {(insights?.goals || []).join(', ') || '-'}
                  </span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'النضج:' : 'Maturity:'}{' '}
                  <span className="text-foreground">{insights?.maturity || '-'}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'المخاطرة:' : 'Risk:'}{' '}
                  <span className="text-foreground">
                    {typeof insights?.risk === 'number' ? `${insights.risk}%` : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* ---- RESEARCH SNAPSHOT ---- */}
            <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {settings.language === 'ar' ? 'ملخص البحث والسوق' : 'Research Snapshot'}
              </h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {settings.language === 'ar' ? 'ملخص:' : 'Summary:'}{' '}
                  <span className="text-foreground">{research?.summary || '-'}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'إشارات السوق:' : 'Signals:'}{' '}
                  <span className="text-foreground">
                    {(research?.signals || []).join(settings.language === 'ar' ? '، ' : ', ') || '-'}
                  </span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'المنافسة:' : 'Competition:'}{' '}
                  <span className="text-foreground">{formatLevel(research?.competition)}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'الطلب:' : 'Demand:'}{' '}
                  <span className="text-foreground">{formatLevel(research?.demand)}</span>
                </div>
                <div>
                  {settings.language === 'ar'
                    ? 'حساسية السعر:'
                    : 'Price sensitivity:'}{' '}
                  <span className="text-foreground">{formatLevel(research?.priceSensitivity)}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'المخاطر التنظيمية:' : 'Regulatory risk:'}{' '}
                  <span className="text-foreground">{formatLevel(research?.regulatoryRisk)}</span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'فجوات/فرص:' : 'Gaps:'}{' '}
                  <span className="text-foreground">
                    {(research?.gaps || []).join(settings.language === 'ar' ? '، ' : ', ') ||
                      '-'}
                  </span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'أماكن ملحوظة:' : 'Notable locations:'}{' '}
                  <span className="text-foreground">
                    {(research?.notableLocations || []).join(
                      settings.language === 'ar' ? '، ' : ', '
                    ) || '-'}
                  </span>
                </div>
                <div>
                  {settings.language === 'ar' ? 'عدد المصادر:' : 'Sources:'}{' '}
                  <span className="text-foreground">
                    {typeof research?.sourcesCount === 'number'
                      ? research.sourcesCount
                      : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* ---- REJECT REASONS (if any) ---- */}
            {rejectedCount > 0 && (
              <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
                <h4 className="text-sm font-semibold text-foreground mb-2">{rejectTitle}</h4>
                {insights?.rejectReasons && insights.rejectReasons.length > 0 ? (
                  <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                    {insights.rejectReasons.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {settings.language === 'ar'
                      ? 'سيظهر السبب بعد اكتمال التحليل.'
                      : 'Reasons appear after analysis completes.'}
                  </p>
                )}
              </div>
            )}

            {/* ---- DOWNLOAD REPORT ---- */}
            {onDownloadReport && (
              <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  {settings.language === 'ar' ? 'تحليل كامل للفكرة' : 'Full Idea Analysis'}
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  {settings.language === 'ar'
                    ? 'تحليل أعمق مرتبط بنتائج البحث والسياق.'
                    : 'A deeper report linked to the research context.'}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-center"
                  onClick={onDownloadReport}
                  disabled={reportBusy}
                >
                  {reportBusy
                    ? settings.language === 'ar'
                      ? 'جاري تجهيز الملف...'
                      : 'Preparing file...'
                    : settings.language === 'ar'
                    ? 'تحميل تقرير Word'
                    : 'Download Word report'}
                </Button>
              </div>
            )}

            {/* ---- FINAL SUMMARY ---- */}
            {insights?.summary && (
              <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  {settings.language === 'ar' ? 'الملخص النهائي' : 'Final Summary'}
                </h4>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap">{insights.summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* -------------------- JUMP-TO-LATEST BUTTON -------------------- */}
      {activeTab === 'chat' && !isNearBottom && (
        <button
          type="button"
          onClick={() => {
            if (scrollRef.current)
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}
          className="mx-4 mb-2 rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {settings.language === 'ar' ? 'الانتقال لآخر الرسائل' : 'Jump to latest'}
        </button>
      )}

      {/* -------------------- INPUT AREA (CHAT TAB) -------------------- */}
      {activeTab === 'chat' ? (
        <div className="chat-input-container">
          {primaryControl && (
            <div className="mb-3 space-y-2">
              <Button
                type="button"
                onClick={() => {
                  primaryControl.onClick?.();
                }}
                disabled={primaryControl.disabled}
                className={cn(
                  'w-full h-12 justify-between rounded-xl border transition-all duration-300',
                  primaryControl.tone === 'success' && 'bg-success/15 border-success/30 text-success hover:bg-success/20',
                  primaryControl.tone === 'warning' && 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/15',
                  primaryControl.tone === 'secondary' && 'bg-secondary/70 border-border text-foreground hover:bg-secondary',
                  (!primaryControl.tone || primaryControl.tone === 'primary') && 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {primaryControl.busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : primaryControl.icon === 'pause' ? (
                    <Pause className="w-4 h-4" />
                  ) : primaryControl.icon === 'retry' ? (
                    <RefreshCcw className="w-4 h-4" />
                  ) : primaryControl.icon === 'sparkles' ? (
                    <Sparkles className="w-4 h-4" />
                  ) : primaryControl.icon === 'reasoning' ? (
                    <Bot className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  <span className="truncate">{primaryControl.label}</span>
                </span>
                {primaryControl.description && (
                  <span className="text-xs opacity-80 truncate max-w-[50%] text-right">
                    {primaryControl.description}
                  </span>
                )}
              </Button>

              {primaryControl.secondary && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full h-10 rounded-xl"
                  onClick={primaryControl.secondary.onClick}
                  disabled={primaryControl.secondary.disabled}
                >
                  {primaryControl.secondary.label}
                </Button>
              )}
            </div>
          )}
          {/* Quick-reply chips */}
          {quickReplies && quickReplies.length > 0 && (
            <div className="quick-replies">
              {quickReplies.map((reply) => (
                <button
                  key={reply.value}
                  type="button"
                  className="quick-reply-btn"
                  onClick={() => onQuickReply?.(reply.value)}
                >
                  {reply.label}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="chat-input-wrapper">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
              disabled={showRetry}
              placeholder={
                isWaitingForLocationChoice
                  ? settings.language === 'ar'
                    ? 'اختر نعم أو لا...'
                    : 'Choose yes or no...'
                  : isWaitingForCountry
                  ? settings.language === 'ar'
                    ? 'اكتب الدولة...'
                    : 'Enter country...'
                  : isWaitingForCity
                  ? settings.language === 'ar'
                    ? 'اكتب المدينة...'
                    : 'Enter city...'
                  : settings.language === 'ar'
                  ? 'اكتب رسالتك...'
                  : 'Type a message...'
              }
              className="chat-input"
              data-testid="chat-input"
            />

            <Button
              type={showRetry ? 'button' : 'submit'}
              size="icon"
              disabled={showRetry ? !onRetryLlm : !inputValue.trim()}
              className={cn('send-btn', inputValue.trim() ? '' : '')}
              data-testid={showRetry ? 'chat-retry-llm' : 'chat-send'}
              onClick={showRetry ? onRetryLlm : undefined}
            >
              {showRetry ? <RefreshCcw className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      ) : (
        /* -------------------- INPUT LOCKED (when not on Chat tab) -------------------- */
        <div className="chat-input-container chat-input-locked">
          <Button type="button" size="icon" className="send-btn" disabled>
            {simulationStatus === 'running' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

