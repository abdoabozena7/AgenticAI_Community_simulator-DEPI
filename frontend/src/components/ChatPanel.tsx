import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage, ReasoningMessage } from '@/types/simulation';
import { cn } from '@/lib/utils';
import { SearchResult } from '@/services/api';

interface ChatPanelProps {
  messages: ChatMessage[];
  reasoningFeed: ReasoningMessage[];
  onSendMessage: (message: string) => void;
  isWaitingForCity?: boolean;
  isWaitingForCountry?: boolean;
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
  onUpdateSettings: (next: Partial<ChatPanelProps['settings']>) => void;
}

export function ChatPanel({
  messages,
  reasoningFeed,
  onSendMessage,
  isWaitingForCity = false,
  isWaitingForCountry = false,
  searchState,
  settings,
  onUpdateSettings,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning' | 'settings'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, reasoningFeed, activeTab]);

  useEffect(() => {
    if (settings.autoFocusInput && activeTab === 'chat') {
      inputRef.current?.focus();
    }
  }, [activeTab, settings.autoFocusInput]);

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
        >
          <span className="flex items-center justify-center gap-2">
            <User className="w-4 h-4" />
            Chat
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
        >
          <span className="flex items-center justify-center gap-2">
            <Bot className="w-4 h-4" />
            Agent Reasoning
            {reasoningFeed.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </span>
          {activeTab === 'reasoning' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={cn(
            "flex-1 px-4 py-3 text-sm font-medium transition-all relative",
            activeTab === 'settings'
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center justify-center gap-2">
            <Settings className="w-4 h-4" />
            Settings
          </span>
          {activeTab === 'settings' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto scrollbar-thin" ref={scrollRef}>
        {activeTab === 'chat' ? (
          <div className="space-y-4">
            {searchState && searchState.status !== 'idle' && (
              <div className="p-3 rounded-lg border border-border/50 bg-secondary/30 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Search className="w-4 h-4 text-primary" />
                  {searchState.status === 'searching' ? 'Searching the web...' : 'Research results'}
                  {searchState.isLive === false && (
                    <span className="text-xs text-warning">LLM fallback</span>
                  )}
                </div>
                {searchState.answer && (
                  <p className="text-sm text-foreground/90">{searchState.answer}</p>
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
                          className="w-full text-left p-2 rounded-md border border-border/40 bg-background/40 hover:border-primary/40 transition"
                          onClick={() =>
                            setExpandedSources((prev) => ({ ...prev, [index]: !expanded }))
                          }
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs text-primary">
                              {domain.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground">{domain}</p>
                              <p className="text-sm text-foreground">{result.title}</p>
                            </div>
                          </div>
                          {expanded ? (
                            <div className="mt-2 text-xs text-muted-foreground space-y-1">
                              {result.snippet && <p>{result.snippet}</p>}
                              {result.reason && <p>Reasoning: {result.reason}</p>}
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
                <h3 className="text-lg font-medium text-foreground mb-2">Start Your Simulation</h3>
                <p className="text-sm text-muted-foreground max-w-[250px] mx-auto">
                  Describe your idea and the system will guide you through the configuration
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
          activeTab === 'reasoning' ? (
            <div className="space-y-3">
            {reasoningFeed.length === 0 ? (
              <div className="text-center py-8">
                <Bot className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">
                  Agent reasoning will appear here during simulation
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
                    <span className="text-xs font-mono text-primary">
                      Agent {msg.agentId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      • Iteration {msg.iteration}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 pl-8">{msg.message}</p>
                </div>
              ))
            )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">Language</label>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant={settings.language === 'ar' ? 'default' : 'secondary'}
                    onClick={() => onUpdateSettings({ language: 'ar' })}
                  >
                    عربي
                  </Button>
                  <Button
                    type="button"
                    variant={settings.language === 'en' ? 'default' : 'secondary'}
                    onClick={() => onUpdateSettings({ language: 'en' })}
                  >
                    English
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Theme</label>
                <select
                  className="mt-2 w-full rounded-md bg-secondary border border-border/50 p-2"
                  value={settings.theme}
                  onChange={(e) => onUpdateSettings({ theme: e.target.value })}
                >
                  <option value="ocean">Ocean</option>
                  <option value="sand">Sand</option>
                  <option value="forest">Forest</option>
                  <option value="rose">Rose</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Auto focus input</span>
                <input
                  type="checkbox"
                  checked={settings.autoFocusInput}
                  onChange={(e) => onUpdateSettings({ autoFocusInput: e.target.checked })}
                />
              </div>
            </div>
          )
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border/50 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isWaitingForCountry
                ? "Enter country..."
                : isWaitingForCity
                ? "Enter city..."
                : "Describe your idea..."
            }
            className="flex-1 bg-secondary border-border/50 focus:border-primary/50"
            onBlur={() => {
              if (settings.autoFocusInput) {
                setTimeout(() => inputRef.current?.focus(), 0);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
