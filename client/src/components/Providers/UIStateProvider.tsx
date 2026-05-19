'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type UIStateContextValue = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
};

const UIStateContext = createContext<UIStateContextValue | null>(null);

export function useUIState(): UIStateContextValue {
  const ctx = useContext(UIStateContext);
  if (!ctx) {
    throw new Error('useUIState must be used within UIStateProvider');
  }
  return ctx;
}

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem('sidebarCollapsed') === 'true';
      }
    } catch {
      // ignore
    }
    return false;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {}
  }, [sidebarCollapsed]);

  // Sync across tabs/windows
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sidebarCollapsed') {
        try {
          const val = e.newValue === 'true';
          setSidebarCollapsedState(val);
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setSidebarCollapsed = (v: boolean) => {
    setSidebarCollapsedState(v);
    try {
      window.dispatchEvent(new CustomEvent('sidebar-collapse-changed', { detail: { collapsed: v } }));
    } catch {}
  };

  return (
    <UIStateContext.Provider value={{ sidebarCollapsed, setSidebarCollapsed }}>
      {children}
    </UIStateContext.Provider>
  );
}


