import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, Check, ChevronDown, Loader2, Play, RefreshCcw, Search, Send, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReasoningBoard } from '@/components/chat/ReasoningBoard';
import { SearchLivePanel } from '@/components/chat/SearchLivePanel';
import type { SearchPanelModel } from '@/lib/searchPanelModel';
import {
  ChatMessage,
  PendingClarification,
  PendingIdeaConfirmation,
  PendingResearchReview,
  PreflightQuestion,
  ReasoningMessage,
  SimulationStatus,
} from '@/types/simulation';
import { cn } from '@/lib/utils';

type BusyStage =
  | 'extracting_schema'
  | 'detecting_mode'
  | 'assistant_reply'
  | 'prestart_research'
  | 'starting_simulation'
  | 'checking_session';

interface ChatPanelProps {
  messages: ChatMessage[];
  reasoningFeed: ReasoningMessage[];
  highlightReasoningMessageIds?: string[];
  reasoningDebug?: { id: string; agentShortId?: string; reason: string; stage?: string; attempt?: number; phase?: string; timestamp: number }[];
  onSendMessage: (msg: string) => void;
  onSelectOption?: (field: string, value: string) => void;
  isWaitingForCity?: boolean;
  isWaitingForCountry?: boolean;
  isWaitingForLocationChoice?: boolean;
  isThinking?: boolean;
  showRetry?: boolean;
  onRetryLlm?: () => void;
  onSearchRetry?: () => void;
  onSearchUseLlm?: () => void;
  canConfirmStart?: boolean;
  onConfirmStart?: () => void;
  quickReplies?: { label: string; value: string }[];
  onQuickReply?: (value: string) => void;
  simulationStatus?: SimulationStatus;
  simulationError?: string | null;
  reasoningActive?: boolean;
  isSummarizing?: boolean;
  viewMode?: 'chat' | 'reasoning';
  searchState?: { status: 'idle' | 'searching' | 'timeout' | 'error' | 'complete'; stage?: BusyStage; timeoutMs?: number; elapsedMs?: number };
  uiProgress?: { active: boolean; stage: BusyStage; elapsedMs?: number; timeoutMs?: number };
  searchPanelModel?: SearchPanelModel | null;
  showSearchLivePanel?: boolean;
  primaryControl?: {
    key: string;
    label: string;
    description?: string;
    disabled?: boolean;
    busy?: boolean;
    tone?: 'primary' | 'secondary' | 'warning' | 'success';
    icon?: 'play' | 'pause' | 'retry' | 'sparkles' | 'reasoning';
    onClick?: () => void;
    secondary?: { label: string; disabled?: boolean; onClick?: () => void };
  } | null;
  pendingClarification?: PendingClarification | null;
  canAnswerClarification?: boolean;
  pendingInputKind?: string | null;
  clarificationBusy?: boolean;
  onSubmitClarification?: (payload: { questionId: string; selectedOptionId?: string; customText?: string }) => void;
  pendingPreflightQuestion?: PreflightQuestion | null;
  preflightRound?: number;
  preflightMaxRounds?: number;
  preflightBusy?: boolean;
  onSubmitPreflight?: (payload: { questionId: string; selectedOptionId?: string; customText?: string }) => void;
  pendingIdeaConfirmation?: PendingIdeaConfirmation | null;
  onConfirmIdeaForStart?: () => void;
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
  postActionResult?: { action: 'make_acceptable' | 'bring_to_world'; title: string; summary: string; steps: string[]; risks: string[]; kpis: string[]; revised_idea?: string } | null;
  onRunPostAction?: (action: 'make_acceptable' | 'bring_to_world') => void;
  onStartFollowupFromPostAction?: () => void;
  onRequestReasoningView?: () => void;
  settings: { language: 'ar' | 'en'; autoFocusInput?: boolean };
}

type ComposerAction = {
  key: string;
  label: string;
  description?: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'warning';
  icon: ReactNode;
  onClick: () => void;
};

