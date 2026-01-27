import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage, ReasoningMessage } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface ChatPanelProps {
  messages: ChatMessage[];
  reasoningFeed: ReasoningMessage[];
  onSendMessage: (message: string) => void;
  isWaitingForCity?: boolean;
  isWaitingForCountry?: boolean;
}

export function ChatPanel({
  messages,
  reasoningFeed,
  onSendMessage,
  isWaitingForCity = false,
  isWaitingForCountry = false,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, reasoningFeed, activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    onSendMessage(inputValue);
    setInputValue('');
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="glass-panel h-full flex flex-col">
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
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {activeTab === 'chat' ? (
          <div className="space-y-4">
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
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 border-t border-border/50">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
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
