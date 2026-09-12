'use client';

/**
 * Skip-to-content was removed from the dashboard shell: the previous
 * translateY hide leaked into view (top-left) in Electron/Chromium and read
 * like a bug. Keyboard users still land in the page via normal tab order.
 */
export function SkipToContentLink() {
  return null;
}
