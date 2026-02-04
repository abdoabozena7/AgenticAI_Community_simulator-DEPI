import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiService, getAuthToken } from '@/services/api';
import { Lock, Mail, User } from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: Record<string, unknown>) => void;
          prompt: (callback?: (notification: any) => void) => void;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

const loadGoogleSdk = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google SDK')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google SDK'));
    document.head.appendChild(script);
  });

const requestGoogleIdToken = (clientId: string) =>
  new Promise<string>((resolve, reject) => {
    const google = window.google?.accounts?.id;
    if (!google) {
      reject(new Error('Google SDK unavailable'));
      return;
    }
    let settled = false;
    const finish = (err?: Error, token?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else if (token) {
        resolve(token);
      } else {
        reject(new Error('Google login failed'));
      }
    };
    const timeoutId = window.setTimeout(() => finish(new Error('Google login timed out')), 10000);
    google.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response: { credential?: string }) => {
        if (response?.credential) {
          finish(undefined, response.credential);
        } else {
          finish(new Error('Google login failed'));
        }
      },
    });
    google.prompt((notification: any) => {
      if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
        finish(new Error('Google login unavailable'));
      }
    });
  });

const getDevGoogleProfile = () => {
  const storageKey = 'dev_google_profile';
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { email?: string; name?: string };
      if (parsed?.email) {
        return { email: parsed.email, name: parsed.name || 'Dev Google User' };
      }
    } catch {
      // ignore
    }
  }
  const profile = { email: 'dev_google_user@local.test', name: 'Dev Google User' };
  localStorage.setItem(storageKey, JSON.stringify(profile));
  return profile;
};

const navItems = [
  { label: { en: 'Solutions', ar: 'الحلول' }, href: '#solutions' },
  { label: { en: 'Research', ar: 'الأبحاث' }, href: '#research' },
  { label: { en: 'Pricing', ar: 'الأسعار' }, href: '#pricing' },
  { label: { en: 'Community', ar: 'المجتمع' }, href: '#community' },
];

const stats = [
  { label: { en: 'Setup time', ar: 'زمن الإعداد' }, value: { en: 'Minutes', ar: 'دقائق' } },
  { label: { en: 'Agent debates', ar: 'مناظرات الوكلاء' }, value: { en: 'Multi-role', ar: 'متعددة الأدوار' } },
  { label: { en: 'Outputs', ar: 'المخرجات' }, value: { en: 'Share-ready', ar: 'جاهزة للمشاركة' } },
];

const features = [
  {
    title: { en: 'Signal-first research', ar: 'أبحاث تبدأ بالإشارات' },
    description: {
      en: 'Blend live web research with structured insights to ground every simulation.',
      ar: 'ادمج بحث الويب الحي مع رؤى منظمة لتأسيس كل محاكاة.',
    },
  },
  {
    title: { en: 'Agentic debate', ar: 'مناظرة وكيلة' },
    description: {
      en: 'Run multi-agent discussions that surface objections, risks, and adoption paths.',
      ar: 'شغّل مناقشات متعددة الوكلاء تكشف الاعتراضات والمخاطر ومسارات التبني.',
    },
  },
  {
    title: { en: 'Launch-ready insights', ar: 'رؤى جاهزة للإطلاق' },
    description: {
      en: 'Export summaries, acceptance metrics, and next-step recommendations in minutes.',
      ar: 'صدّر ملخصات ومؤشرات القبول وتوصيات الخطوات التالية خلال دقائق.',
    },
  },
];

const MarketingLandingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const authHandledRef = useRef(false);
  const [appSettings, setAppSettings] = useState(() => {
    if (typeof window === 'undefined') {
      return { language: 'en' as 'en' | 'ar', theme: 'dark' as 'dark' | 'light' };
    }
    try {
      const saved = window.localStorage.getItem('appSettings');
      if (!saved) return { language: 'en' as 'en' | 'ar', theme: 'dark' as 'dark' | 'light' };
      const parsed = JSON.parse(saved);
      return {
        language: parsed?.language === 'ar' ? 'ar' : 'en',
        theme: parsed?.theme === 'light' ? 'light' : 'dark',
      } as { language: 'en' | 'ar'; theme: 'dark' | 'light' };
    } catch {
      return { language: 'en' as 'en' | 'ar', theme: 'dark' as 'dark' | 'light' };
    }
  });
  const [showAuth, setShowAuth] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [landingPrompt, setLandingPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
  const t = (en: string, ar: string) => (appSettings.language === 'ar' ? ar : en);
  const pick = (value: { en: string; ar: string }) => (appSettings.language === 'ar' ? value.ar : value.en);
  const persistLandingIdea = () => {
    const prompt = landingPrompt.trim();
    if (!prompt) return;
    try {
      localStorage.setItem('dashboardIdea', prompt);
    } catch {
      // ignore
    }
  };

  const openAuth = (mode: 'login' | 'register' = 'login') => {
    persistLandingIdea();
    setIsRegistering(mode === 'register');
    setError(null);
    setShowAuth(true);
  };

  const closeAuth = () => {
    setShowAuth(false);
    setError(null);
  };

  useEffect(() => {
    if (!showAuth) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAuth();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [showAuth]);

  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.lang = appSettings.language;
    root.dir = appSettings.language === 'ar' ? 'rtl' : 'ltr';
    root.classList.toggle('rtl', appSettings.language === 'ar');
    root.classList.toggle('lang-ar', appSettings.language === 'ar');
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${appSettings.theme}`);
    try {
      const saved = window.localStorage.getItem('appSettings');
      const parsed = saved ? JSON.parse(saved) : {};
      window.localStorage.setItem('appSettings', JSON.stringify({ ...parsed, ...appSettings }));
    } catch {
      // ignore
    }
  }, [appSettings]);

  useEffect(() => {
    if (getAuthToken()) return;
    try {
      const pending = localStorage.getItem('pendingIdea');
      if (!pending && !landingPrompt.trim()) {
        localStorage.removeItem('dashboardIdea');
      }
    } catch {
      // ignore
    }
  }, []);


  useEffect(() => {
    if (authHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    const auth = params.get('auth');
    if (auth === 'login' || auth === 'register') {
      openAuth(auth === 'register' ? 'register' : 'login');
      authHandledRef.current = true;
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const handleGoogleLogin = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      if (googleClientId) {
        await loadGoogleSdk();
        const idToken = await requestGoogleIdToken(googleClientId);
        await apiService.loginWithGoogle({ id_token: idToken });
      } else {
        const profile = getDevGoogleProfile();
        await apiService.loginWithGoogle({ email: profile.email, name: profile.name });
      }
      setShowAuth(false);
      const me = await apiService.getMe();
      if (me?.role === 'admin') {
        localStorage.removeItem('postLoginRedirect');
        navigate('/control-center', { replace: true });
      } else {
        const redirect = localStorage.getItem('postLoginRedirect');
        if (redirect) {
          localStorage.removeItem('postLoginRedirect');
          navigate(redirect, { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Google login failed');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegistering) {
        const name = fullName.trim();
        const emailValue = email.trim();
        const username = name || (emailValue ? emailValue.split('@')[0] : '');
        if (!username) {
          throw new Error('Please provide your name or email.');
        }
        await apiService.register(username, emailValue, password);
      } else {
        await apiService.login(email.trim(), password);
      }
      setShowAuth(false);
      const me = await apiService.getMe();
      if (me?.role === 'admin') {
        localStorage.removeItem('postLoginRedirect');
        navigate('/control-center', { replace: true });
      } else {
        const redirect = localStorage.getItem('postLoginRedirect');
        if (redirect) {
          localStorage.removeItem('postLoginRedirect');
          navigate(redirect, { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStartSimulation = (mode: 'login' | 'register') => {
    const prompt = landingPrompt.trim();
    if (prompt) {
      localStorage.setItem('pendingIdea', prompt);
      try {
        localStorage.setItem('dashboardIdea', prompt);
      } catch {
        // ignore
      }
    }
    localStorage.setItem('postLoginRedirect', '/dashboard');
    if (getAuthToken()) {
      apiService.getMe().then((me) => {
        if (me?.role === 'admin') {
          navigate('/control-center');
        } else {
          navigate('/dashboard');
        }
      }).catch(() => navigate('/dashboard'));
      return;
    }
    openAuth(mode);
  };

  return (
    <div className="font-display relative h-screen max-h-screen overflow-x-hidden overflow-y-auto bg-[#0b0b12] text-white scrollbar-thin">
      <div className="absolute inset-0 landing-hero-bg" />
      <div className="absolute inset-0 landing-grid" />
      <div className="pointer-events-none absolute -top-32 left-[-10%] h-[320px] w-[320px] rounded-full bg-emerald-400/30 blur-[140px] landing-float" />
      <div className="pointer-events-none absolute top-10 right-[-8%] h-[360px] w-[360px] rounded-full bg-amber-400/30 blur-[150px] landing-float landing-delay-300" />
      <div className="pointer-events-none absolute bottom-[-12%] left-[20%] h-[420px] w-[420px] rounded-full bg-rose-500/30 blur-[160px] landing-float landing-delay-600" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-emerald-300 via-cyan-300 to-amber-200 shadow-lg shadow-emerald-500/20" />
              <div className="font-display text-lg font-semibold tracking-wide">Agentic Lab</div>
            </div>

          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="transition hover:text-white"
              >
                {pick(item.label)}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1 text-xs text-white/70">
              <button
                type="button"
                onClick={() => setAppSettings((prev) => ({ ...prev, language: 'en' }))}
                className={`rounded-full px-3 py-1 ${appSettings.language === 'en' ? 'bg-white text-slate-900' : ''}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setAppSettings((prev) => ({ ...prev, language: 'ar' }))}
                className={`rounded-full px-3 py-1 ${appSettings.language === 'ar' ? 'bg-white text-slate-900' : ''}`}
              >
                العربية
              </button>
            </div>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="hidden rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white md:inline-flex"
            >
              {t('Log in', 'تسجيل الدخول')}
            </button>
            <button
              type="button"
              onClick={() => openAuth('register')}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-white/20 transition hover:translate-y-[-1px] hover:shadow-white/30"
            >
              {t('Get started', 'ابدأ الآن')}
            </button>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-16">
          <section className="pt-10 text-center md:pt-16">
            <div className="landing-reveal inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.32em] text-white/70">
              {t('New', 'جديد')}
              <span className="text-white/90 normal-case tracking-normal">
                {t('Real-time agentic simulations', 'محاكاة وكيلة في الوقت الحقيقي')}
              </span>
            </div>
            <h1 className="landing-reveal landing-delay-200 font-display mt-6 text-4xl font-semibold leading-tight text-white md:text-6xl">
              {t('Build products people', 'ابنِ منتجات')}
              <span className="block text-white/80">{t('choose on day one', 'يختارها الناس من اليوم الأول')}</span>
            </h1>
            <p className="landing-reveal landing-delay-300 mx-auto mt-4 max-w-2xl text-base text-white/70 md:text-lg">
              {t(
                'Agentic Lab turns a raw idea into a simulated market. Test messaging, validate demand, and uncover risks before you ship.',
                'يحوّل Agentic Lab الفكرة الخام إلى سوق مُحاكى. اختبر الرسائل، تحقّق من الطلب، واكشف المخاطر قبل الإطلاق.',
              )}
            </p>
            <div className="landing-reveal landing-delay-500 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => handleStartSimulation('register')}
                className="rounded-full bg-gradient-to-r from-emerald-300 via-cyan-300 to-amber-200 px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-400/30 transition hover:translate-y-[-1px]"
              >
                {t('Start a simulation', 'ابدأ محاكاة')}
              </button>
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white/90 transition hover:border-white/40 hover:text-white"
              >
                {t('Watch the demo', 'شاهد العرض')}
              </button>
            </div>
          </section>

          <section className="landing-reveal landing-delay-700 mt-12 flex justify-center">
            <div className="w-full max-w-3xl rounded-[28px] border border-white/15 bg-white/10 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl md:p-8">
              <div className="text-sm text-white/60">{t('Ask Agentic to simulate a launch for...', 'اطلب من Agentic محاكاة إطلاق لـ...')}</div>
              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  aria-label={t('Add attachment', 'إضافة مرفق')}
                  onClick={() => handleStartSimulation('register')}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-lg text-white/80 transition hover:border-white/40"
                >
                  +
                </button>
                <input
                  value={landingPrompt}
                  onChange={(event) => setLandingPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleStartSimulation('register');
                    }
                  }}
                  placeholder={t("Describe the launch you'd like to test", 'صف الإطلاق الذي تريد اختباره')}
                  className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-xs uppercase tracking-[0.35em] text-white/50">{t('Plan', 'الخطة')}</span>
                  <button
                    type="button"
                    onClick={() => handleStartSimulation('register')}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg shadow-white/20 transition hover:translate-y-[-1px]"
                    aria-label={t('Send prompt', 'إرسال الطلب')}
                  >
                    -{'>'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-12 grid gap-4 text-center sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label.en}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-white/70 backdrop-blur"
              >
                <div className="font-display text-2xl font-semibold text-white">{pick(stat.value)}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.2em]">{pick(stat.label)}</div>
              </div>
            ))}
          </section>

          <section id="solutions" className="mt-14">
            <div className="grid gap-5 md:grid-cols-3">
              {features.map((feature, index) => (
                <div
                  key={feature.title.en}
                  className="landing-reveal rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-6 backdrop-blur-xl"
                  style={{ animationDelay: `${0.3 + index * 0.15}s` }}
                >
                  <div className="font-display text-lg font-semibold">{pick(feature.title)}</div>
                  <p className="mt-3 text-sm text-white/70">{pick(feature.description)}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="research" className="mt-14 flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-display text-2xl font-semibold text-white">
                {t('From idea to evidence', 'من الفكرة إلى الدليل')}
              </div>
              <p className="mt-2 max-w-xl text-sm text-white/70">
                {t(
                  'Blend interviews, research summaries, and simulation outcomes into one launch-ready briefing.',
                  'ادمج المقابلات وملخصات الأبحاث ونتائج المحاكاة في ملخص جاهز للإطلاق.',
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white/90 transition hover:border-white/40"
            >
              {t('See reports', 'عرض التقارير')}
            </button>
          </section>

          <section id="pricing" className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70 backdrop-blur-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-display text-2xl font-semibold text-white">
                  {t('Flexible pricing for teams', 'أسعار مرنة للفرق')}
                </div>
                <p className="mt-2 max-w-xl text-sm text-white/70">
                  {t(
                    'Start with a free trial, then scale usage as your research pipeline grows.',
                    'ابدأ بفترة تجريبية مجانية ثم وسّع الاستخدام مع نمو مسار الأبحاث لديك.',
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openAuth('register')}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-white/20 transition hover:translate-y-[-1px]"
              >
                {t('View plans', 'عرض الخطط')}
              </button>
            </div>
          </section>

          <section id="community" className="mt-10 text-center text-xs uppercase tracking-[0.4em] text-white/40">
            {t(
              'Built for founders, product leaders, and research teams',
              'مصمم للمؤسسين وقادة المنتج وفرق الأبحاث',
            )}
          </section>
        </main>
      </div>

      {showAuth && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8"
          onClick={closeAuth}
        >
          <div
            className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#151515]/95 p-8 shadow-2xl backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeAuth}
              className="absolute right-4 top-4 rounded-full border border-white/10 px-2 py-1 text-xs text-white/70 hover:text-white"
            >
              X
            </button>

            <div className="space-y-2 text-center">
              <div className="mx-auto h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-300 via-cyan-300 to-amber-200 shadow-lg shadow-emerald-500/30" />
              <h2 className="text-2xl font-semibold text-white">
                {isRegistering ? t('Create Account', 'إنشاء حساب') : t('Sign in', 'تسجيل الدخول')}
              </h2>
              <p className="text-sm text-white/50">
                {isRegistering
                  ? t('Start your 7-day free trial', 'ابدأ تجربتك المجانية لمدة 7 أيام')
                  : t('Log in to your account', 'سجّل الدخول إلى حسابك')}
              </p>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-500/60 bg-rose-500/10 text-rose-100 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {isRegistering && (
                <div className="relative">
                  <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder={t('Full name', 'الاسم الكامل')}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-11 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                    required
                  />
                </div>
              )}

              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  type={isRegistering ? 'email' : 'text'}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={isRegistering ? t('Email address', 'البريد الإلكتروني') : t('Username or email', 'اسم المستخدم أو البريد الإلكتروني')}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-11 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('Password', 'كلمة المرور')}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-11 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white/90 disabled:opacity-60"
              >
                {loading
                  ? t('Please wait...', 'يرجى الانتظار...')
                  : isRegistering
                    ? t('Create Account', 'إنشاء حساب')
                    : t('Sign in', 'تسجيل الدخول')}
                <span className="text-base">-{'>'}</span>
              </button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs text-white/40">
              <span className="h-px flex-1 bg-white/10" />
              {t('OR', 'أو')}
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleBusy}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-white/15 bg-black/60 px-4 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 disabled:opacity-60"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-base font-semibold">
                G
              </span>
              {t('Continue with Google', 'المتابعة باستخدام Google')}
            </button>

            <div className="mt-6 flex items-center justify-center text-sm text-white/60">
              {isRegistering ? t('Already have an account?', 'لديك حساب بالفعل؟') : t("Don't have an account?", 'ليس لديك حساب؟')}{' '}
              <button
                type="button"
                onClick={() => setIsRegistering((prev) => !prev)}
                className="ml-1 text-white underline underline-offset-4"
              >
                {isRegistering ? t('Sign in', 'تسجيل الدخول') : t('Create account', 'إنشاء حساب')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketingLandingPage;
