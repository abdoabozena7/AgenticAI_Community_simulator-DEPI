import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Globe, FileText, CreditCard, MapPin, CheckCircle,
  Loader2, ExternalLink, ChevronRight, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { SearchResponse, SearchStructured } from '@/services/api';

interface ResearchResult {
  search: SearchResponse;
  map?: {
    counts?: Record<string, number>;
    markers?: { lat: number; lon: number; name: string; tag: string }[];
    center?: { lat: number; lon: number };
    tags?: string[];
  };
  structured?: SearchStructured;
  evidence_cards?: string[];
}

interface TimelineStep {
  id: number;
  icon: typeof Search;
  title: string;
  titleAr: string;
  status: 'pending' | 'running' | 'done';
}

interface ResearchTabProps {
  loading: boolean;
  result: ResearchResult | null;
  query?: string;
  onStartSimulation?: () => void;
}

export default function ResearchTab({ loading, result, query, onStartSimulation }: ResearchTabProps) {
  const { isRTL } = useLanguage();
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);

  const stepTemplates = useMemo(() => {
    const q = query || (isRTL ? 'الفكرة' : 'your idea');
    return [
      { id: 1, icon: Search, title: `Searching about "${q}"`, titleAr: `البحث عن "${q}"`, status: 'pending' as const },
      { id: 2, icon: Globe, title: 'Collecting sources', titleAr: 'جمع المصادر', status: 'pending' as const },
      { id: 3, icon: FileText, title: 'Summarizing insights', titleAr: 'تلخيص الرؤى', status: 'pending' as const },
      { id: 4, icon: CreditCard, title: 'Creating evidence cards', titleAr: 'إنشاء بطاقات الأدلة', status: 'pending' as const },
      { id: 5, icon: MapPin, title: 'Map analysis (if location provided)', titleAr: 'تحليل المنطقة (إذا تم تحديد موقع)', status: 'pending' as const },
      { id: 6, icon: CheckCircle, title: 'Research complete', titleAr: 'اكتمل البحث', status: 'pending' as const },
    ];
  }, [query, isRTL]);

  useEffect(() => {
    setSteps(stepTemplates);
    setCurrentStep(0);
  }, [stepTemplates]);

  useEffect(() => {
    if (!loading) {
      if (result) {
        setSteps((prev) => prev.map((step) => ({ ...step, status: 'done' })));
      }
      return;
    }
    if (currentStep >= stepTemplates.length) return;
    const timer1 = window.setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => i === currentStep ? { ...s, status: 'running' } : s));
    }, 300);
    const timer2 = window.setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => i === currentStep ? { ...s, status: 'done' } : s));
      setCurrentStep((prev) => prev + 1);
    }, 1500);
    return () => {
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
    };
  }, [currentStep, loading, stepTemplates.length, result]);

  const structured = result?.structured || result?.search?.structured;
  const evidenceCards = (result?.evidence_cards?.length ? result.evidence_cards : structured?.evidence_cards) || [];
  const sources = result?.search?.results || [];
  const readerItem = sources[0];
  const mapCounts = result?.map?.counts || {};
  const mapEntries = Object.entries(mapCounts);
  const mapCenter = useMemo(() => {
    const center = result?.map?.center;
    if (
      center &&
      typeof center.lat === 'number' &&
      typeof center.lon === 'number' &&
      Number.isFinite(center.lat) &&
      Number.isFinite(center.lon)
    ) {
      return center;
    }
    const marker = (result?.map?.markers || []).find(
      (item) =>
        typeof item?.lat === 'number' &&
        typeof item?.lon === 'number' &&
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lon)
    );
    return marker ? { lat: marker.lat, lon: marker.lon } : null;
  }, [result?.map]);

  const osmEmbedUrl = useMemo(() => {
    if (!mapCenter) {
      // Global fallback so the map card is always functional and not a blank placeholder.
      return 'https://www.openstreetmap.org/export/embed.html?bbox=-180%2C-85%2C180%2C85&layer=mapnik';
    }
    const lat = Math.max(-85, Math.min(85, mapCenter.lat));
    const lon = Math.max(-180, Math.min(180, mapCenter.lon));
    const lonDelta = 0.03;
    const latDelta = 0.02;
    const bbox = `${lon - lonDelta},${lat - latDelta},${lon + lonDelta},${lat + latDelta}`;
    const marker = `${lat},${lon}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
  }, [mapCenter]);

  const osmPageUrl = useMemo(() => {
    if (!mapCenter) return null;
    return `https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lon}#map=14/${mapCenter.lat}/${mapCenter.lon}`;
  }, [mapCenter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isRTL ? 'بحث الوكلاء' : 'Agent Research'}</h1>
          <p className="text-muted-foreground text-sm">{isRTL ? 'تتبع عملية البحث' : 'Track the research process'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="liquid-glass-button">
            <Loader2 className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? (isRTL ? 'جاري...' : 'Processing...') : (isRTL ? 'مكتمل' : 'Complete')}
          </Badge>
          {result && onStartSimulation && (
            <Button onClick={onStartSimulation} size="sm" className="liquid-glass-button">
              <Play className="w-4 h-4 mr-1" />
              {isRTL ? 'ابدأ المحاكاة' : 'Start Simulation'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3 liquid-glass rounded-2xl p-5">
          <h3 className="font-bold mb-4">{isRTL ? 'الجدول الزمني' : 'Timeline'}</h3>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.06 }}
                className={`flex items-start gap-3 p-3 rounded-xl transition-colors ${
                  step.status === 'running' ? 'bg-cyan-500/10 border border-cyan-500/30' :
                  step.status === 'done' ? 'bg-green-500/10' : 'opacity-50'
                }`}
              >
                <div className={`p-1.5 rounded-lg ${step.status === 'running' ? 'bg-cyan-500/20' : step.status === 'done' ? 'bg-green-500/20' : 'bg-secondary'}`}>
                  {step.status === 'running' ? <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" /> :
                   step.status === 'done' ? <CheckCircle className="w-4 h-4 text-green-400" /> :
                   <step.icon className="w-4 h-4 text-muted-foreground" />}
                </div>
                <p className={`text-xs ${step.status === 'done' ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {isRTL ? step.titleAr : step.title}
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 liquid-glass rounded-2xl p-5">
          <div className="flex gap-2 mb-4">
            <Button variant="secondary" size="sm" className="rounded-full text-xs">Page 1</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-xs">Page 2</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-xs">Page 3</Button>
          </div>
          {loading && !result ? (
            <div className="space-y-3"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>
          ) : readerItem ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <h3 className="text-lg font-bold">{readerItem.title || (isRTL ? 'نتائج البحث' : 'Search result')}</h3>
              <a href={readerItem.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 flex items-center gap-1">
                {readerItem.url}<ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {structured?.summary || readerItem.snippet || (isRTL ? 'لا يوجد ملخص بعد.' : 'No summary available yet.')}
              </p>
            </motion.div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isRTL ? 'لا توجد نتائج بعد. ابدأ بحثًا من الصفحة الرئيسية.' : 'No results yet. Start research from the Home tab.'}
            </p>
          )}
        </div>

        <div className="lg:col-span-4 space-y-4">
          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-yellow-400" />{isRTL ? 'الأدلة' : 'Evidence'}</h3>
            <div className="space-y-2">
              {evidenceCards.length ? evidenceCards.map((ev, i) => (
                <motion.div key={`${ev}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 }}
                  className="p-3 rounded-xl bg-secondary/50 border border-border/50">
                  <Badge variant="outline" className="mb-1 text-xs">{`E${i + 1}`}</Badge>
                  <p className="text-xs text-foreground">{ev}</p>
                </motion.div>
              )) : (
                <p className="text-xs text-muted-foreground">
                  {isRTL ? 'لا توجد بطاقات أدلة حتى الآن.' : 'No evidence cards yet.'}
                </p>
              )}
            </div>
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-cyan-400" />{isRTL ? 'المصادر' : 'Sources'}</h3>
            {sources.length ? sources.map((s, i) => (
              <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-cyan-400 transition-colors py-1">
                <ChevronRight className="w-3 h-3" />{s.title || s.url}
              </a>
            )) : (
              <p className="text-xs text-muted-foreground">
                {isRTL ? 'لا توجد مصادر بعد.' : 'No sources yet.'}
              </p>
            )}
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-green-400" />{isRTL ? 'تحليل المنطقة' : 'Area Analysis'}</h3>
            <div className="aspect-video rounded-xl bg-secondary/50 mb-3 overflow-hidden border border-border/50">
              <iframe
                title="OpenStreetMap area analysis"
                src={osmEmbedUrl}
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            {osmPageUrl && (
              <a
                href={osmPageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors inline-flex items-center gap-1 mb-3"
              >
                {isRTL ? 'فتح الخريطة في نافذة جديدة' : 'Open map in new tab'}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {mapEntries.length ? (
              <div className="grid grid-cols-3 gap-2">
                {mapEntries.slice(0, 6).map(([tag, count]) => (
                  <div key={tag} className="text-center p-2 rounded-xl bg-secondary/30">
                    <p className="text-sm font-bold">{count}</p>
                    <p className="text-[10px] text-muted-foreground">{tag}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {mapCenter ? (isRTL ? '�� ��� ������ ��� �������� ����� ����� ��������� �������.' : 'No nearby POI stats were found for the selected tags.') : (isRTL ? '��� ������ ������ ��� �������� �������.' : 'Add a location to see area stats.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


