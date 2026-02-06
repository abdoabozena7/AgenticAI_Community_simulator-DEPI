import { useState } from 'react';
import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { X, Mail, Lock, User, ArrowRight, Github } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RippleButton } from '@/components/ui/ripple-button';
import { RippleInput } from '@/components/ui/ripple-input';
import { useLanguage } from '@/contexts/LanguageContext';
 import { toast } from 'sonner';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'register';
}

export function AuthModal({ isOpen, onClose, initialMode = 'register' }: AuthModalProps) {
  const { isRTL } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
     
     // Check for admin credentials
     const isAdmin = (email === 'admin' || name === 'admin') && password === '123';
     const targetRoute = '/dashboard';
     
     if (isAdmin) {
       toast.success('Welcome, Administrator!');
     } else {
       toast.success('Login successful!');
     }
     
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.2 });
    gsap.to(modalRef.current, {
      opacity: 0,
      scale: 0.9,
      y: 30,
      duration: 0.2,
      onComplete: () => {
        onClose();
         navigate(targetRoute, { state: { isAdmin } });
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
          className="relative w-full max-w-md p-8 rounded-2xl liquid-glass"
        style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'login'
              ? 'Sign in to continue to your simulations'
              : 'Start your 7-day free trial'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="relative">
              <User className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
              <RippleInput
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
              />
            </div>
          )}

          <div className="relative">
            <Mail className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
            <RippleInput
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
            />
          </div>

          <div className="relative">
            <Lock className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10`} />
            <RippleInput
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${isRTL ? 'pr-11' : 'pl-11'} bg-secondary border-border text-foreground placeholder:text-muted-foreground`}
            />
          </div>

          {mode === 'login' && (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </button>
          )}

          <RippleButton
            type="submit"
            rippleColor="rgba(0, 255, 255, 0.3)"
            className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-full py-6 text-base font-semibold group rgb-shadow-hover"
          >
            {mode === 'login' ? 'Sign In' : 'Create Account'}
            <ArrowRight className={`w-4 h-4 ${isRTL ? 'mr-2 group-hover:-translate-x-1' : 'ml-2 group-hover:translate-x-1'} transition-transform`} />
          </RippleButton>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">OR</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Social */}
        <RippleButton
          type="button"
          variant="outline"
          rippleColor="rgba(255, 0, 255, 0.2)"
          className="w-full liquid-glass-button rounded-full py-6"
        >
          <Github className="w-5 h-5 mr-2" />
          Continue with GitHub
        </RippleButton>

        {/* Toggle mode */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-foreground hover:underline font-medium"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
