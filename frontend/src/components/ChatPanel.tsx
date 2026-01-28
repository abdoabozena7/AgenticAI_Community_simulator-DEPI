import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Search } from 'lucide-react';
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
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  const [searchDetailsOpen, setSearchDetailsOpen] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

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

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="glass-panel h-full flex flex-col min-h-0">
      {/* Tab Header */}
      <div className="flex border-b border-border/50">
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            "flex-1 px-4 py-3 text-sm font-medium transition-all relative",
            activeTab === 'chat'
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
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
            "flex-1 px-4 py-3 text-sm font-medium transition-all relative",
            activeTab === 'reasoning'
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
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

      {/* Messages Area */}
      <div
        className="flex-1 p-4 overflow-y-auto scrollbar-thin"
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
            {isThinking && (
              <button
                type="button"
                onClick={() => setActiveTab('reasoning')}
                className="w-full rounded-lg border border-border/40 bg-secondary/30 px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 transition"
              >
                {settings.language === 'ar'
                  ? 'جاري التفكير... اضغط لمشاهدة تفكير الوكلاء'
                  : 'Thinking... click to view agent reasoning'}
              </button>
            )}
            {searchState && searchState.status !== 'idle' && (
              <div className="p-3 rounded-lg border border-border/50 bg-secondary/30 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Search className="w-4 h-4 text-primary" />
                  {searchState.status === 'searching'
                    ? (settings.language === 'ar' ? 'جار البحث في الويب...' : 'Searching the web...')
                    : (settings.language === 'ar' ? 'نتائج البحث' : 'Research results')}
                  {searchState.isLive === false && (
                    <span className="text-xs text-warning">
                      {settings.language === 'ar' ? 'محاكاة بالـ LLM' : 'LLM fallback'}
                    </span>
                  )}
                </div>
                {searchState.status === 'searching' && (
                  <button
                    type="button"
                    onClick={() => setSearchDetailsOpen((prev) => !prev)}
                    className="text-xs text-primary underline"
                  >
                    {settings.language === 'ar' ? 'تفاصيل البحث' : 'Search details'}
                  </button>
                )}
                {searchState.status === 'searching' && searchDetailsOpen && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>
                      {settings.language === 'ar'
                        ? `الاستعلام: ${searchState.query || ''}`
                        : `Query: ${searchState.query || ''}`}
                    </div>
                    <div>
                      {settings.language === 'ar'
                        ? 'الحد الأقصى للبحث: 6 ثواني ثم نكمل بالـ LLM'
                        : 'Max search time: 6s, then continue with LLM'}
                    </div>
                  </div>
                )}
                {searchState.answer && (
                  <p className="text-sm text-foreground/90">{searchState.answer}</p>
                )}
                {searchState.status === 'done' &&
                  !searchState.answer &&
                  (!searchState.results || searchState.results.length === 0) && (
                    <p className="text-xs text-muted-foreground">
                      {settings.language === 'ar'
                        ? 'لم يتم العثور على مصادر كافية.'
                        : 'No sufficient sources found.'}
                    </p>
                  )}
                {searchState.results && searchState.results.length > 0 && (
                  <div className="space-y-2">
                    {searchState.results.map((result, index) => {
                      const expanded = Boolean(expandedSources[index]);
                      const domain = result.domain || result.url?.replace(/^https?:\/\//, '').split('/')[0] || 'source';
                      return (
                        <button
                          key={`${domain}-${index}`}
                          type="button"
                          className={cn(
                            "w-full p-2 rounded-md border border-border/40 bg-background/40 hover:border-primary/40 transition",
                            settings.language === 'ar' ? 'text-right' : 'text-left'
                          )}
                          onClick={() =>
                            setExpandedSources((prev) => ({ ...prev, [index]: !expanded }))
                          }
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs text-primary overflow-hidden">
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                alt={domain}
                                className="w-4 h-4"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              <span className="leading-none">{domain.slice(0, 1).toUpperCase()}</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground">{domain}</p>
                              <p className="text-sm text-foreground">{result.title}</p>
                            </div>
                          </div>
                          {expanded ? (
                            <div className="mt-2 text-xs text-muted-foreground space-y-1">
                              {result.snippet && <p>{result.snippet}</p>}
                              {result.reason && (
                                <p>
                                  {settings.language === 'ar' ? 'المنطق: ' : 'Reasoning: '}
                                  {result.reason}
                                </p>
                              )}
                            </div>
                          ) : (
                            result.snippet && (
                              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                                {result.snippet}
                              </p>
                            )
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
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
                    ? 'اكتب فكرتك وسيقوم النظام بتجهيز الإعدادات تلقائيًا'
                    : 'Describe your idea and the system will guide you through the configuration'}
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "chat-message animate-fade-in",
                    msg.type === 'user' ? "chat-message-user" : "chat-message-system"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                      msg.type === 'user' ? "bg-primary/20" : "bg-secondary"
                    )}>
                      {msg.type === 'user' ? (
                        <User className="w-4 h-4 text-primary" />
                      ) : (
                        <Bot className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                    {msg.options && msg.options.items.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.options.items.map((opt) => (
                          <button
                            key={`${msg.options?.field}-${opt.value}`}
                            type="button"
                            onClick={() => onSelectOption?.(msg.options!.field, opt.value)}
                            className={cn(
                              "w-full rounded-lg border border-border/40 px-3 py-2 text-sm text-foreground/90",
                              "hover:border-primary/50 hover:bg-primary/5 transition text-right"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-xs text-muted-foreground">OK</span>
                            </div>
                            {opt.description && (
                              <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground mt-1 block">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>
                  </div>
                </div>
              ))
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
                        "text-xs font-mono",
                        msg.opinion === 'accept'
                          ? "text-success"
                          : msg.opinion === 'reject'
                          ? "text-destructive"
                          : "text-primary"
                      )}
                    >
                      Agent {msg.agentId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      � Iteration {msg.iteration}
                    </span>
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

      {/* Input Area */}
      <div className="p-4 border-t border-border/50 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
            placeholder={
              isWaitingForCountry
                ? (settings.language === 'ar' ? "اكتب الدولة..." : "Enter country...")
                : isWaitingForCity
                ? (settings.language === 'ar' ? "اكتب المدينة..." : "Enter city...")
                : (settings.language === 'ar' ? "اكتب فكرتك..." : "Describe your idea...")
            }
            className="flex-1 bg-secondary border-border/50 focus:border-primary/50"
            data-testid="chat-input"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            data-testid="chat-send"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
