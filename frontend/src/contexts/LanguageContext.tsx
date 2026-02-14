import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    'nav.features': 'Features',
    'nav.howItWorks': 'How it Works',
    'nav.pricing': 'Pricing',
    'nav.signIn': 'Sign In',
    'nav.startFree': 'Start Free',

    'hero.title1': 'Test Your Idea',
    'hero.title2': 'Before You Build',
    'hero.subtitle':
      'Got an idea in your head? We help you validate it before spending time and money.',
    'hero.cta': 'Start Free Trial',
    'hero.watchDemo': 'Watch Demo',
    'hero.stat1': '24+ AI Agents',
    'hero.stat1Label': 'Virtual Society',
    'hero.stat2': '87%',
    'hero.stat2Label': 'Accuracy Rate',
    'hero.stat3': '< 5min',
    'hero.stat3Label': 'Results Time',

    'problem.tag': 'The Problem',
    'problem.title': 'Why Most Ideas Fail',
    'problem.desc':
      'Generic chatbot replies are not real validation. You need diverse, realistic perspectives.',
    'problem.point1': 'No real market feedback',
    'problem.point1Desc':
      'People often hear what they want, not what the market will actually do.',
    'problem.point2': 'Fear of embarrassment',
    'problem.point2Desc':
      'Testing in public can be risky before the idea is mature.',
    'problem.point3': 'No diverse perspectives',
    'problem.point3Desc':
      'You need skeptics, optimists, and pragmatists, not one voice.',

    'solution.tag': 'The Solution',
    'solution.title': 'Meet ASSET',
    'solution.subtitle': 'AI Social Simulation & Evolution Tool',
    'solution.desc':
      'Test ideas in a virtual environment first, then iterate safely.',

    'sim.tag': 'How it works',
    'sim.title': 'Watch AI Agents Test Your Idea',
    'sim.desc':
      'A virtual society of AI agents with different backgrounds and personalities.',
    'sim.live': 'Live Simulation',
    'sim.agents': 'agents',
    'sim.feature1': 'Real Personalities',
    'sim.feature1Desc': 'Different roles and mindsets for balanced evaluation.',
    'sim.feature2': 'Psychological Traits',
    'sim.feature2Desc': 'Different optimism, skepticism, and risk tolerance.',
    'sim.feature3': 'Live Debates',
    'sim.feature3Desc': 'Agents discuss and influence each other in real time.',
    'sim.feature4': 'Real Data Grounding',
    'sim.feature4Desc': 'Web-grounded context when available.',

    'features.tag': 'Features',
    'features.title': 'Everything You Need',
    'features.desc': 'Powerful tools to validate your ideas with confidence.',
    'features.f1': 'Instant Results',
    'features.f1Desc': 'Fast feedback loop.',
    'features.f2': 'Acceptance Rate',
    'features.f2Desc': 'See likely audience response.',
    'features.f3': 'Polarization Index',
    'features.f3Desc': 'Measure disagreement and alignment.',
    'features.f4': 'Deep Analysis',
    'features.f4Desc': 'Strengths, risks, and suggestions.',
    'features.f5': 'Global Markets',
    'features.f5Desc': 'Explore different regions and contexts.',
    'features.f6': 'Real-Time Thinking',
    'features.f6Desc': 'Track opinion shifts over time.',

    'pricing.tag': 'Pricing',
    'pricing.title': 'Start Free Today',
    'pricing.desc': 'Try it free first.',
    'pricing.trial': 'Free Trial',
    'pricing.trialTitle': '7-Day Trial',
    'pricing.price': '$0',
    'pricing.per': '/week',
    'pricing.includes': '3 simulations daily • Full access',
    'pricing.f1': '3 simulations per day',
    'pricing.f2': '24 AI agents per simulation',
    'pricing.f3': 'Real-time analytics',
    'pricing.f4': 'Market insights',
    'pricing.f5': 'Email support',
    'pricing.f6': 'No credit card required',
    'pricing.cta': 'Start Free Trial',
    'pricing.noCard': 'No payment info required to start',

    'cta.title': 'Ready to Validate Your Idea?',
    'cta.desc': 'Iterate in a safe virtual environment before launch.',
    'cta.button': 'Try ASSET Free',

    'footer.rights': '© 2024 ASSET. All rights reserved.',
    'footer.privacy': 'Privacy Policy',
    'footer.terms': 'Terms of Service',
  },
  ar: {
    'nav.features': 'المميزات',
    'nav.howItWorks': 'كيف يعمل',
    'nav.pricing': 'الأسعار',
    'nav.signIn': 'تسجيل الدخول',
    'nav.startFree': 'ابدأ مجانًا',

    'hero.title1': 'جرّب فكرتك',
    'hero.title2': 'قبل ما تبنيها',
    'hero.subtitle':
      'عندك فكرة في دماغك؟ ASSET يساعدك تختبرها قبل ما تصرف وقت وفلوس.',
    'hero.cta': 'ابدأ تجربة مجانية',
    'hero.watchDemo': 'شاهد العرض',
    'hero.stat1': '+24 وكيل ذكي',
    'hero.stat1Label': 'مجتمع افتراضي',
    'hero.stat2': '87%',
    'hero.stat2Label': 'دقة النتائج',
    'hero.stat3': '< 5 دقائق',
    'hero.stat3Label': 'وقت النتائج',

    'problem.tag': 'المشكلة',
    'problem.title': 'ليه أغلب الأفكار بتفشل',
    'problem.desc':
      'الردود العامة من أدوات الدردشة مش تقييم حقيقي. أنت محتاج آراء متنوعة وواقعية.',
    'problem.point1': 'مفيش رد فعل سوق حقيقي',
    'problem.point1Desc': 'غالبًا بتسمع اللي عاوز تسمعه، مش اللي السوق هيعمله فعلًا.',
    'problem.point2': 'الخوف من الإحراج',
    'problem.point2Desc': 'اختبار الفكرة على ناس حقيقيين بدري ممكن يكون مكلف.',
    'problem.point3': 'غياب التنوع في الآراء',
    'problem.point3Desc': 'لازم متشكك ومتفائل وعملي، مش صوت واحد.',

    'solution.tag': 'الحل',
    'solution.title': 'تعرّف على ASSET',
    'solution.subtitle': 'أداة محاكاة اجتماعية بالذكاء الاصطناعي',
    'solution.desc': 'اختبر الفكرة افتراضيًا أولًا، ثم طوّرها بثقة.',

    'sim.tag': 'كيف يعمل',
    'sim.title': 'شاهد الوكلاء وهم يختبرون فكرتك',
    'sim.desc': 'مجتمع افتراضي من وكلاء بسمات وخلفيات مختلفة.',
    'sim.live': 'محاكاة مباشرة',
    'sim.agents': 'وكيل',
    'sim.feature1': 'شخصيات مختلفة',
    'sim.feature1Desc': 'أدوار وعقليات متنوعة لتقييم متوازن.',
    'sim.feature2': 'سمات نفسية',
    'sim.feature2Desc': 'درجات مختلفة من التفاؤل والشك وتحمّل المخاطر.',
    'sim.feature3': 'نقاشات حية',
    'sim.feature3Desc': 'الوكلاء يناقشون ويؤثرون على بعضهم مباشرة.',
    'sim.feature4': 'اعتماد على بيانات حقيقية',
    'sim.feature4Desc': 'ربط بحث ويب عند توفر مصادر مناسبة.',

    'features.tag': 'المميزات',
    'features.title': 'كل اللي تحتاجه',
    'features.desc': 'أدوات قوية للتحقق من فكرتك بثقة.',
    'features.f1': 'نتائج سريعة',
    'features.f1Desc': 'حلقة تقييم سريعة وواضحة.',
    'features.f2': 'نسبة القبول',
    'features.f2Desc': 'اعرف رد فعل الجمهور المتوقع.',
    'features.f3': 'مؤشر الاستقطاب',
    'features.f3Desc': 'قياس الاختلاف والاتفاق حول الفكرة.',
    'features.f4': 'تحليل عميق',
    'features.f4Desc': 'نقاط قوة ومخاطر واقتراحات.',
    'features.f5': 'أسواق متعددة',
    'features.f5Desc': 'اختبر عبر مناطق وسياقات مختلفة.',
    'features.f6': 'تفكير لحظي',
    'features.f6Desc': 'تابع تغيّر الآراء مع الوقت.',

    'pricing.tag': 'الأسعار',
    'pricing.title': 'ابدأ مجانًا اليوم',
    'pricing.desc': 'جرّب أولًا بدون تعقيد.',
    'pricing.trial': 'تجربة مجانية',
    'pricing.trialTitle': 'تجربة 7 أيام',
    'pricing.price': '$0',
    'pricing.per': '/أسبوع',
    'pricing.includes': '3 محاكاة يوميًا • وصول كامل',
    'pricing.f1': '3 محاكاة يوميًا',
    'pricing.f2': '24 وكيلًا لكل محاكاة',
    'pricing.f3': 'تحليلات لحظية',
    'pricing.f4': 'رؤى سوق',
    'pricing.f5': 'دعم عبر البريد',
    'pricing.f6': 'بدون بطاقة ائتمان',
    'pricing.cta': 'ابدأ التجربة المجانية',
    'pricing.noCard': 'لا يلزم إدخال بيانات دفع للبدء',

    'cta.title': 'جاهز تختبر فكرتك؟',
    'cta.desc': 'طوّر الفكرة داخل بيئة افتراضية قبل الإطلاق.',
    'cta.button': 'جرّب ASSET مجانًا',

    'footer.rights': '© 2024 ASSET. جميع الحقوق محفوظة.',
    'footer.privacy': 'سياسة الخصوصية',
    'footer.terms': 'شروط الخدمة',
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const looksMojibake = (value: string): boolean => {
  const text = String(value || '');
  if (!text) return false;
  if (/[ÃÂØÙ]/.test(text)) return true;
  if (/ط[^\u0600-\u06FF\s]|ظ[^\u0600-\u06FF\s]/.test(text)) return true;
  return false;
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    try {
      const saved = window.localStorage.getItem('appSettings');
      if (!saved) return 'en';
      const parsed = JSON.parse(saved);
      return parsed?.language === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });

  const t = (key: string): string => {
    const localized = translations[language][key];
    if (typeof localized === 'string') {
      if (language === 'ar' && looksMojibake(localized)) {
        return translations.en[key] || key;
      }
      return localized;
    }
    return translations.en[key] || key;
  };

  const isRTL = language === 'ar';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.setAttribute('lang', language);
    html.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
    html.classList.toggle('rtl', isRTL);
    html.classList.toggle('lang-ar', isRTL);
    document.body.classList.toggle('font-arabic', isRTL);

    try {
      const saved = window.localStorage.getItem('appSettings');
      const parsed = saved ? JSON.parse(saved) : {};
      window.localStorage.setItem('appSettings', JSON.stringify({ ...parsed, language }));
    } catch {
      // ignore
    }
  }, [language, isRTL]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
