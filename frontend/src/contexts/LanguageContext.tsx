import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations = {
  en: {
    // Navbar
    'nav.features': 'Features',
    'nav.howItWorks': 'How it Works',
    'nav.pricing': 'Pricing',
    'nav.signIn': 'Sign In',
    'nav.startFree': 'Start Free',

    // Hero
    'hero.title1': 'Test Your Idea',
    'hero.title2': 'Before You Build',
    'hero.subtitle': 'Got an idea stuck in your head? Not sure if it\'s brilliant or just wishful thinking? There\'s a huge difference between an idea being "cool" in your imagination and being realistic, executable, and actually wanted by people.',
    'hero.cta': 'Start Free Trial',
    'hero.watchDemo': 'Watch Demo',
    'hero.stat1': '24+ AI Agents',
    'hero.stat1Label': 'Virtual Society',
    'hero.stat2': '87%',
    'hero.stat2Label': 'Accuracy Rate',
    'hero.stat3': '< 5min',
    'hero.stat3Label': 'Results Time',

    // Problem Section
    'problem.tag': 'The Problem',
    'problem.title': 'Why Most Ideas Fail',
    'problem.desc': 'You ask ChatGPT "what do you think?" and get a diplomatic, safe answer. That\'s not real validation.',
    'problem.point1': 'No real market feedback',
    'problem.point1Desc': 'AI chatbots give you what you want to hear, not what the market thinks',
    'problem.point2': 'Fear of embarrassment',
    'problem.point2Desc': 'Testing ideas on real people means risking rejection and judgment',
    'problem.point3': 'No diverse perspectives',
    'problem.point3Desc': 'You need skeptics, optimists, risk-takers, and pragmatists to evaluate',

    // Solution Section
    'solution.tag': 'The Solution',
    'solution.title': 'Meet ASSET',
    'solution.subtitle': 'AI Social Simulation & Evolution Tool',
    'solution.desc': 'What if you could test your idea on real people... without actually testing it on people? No embarrassment, no risk, just pure insights.',

    // Simulation
    'sim.tag': 'How it works',
    'sim.title': 'Watch AI Agents Test Your Idea',
    'sim.desc': 'We built a virtual society of 24 AI agents, each with unique personalities, professional backgrounds, and psychological traits.',
    'sim.live': 'Live Simulation',
    'sim.agents': 'agents',
    'sim.feature1': 'Real Personalities',
    'sim.feature1Desc': 'Skeptical developers, practical entrepreneurs, stability-seeking employees, cautious professionals',
    'sim.feature2': 'Psychological Traits',
    'sim.feature2Desc': 'Each agent has different levels of optimism, skepticism, and risk tolerance',
    'sim.feature3': 'Live Debates',
    'sim.feature3Desc': 'Agents discuss, persuade each other, with opinion leaders influencing the group',
    'sim.feature4': 'Real Data Grounding',
    'sim.feature4Desc': 'Connected to web search analyzing real market conditions, competitors, and regulations',

    // Features
    'features.tag': 'Features',
    'features.title': 'Everything You Need',
    'features.desc': 'Powerful tools to validate your ideas with confidence',
    'features.f1': 'Instant Results',
    'features.f1Desc': 'Get comprehensive market feedback in under 5 minutes',
    'features.f2': 'Acceptance Rate',
    'features.f2Desc': 'See how different demographics respond to your idea',
    'features.f3': 'Polarization Index',
    'features.f3Desc': 'Measure how divided or unified opinions are about your concept',
    'features.f4': 'Deep Analysis',
    'features.f4Desc': 'Strengths, weaknesses, risks, and improvement suggestions',
    'features.f5': 'Global Markets',
    'features.f5Desc': 'Test ideas across different regions and cultures',
    'features.f6': 'Real-Time Thinking',
    'features.f6Desc': 'Watch agents change their minds as they debate',

    // Pricing
    'pricing.tag': 'Pricing',
    'pricing.title': 'Start Free Today',
    'pricing.desc': 'Try everything free for 7 days. No strings attached.',
    'pricing.trial': 'Free Trial',
    'pricing.trialTitle': '7-Day Trial',
    'pricing.price': '$0',
    'pricing.per': '/week',
    'pricing.includes': '3 simulations daily • Full access',
    'pricing.f1': '3 simulations per day',
    'pricing.f2': '24 AI agents per simulation',
    'pricing.f3': 'Real-time analytics',
    'pricing.f4': 'Full market insights',
    'pricing.f5': 'Email support',
    'pricing.f6': 'No credit card required',
    'pricing.cta': 'Start Free Trial',
    'pricing.noCard': 'No payment info required to start',

    // CTA
    'cta.title': 'Ready to Validate Your Idea?',
    'cta.desc': 'Make mistakes in a virtual environment. Refine your idea until you reach the best version ready for real-world success.',
    'cta.button': 'Try ASSET Free',

    // Footer
    'footer.rights': '© 2024 ASSET. All rights reserved.',
    'footer.privacy': 'Privacy Policy',
    'footer.terms': 'Terms of Service',
  },
  ar: {
    // Navbar
    'nav.features': 'المميزات',
    'nav.howItWorks': 'كيف يعمل',
    'nav.pricing': 'الأسعار',
    'nav.signIn': 'تسجيل الدخول',
    'nav.startFree': 'ابدأ مجاناً',

    // Hero
    'hero.title1': 'جرّب فكرتك',
    'hero.title2': 'قبل ما تبنيها',
    'hero.subtitle': 'عندك فكرة مشروع في دماغك.. بس لسه مش عارف هي حلوة ولا وحشة؟ 🤔 فيه فرق شاسع بين إن الفكرة تكون "حلوة" في خيالك، وبين إنها تكون واقعية، قابلة للتنفيذ، والأهم.. إنها تعجب الناس.',
    'hero.cta': 'ابدأ تجربة مجانية',
    'hero.watchDemo': 'شاهد العرض',
    'hero.stat1': '24+ وكيل ذكي',
    'hero.stat1Label': 'مجتمع افتراضي',
    'hero.stat2': '87%',
    'hero.stat2Label': 'دقة النتائج',
    'hero.stat3': '< 5 دقائق',
    'hero.stat3Label': 'وقت النتائج',

    // Problem Section
    'problem.tag': 'المشكلة',
    'problem.title': 'ليه معظم الأفكار بتفشل؟',
    'problem.desc': 'لما تسأل ChatGPT "إيه رأيك؟" بيرد عليك برد دبلوماسي. ده مش تقييم حقيقي.',
    'problem.point1': 'مفيش ردود فعل حقيقية',
    'problem.point1Desc': 'الشات بوتات بتقولك اللي عايز تسمعه، مش رأي السوق الحقيقي',
    'problem.point2': 'الخوف من الإحراج',
    'problem.point2Desc': 'تجربة الأفكار على ناس حقيقيين يعني مخاطرة بالرفض والحكم',
    'problem.point3': 'مفيش وجهات نظر متنوعة',
    'problem.point3Desc': 'محتاج متشككين، متفائلين، مغامرين، وعمليين يقيموا فكرتك',

    // Solution Section
    'solution.tag': 'الحل',
    'solution.title': 'تعرف على ASSET',
    'solution.subtitle': 'أداة المحاكاة والتطور الاجتماعي بالذكاء الاصطناعي',
    'solution.desc': 'إيه رأيك لو تقدر تجرب فكرتك على الناس... من غير ما تجربها على الناس فعلاً؟ من غير إحراج، من غير مخاطرة، بس تحليلات حقيقية.',

    // Simulation
    'sim.tag': 'كيف يعمل',
    'sim.title': 'شاهد الوكلاء وهم يختبرون فكرتك',
    'sim.desc': 'بنينا مجتمع افتراضي من 24 وكيل ذكاء اصطناعي، كل واحد بشخصية فريدة وخلفية مهنية وسمات نفسية مختلفة.',
    'sim.live': 'محاكاة مباشرة',
    'sim.agents': 'وكيل',
    'sim.feature1': 'شخصيات حقيقية',
    'sim.feature1Desc': 'المبرمج المتشكك، رائد الأعمال العملي، الموظف اللي بيدور على الاستقرار، المحترف الحذر',
    'sim.feature2': 'سمات نفسية',
    'sim.feature2Desc': 'كل وكيل ليه مستويات مختلفة من التفاؤل، الشك، والقدرة على تحمل المخاطر',
    'sim.feature3': 'نقاشات حية',
    'sim.feature3Desc': 'الوكلاء بيتناقشوا، بيقنعوا بعض، وفيه قادة رأي بيأثروا على الباقي',
    'sim.feature4': 'بيانات واقعية',
    'sim.feature4Desc': 'مربوط بمحرك بحث بيحلل السوق الحقيقي والمنافسين والقوانين',

    // Features
    'features.tag': 'المميزات',
    'features.title': 'كل اللي محتاجه',
    'features.desc': 'أدوات قوية لتقييم أفكارك بثقة',
    'features.f1': 'نتائج فورية',
    'features.f1Desc': 'احصل على ردود فعل السوق الشاملة في أقل من 5 دقائق',
    'features.f2': 'نسبة القبول',
    'features.f2Desc': 'شوف إزاي فئات مختلفة بتستجيب لفكرتك',
    'features.f3': 'مؤشر الاستقطاب',
    'features.f3Desc': 'قياس مدى انقسام أو اتفاق الآراء حول مفهومك',
    'features.f4': 'تحليل عميق',
    'features.f4Desc': 'نقاط القوة، الضعف، المخاطر، واقتراحات التحسين',
    'features.f5': 'أسواق عالمية',
    'features.f5Desc': 'اختبر الأفكار عبر مناطق وثقافات مختلفة',
    'features.f6': 'تفكير لحظي',
    'features.f6Desc': 'شاهد الوكلاء وهم يغيرون رأيهم أثناء النقاش',

    // Pricing
    'pricing.tag': 'الأسعار',
    'pricing.title': 'ابدأ مجاناً اليوم',
    'pricing.desc': 'جرب كل شيء مجاناً لمدة 7 أيام. بدون أي التزام.',
    'pricing.trial': 'تجربة مجانية',
    'pricing.trialTitle': 'تجربة 7 أيام',
    'pricing.price': '$0',
    'pricing.per': '/أسبوع',
    'pricing.includes': '3 محاكاة يومياً • وصول كامل',
    'pricing.f1': '3 محاكاة في اليوم',
    'pricing.f2': '24 وكيل ذكي لكل محاكاة',
    'pricing.f3': 'تحليلات لحظية',
    'pricing.f4': 'تحليلات سوق كاملة',
    'pricing.f5': 'دعم بالبريد الإلكتروني',
    'pricing.f6': 'لا يلزم بطاقة ائتمان',
    'pricing.cta': 'ابدأ التجربة المجانية',
    'pricing.noCard': 'لا يلزم معلومات الدفع للبدء',

    // CTA
    'cta.title': 'جاهز تقيّم فكرتك؟',
    'cta.desc': 'اغلط في بيئة افتراضية. عدّل فكرتك لحد ما توصل لأفضل نسخة جاهزة للنجاح في الواقع. 🎯',
    'cta.button': 'جرب ASSET مجاناً',

    // Footer
    'footer.rights': '© 2024 ASSET. جميع الحقوق محفوظة.',
    'footer.privacy': 'سياسة الخصوصية',
    'footer.terms': 'شروط الخدمة',
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

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
    return translations[language][key as keyof typeof translations['en']] || key;
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
