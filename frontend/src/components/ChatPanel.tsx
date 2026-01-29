import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage, ReasoningMessage } from '@/types/simulation';
import { cn } from '@/lib/utils';
import { SearchResult } from '@/services/api';

interface ChatPanelProps {
  messages: ChatMessage[];
  reasoningFeed: ReasoningMessage[];
  onSendMessage: (message: string) => void;
  onSelectOption?: (field: 'category' | 'audience' | 'goals' | 'maturity', value: string) => void;
  isWaitingForCity?: boolean;
  isWaitingForCountry?: boolean;
  isThinking?: boolean;
  showRetry?: boolean;
  onRetryLlm?: () => void;
  insights?: {
    idea?: string;
    location?: string;
    category?: string;
    audience?: string[];
    goals?: string[];
    maturity?: string;
    risk?: number;
    summary?: string;
    rejectAdvice?: string;
    rejectReasons?: string[];
  };
  searchState?: {
    status: 'idle' | 'searching' | 'done';
    query?: string;
    answer?: string;
    provider?: string;
    isLive?: boolean;
    results?: SearchResult[];
  };
  settings: {
    language: 'ar' | 'en';
    theme: string;
    autoFocusInput: boolean;
  };
}

export function ChatPanel({
  messages,
  reasoningFeed,
  onSendMessage,
  onSelectOption,
  isWaitingForCity = false,
  isWaitingForCountry = false,
  isThinking = false,
  showRetry = false,
  onRetryLlm,
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

  const handleThinkingHeaderClick = () => {
    if (searchState?.status === 'searching') {
      setThinkingOpen((prev) => !prev);
      return;
    }
    setActiveTab('reasoning');
  };

  useEffect(() => {
    if (scrollRef.current && isNearBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, reasoningFeed, activeTab, isNearBottom]);

  const lastMessageCount = useRef(0);
  useEffect(() => {
    if (!settings.autoFocusInput) return;
    if (activeTab !== 'chat') return;
    if (messages.length !== lastMessageCount.current) {
      lastMessageCount.current = messages.length;
      inputRef.current?.focus();
    }
  }, [messages.length, settings.autoFocusInput, activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    onSendMessage(inputValue);
    setInputValue('');
    if (settings.autoFocusInput) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <div className="glass-panel h-full flex flex-col min-h-0">
      <div className="flex border-b border-border/50">
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            'flex-1 px-4 py-3 text-sm font-medium transition-all relative',
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
        <button
          onClick={() => setActiveTab('reasoning')}
          className={cn(
            'flex-1 px-4 py-3 text-sm font-medium transition-all relative',
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
        <button
          onClick={() => setActiveTab('insights')}
          className={cn(
            'flex-1 px-4 py-3 text-sm font-medium transition-all relative',
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

      <div
        className="messages-container scrollbar-thin"
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
          <div className="space-y-4">
            {showRetry && (
              <div className="poll-card">
                <p>{settings.language === 'ar' ? 'الـ LLM مشغول الآن.' : 'LLM is busy right now.'}</p>
                <div className="poll-options">
                  <button
                    type="button"
                    className="poll-option"
                    onClick={onRetryLlm}
                  >
                    {settings.language === 'ar' ? 'أعد المحاولة' : 'Retry'}
                  </button>
                </div>
              </div>
            )}
            {(isThinking || (searchState && searchState.status === 'searching')) && (
              <div className={cn('thinking-container', thinkingOpen && 'expanded')}>
                <div
                  className="thinking-header"
                  onClick={handleThinkingHeaderClick}
                >
                  <span className="thinking-icon" />
                  <span className="thinking-label">
                    {searchState?.status === 'searching'
                      ? (settings.language === 'ar' ? 'جاري البحث' : 'Searching')
                      : (settings.language === 'ar' ? 'جارٍ التفكير' : 'Reasoning')}
                  </span>
                  <ChevronDown className="thinking-chevron" />
                </div>
                <div className="thinking-content">
                  <div className="thinking-steps">
                    {(searchState?.status === 'searching'
                      ? [
                          settings.language === 'ar' ? 'جمع مصادر سريعة' : 'Collecting quick sources',
                          settings.language === 'ar' ? 'تلخيص إشارات السوق' : 'Summarizing market signals',
                          settings.language === 'ar' ? 'تحضير سياق الوكلاء' : 'Preparing agent context',
                        ]
                      : [
                          settings.language === 'ar' ? 'قراءة آراء الوكلاء' : 'Reading agent views',
                          settings.language === 'ar' ? 'مقارنة الحجج' : 'Comparing arguments',
                          settings.language === 'ar' ? 'صياغة رد واضح' : 'Drafting a clear reply',
                        ]
                    ).map((step, idx) => (
                      <div key={step} className="thinking-step" style={{ animationDelay: `${idx * 0.1}s` }}>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="text-center py-8">
                <Sparkles className="w-12 h-12 mx-auto text-primary/50 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {settings.language === 'ar' ? 'ابدأ المحاكاة' : 'Start Your Simulation'}
                </h3>
                <p className="text-sm text-muted-foreground max-w-[250px] mx-auto">
                  {settings.language === 'ar'
                    ? 'صف فكرتك وسيقودك النظام لإكمال الإعدادات'
                    : 'Describe your idea and the system will guide you through the configuration'}
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={cn('message', msg.type === 'user' ? 'user' : 'bot')}>
                  {!msg.options && <div className="bubble">{msg.content}</div>}
                  {msg.options && msg.options.items.length > 0 && (
                    <div className={msg.options.kind === 'single' ? 'poll-card' : 'multi-select-card'}>
                      <p>{msg.content}</p>
                      <div className={msg.options.kind === 'single' ? 'poll-options' : 'multi-options'}>
                        {msg.options.items.map((opt, idx) => (
                          <button
                            key={`${msg.options?.field}-${opt.value}`}
                            type="button"
                            className={msg.options.kind === 'single' ? 'poll-option' : 'multi-option'}
                            style={{ animationDelay: `${100 + idx * 60}ms` }}
                            onClick={() => onSelectOption?.(msg.options!.field, opt.value)}
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

            {(isThinking || (searchState && searchState.status === 'searching')) && (
              <div className="typing-indicator">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
          </div>
        ) : activeTab === 'reasoning' ? (
          <div className="space-y-3">
            {reasoningFeed.length === 0 ? (
              <div className="text-center py-8">
                <Bot className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">
                  {settings.language === 'ar'
                    ? 'تفكير الوكلاء سيظهر هنا أثناء المحاكاة'
                    : 'Agent reasoning will appear here during simulation'}
                </p>
              </div>
            ) : (
              reasoningFeed.map((msg) => (
                <div
                  key={msg.id}
                  className="p-3 rounded-lg bg-secondary/50 border border-border/30 animate-slide-in-right"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3 h-3 text-primary" />
                    </div>
                    <span
                      className={cn(
                        'text-xs font-mono',
                        msg.opinion === 'accept'
                          ? 'text-success'
                          : msg.opinion === 'reject'
                          ? 'text-destructive'
                          : 'text-primary'
                      )}
                    >
                      Agent {msg.agentId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">? Iteration {msg.iteration}</span>
                  </div>
                  <p className="text-sm text-foreground/90 pl-8">{msg.message}</p>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {settings.language === 'ar' ? 'تفاصيل الفكرة' : 'Idea Details'}
              </h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>{settings.language === 'ar' ? 'الفكرة:' : 'Idea:'} <span className="text-foreground">{insights?.idea || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'الموقع:' : 'Location:'} <span className="text-foreground">{insights?.location || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'الفئة:' : 'Category:'} <span className="text-foreground">{insights?.category || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'الجمهور:' : 'Audience:'} <span className="text-foreground">{(insights?.audience || []).join(', ') || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'الأهداف:' : 'Goals:'} <span className="text-foreground">{(insights?.goals || []).join(', ') || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'النضج:' : 'Maturity:'} <span className="text-foreground">{insights?.maturity || '-'}</span></div>
                <div>{settings.language === 'ar' ? 'المخاطرة:' : 'Risk:'} <span className="text-foreground">{typeof insights?.risk === 'number' ? `${insights.risk}%` : '-'}</span></div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {settings.language === 'ar' ? 'لماذا يرفض البعض؟' : 'Why some reject'}
              </h4>
              {insights?.rejectReasons && insights.rejectReasons.length > 0 ? (
                <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                  {insights.rejectReasons.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {settings.language === 'ar'
                    ? 'سيظهر هنا بعد انتهاء المحاكاة.'
                    : 'Appears after simulation completes.'}
                </p>
              )}
            </div>

            <div className="p-4 rounded-lg bg-secondary/40 border border-border/40">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {settings.language === 'ar' ? 'كيف نجعلها مقبولة؟' : 'How to make it acceptable'}
              </h4>
              {insights?.rejectAdvice ? (
                <p className="text-sm text-muted-foreground">{insights.rejectAdvice}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {settings.language === 'ar'
                    ? 'سنجمع اقتراحات عملية هنا بعد التحليل.'
                    : 'Actionable tips will appear here after analysis.'}
                </p>
              )}
            </div>

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

      {activeTab === 'chat' && !isNearBottom && (
        <button
          type="button"
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="mx-4 mb-2 rounded-full border border-border/50 bg-secondary/60 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {settings.language === 'ar' ? 'الانتقال لآخر الرسائل' : 'Jump to latest'}
        </button>
      )}

      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-input-wrapper">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
            placeholder={
              isWaitingForCountry
                ? (settings.language === 'ar' ? 'اكتب الدولة...' : 'Enter country...')
                : isWaitingForCity
                ? (settings.language === 'ar' ? 'اكتب المدينة...' : 'Enter city...')
                : (settings.language === 'ar' ? 'اكتب رسالتك...' : 'Type a message...')
            }
            className="chat-input"
            data-testid="chat-input"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim()}
            className="send-btn"
            data-testid="chat-send"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
