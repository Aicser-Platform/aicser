'use client';
const noop = () => {};

export const useFeaturebaseStore = () => ({
  shouldLoad: false,
  openWidget: noop,
  openHelp: noop,
});
