import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  ChevronDown,
  Clock,
  RotateCcw,
  Check,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage, ReasoningMessage } from '@/types/simulation';
import { cn } from '@/lib/utils';
import { SearchResult } from '@/services/api';

/* ------------------------------------------------------------------
   PROP‑TYPES
------------------------------------------------------------------- */
interface ChatPanelProps {
  /** chat messages (user & bot) */
  messages: ChatMessage[];
  /** stream of reasoning messages from the agents */
  reasoningFeed: ReasoningMessage[];
  /** send a new chat message */
  onSendMessage: (msg: string) => void;
  /** user selected an option in a poll / multi‑select */
  onSelectOption?: (field: string, value: string) => void;
  /** waiting for a city name */
  isWaitingForCity?: boolean;
  /** waiting for a country name */
  isWaitingForCountry?: boolean;
  /** waiting for location choice (yes/no) */
  isWaitingForLocationChoice?: boolean;
  /** agents are thinking (typing indicator) */
  isThinking?: boolean;
  /** LLM generation error – show retry button */
  showRetry?: boolean;
  onRetryLlm?: () => void;
  /** Searching timed‑out – allow “retry” */
  onSearchRetry?: () => void;
  /** Use LLM instead of web search */
  onSearchUseLlm?: () => void;
  /** “Start” button should appear even if no text typed */
  canConfirmStart?: boolean;
  onConfirmStart?: () => void;
  /** Pre‑defined quick‑reply chips */
  quickReplies?: { label: string; value: string }[];
  onQuickReply?: (value: string) => void;
  /** overall simulation state */
  simulationStatus?: 'idle' | 'running' | 'finished';
  /** agents are currently reasoning */
  reasoningActive?: boolean;
  /** summarisation phase */
  isSummarizing?: boolean;
  /** how many agents rejected */
  rejectedCount?: number;
  /** market‑research data */
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
  /** “download report” button state */
  reportBusy?: boolean;
  onDownloadReport?: () => void;
  /** top‑level insights shown in the “Insights” tab */
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
  /** current status of the web‑search routine */
  searchState?: {
    status: 'idle' | 'searching' | 'timeout' | 'error' | 'complete';
  };
  /** user settings (language, auto‑focus, …) */
  settings: {
    language: 'ar' | 'en';
    autoFocusInput?: boolean;
  };
}

