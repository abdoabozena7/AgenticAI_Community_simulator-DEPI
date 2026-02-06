import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, MapPin, Tag, ArrowRight, CheckCircle, XCircle, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLanguage } from '@/contexts/LanguageContext';

const categories = [
  { value: 'technology', label: 'Technology', labelAr: 'تقنية' },
  { value: 'healthcare', label: 'Healthcare', labelAr: 'صحة' },
  { value: 'finance', label: 'Finance', labelAr: 'مالية' },
  { value: 'education', label: 'Education', labelAr: 'تعليم' },
  { value: 'e-commerce', label: 'E-commerce', labelAr: 'تجارة إلكترونية' },
  { value: 'entertainment', label: 'Entertainment', labelAr: 'ترفيه' },
  { value: 'social', label: 'Social', labelAr: 'اجتماعي' },
  { value: 'b2b saas', label: 'B2B SaaS', labelAr: 'برمجيات أعمال' },
  { value: 'consumer apps', label: 'Consumer Apps', labelAr: 'تطبيقات مستهلكين' },
  { value: 'hardware', label: 'Hardware', labelAr: 'أجهزة' },
];

interface HomeTabProps {
  onStartResearch: (payload: { idea: string; location?: string; category?: string }) => void;
  onStartSimulation: (idea: string) => void;
  onRedeemPromo: (code: string) => Promise<string>;
  researchBusy?: boolean;
}

export default function HomeTab({ onStartResearch, onStartSimulation, onRedeemPromo, researchBusy }: HomeTabProps) {
  const { language, isRTL } = useLanguage();
  const [idea, setIdea] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem('dashboardIdea') || '';
    } catch {
      return '';
    }
  });
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('technology');
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const t = (en: string, ar: string) => (language === 'ar' ? ar : en);

  useEffect(() => {
    try {
      if (idea.trim()) {
        window.localStorage.setItem('dashboardIdea', idea.trim());
      } else {
        window.localStorage.removeItem('dashboardIdea');
      }
    } catch {
      // ignore
    }
  }, [idea]);

  const handleStartResearch = () => {
    if (!idea.trim()) return;
    onStartResearch({
      idea: idea.trim(),
      location: location.trim() || undefined,
      category: category || undefined,
    });
  };

  const handleStartSimulation = () => {
    if (!idea.trim()) return;
    onStartSimulation(idea.trim());
  };

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoStatus('idle');
    setPromoMessage(null);
    try {
      const message = await onRedeemPromo(promoCode.trim());
      setPromoStatus('success');
      setPromoMessage(message);
      setPromoCode('');
    } catch (err: any) {
      setPromoStatus('error');
      setPromoMessage(err?.message || t('Failed to redeem code.', 'فشل استرداد الكود.'));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="liquid-glass rounded-2xl p-8 ai-glow-card"
      >
        <h2 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 ai-glow-subtle">
            <Play className="w-6 h-6 text-cyan-400" />
          </div>
          {t('Start New Simulation', 'ابدأ محاكاة جديدة')}
        </h2>
        <p className="text-muted-foreground mb-6">
          {t('Describe your idea and start simulation immediately', 'اكتب فكرتك وابدأ المحاكاة فورًا')}
        </p>

        <div className="space-y-5">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {t('Your Idea', 'الفكرة')}
            </label>
            <Textarea
              placeholder={t('Example: Quick coffee kiosk near a university', 'مثال: كشك قهوة سريع جنب جامعة في مدينة نصر')}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="bg-secondary/50 border-border min-h-[100px] text-base"
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {t('Place / Area (optional)', 'المكان / المنطقة (اختياري)')}
            </label>
            <div className="relative">
              <MapPin className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground`} />
              <Input
                placeholder={t('Example: Nasr City, Cairo', 'مثال: مدينة نصر، القاهرة')}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary/50 border-border`}
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {t('Category', 'التصنيف')}
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="bg-secondary/50 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {isRTL ? cat.labelAr : cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleStartSimulation}
            disabled={!idea.trim()}
            className="w-full liquid-glass-button py-6 text-lg rgb-shadow-hover ai-glow-button"
          >
            <Play className="w-5 h-5 mr-2" />
            {t('Start Simulation', 'ابدأ المحاكاة')}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>

          <Button
            onClick={handleStartResearch}
            disabled={!idea.trim() || researchBusy}
            variant="secondary"
            className="w-full py-6 text-lg"
          >
            <Zap className="w-5 h-5 mr-2" />
            {researchBusy ? t('Researching...', 'جارٍ البحث...') : t('Start Agent Research', 'ابدأ بحث الوكلاء')}
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="liquid-glass rounded-2xl p-6"
      >
        <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary" />
          {t('Promo Code', 'كود خصم')}
        </h3>
        <div className="flex gap-3">
          <Input
            placeholder={t('Enter promo code', 'ادخل كود الخصم')}
            value={promoCode}
            onChange={(e) => { setPromoCode(e.target.value); setPromoStatus('idle'); setPromoMessage(null); }}
            className="flex-1 bg-secondary/50 border-border"
          />
          <Button onClick={handleRedeemPromo} variant="secondary">
            {t('Redeem', 'استرداد')}
          </Button>
        </div>
        {promoStatus === 'success' && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span>{promoMessage || t('Promo redeemed successfully.', 'تم استرداد الكود بنجاح.')}</span>
          </motion.div>
        )}
        {promoStatus === 'error' && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-2 text-destructive">
            <XCircle className="w-4 h-4" />
            <span>{promoMessage || t('Invalid code', 'كود غير صحيح')}</span>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
