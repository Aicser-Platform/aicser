import { create } from 'zustand';
import { ReactNode } from 'react';

interface HeaderState {
  extraLeft?: ReactNode;
  extraRight?: ReactNode;
  setExtraLeft: (node?: ReactNode) => void;
  setExtraRight: (node?: ReactNode) => void;
  clearExtras: () => void;
}

export const useHeaderStore = create<HeaderState>((set) => ({
  extraLeft: undefined,
  extraRight: undefined,
  setExtraLeft: (node) => set({ extraLeft: node }),
  setExtraRight: (node) => set({ extraRight: node }),
  clearExtras: () => set({ extraLeft: undefined, extraRight: undefined }),
}));
