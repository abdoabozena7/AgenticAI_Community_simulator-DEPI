import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Zap, MapPin, Tag, ArrowRight, CheckCircle, XCircle, Search, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLanguage } from '@/contexts/LanguageContext';

const categories = [
  { value: 'default', label: 'Default', labelAr: 'افتراضي' },
  { value: 'food', label: 'Food', labelAr: 'طعام' },
  { value: 'retail', label: 'Retail', labelAr: 'تجزئة' },
  { value: 'education', label: 'Education', labelAr: 'تعليم' },
  { value: 'healthcare', label: 'Healthcare', labelAr: 'صحة' },
  { value: 'services', label: 'Services', labelAr: 'خدمات' },
  { value: 'tech', label: 'Tech', labelAr: 'تقنية' },
];

interface HomeTabProps {
  onStartResearch: () => void;
}

export default function HomeTab({ onStartResearch }: HomeTabProps) {
  const { isRTL } = useLanguage();
  const [idea, setIdea] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('default');
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleStartResearch = () => {
    if (idea.trim()) onStartResearch();
  };

  const handleRedeemPromo = () => {
    setPromoStatus(promoCode.toUpperCase() === 'WELCOME2024' ? 'success' : 'error');
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Prompt Area - Main Input */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="liquid-glass rounded-2xl p-8 ai-glow-card"
      >
        <h2 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 ai-glow-subtle">
            <Sparkles className="w-6 h-6 text-cyan-400" />
          </div>
          {isRTL ? 'ابدأ بحث جديد' : 'Start New Research'}
        </h2>
        <p className="text-muted-foreground mb-6">
          {isRTL ? 'وصف فكرتك وخلّي الذكاء الاصطناعي يساعدك' : 'Describe your idea and let AI help you validate it'}
        </p>

        <div className="space-y-5">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {isRTL ? 'الفكرة' : 'Your Idea'}
            </label>
            <Textarea
              placeholder={isRTL ? 'مثال: كشك قهوة سريع جنب جامعة في مدينة نصر' : 'Example: Quick coffee kiosk near a university'}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              className="bg-secondary/50 border-border min-h-[100px] text-base"
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {isRTL ? 'المكان / المنطقة (اختياري)' : 'Place / Area (optional)'}
            </label>
            <div className="relative">
              <MapPin className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground`} />
              <Input
                placeholder={isRTL ? 'مثال: مدينة نصر، القاهرة' : 'Example: Nasr City, Cairo'}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary/50 border-border`}
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              {isRTL ? 'التصنيف' : 'Category'}
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
            onClick={handleStartResearch}
            disabled={!idea.trim()}
            className="w-full liquid-glass-button py-6 text-lg rgb-shadow-hover ai-glow-button"
          >
            <Zap className="w-5 h-5 mr-2" />
            {isRTL ? 'ابدأ البحث' : 'Start Agent Research'}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </motion.div>

      {/* Promo Code */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="liquid-glass rounded-2xl p-6"
      >
        <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary" />
          {isRTL ? 'كود خصم' : 'Promo Code'}
        </h3>
        <div className="flex gap-3">
          <Input
            placeholder={isRTL ? 'ادخل كود الخصم' : 'Enter promo code'}
            value={promoCode}
            onChange={(e) => { setPromoCode(e.target.value); setPromoStatus('idle'); }}
            className="flex-1 bg-secondary/50 border-border"
          />
          <Button onClick={handleRedeemPromo} variant="secondary">
            {isRTL ? 'استرداد' : 'Redeem'}
          </Button>
        </div>
        {promoStatus === 'success' && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span>{isRTL ? '✅ تم إضافة +3 محاولات' : '✅ Added +3 attempts'}</span>
          </motion.div>
        )}
        {promoStatus === 'error' && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-2 text-destructive">
            <XCircle className="w-4 h-4" />
            <span>{isRTL ? '❌ كود غير صحيح' : '❌ Invalid code'}</span>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
