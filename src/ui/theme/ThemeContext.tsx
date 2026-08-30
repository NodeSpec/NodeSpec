import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Theme, ThemeMode } from './index.js';
import { getTheme } from './index.js';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'specgraph-theme';

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultMode?: ThemeMode;
  readOnly?: boolean;
}

export function ThemeProvider({ children, defaultMode, readOnly }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode ?? getInitialMode);

  useEffect(() => {
    if (!readOnly) {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }, [mode, readOnly]);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
  }, []);

  const theme = useMemo(() => getTheme(mode), [mode]);

  const value = useMemo(
    () => ({ theme, mode, toggleTheme, setMode }),
    [theme, mode, toggleTheme, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
