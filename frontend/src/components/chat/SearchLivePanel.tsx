import { ExternalLink, FileSearch, Globe2, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface SearchLivePanelProps {
  language: 'ar' | 'en';
  searchState?: {
    status: 'idle' | 'searching' | 'timeout' | 'error' | 'complete';
  };
  events: SearchLiveEvent[];
}

const ACTION_LABELS: Record<string, { ar: string; en: string; progress: number }> = {
  research_started: { ar: 'جاري البحث...', en: 'Searching...', progress: 10 },
  search_results_found: { ar: 'تم العثور على النتائج', en: 'Found results...', progress: 28 },
  page_opened: { ar: 'فتح الصفحة', en: 'Opening page...', progress: 52 },
  page_opening: { ar: 'فتح الصفحة', en: 'Opening page...', progress: 52 },
  page_scraped: { ar: 'استخراج البيانات', en: 'Extracting data...', progress: 78 },
  evidence_extracted: { ar: 'بناء الأدلة', en: 'Building evidence...', progress: 88 },
  research_completed: { ar: 'اكتمل البحث', en: 'Search completed', progress: 100 },
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

const normalizeEvent = (event: SearchLiveEvent) => {
  const actionKey = String(event.action || '').trim().toLowerCase();
  const mapping = ACTION_LABELS[actionKey] || ACTION_LABELS.page_scraped;
  const domain = event.domain || toHost(event.url);
  const title = event.title || domain || event.url || actionKey;
  const progress = typeof event.progressPct === 'number'
    ? Math.max(0, Math.min(100, Math.round(event.progressPct)))
    : mapping.progress;

  return {
    actionKey,
    labelAr: mapping.ar,
    labelEn: mapping.en,
    domain,
    title,
    progress,
  };
};

export function SearchLivePanel({ language, searchState, events }: SearchLivePanelProps) {
  const orderedEvents = [...events]
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))
    .slice(-8);

  const latestEvent = orderedEvents.at(-1);
  const latestMeta = latestEvent ? normalizeEvent(latestEvent) : null;
  const title = language === 'ar' ? 'البحث المباشر' : 'Live search';
  const subtitle = latestMeta
    ? (language === 'ar' ? latestMeta.labelAr : latestMeta.labelEn)
    : (language === 'ar' ? 'نجهز مصادر حقيقية من الإنترنت' : 'Gathering real internet sources');
  const isBusy = searchState?.status === 'searching';

  return (
    <section className="rounded-[28px] border border-border/60 bg-card/75 p-4 shadow-[0_20px_60px_-34px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-xs font-semibold text-primary">
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="h-3.5 w-3.5" />}
            <span>{title}</span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{subtitle}</h3>
            <p className="text-sm text-muted-foreground">
              {language === 'ar'
                ? 'يمكنك متابعة الصفحات التي يفتحها النظام خطوة بخطوة.'
                : 'Watch each source as it is opened and processed.'}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/55 px-3 py-2 text-start">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {language === 'ar' ? 'الحالة' : 'Status'}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {searchState?.status === 'timeout'
              ? (language === 'ar' ? 'انتهت مهلة البحث' : 'Search timed out')
              : searchState?.status === 'error'
              ? (language === 'ar' ? 'تعذر المتابعة' : 'Search failed')
              : searchState?.status === 'complete'
              ? (language === 'ar' ? 'اكتملت الجولة' : 'Run complete')
              : (language === 'ar' ? 'يعمل الآن' : 'Running now')}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {orderedEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 px-4 py-5 text-sm text-muted-foreground">
            {language === 'ar'
              ? 'بمجرد بدء البحث ستظهر هنا المواقع التي يتم فتحها وتلخيصها.'
              : 'Once search starts, opened pages and extraction progress will appear here.'}
          </div>
        ) : (
          orderedEvents.map((event, index) => {
            const meta = normalizeEvent(event);
            const favicon = event.faviconUrl || (meta.domain ? FALLBACK_FAVICON(meta.domain) : '');
            const preview = event.snippet || event.error || '';

            return (
              <article
                key={`${event.eventSeq || index}-${event.url || meta.title}`}
                className={cn(
                  'rounded-2xl border border-border/55 bg-background/55 p-3 transition-colors',
                  index === orderedEvents.length - 1 && 'border-primary/30 bg-primary/5',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-2xl border border-border/50 bg-card">
                    {favicon ? (
                      <img
                        src={favicon}
                        alt={meta.domain || meta.title}
                        className="h-5 w-5 object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <FileSearch className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{meta.title}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
                          <span className="truncate">{event.url || meta.domain}</span>
                          {event.url ? <ExternalLink className="h-3 w-3 flex-none" /> : null}
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        <span>{language === 'ar' ? meta.labelAr : meta.labelEn}</span>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{language === 'ar' ? 'تقدم المعالجة' : 'Scraping progress'}</span>
                        <span>{meta.progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary/70">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${meta.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="rounded-xl border border-border/45 bg-card/45 px-3 py-2 leading-6 text-foreground/85">
                        {preview || (language === 'ar' ? 'سيظهر الملخص هنا بعد الاستخراج.' : 'Summary preview will appear here once extracted.')}
                      </div>
                      <div className="flex flex-col items-start gap-1 rounded-xl border border-border/45 bg-card/45 px-3 py-2 text-[11px]">
                        {typeof event.httpStatus === 'number' ? (
                          <span>{language === 'ar' ? `HTTP: ${event.httpStatus}` : `HTTP: ${event.httpStatus}`}</span>
                        ) : null}
                        {typeof event.contentChars === 'number' ? (
                          <span>{language === 'ar' ? `${event.contentChars} حرف` : `${event.contentChars} chars`}</span>
                        ) : null}
                        {typeof event.relevanceScore === 'number' ? (
                          <span>{language === 'ar' ? `صلة ${Math.round(event.relevanceScore * 100)}%` : `Relevance ${Math.round(event.relevanceScore * 100)}%`}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
