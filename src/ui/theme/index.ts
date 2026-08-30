export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  accent: string;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
}

const darkColors: ThemeColors = {
  background: '#0f1117',
  backgroundSecondary: '#1a1d26',
  backgroundTertiary: '#24273a',
  surface: '#1a1d26',
  surfaceHover: '#24273a',
  border: '#3f4458',
  borderStrong: '#5a5f78',
  text: '#E6E9EF',
  textSecondary: '#c9cdd8',
  textMuted: '#8a8f9e',
  primary: '#8B8FE6',
  primaryHover: '#7b7fdb',
  success: '#4ade80',
  successBg: '#1a3d2e',
  warning: '#fbbf24',
  warningBg: '#3d2f1a',
  error: '#f87171',
  errorBg: '#3d1a1a',
  accent: '#a78bfa',
};

const lightColors: ThemeColors = {
  background: '#fafbfc',
  backgroundSecondary: '#ffffff',
  backgroundTertiary: '#f3f4f8',
  surface: '#ffffff',
  surfaceHover: '#f8f9fb',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  text: '#1f2937',
  textSecondary: '#4b5563',
  textMuted: '#6b7280',
  primary: '#8B8FE6',
  primaryHover: '#7b7fdb',
  success: '#10b981',
  successBg: '#d1fae5',
  warning: '#f59e0b',
  warningBg: '#fef3c7',
  error: '#ef4444',
  errorBg: '#fee2e2',
  accent: '#a78bfa',
};

export const themes: Record<ThemeMode, Theme> = {
  dark: { mode: 'dark', colors: darkColors },
  light: { mode: 'light', colors: lightColors },
};

export function getTheme(mode: ThemeMode): Theme {
  return themes[mode];
}
