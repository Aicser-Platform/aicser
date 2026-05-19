'use client';

import React, { createContext, useContext } from 'react';

export type ThemeModeContextValue = {
  isDarkMode: boolean;
  setIsDarkMode: (value: boolean) => void;
};

export const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within a ThemeModeContext provider');
  }
  return ctx;
}


