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
  searchState,
  settings,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning'>('chat');
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
        ) : (
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
