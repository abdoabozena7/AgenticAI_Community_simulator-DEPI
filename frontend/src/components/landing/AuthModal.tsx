import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { X, Mail, Lock, User, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RippleButton } from '@/components/ui/ripple-button';
import { RippleInput } from '@/components/ui/ripple-input';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiService } from '@/services/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'register';
}

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

const toAsciiDigits = (value: string) =>
  value
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));

const normalizeAuthValue = (value: string, trim = true) => {
  const withoutControlMarks = value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  const normalized = toAsciiDigits(withoutControlMarks).normalize('NFKC');
  return trim ? normalized.trim() : normalized;
};

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

export function AuthModal({ isOpen, onClose, initialMode = 'register' }: AuthModalProps) {
  const { language, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const isReset = mode === 'reset';
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
  const t = (en: string, ar: string) => (language === 'ar' ? ar : en);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setInfo(null);
    setNeedsVerification(false);
  }, [initialMode]);

  useEffect(() => {
    if (isOpen) {
      gsap.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3 }
      );
      gsap.fromTo(
        modalRef.current,
        { opacity: 0, scale: 0.9, y: 30, rotateX: 10 },
        { opacity: 1, scale: 1, y: 0, rotateX: 0, duration: 0.5, ease: 'power3.out' }
      );
    }
  }, [isOpen]);

  const handleClose = () => {
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
    gsap.to(modalRef.current, {
      opacity: 0,
      scale: 0.9,
      y: 30,
      duration: 0.2,
      onComplete: onClose,
    });
  };

  const handleRedirect = async () => {
    const me = await apiService.getMe();
    if (me?.role === 'admin') {
      localStorage.removeItem('postLoginRedirect');
      handleClose();
      navigate('/control-center', { replace: true });
      return;
    }
    const redirect = localStorage.getItem('postLoginRedirect');
    if (redirect) {
      localStorage.removeItem('postLoginRedirect');
      handleClose();
      navigate(redirect, { replace: true });
      return;
    }
    handleClose();
    navigate('/dashboard', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setNeedsVerification(false);
    setLoading(true);
    try {
      if (isReset) {
        const emailValue = normalizeAuthValue(email, true);
        if (!emailValue) {
          throw new Error(t('Please enter your email.', 'يرجى إدخال بريدك.'));
        }
        await apiService.requestPasswordReset(emailValue);
        setInfo(t('Password reset email sent. Check your inbox.', 'تم إرسال رابط إعادة التعيين. تحقق من بريدك.'));
        return;
      }
      if (mode === 'register') {
        const nameValue = normalizeAuthValue(name, true);
        const emailValue = normalizeAuthValue(email, true);
        const passwordValue = normalizeAuthValue(password, false);
        const username = nameValue || (emailValue ? emailValue.split('@')[0] : '');
        if (!username) {
          throw new Error(t('Please provide your name or email.', 'يرجى إدخال الاسم أو البريد الإلكتروني.'));
        }
        const res = await apiService.register(username, emailValue, passwordValue);
        if (!res?.access_token) {
          setInfo(t('Verification email sent. Please verify to continue.', 'تم إرسال رسالة التفعيل. يرجى التحقق للمتابعة.'));
          setMode('login');
          return;
        }
      } else {
        const loginValue = normalizeAuthValue(email, true);
        const passwordValue = normalizeAuthValue(password, false);
        await apiService.login(loginValue, passwordValue);
      }
      await handleRedirect();
    } catch (err: any) {
      const message = err?.message || t('Authentication failed', 'فشل تسجيل الدخول');
      if (typeof message === 'string' && message.toLowerCase().includes('email not verified')) {
        setNeedsVerification(true);
        setError(t('Email not verified. Please check your inbox.', 'البريد الإلكتروني غير مفعّل. تحقق من بريدك.'));
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };


  const handleResendVerification = async () => {
    const emailValue = normalizeAuthValue(email, true);
    if (!emailValue) {
      setError(t('Please enter your email.', 'ظٹط±ط¬ظ‰ ط¥ط¯ط®ط§ظ„ ط¨ط±ظٹط¯ظƒ.'));
      return;
    }
    setResendBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiService.resendVerification(emailValue);
      setInfo(t('Verification email sent. Please check your inbox.', 'تم إرسال رسالة التفعيل. تحقق من بريدك.'));
    } catch (err: any) {
      setError(err?.message || t('Failed to resend verification email.', 'تعذر إعادة إرسال رسالة التفعيل.'));
    } finally {
      setResendBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setNeedsVerification(false);
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
      await handleRedirect();
    } catch (err: any) {
      setError(err?.message || t('Google login failed', 'فشل تسجيل الدخول عبر Google'));
    } finally {
      setGoogleBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div
        ref={modalRef}
        className="relative w-full max-w-md p-8 rounded-2xl liquid-glass"
        style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {isReset
              ? t('Reset Password', 'إعادة تعيين كلمة المرور')
              : mode === 'login'
                ? t('Welcome Back', 'مرحباً بعودتك')
                : t('Create Account', 'إنشاء حساب')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isReset
              ? t('We will email you a reset link', 'سوف نرسل رابط إعادة التعيين إلى بريدك')
              : mode === 'login'
                ? t('Sign in to continue', 'سجّل الدخول للمتابعة')
                : t('Start your 7-day free trial', 'ابدأ تجربتك المجانية لمدة 7 أيام')}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="relative">
              <User className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
              <RippleInput
                type="text"
                placeholder={t('Full name', 'الاسم الكامل')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
              />
            </div>
          )}

          <div className="relative">
            <Mail className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
            <RippleInput
              type={mode === 'register' || isReset ? 'email' : 'text'}
              dir="ltr"
              placeholder={isReset
                ? t('Email address', 'البريد الإلكتروني')
                : mode === 'register'
                  ? t('Email address', 'البريد الإلكتروني')
                  : t('Username or email', 'اسم المستخدم أو البريد')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
            />
          </div>

          {!isReset && (
            <div className="relative">
              <Lock className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
              <RippleInput
                type="password"
                dir="ltr"
                placeholder={t('Password', 'كلمة المرور')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
              />
            </div>
          )}

          {mode === 'login' && !isReset && (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setMode('reset'); setError(null); setInfo(null); }}
            >
              {t('Forgot password?', 'نسيت كلمة المرور؟')}
            </button>
          )}

          <RippleButton
            type="submit"
            rippleColor="rgba(0, 255, 255, 0.3)"
            className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold group rgb-shadow-hover"
            disabled={loading}
          >
            {loading
              ? t('Please wait...', 'يرجى الانتظار...')
              : isReset
                ? t('Send Reset Link', 'إرسال رابط التعيين')
                : mode === 'login'
                  ? t('Sign In', 'تسجيل الدخول')
                  : t('Create Account', 'إنشاء حساب')}
            <ArrowRight className={`w-4 h-4 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
          </RippleButton>
        </form>

        {needsVerification && (
          <RippleButton
            type="button"
            variant="outline"
            className="w-full mb-4"
            onClick={handleResendVerification}
            disabled={resendBusy}
          >
            {resendBusy
              ? t('Sending...', 'جارٍ الإرسال...')
              : t('Resend verification email', 'إعادة إرسال رسالة التفعيل')}
          </RippleButton>
        )}

        {!isReset && (
          <>
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{t('OR', 'أو')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <RippleButton
              type="button"
              variant="outline"
              rippleColor="rgba(255, 0, 255, 0.2)"
              className="w-full liquid-glass-button rounded-full py-6"
              onClick={handleGoogleLogin}
              disabled={googleBusy}
            >
              <span className={`w-5 h-5 ${isRTL ? 'ml-2' : 'mr-2'} text-sm font-semibold`}>G</span>
              {googleBusy ? t('Connecting...', 'جارٍ الاتصال...') : t('Continue with Google', 'المتابعة باستخدام Google')}
            </RippleButton>
          </>
        )}

        {!isReset ? (
          <p className="text-center text-sm text-muted-foreground mt-6">
            {mode === 'login' ? t("Don't have an account? ", 'ليس لديك حساب؟ ') : t('Already have an account? ', 'لديك حساب بالفعل؟ ')}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); setInfo(null); }}
              className="text-foreground hover:underline font-medium"
            >
              {mode === 'login' ? t('Sign up', 'إنشاء حساب') : t('Sign in', 'تسجيل الدخول')}
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground mt-6">
            {t('Remembered your password? ', 'تذكرت كلمة المرور؟ ')}
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); setInfo(null); }}
              className="text-foreground hover:underline font-medium"
            >
              {t('Sign in', 'تسجيل الدخول')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}











