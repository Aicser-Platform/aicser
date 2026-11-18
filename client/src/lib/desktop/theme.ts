'use client';

import { useThemeMode } from '@/components/Providers/ThemeModeContext';

/** The desktop's `useThemePreference()` on the web: the app's current light/dark mode. */
export function useThemePreference(): 'light' | 'dark' {
  return useThemeMode().isDarkMode ? 'dark' : 'light';
}
