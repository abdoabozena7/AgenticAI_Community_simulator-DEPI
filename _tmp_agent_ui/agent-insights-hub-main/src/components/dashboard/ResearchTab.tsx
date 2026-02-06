import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Globe, FileText, CreditCard, MapPin, CheckCircle,
  Loader2, ExternalLink, ArrowRight, Coffee, Building,
  Pill, ChevronRight, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';

interface TimelineStep {
  id: number;
  icon: typeof Search;
  title: string;
  titleAr: string;
  status: 'pending' | 'running' | 'done';
}

const initialSteps: TimelineStep[] = [
  { id: 1, icon: Search, title: 'Searching about "Coffee Kiosk" in "Nasr City"', titleAr: 'البحث عن "كشك قهوة" في "مدينة نصر"', status: 'pending' },
  { id: 2, icon: Globe, title: 'Found 12 websites; opening top 3', titleAr: 'تم إيجاد 12 موقع؛ فتح أفضل 3', status: 'pending' },
  { id: 3, icon: FileText, title: 'Extracting content (Reader View)', titleAr: 'استخراج المحتوى (وضع القراءة)', status: 'pending' },
  { id: 4, icon: CreditCard, title: 'Creating evidence cards', titleAr: 'إنشاء بطاقات الأدلة', status: 'pending' },
  { id: 5, icon: MapPin, title: 'Map analysis (location found)', titleAr: 'تحليل الخريطة (تم إيجاد الموقع)', status: 'pending' },
  { id: 6, icon: CheckCircle, title: 'Research complete → Starting simulation...', titleAr: 'اكتمل البحث ← بدء المحاكاة...', status: 'pending' },
];

const evidenceCards = [
  { id: 'E1', text: 'High foot traffic areas boost conversions', textAr: 'المناطق ذات الحركة العالية تزيد التحويلات' },
  { id: 'E2', text: 'Competitors within 500m increase CAC', textAr: 'المنافسون في نطاق 500م يزيدون تكلفة الاستحواذ' },
  { id: 'E3', text: 'Rent range in area is 8,000-15,000 EGP', textAr: 'نطاق الإيجار في المنطقة 8,000-15,000 جنيه' },
  { id: 'E4', text: 'University presence increases coffee demand', textAr: 'وجود الجامعات يزيد الطلب على القهوة' },
];

const sources = [
  { title: 'Market Analysis Report 2024', url: '#' },
  { title: 'Local Business Directory', url: '#' },
  { title: 'Cairo Real Estate Guide', url: '#' },
];

const readerContent = {
  title: 'Coffee Shop Market Analysis - Nasr City',
  url: 'https://example.com/market-analysis',
  content: `The coffee shop market in Nasr City has seen significant growth over the past 5 years. With a large student population from nearby universities, there is consistent demand for quick-service coffee options.

Key findings indicate that locations within 200 meters of university gates see 40% higher foot traffic. However, competition is fierce with 22 existing cafes in the immediate area.

Rent prices have stabilized around 12,000 EGP monthly for small kiosk-sized spaces. The optimal strategy for new entrants is to focus on speed of service and consistent quality to differentiate from existing competitors.`
};

const mapStats = [
  { icon: Coffee, label: 'Cafes', count: 22, color: 'text-yellow-400' },
  { icon: Building, label: 'Restaurants', count: 15, color: 'text-cyan-400' },
  { icon: Pill, label: 'Pharmacies', count: 9, color: 'text-green-400' },
];

export default function ResearchTab() {
  const { isRTL } = useLanguage();
  const [steps, setSteps] = useState(initialSteps);
  const [currentStep, setCurrentStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (currentStep < steps.length) {
      const timer1 = setTimeout(() => {
        setSteps(prev => prev.map((s, i) => i === currentStep ? { ...s, status: 'running' } : s));
      }, 500);
      const timer2 = setTimeout(() => {
        setSteps(prev => prev.map((s, i) => i === currentStep ? { ...s, status: 'done' } : s));
        setCurrentStep(prev => prev + 1);
      }, 2000 + Math.random() * 1000);
      return () => { clearTimeout(timer1); clearTimeout(timer2); };
    } else {
      setIsComplete(true);
    }
  }, [currentStep, steps.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isRTL ? 'بحث الوكلاء' : 'Agent Research'}</h1>
          <p className="text-muted-foreground text-sm">{isRTL ? 'تتبع عملية البحث' : 'Track the research process'}</p>
        </div>
        <Badge variant="outline" className="liquid-glass-button">
          <Loader2 className={`w-4 h-4 mr-2 ${!isComplete ? 'animate-spin' : ''}`} />
          {isComplete ? (isRTL ? 'مكتمل' : 'Complete') : (isRTL ? 'جاري...' : 'Processing...')}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-3 liquid-glass rounded-2xl p-5">
          <h3 className="font-bold mb-4">{isRTL ? 'الجدول الزمني' : 'Timeline'}</h3>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <motion.div key={step.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.1 }}
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

        {/* Reader View */}
        <div className="lg:col-span-5 liquid-glass rounded-2xl p-5">
          <div className="flex gap-2 mb-4">
            <Button variant="secondary" size="sm" className="rounded-full text-xs">Page 1</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-xs">Page 2</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-xs">Page 3</Button>
          </div>
          {currentStep < 3 ? (
            <div className="space-y-3"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <h3 className="text-lg font-bold">{readerContent.title}</h3>
              <a href={readerContent.url} className="text-xs text-cyan-400 flex items-center gap-1">{readerContent.url}<ExternalLink className="w-3 h-3" /></a>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{readerContent.content}</p>
            </motion.div>
          )}
        </div>

        {/* Evidence + Map */}
        <div className="lg:col-span-4 space-y-4">
          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-yellow-400" />{isRTL ? 'الأدلة' : 'Evidence'}</h3>
            <div className="space-y-2">
              {evidenceCards.map((ev, i) => (
                <motion.div key={ev.id} initial={{ opacity: 0 }} animate={{ opacity: currentStep >= 4 ? 1 : 0.3 }} transition={{ delay: i * 0.1 }}
                  className="p-3 rounded-xl bg-secondary/50 border border-border/50">
                  <Badge variant="outline" className="mb-1 text-xs">{ev.id}</Badge>
                  <p className="text-xs text-foreground">{isRTL ? ev.textAr : ev.text}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Globe className="w-4 h-4 text-cyan-400" />{isRTL ? 'المصادر' : 'Sources'}</h3>
            {sources.map((s, i) => (
              <a key={i} href={s.url} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-cyan-400 transition-colors py-1">
                <ChevronRight className="w-3 h-3" />{s.title}
              </a>
            ))}
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-green-400" />{isRTL ? 'تحليل المنطقة' : 'Area Analysis'}</h3>
            <div className="aspect-video rounded-xl bg-secondary/50 mb-3 flex items-center justify-center">
              <span className="text-muted-foreground text-xs">OpenStreetMap</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mapStats.map(s => (
                <div key={s.label} className="text-center p-2 rounded-xl bg-secondary/30">
                  <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
                  <p className="text-sm font-bold">{s.count}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