const stageLabels: Record<BusyStage, { ar: string; en: string }> = {
  extracting_schema: { ar: 'نحلل الفكرة ونرتب عناصرها', en: 'Structuring the idea' },
  detecting_mode: { ar: 'نحدد أفضل مسار للعمل', en: 'Detecting the best flow' },
  assistant_reply: { ar: 'نحضّر الرد التالي', en: 'Preparing the next reply' },
  prestart_research: { ar: 'نجمع مصادر من الإنترنت', en: 'Collecting internet sources' },
  starting_simulation: { ar: 'نبدأ المحاكاة الآن', en: 'Starting the simulation' },
  checking_session: { ar: 'نتأكد من الجلسة الحالية', en: 'Checking the current session' },
};

const yesNoChoice = (items: ChatMessage['options']['items']) => items.length === 2 && items.some((item) => item.value.toLowerCase() === 'yes') && items.some((item) => item.value.toLowerCase() === 'no');

function PromptCard({
  title,
  description,
  options,
  selected,
  onSelect,
  text,
  onText,
  busy,
  submitLabel,
  onSubmit,
  tone = 'info',
}: {
  title: string;
  description: string;
  options: { id: string; label: string }[];
  selected: string | null;
  onSelect: (value: string) => void;
  text: string;
  onText: (value: string) => void;
  busy?: boolean;
  submitLabel: string;
  onSubmit: () => void;
  tone?: 'info' | 'warning';
}) {
  return (
    <section className={cn('rounded-[30px] border p-5', tone === 'warning' ? 'border-amber-400/30 bg-amber-500/10' : 'border-cyan-400/30 bg-cyan-500/10')}>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-foreground/90">{description}</p>
      <div className="mt-4 space-y-2">
        {options.map((option) => (
          <button key={option.id} type="button" onClick={() => onSelect(option.id)} className={cn('w-full rounded-2xl border px-4 py-3 text-start transition', selected === option.id ? 'border-primary/40 bg-primary/10' : 'border-border/60 bg-background/55 hover:border-primary/20')}>
            {option.label}
          </button>
        ))}
      </div>
      <Input value={text} onChange={(event) => onText(event.target.value)} className="mt-3 h-12 rounded-2xl border-border/60 bg-background/65 text-base" placeholder="..." dir="rtl" />
      <Button type="button" onClick={onSubmit} disabled={busy || (!selected && !text.trim())} className="mt-3 rounded-2xl">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        <span>{submitLabel}</span>
      </Button>
    </section>
  );
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    messages,
    reasoningFeed,
    highlightReasoningMessageIds = [],
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
    quickReplies = [],
    onQuickReply,
    simulationStatus = 'idle',
    simulationError = null,
    reasoningActive = false,
    isSummarizing = false,
    viewMode = 'chat',
    searchState,
    uiProgress,
    searchPanelModel = null,
    showSearchLivePanel = true,
    primaryControl = null,
  pendingClarification = null,
  canAnswerClarification = false,
  pendingInputKind = null,
  clarificationBusy = false,
    onSubmitClarification,
    pendingPreflightQuestion = null,
    preflightRound = 0,
    preflightMaxRounds = 0,
    preflightBusy = false,
    onSubmitPreflight,
    pendingIdeaConfirmation = null,
    onConfirmIdeaForStart,
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
    onRequestReasoningView,
    settings,
  } = props;

  const language = settings.language;
  const isReasoningView = viewMode === 'reasoning';
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const allowAutoFocusRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);

  const [inputValue, setInputValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [clarificationChoice, setClarificationChoice] = useState<string | null>(null);
  const [clarificationText, setClarificationText] = useState('');
  const [preflightChoice, setPreflightChoice] = useState<string | null>(null);
  const [preflightText, setPreflightText] = useState('');
  const [reviewSelectedIds, setReviewSelectedIds] = useState<string[]>([]);
  const [reviewExtraUrls, setReviewExtraUrls] = useState('');
  const [reviewQueryRefinement, setReviewQueryRefinement] = useState('');

  useEffect(() => {
    if (!pendingClarification?.questionId) return;
    setClarificationChoice(null);
    setClarificationText('');
  }, [pendingClarification?.questionId]);

  useEffect(() => {
    if (!pendingPreflightQuestion?.questionId) return;
    setPreflightChoice(null);
    setPreflightText('');
  }, [pendingPreflightQuestion?.questionId]);

  useEffect(() => {
    if (!pendingResearchReview?.cycleId) return;
    setReviewSelectedIds(pendingResearchReview.candidateUrls.slice(0, 3).map((item) => item.id));
    setReviewExtraUrls('');
    setReviewQueryRefinement('');
  }, [pendingResearchReview?.candidateUrls, pendingResearchReview?.cycleId]);

  useEffect(() => {
    const container = listRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, reasoningFeed, isThinking, pendingClarification, pendingPreflightQuestion, pendingResearchReview, pendingIdeaConfirmation]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (formRef.current?.contains(target)) {
        allowAutoFocusRef.current = true;
        return;
      }
      allowAutoFocusRef.current = false;
      setMenuOpen(false);
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  useEffect(() => {
    if (!settings.autoFocusInput || isReasoningView) return;
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [isReasoningView, settings.autoFocusInput]);

  useEffect(() => {
    if (!settings.autoFocusInput || isReasoningView || !allowAutoFocusRef.current) return;
    const latest = messages.at(-1)?.id || null;
    if (!latest || latest === lastMessageIdRef.current) return;
    lastMessageIdRef.current = latest;
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [isReasoningView, messages, settings.autoFocusInput]);

  const inlineStatus = useMemo(() => {
    if (searchState?.status === 'searching') return { tone: 'info' as const, label: language === 'ar' ? stageLabels[searchState.stage || 'prestart_research'].ar : stageLabels[searchState.stage || 'prestart_research'].en };
    if (searchState?.status === 'timeout') return { tone: 'warning' as const, label: language === 'ar' ? 'انتهت مهلة البحث. يمكنك الإعادة أو استخدام البديل المحلي.' : 'Search timed out. Retry or use the local fallback.' };
    if (searchState?.status === 'error') return { tone: 'error' as const, label: language === 'ar' ? 'تعذر إكمال البحث الحالي.' : 'The current search could not be completed.' };
    if (uiProgress?.active) return { tone: 'info' as const, label: language === 'ar' ? stageLabels[uiProgress.stage].ar : stageLabels[uiProgress.stage].en };
    return null;
  }, [language, searchState, uiProgress]);

  const primaryAction = useMemo<ComposerAction | null>(() => {
    if (inputValue.trim()) return { key: 'send', label: language === 'ar' ? 'إرسال الرسالة' : 'Send message', icon: <Send className="h-4 w-4" />, onClick: () => { const next = inputValue.trim(); if (!next) return; onSendMessage(next); setInputValue(''); allowAutoFocusRef.current = true; window.requestAnimationFrame(() => inputRef.current?.focus()); } };
    if (searchState?.status === 'timeout' && onSearchRetry) return { key: 'retry-search', label: language === 'ar' ? 'إعادة البحث' : 'Retry search', description: language === 'ar' ? 'يمكنك إعادة المحاولة أو استخدام البديل المحلي.' : 'Retry or use the local fallback.', tone: 'warning', icon: <Search className="h-4 w-4" />, onClick: () => (onSearchUseLlm ? setMenuOpen((open) => !open) : onSearchRetry()) };
    if (showRetry && onRetryLlm) return { key: 'fallback', label: language === 'ar' ? 'استخدام بديل LLM' : 'Use LLM fallback', tone: 'warning', icon: <Wand2 className="h-4 w-4" />, onClick: onRetryLlm };
    if (canConfirmStart && onConfirmStart) return { key: 'start', label: language === 'ar' ? 'شغّل خط الأنابيب الإلزامي' : 'Run mandatory pipeline', icon: <Play className="h-4 w-4" />, onClick: onConfirmStart };
    if (primaryControl?.onClick) return {
      key: primaryControl.key,
      label: primaryControl.label,
      description: primaryControl.description,
      disabled: primaryControl.disabled,
      busy: primaryControl.busy,
      tone: primaryControl.tone === 'warning' ? 'warning' : primaryControl.tone === 'secondary' ? 'secondary' : 'primary',
      icon: primaryControl.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryControl.icon === 'retry' ? <RefreshCcw className="h-4 w-4" /> : primaryControl.icon === 'sparkles' ? <Sparkles className="h-4 w-4" /> : <Play className="h-4 w-4" />,
      onClick: primaryControl.onClick,
    };
    return null;
  }, [canConfirmStart, inputValue, language, onConfirmStart, onRetryLlm, onSearchRetry, onSearchUseLlm, onSendMessage, primaryControl, searchState?.status, showRetry]);

  const secondaryActions = useMemo<ComposerAction[]>(() => {
    if (searchState?.status === 'timeout' && onSearchRetry) {
      const actions: ComposerAction[] = [{ key: 'retry-direct', label: language === 'ar' ? 'إعادة البحث' : 'Retry search', icon: <RefreshCcw className="h-4 w-4" />, onClick: () => { onSearchRetry(); setMenuOpen(false); } }];
      if (onSearchUseLlm) actions.push({ key: 'fallback-llm', label: language === 'ar' ? 'استخدام البديل المحلي' : 'Use LLM fallback', tone: 'warning', icon: <Wand2 className="h-4 w-4" />, onClick: () => { onSearchUseLlm(); setMenuOpen(false); } });
      return actions;
    }
    if (primaryControl?.secondary?.onClick) return [{ key: `${primaryControl.key}-secondary`, label: primaryControl.secondary.label, disabled: primaryControl.secondary.disabled, icon: <RefreshCcw className="h-4 w-4" />, onClick: () => { primaryControl.secondary?.onClick?.(); setMenuOpen(false); } }];
    return [];
  }, [language, onSearchRetry, onSearchUseLlm, primaryControl, searchState?.status]);

  const submitClarification = useCallback(() => {
    if (!pendingClarification || !onSubmitClarification) return;
    const text = clarificationText.trim();
    if (!clarificationChoice && !text) return;
    onSubmitClarification({ questionId: pendingClarification.questionId, selectedOptionId: clarificationChoice || undefined, customText: text || undefined });
  }, [clarificationChoice, clarificationText, onSubmitClarification, pendingClarification]);

  const submitPreflight = useCallback(() => {
    if (!pendingPreflightQuestion || !onSubmitPreflight) return;
    const text = preflightText.trim();
    if (!preflightChoice && !text) return;
    onSubmitPreflight({ questionId: pendingPreflightQuestion.questionId, selectedOptionId: preflightChoice || undefined, customText: text || undefined });
  }, [onSubmitPreflight, pendingPreflightQuestion, preflightChoice, preflightText]);

  return (
    <div className="flex h-full min-h-0 flex-col" dir="rtl">
      <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5 scrollbar-thin">
        {inlineStatus ? <div className={cn('rounded-[24px] border px-4 py-3 text-sm', inlineStatus.tone === 'warning' && 'border-amber-400/30 bg-amber-500/10 text-amber-100', inlineStatus.tone === 'error' && 'border-rose-400/30 bg-rose-500/10 text-rose-100', inlineStatus.tone === 'info' && 'border-sky-400/25 bg-sky-500/10 text-sky-100')}>{inlineStatus.label}</div> : null}
        {showSearchLivePanel && searchPanelModel && searchPanelModel.stage !== 'hidden' ? <SearchLivePanel model={searchPanelModel} /> : null}
        {!isReasoningView && (reasoningActive || reasoningFeed.length > 1) ? <section className="rounded-[30px] border border-primary/25 bg-primary/10 p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-foreground">{language === 'ar' ? 'الوكلاء بدأوا يتناقشون الآن' : 'Agents have started debating now'}</h3><p className="mt-1 text-sm text-muted-foreground">{language === 'ar' ? 'افتح شاشة النقاش لرؤية الحوار الجماعي بين الوكلاء.' : 'Open the reasoning view to watch the group discussion.'}</p></div>{onRequestReasoningView ? <Button type="button" onClick={onRequestReasoningView} className="rounded-2xl">{language === 'ar' ? 'مشاهدة النقاش' : 'Open reasoning'}</Button> : null}</div></section> : null}
        {isReasoningView ? <ReasoningBoard language={language} messages={reasoningFeed} highlightIds={highlightReasoningMessageIds} /> : <>
          {messages.map((message) => {
            const isUser = message.type === 'user';
            const authorLabel = isUser ? (language === 'ar' ? 'أنت' : 'You') : message.type === 'agent' ? (message.agentId || 'Agent') : (language === 'ar' ? 'المساعد' : 'Assistant');
            return <div key={message.id} className={cn('flex w-full', isUser ? 'justify-start md:justify-end' : 'justify-start')}><div className={cn('w-full max-w-[98%] rounded-[28px] border px-5 py-4 md:max-w-[92%]', isUser ? 'border-primary/25 bg-primary/12' : message.type === 'agent' ? 'border-emerald-400/25 bg-emerald-500/10' : 'border-border/60 bg-background/65')}><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><div className={cn('flex h-8 w-8 items-center justify-center rounded-2xl border', isUser ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/55 bg-card/80 text-foreground')}>{isUser ? <span className="text-sm font-semibold">{language === 'ar' ? 'أنت' : 'Me'}</span> : <Bot className="h-4 w-4" />}</div><span className="font-medium text-foreground/90">{authorLabel}</span></div><p className="whitespace-pre-wrap text-[15px] leading-8 text-foreground">{message.content}</p>{message.options?.items?.length ? <div className={cn('mt-4 gap-3', yesNoChoice(message.options.items) ? 'grid grid-cols-2' : 'grid grid-cols-1')}>{message.options.items.map((item) => <button key={`${message.id}-${item.value}`} type="button" onClick={() => onSelectOption?.(message.options!.field, item.value)} className="rounded-[22px] border border-border/60 bg-card/75 px-4 py-3.5 text-start transition hover:border-primary/35 hover:bg-primary/8"><div className="text-sm font-semibold leading-7 text-foreground">{yesNoChoice(message.options.items) ? item.value.toLowerCase() === 'yes' ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No') : item.label}</div>{item.description ? <div className="mt-1 text-xs leading-6 text-muted-foreground">{item.description}</div> : null}</button>)}</div> : null}</div></div>;
          })}
          {isThinking ? <div className="inline-flex items-center gap-2 rounded-full border border-border/55 bg-card/80 px-4 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span>{language === 'ar' ? 'المساعد يكتب الآن...' : 'Assistant is responding...'}</span></div> : null}
          {simulationError ? <div className="rounded-[26px] border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-foreground"><div className="mb-1 flex items-center gap-2 font-semibold text-destructive"><TriangleAlert className="h-4 w-4" /><span>{language === 'ar' ? 'حدث خطأ أثناء التنفيذ' : 'Execution error'}</span></div>{simulationError}</div> : null}
          {pendingIdeaConfirmation ? <section className="rounded-[30px] border border-emerald-400/30 bg-emerald-500/10 p-5"><h3 className="text-base font-semibold text-foreground">{language === 'ar' ? 'هل هذا هو الوصف النهائي للفكرة؟' : 'Is this the final idea framing?'}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-foreground/90">{pendingIdeaConfirmation.description}</p><div className="mt-4 grid grid-cols-2 gap-2"><Button type="button" onClick={onConfirmIdeaForStart} className="rounded-2xl"><Check className="h-4 w-4" /><span>{language === 'ar' ? 'نعم، ابدأ' : 'Yes, start'}</span></Button><Button type="button" variant="outline" onClick={() => inputRef.current?.focus()} className="rounded-2xl"><X className="h-4 w-4" /><span>{language === 'ar' ? 'لا، سأعدل' : 'No, I will edit'}</span></Button></div></section> : null}
          {pendingInputKind === 'clarification' && canAnswerClarification && pendingClarification ? <PromptCard title={language === 'ar' ? 'نحتاج توضيحًا قبل المتابعة' : 'Clarification is needed before continuing'} description={pendingClarification.question} options={pendingClarification.options} selected={clarificationChoice} onSelect={setClarificationChoice} text={clarificationText} onText={setClarificationText} busy={clarificationBusy} submitLabel={language === 'ar' ? 'إرسال التوضيح' : 'Send clarification'} onSubmit={submitClarification} /> : null}
          {pendingPreflightQuestion ? <PromptCard title={language === 'ar' ? `سؤال تمهيدي ${preflightRound}/${preflightMaxRounds}` : `Preflight question ${preflightRound}/${preflightMaxRounds}`} description={pendingPreflightQuestion.question} options={pendingPreflightQuestion.options} selected={preflightChoice} onSelect={setPreflightChoice} text={preflightText} onText={setPreflightText} busy={preflightBusy} submitLabel={language === 'ar' ? 'تأكيد الإجابة' : 'Confirm answer'} onSubmit={submitPreflight} tone="warning" /> : null}
          {pendingResearchReview ? <section className="rounded-[30px] border border-primary/30 bg-primary/8 p-5"><h3 className="text-base font-semibold text-foreground">{language === 'ar' ? 'راجع نتائج البحث قبل المتابعة' : 'Review research before continuing'}</h3>{pendingResearchReview.gapSummary ? <p className="mt-2 text-sm leading-7 text-muted-foreground">{pendingResearchReview.gapSummary}</p> : null}<div className="mt-4 space-y-2">{pendingResearchReview.candidateUrls.map((item) => { const selected = reviewSelectedIds.includes(item.id); return <button key={item.id} type="button" onClick={() => setReviewSelectedIds((prev) => prev.includes(item.id) ? prev.filter((entry) => entry !== item.id) : [...prev, item.id])} className={cn('w-full rounded-2xl border px-4 py-3 text-start transition', selected ? 'border-primary/40 bg-primary/10' : 'border-border/60 bg-background/55')}><div className="text-sm font-semibold text-foreground">{item.title || item.domain || item.url}</div><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{item.url}</div></button>; })}</div><Input value={reviewQueryRefinement} onChange={(event) => setReviewQueryRefinement(event.target.value)} className="mt-3 h-12 rounded-2xl border-border/60 bg-background/65 text-base" placeholder={language === 'ar' ? 'تحسين إضافي للاستعلام' : 'Optional query refinement'} dir="rtl" /><Input value={reviewExtraUrls} onChange={(event) => setReviewExtraUrls(event.target.value)} className="mt-3 h-12 rounded-2xl border-border/60 bg-background/65 text-base" placeholder={language === 'ar' ? 'ألصق روابط إضافية مفصولة بفاصلة' : 'Extra URLs separated by comma'} dir="ltr" /><div className="mt-4 grid gap-2 sm:grid-cols-3"><Button type="button" disabled={researchReviewBusy || !reviewSelectedIds.length} onClick={() => onSubmitResearchReviewAction?.({ cycleId: pendingResearchReview.cycleId, action: 'scrape_selected', selectedUrlIds: reviewSelectedIds, addedUrls: reviewExtraUrls.split(',').map((item) => item.trim()).filter(Boolean), queryRefinement: reviewQueryRefinement.trim() || undefined })} className="rounded-2xl">{researchReviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}<span>{language === 'ar' ? 'استخراج المحدد' : 'Scrape selected'}</span></Button><Button type="button" variant="outline" disabled={researchReviewBusy} onClick={() => onSubmitResearchReviewAction?.({ cycleId: pendingResearchReview.cycleId, action: 'continue_search', addedUrls: reviewExtraUrls.split(',').map((item) => item.trim()).filter(Boolean), queryRefinement: reviewQueryRefinement.trim() || undefined })} className="rounded-2xl"><RefreshCcw className="h-4 w-4" /><span>{language === 'ar' ? 'وسّع البحث' : 'Continue search'}</span></Button><Button type="button" variant="ghost" disabled={researchReviewBusy} onClick={() => onSubmitResearchReviewAction?.({ cycleId: pendingResearchReview.cycleId, action: 'cancel_review' })} className="rounded-2xl"><X className="h-4 w-4" /><span>{language === 'ar' ? 'إلغاء' : 'Cancel'}</span></Button></div></section> : null}
          {postActionsEnabled && onRunPostAction ? <section className="rounded-[30px] border border-border/60 bg-card/75 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-foreground">{language === 'ar' ? 'الخطوة التالية بعد التقييم' : 'Next step after evaluation'}</h3>{typeof finalAcceptancePct === 'number' ? <p className="mt-1 text-sm text-muted-foreground">{language === 'ar' ? `نسبة القبول الحالية ${Math.round(finalAcceptancePct)}%` : `Current acceptance ${Math.round(finalAcceptancePct)}%`}</p> : null}</div>{recommendedPostAction ? <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{language === 'ar' ? `مقترح: ${recommendedPostAction === 'make_acceptable' ? 'اجعلها مقبولة' : 'أنزلها للعالم'}` : `Suggested: ${recommendedPostAction}`}</div> : null}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Button type="button" variant={recommendedPostAction === 'make_acceptable' ? 'default' : 'outline'} disabled={postActionBusy !== null} onClick={() => onRunPostAction('make_acceptable')} className="rounded-2xl">{postActionBusy === 'make_acceptable' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}<span>{language === 'ar' ? 'اجعلها مقبولة' : 'Make acceptable'}</span></Button><Button type="button" variant={recommendedPostAction === 'bring_to_world' ? 'default' : 'outline'} disabled={postActionBusy !== null} onClick={() => onRunPostAction('bring_to_world')} className="rounded-2xl">{postActionBusy === 'bring_to_world' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}<span>{language === 'ar' ? 'أنزلها للعالم' : 'Bring to world'}</span></Button></div></section> : null}
          {postActionResult ? <section className="rounded-[30px] border border-emerald-400/25 bg-emerald-500/8 p-5"><h3 className="text-base font-semibold text-foreground">{postActionResult.title}</h3><p className="mt-2 text-sm leading-7 text-foreground/90">{postActionResult.summary}</p>{onStartFollowupFromPostAction ? <Button type="button" onClick={onStartFollowupFromPostAction} className="mt-4 rounded-2xl"><Play className="h-4 w-4" /><span>{language === 'ar' ? 'ابدأ جولة متابعة' : 'Start follow-up run'}</span></Button> : null}</section> : null}
          {quickReplies.length && !pendingClarification && !pendingPreflightQuestion && !pendingResearchReview ? <div className="flex flex-wrap gap-2">{quickReplies.map((reply) => <button key={reply.value} type="button" onClick={() => onQuickReply?.(reply.value)} className="rounded-full border border-border/55 bg-card/80 px-4 py-2 text-sm text-foreground transition hover:border-primary/30 hover:bg-primary/8">{reply.label}</button>)}</div> : null}
        </>}
      </div>
      {!isReasoningView ? <div className="border-t border-border/45 px-5 pb-5 pt-4"><form ref={formRef} onSubmit={(event) => { event.preventDefault(); primaryAction?.onClick(); }} className="relative"><div className="flex items-end gap-3"><Input ref={inputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={language === 'ar' ? 'اكتب رسالتك أو عدّل الفكرة...' : 'Type your message or refine the idea...'} className="h-14 flex-1 rounded-[24px] border-border/60 bg-card/80 px-5 text-base" dir="rtl" /><div className="relative shrink-0"><Button type="submit" disabled={!primaryAction || primaryAction.disabled || primaryAction.busy || isThinking || simulationStatus === 'configuring'} className={cn('h-14 min-w-[180px] rounded-[24px] px-5 transition-all duration-200', primaryAction?.tone === 'warning' && 'bg-amber-500 text-slate-950 hover:bg-amber-400', primaryAction?.tone === 'secondary' && 'bg-secondary text-foreground hover:bg-secondary/85', menuOpen && 'translate-y-[-1px] shadow-[0_12px_32px_-16px_rgba(0,0,0,0.45)]')}>{primaryAction?.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryAction?.icon}<span>{primaryAction?.label || (language === 'ar' ? 'اكتب رسالة' : 'Write message')}</span>{secondaryActions.length ? <ChevronDown className={cn('h-4 w-4 transition-transform', menuOpen && 'rotate-180')} /> : null}</Button>{secondaryActions.length ? <div className={cn('absolute bottom-[calc(100%+10px)] start-0 w-72 origin-bottom rounded-[24px] border border-border/60 bg-card/95 p-2 shadow-2xl backdrop-blur-xl transition-all duration-200', menuOpen ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-2 scale-95 opacity-0')}>{secondaryActions.map((action) => <button key={action.key} type="button" disabled={action.disabled} onClick={action.onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start text-sm text-foreground transition hover:bg-primary/8 disabled:opacity-50"><span className={cn('flex h-9 w-9 items-center justify-center rounded-2xl border', action.tone === 'warning' ? 'border-amber-400/30 bg-amber-500/15 text-amber-300' : 'border-border/60 bg-background/65 text-foreground')}>{action.icon}</span><span>{action.label}</span></button>)}</div> : null}</div></div></form></div> : null}
    </div>
  );
}
