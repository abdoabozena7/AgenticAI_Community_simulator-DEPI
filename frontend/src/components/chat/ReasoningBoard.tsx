import { MessageSquareQuote, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReasoningMessage } from '@/types/simulation';

interface ReasoningBoardProps {
  language: 'ar' | 'en';
  messages: ReasoningMessage[];
  highlightIds?: string[];
  emptyHint?: string;
}

const formatTime = (timestamp?: number, language?: 'ar' | 'en') => {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

const buildAgentSides = (messages: ReasoningMessage[]) => {
  const sideByAgent = new Map<string, 'left' | 'right'>();
  let nextSide: 'left' | 'right' = 'right';

  for (const item of messages) {
    if (!sideByAgent.has(item.agentId)) {
      sideByAgent.set(item.agentId, nextSide);
      nextSide = nextSide === 'right' ? 'left' : 'right';
    }
  }

  return sideByAgent;
};

export function ReasoningBoard({
  language,
  messages,
  highlightIds = [],
  emptyHint,
}: ReasoningBoardProps) {
  const sideByAgent = buildAgentSides(messages);
  const highlighted = new Set(highlightIds);
  const sortedMessages = [...messages].sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));

  if (!sortedMessages.length) {
    return (
      <div className="rounded-[28px] border border-dashed border-border/60 bg-card/55 px-5 py-8 text-center text-sm text-muted-foreground">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/70">
          <MessageSquareQuote className="h-5 w-5" />
        </div>
        {emptyHint || (language === 'ar' ? 'عندما يبدأ النقاش ستظهر رسائل الوكلاء هنا.' : 'Agent discussion will appear here once debate starts.')}
      </div>
    );
  }

  return (
    <section className="rounded-[28px] border border-border/60 bg-card/75 p-4 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{language === 'ar' ? 'نقاش الوكلاء' : 'Agent discussion'}</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-foreground">
            {language === 'ar' ? 'الوكلاء بدأوا يتناقشون الآن' : 'The agents are debating now'}
          </h3>
        </div>
        <div className="rounded-2xl border border-border/55 bg-background/55 px-3 py-2 text-sm text-muted-foreground">
          {language === 'ar' ? `${sortedMessages.length} رسالة` : `${sortedMessages.length} messages`}
        </div>
      </div>

      <div className="space-y-3">
        {sortedMessages.map((message) => {
          const side = sideByAgent.get(message.agentId) || 'right';
          const label = message.agentLabel || message.agentShortId || message.agentId;
          const isHighlighted = highlighted.has(message.id);

          return (
            <div
              key={message.id}
              className={cn(
                'flex w-full',
                side === 'right' ? 'justify-end' : 'justify-start',
              )}
            >
              <article
                className={cn(
                  'max-w-[88%] rounded-[24px] border px-4 py-3 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.55)] md:max-w-[72%]',
                  side === 'right'
                    ? 'border-primary/25 bg-primary/10'
                    : 'border-border/60 bg-background/65',
                  isHighlighted && 'ring-2 ring-primary/50',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {message.archetype || (language === 'ar' ? 'وكيل' : 'Agent')}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatTime(message.timestamp, language)}
                  </div>
                </div>

                {message.replyToAgentId || message.replyToShortId ? (
                  <div className="mb-2 rounded-2xl border border-border/50 bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
                    {language === 'ar'
                      ? `يرد على ${message.replyToShortId || message.replyToAgentId}`
                      : `Replying to ${message.replyToShortId || message.replyToAgentId}`}
                  </div>
                ) : null}

                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/92">
                  {message.message}
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {message.phase ? (
                    <span className="rounded-full border border-border/55 bg-card/60 px-2.5 py-1">
                      {language === 'ar' ? `المرحلة: ${message.phase}` : `Phase: ${message.phase}`}
                    </span>
                  ) : null}
                  {message.stanceAfter ? (
                    <span className="rounded-full border border-border/55 bg-card/60 px-2.5 py-1">
                      {language === 'ar' ? `الموقف: ${message.stanceAfter}` : `Stance: ${message.stanceAfter}`}
                    </span>
                  ) : null}
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
