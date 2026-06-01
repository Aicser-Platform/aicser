'use client';

import { create } from 'zustand';

interface FeaturebaseState {
  shouldLoad: boolean;
  openHelp: () => void;
  openWidget: () => void;
}

const bootedRef = { current: false };
const pendingOpenRef = { current: false };

function triggerHelpWidget(setShouldLoad: () => void) {
  setShouldLoad();
  pendingOpenRef.current = true;
  if (typeof window === 'undefined') return;
  const win = window as Window & { Featurebase?: (...args: unknown[]) => void };
  if (typeof win.Featurebase === 'function') {
    win.Featurebase('show');
    pendingOpenRef.current = false;
  }
}

export const useFeaturebaseStore = create<FeaturebaseState>()((set) => ({
  shouldLoad: false,

  openHelp: () => {
    triggerHelpWidget(() => set({ shouldLoad: true }));
  },

  openWidget: () => {
    triggerHelpWidget(() => set({ shouldLoad: true }));
  },
}));

/** Hook for FeaturebaseMessenger — exposes boot/pending refs shared with the store. */
export function useFeaturebaseHelp() {
  const shouldLoad = useFeaturebaseStore((s) => s.shouldLoad);
  return { shouldLoad, bootedRef, pendingOpenRef };
}
