import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scale, Shield, Gavel, CheckCircle, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, ArrowRight, Loader2, Target, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';

interface CourtResult {
  defense: string[];
  prosecution: string[];
  verdict: 'strong' | 'medium' | 'weak';
  verdictText: string;
  verdictTextAr: string;
  successConditions: string[];
  risks: string[];
  nextSteps: string[];
}

const sampleResult: CourtResult = {
  defense: [
    'High demand in university areas for quick coffee service',
    'Low initial investment compared to full café',
    'Proven business model with fast ROI potential',
    'Flexible location options near high-traffic areas',
    'Growing coffee culture among young demographics',
  ],
  prosecution: [
    'Intense competition from 22 existing cafes in the area',
    'High rent prices may squeeze profit margins',
    'Seasonal fluctuations during university breaks',
    'Limited product differentiation opportunities',
    'Weather dependency for outdoor kiosk operations',
  ],
  verdict: 'medium',
  verdictText: 'The idea is strong but needs clear product differentiation and faster experience than competitors.',
  verdictTextAr: 'الفكرة قوية بس محتاجة تميّز واضح في المنتج وتجربة أسرع من المنافسين.',
  successConditions: [
    'Secure location within 200m of university gate',
    'Maintain service time under 2 minutes',
    'Achieve 60% of sales in morning rush',
    'Keep monthly rent under 12,000 EGP',
  ],
  risks: [
    'University policy changes on vendor permits',
    'New competitors entering the market',
    'Supply chain disruptions for coffee beans',
    'Economic downturn affecting discretionary spending',
  ],
  nextSteps: [
    'Survey potential locations near university gates',
    'Calculate detailed financial projections',
    'Research permit requirements from local authorities',
    'Develop unique menu offerings for differentiation',
    'Create supplier relationships for consistent quality',
    'Design efficient workflow for 2-minute service',
    'Plan soft launch with student feedback program',
  ],
};

export default function IdeaCourtTab() {
  const { isRTL } = useLanguage();
  const [idea, setIdea] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<CourtResult | null>(null);
  const [expandedSections, setExpandedSections] = useState<string[]>(['defense', 'prosecution', 'verdict']);

  const handleSubmit = () => {
    if (!idea.trim()) return;
    setIsProcessing(true);
    setTimeout(() => { setResult(sampleResult); setIsProcessing(false); }, 3000);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]);
  };

  const getVerdictConfig = (verdict: string) => {
    switch (verdict) {
      case 'strong': return { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: isRTL ? 'قوية' : 'Strong' };
      case 'medium': return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: isRTL ? 'متوسطة' : 'Medium' };
      case 'weak': return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: isRTL ? 'ضعيفة' : 'Weak' };
      default: return { icon: Scale, color: 'text-muted-foreground', bg: 'bg-secondary', label: isRTL ? 'غير معروف' : 'Unknown' };
    }
  };

  const SectionCard = ({ id, icon: Icon, iconColor, title, children }: { id: string; icon: typeof Shield; iconColor: string; title: string; children: React.ReactNode }) => (
    <div className="liquid-glass rounded-2xl overflow-hidden">
      <button onClick={() => toggleSection(id)} className="w-full p-5 flex items-center justify-between hover:bg-secondary/30 transition-colors">
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <span className="font-bold text-foreground">{title}</span>
        </div>
        {expandedSections.includes(id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {expandedSections.includes(id) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-5">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">{isRTL ? 'محكمة الأفكار' : 'Idea Court'}</h1>
        <p className="text-muted-foreground text-sm">{isRTL ? 'دع الذكاء الاصطناعي يحلل فكرتك' : 'Let AI analyze your idea from all angles'}</p>
      </div>

      {/* Input */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="liquid-glass rounded-2xl p-6 ai-glow-card">
        <Textarea
          placeholder={isRTL ? 'كشك قهوة سريع جنب جامعة في مدينة نصر...' : 'Quick coffee kiosk near a university...'}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          className="min-h-28 bg-secondary/50 border-border mb-4"
        />
        <Button onClick={handleSubmit} disabled={isProcessing || !idea.trim()} className="w-full liquid-glass-button py-5 text-base ai-glow-button">
          {isProcessing ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />{isRTL ? 'جاري التحليل...' : 'Analyzing...'}</> : <><Gavel className="w-5 h-5 mr-2" />{isRTL ? 'تشغيل محكمة الأفكار' : 'Run Idea Court'}</>}
        </Button>
      </motion.div>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <SectionCard id="defense" icon={Shield} iconColor="text-green-400" title={isRTL ? 'الدفاع' : 'Defense AI'}>
              <ul className="space-y-2">
                {result.defense.map((p, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard id="prosecution" icon={Gavel} iconColor="text-red-400" title={isRTL ? 'الادعاء' : 'Prosecution AI'}>
              <ul className="space-y-2">
                {result.prosecution.map((p, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard id="verdict" icon={Scale} iconColor="text-purple-400" title={isRTL ? 'حكم القاضي' : 'Judge Verdict'}>
              {(() => {
                const config = getVerdictConfig(result.verdict);
                return (
                  <div className={`p-4 rounded-xl ${config.bg} flex items-center gap-4`}>
                    <config.icon className={`w-10 h-10 ${config.color}`} />
                    <div>
                      <Badge className={config.bg}>{config.label}</Badge>
                      <p className="text-foreground mt-2">{isRTL ? result.verdictTextAr : result.verdictText}</p>
                    </div>
                  </div>
                );
              })()}
            </SectionCard>

            <div className="liquid-glass rounded-2xl p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-green-400" />{isRTL ? 'شروط النجاح' : 'Success Conditions'}</h3>
              <ul className="space-y-2">
                {result.successConditions.map((c, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground"><CheckCircle className="w-4 h-4 text-green-400" />{c}</li>
                ))}
              </ul>
            </div>

            <div className="liquid-glass rounded-2xl p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-yellow-400" />{isRTL ? 'المخاطر' : 'Risks'}</h3>
              <ul className="space-y-2">
                {result.risks.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground"><AlertTriangle className="w-4 h-4 text-yellow-400" />{r}</li>
                ))}
              </ul>
            </div>

            <div className="liquid-glass rounded-2xl p-5">
              <h3 className="font-bold mb-3 flex items-center gap-2"><ArrowRight className="w-4 h-4 text-cyan-400" />{isRTL ? 'الخطوات التالية' : 'Next Steps'}</h3>
              <ol className="space-y-2">
                {result.nextSteps.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold shrink-0">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