/* ------------------------------------------------------------------
   READ‑MORE COMPONENT (unchanged)
------------------------------------------------------------------- */
function ReadMoreText({
  text,
  collapsedLines = 6,
  className,
}: {
  text: string;
  collapsedLines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldClamp = text.length > 260;

  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'whitespace-pre-wrap break-words',
          shouldClamp && !expanded && `line-clamp-${collapsedLines}`
        )}
      >
        {text}
      </div>

      {shouldClamp && (
        <span
          className="readmore"
          onClick={() => setExpanded((p) => !p)}
          role="button"
          tabIndex={0}
        >
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')}
          />
          {expanded ? 'Read less' : 'Read more'}
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

      {/* No borders‑/boxes – expandable area */}
      <div className="inline-disclosure-content">
        <div className="inline-steps">
          {steps.map((s, i) => (
            <div
              key={s}
              className="inline-step"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              → {s}
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
  onSendMessage,
  onSelectOption,
  isWaitingForCity = false,
  isWaitingForCountry = false,
  isWaitingForLocationChoice = false,
  isThinking = false,
  showRetry = false,
  onRetryLlm,
  onSearchRetry,
  onSearchUseLlm,
  canConfirmStart = false,
  onConfirmStart,
  quickReplies,
  onQuickReply,
  simulationStatus = 'idle',
  reasoningActive = false,
  isSummarizing = false,
  rejectedCount = 0,
  research,
  reportBusy = false,
  onDownloadReport,
  insights,
  searchState,
  settings,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning' | 'insights'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);

  const isSearchTimeout = searchState?.status === 'timeout';
  const isActionMode = showRetry || isSearchTimeout;

  const [searchActionsOpen, setSearchActionsOpen] = useState(false);
  const [actionsClosing, setActionsClosing] = useState(false);
  const [hiddenOptionIds, setHiddenOptionIds] = useState<Set<string>>(new Set());
  const hideTimersRef = useRef<Record<string, number>>({});

  // Auto‑switch to reasoning **once** when it first becomes active
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (reasoningActive && !autoSwitchedRef.current) {
      autoSwitchedRef.current = true;
      setActiveTab('reasoning');
    }
  }, [reasoningActive]);

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

  // Open the “search actions” pop‑over automatically when a timeout occurs
  useEffect(() => {
    if (isSearchTimeout) {
      setSearchActionsOpen(true);
      setActionsClosing(false);
    } else {
      setSearchActionsOpen(false);
      setActionsClosing(false);
    }
  }, [isSearchTimeout]);

  const closeActions = () => {
    setActionsClosing(true);
    window.setTimeout(() => {
      setSearchActionsOpen(false);
      setActionsClosing(false);
    }, 140);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isActionMode) return;
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
    'Information Shock': 'التصادم المعرفي (Information Shock)',
    'Polarization Phase': 'الاستقطاب (Polarization Phase)',
    'Clash of Values': 'محاولات الإقناع والجمود (Clash of Values)',
    'Resolution Pressure': 'النتيجة النهائية (Resolution Pressure)',
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
    if (reasoningActive) {
      setActiveTab('reasoning');
      return;
    }
    setThinkingOpen((p) => !p);
  };

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
          onClick={() => setActiveTab('reasoning')}
          className={cn(
            'flex-1 px-3 py-3 text-sm font-medium transition-all relative',
            activeTab === 'reasoning'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          data-testid="tab-reasoning"
        >
          <span className="flex items-center justify-center gap-2">
            <Bot className="w-4 h-4" />
            {settings.language === 'ar' ? 'تفكير الوكلاء' : 'Agent Reasoning'}
            {reasoningFeed.length > 0 && (
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
        // **IMPORTANT change** – added bottom padding (pb‑24) so the last message
        // never gets hidden behind the pop‑over that appears on timeout.
        className="messages-container scrollbar-thin pb-24"
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
                    ? 'صف فكرتك وسيقودك النظام لإكمال الإعدادات'
                    : 'Describe your idea and the system will guide you through the configuration'}
                </p>
              </div>
            ) : (
              /* ------------ LIST OF CHAT MESSAGES ------------ */
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'message message-compact',
                    msg.type === 'user' ? 'user' : 'bot'
                  )}
                >
                  {/* Simple text bubbles */}
                  {!msg.options && (
                    <div className="bubble bubble-compact">
                      <ReadMoreText text={msg.content} collapsedLines={6} />
                    </div>
                  )}

                  {/* Poll / multi‑select messages */}
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

            {statusLabel && <div className="status-chip">{statusLabel}</div>}

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
            {reasoningFeed.length === 0 ? (
              <div className="text-center py-8">
                <Bot className="w-10 h-10 mx-auto text-muted-foreground/25 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {settings.language === 'ar'
                    ? 'تفكير الوكلاء سيظهر هنا أثناء المحاكاة'
                    : 'Agent reasoning will appear here during simulation'}
                </p>
              </div>
            ) : (
              phaseGroups.map((group) => (
                <div key={group.phase} className="space-y-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground/80">
                    {phaseLabelMap[group.phase] ?? group.phase}
                  </div>
                  {group.items.map((msg) => {
                    const idx = reasoningIndex.get(msg.id) ?? 0;
                    const side = idx % 2 === 0 ? 'user' : 'bot';
                    const tone =
                      msg.opinion === 'accept'
                        ? 'text-success'
                        : msg.opinion === 'reject'
                        ? 'text-destructive'
                        : 'text-primary';
                    const bubbleBg = side === 'user' ? 'bg-secondary' : 'bg-card';
                    const shortId = msg.agentShortId ?? msg.agentId.slice(0, 4);
                    const replyShort =
                      msg.replyToShortId ?? (msg.replyToAgentId ? msg.replyToAgentId.slice(0, 4) : undefined);

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
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                              <Bot className="w-3 h-3 text-primary" />
                            </div>
                            <span className={cn('text-xs font-mono', tone)}>
                              {shortId}
                            </span>
                            {msg.archetype && (
                              <span className="text-xs text-muted-foreground">
                                {msg.archetype}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Iter {msg.iteration}
                            </span>
                            {replyShort && (
                              <span className="text-[11px] text-muted-foreground">
                                ? {replyShort}
                              </span>
                            )}
                          </div>

                          <ReadMoreText
                            text={msg.message}
                            collapsedLines={7}
                            className="text-sm text-foreground/90"
                          />
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
                    ? 'رينج الأسعار/الحساسية:'
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

      {/* -------------------- JUMP‑TO‑LATEST BUTTON -------------------- */}
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
          {/* Inline actions under the latest message when search times out */}
          {isSearchTimeout && (
            <div className="mb-2 rounded-xl border border-border/40 bg-secondary/40 p-2">
              <div className="text-xs text-muted-foreground mb-2">
                {settings.language === 'ar'
                  ? 'قعدت ادور كتير وملقيتش بيانات كفاية. تحب اعيد البحث بوقت أطول ولا استخدم LLM علشان أكمّل؟'
                  : 'I searched a lot but couldn\'t find enough data. Retry with a longer timeout or use the LLM fallback?'}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="action-item inline"
                  onClick={() => onSearchRetry?.()}
                  disabled={!onSearchRetry}
                >
                  <span className="action-ico"><Clock className="w-4 h-4" /></span>
                  <span className="action-title">{settings.language === 'ar' ? 'عيد البحث' : 'Retry Search'}</span>
                </button>
                <button
                  type="button"
                  className="action-item inline primary"
                  onClick={() => onSearchUseLlm?.()}
                  disabled={!onSearchUseLlm}
                >
                  <span className="action-ico"><Sparkles className="w-4 h-4" /></span>
                  <span className="action-title">{settings.language === 'ar' ? 'استخدم LLM' : 'Use LLM'}</span>
                </button>
              </div>
            </div>
          )}
          {/* Quick‑reply chips */}
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
              disabled={isActionMode}
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

            {/* --------- SEND / RETRY / SEARCH ACTIONS --------- */}
            <div className="relative">
              {/* Pop‑over that appears when the search timed‑out */}
              {isSearchTimeout && searchActionsOpen && (
                <div className={cn('action-pop', actionsClosing && 'closing')}>


                  <button
                    type="button"
                    className="action-item"
                    onClick={() => {
                      onSearchRetry?.();
                      closeActions();
                    }}
                    disabled={!onSearchRetry}
                  >
                    <span className="action-ico">
                      <Clock className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <div className="action-title">
                        {settings.language === 'ar' ? 'عيد البحث' : 'Retry Search'}
                      </div>
                      <div className="action-sub">
                        {settings.language === 'ar' ? 'مهلة أطول' : 'Use a longer timeout'}
                      </div>
                    </span>
                  </button>
                </div>
              )}

              {/* ---- RETRY LLM (when a generation error occurs) ---- */}
              {showRetry ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className={cn('retry-llm-btn', 'send-glow')}
                  onClick={onRetryLlm}
                  disabled={!onRetryLlm}
                  data-testid="chat-retry-llm"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              ) : isSearchTimeout ? (
                /* ---- SEARCH‑TIMEOUT toggle button (opens the pop‑over) ---- */
                <Button
                  type="button"
                  size="icon"
                  className={cn('send-btn', 'send-glow')}
                  onClick={() => {
                    if (searchActionsOpen) closeActions();
                    else setSearchActionsOpen(true);
                  }}
                  data-testid="search-action-toggle"
                >
                  <Send className="w-4 h-4" />
                </Button>
              ) : canConfirmStart && !inputValue.trim() ? (
                /* ---- CONFIRM START (no text entered) ---- */
                <Button
                  type="button"
                  size="icon"
                  className={cn('confirm-start-btn', 'send-glow')}
                  onClick={onConfirmStart}
                  disabled={!onConfirmStart}
                  data-testid="confirm-start"
                >
                  <Check className="w-4 h-4" />
                </Button>
              ) : (
                /* ---- NORMAL SEND BUTTON ---- */
                <Button
                  type="submit"
                  size="icon"
                  disabled={!inputValue.trim()}
                  className={cn('send-btn', inputValue.trim() ? '' : '')}
                  data-testid="chat-send"
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
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
