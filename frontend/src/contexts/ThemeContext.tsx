import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from 'next-themes';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem('appSettings');
    if (!saved) return 'dark';
    const parsed = JSON.parse(saved);
    return parsed?.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

function ThemeBridge({ children }: { children: ReactNode }) {
  const { theme: rawTheme, resolvedTheme, setTheme: setNextTheme } = useNextTheme();
  const effectiveTheme = (resolvedTheme || rawTheme || 'dark') as Theme;

  const setTheme = (next: Theme) => {
    setNextTheme(next);
  };

  const toggleTheme = () => {
    setNextTheme(effectiveTheme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', effectiveTheme === 'dark');
    root.classList.toggle('light', effectiveTheme === 'light');
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${effectiveTheme}`);

    try {
      const saved = window.localStorage.getItem('appSettings');
      const parsed = saved ? JSON.parse(saved) : {};
      window.localStorage.setItem('appSettings', JSON.stringify({ ...parsed, theme: effectiveTheme }));
    } catch {
      // ignore
    }
  }, [effectiveTheme]);

  const value = useMemo(
    () => ({ theme: effectiveTheme, setTheme, toggleTheme }),
    [effectiveTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialTheme = getInitialTheme();
  return (
    <NextThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false}>
      <ThemeBridge>{children}</ThemeBridge>
    </NextThemeProvider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
