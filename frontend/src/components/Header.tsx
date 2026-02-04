import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, Settings, Wifi, WifiOff } from 'lucide-react';
import { SimulationStatus } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface HeaderProps {
  simulationStatus: SimulationStatus;
  isConnected: boolean;
  language: 'ar' | 'en';
  settings: {
    language: 'ar' | 'en';
    theme: string;
    autoFocusInput: boolean;
  };
  showSettings: boolean;
  onToggleSettings: () => void;
  onSettingsChange: (updates: Partial<HeaderProps['settings']>) => void;
  onExitDashboard?: () => void;
  onLogout?: () => void;
}

export function Header({
  simulationStatus,
  isConnected,
  language,
  settings,
  showSettings,
  onToggleSettings,
  onSettingsChange,
  onExitDashboard,
  onLogout,
}: HeaderProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!showSettings) return;
    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 360;
      const baseLeft = language === 'ar' ? rect.left : rect.right - menuWidth;
      const left = Math.max(12, Math.min(baseLeft, window.innerWidth - menuWidth - 12));
      const top = rect.bottom + 12;
      setMenuStyle({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showSettings, language]);

  useEffect(() => {
    if (!showSettings) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onToggleSettings();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSettings, onToggleSettings]);

  const statusLabel = (() => {
    const mapAr: Record<SimulationStatus, string> = {
      idle: 'جاهز',
      configuring: 'تهيئة',
      running: 'يعمل',
      paused: 'متوقف',
      completed: 'مكتمل',
      error: 'خطأ',
    };
    const mapEn: Record<SimulationStatus, string> = {
      idle: 'Idle',
      configuring: 'Configuring',
      running: 'Running',
      paused: 'Paused',
      completed: 'Completed',
      error: 'Error',
    };
    return language === 'ar' ? mapAr[simulationStatus] : mapEn[simulationStatus];
  })();
  return (
    <header className="glass-panel border-b border-border/50 px-6 py-3 overflow-visible relative z-50">
      <div className="flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary-foreground" />
            </div>
            {simulationStatus === 'running' && (
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success border-2 border-background animate-pulse" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold">
              <span className="text-gradient">
              {language === 'ar' ? (
                <>
                نقطة <span className="line-through text-destructive">الا</span> العودة
                </>
              ) : (
                <>
                Point of <span className="line-through text-destructive">no</span> return
                </>
              )}
              </span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {language === 'ar' ? 'جرب افكارك  قبل اطلاقها' : 'Test your ideas before launching them'}
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 relative">
          {onExitDashboard && (
            <button
              type="button"
              onClick={onExitDashboard}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border border-border/50 bg-secondary/60 text-muted-foreground hover:text-foreground"
            >
              {language === 'ar' ? 'العودة للوحة التحكم' : 'Back to dashboard'}
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border border-border/50 bg-secondary/60 text-muted-foreground hover:text-foreground"
            >
              {language === 'ar' ? 'تسجيل الخروج' : 'Log out'}
            </button>
          )}
          {/* Connection Status */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
            isConnected 
              ? "bg-success/10 text-success border border-success/20" 
              : "bg-destructive/10 text-destructive border border-destructive/20"
          )}>
            {isConnected ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span>{isConnected ? (language === 'ar' ? 'متصل' : 'Connected') : (language === 'ar' ? 'غير متصل' : 'Disconnected')}</span>
          </div>

          {/* Settings Tab */}
          <button
            ref={buttonRef}
            type="button"
            onClick={onToggleSettings}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors min-w-[110px] justify-center",
              showSettings
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-secondary/60 text-muted-foreground border-border/50 hover:text-foreground"
            )}
          >
            <Settings className="w-3.5 h-3.5" />
            {language === 'ar' ? 'الإعدادات' : 'Settings'}
          </button>

          {/* Simulation Status */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
            simulationStatus === 'running' && "bg-primary/10 text-primary border-primary/20",
            simulationStatus === 'paused' && "bg-warning/10 text-warning border-warning/20",
            simulationStatus === 'completed' && "bg-success/10 text-success border-success/20",
            simulationStatus === 'error' && "bg-destructive/10 text-destructive border-destructive/20",
            simulationStatus === 'idle' && "bg-muted text-muted-foreground border-border",
            simulationStatus === 'configuring' && "bg-accent/10 text-accent border-accent/20"
          )}>
            <div className={cn(
              "w-2 h-2 rounded-full",
              simulationStatus === 'running' && "bg-primary animate-pulse",
              simulationStatus === 'paused' && "bg-warning",
              simulationStatus === 'completed' && "bg-success",
              simulationStatus === 'error' && "bg-destructive",
              simulationStatus === 'idle' && "bg-muted-foreground",
              simulationStatus === 'configuring' && "bg-accent animate-pulse"
            )} />
            <span>{statusLabel}</span>
          </div>

          {showSettings && menuStyle && typeof document !== 'undefined' && createPortal(
            <div
              ref={menuRef}
              style={{ top: menuStyle.top, left: menuStyle.left }}
              className="fixed w-[360px] rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl p-4 shadow-2xl z-[9999]"
            >
              <div className="flex flex-col gap-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{language === 'ar' ? 'اللغة' : 'Language'}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onSettingsChange({ language: 'ar' })}
                      className={settings.language === 'ar'
                        ? 'px-3 py-1 rounded-md bg-primary text-primary-foreground'
                        : 'px-3 py-1 rounded-md bg-secondary text-foreground'}
                    >
                      عربي
                    </button>
                    <button
                      type="button"
                      onClick={() => onSettingsChange({ language: 'en' })}
                      className={settings.language === 'en'
                        ? 'px-3 py-1 rounded-md bg-primary text-primary-foreground'
                        : 'px-3 py-1 rounded-md bg-secondary text-foreground'}
                    >
                      English
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{language === 'ar' ? 'الثيم' : 'Theme'}</span>
                  <select
                    className="rounded-md bg-secondary border border-border/50 px-2 py-1 text-sm"
                    value={settings.theme}
                    onChange={(e) => onSettingsChange({ theme: e.target.value })}
                  >
                    <option value="dark">{language === 'ar' ? 'داكن' : 'Dark'}</option>
                    <option value="light">{language === 'ar' ? 'فاتح' : 'Light'}</option>
                  </select>
                </div>

                <label className="flex items-center justify-between">
                  <span className="text-muted-foreground">{language === 'ar' ? 'تركيز تلقائي' : 'Auto focus'}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoFocusInput}
                    onChange={(e) => onSettingsChange({ autoFocusInput: e.target.checked })}
                  />
                </label>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </header>
  );
}
