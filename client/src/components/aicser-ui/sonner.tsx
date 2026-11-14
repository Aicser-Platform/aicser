'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useEffect, useState } from 'react';

/** Read the app's theme (html[data-theme] / .dark) so toasts match it. */
function useHtmlTheme(): 'light' | 'dark' {
  const read = () =>
    typeof document !== 'undefined' &&
    (document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark'))
      ? 'dark'
      : 'light';
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Toasts for Aicser UI pages (Docs, Slides). */
function Toaster(props: ToasterProps) {
  const theme = useHtmlTheme();
  return <Sonner theme={theme} position="bottom-right" closeButton {...props} />;
}

export { Toaster };
