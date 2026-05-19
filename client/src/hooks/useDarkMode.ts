import { useState } from 'react';

export const useDarkMode = () => {
    const [isDarkMode, setIsDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('darkMode');
            if (stored !== null) {
                return JSON.parse(stored);
            }
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });

    // Persist preference only; DOM class toggling handled centrally in ThemeProvider
    // This avoids double-toggling and visual race conditions during mode switches
    if (typeof window !== 'undefined') {
        try { localStorage.setItem('darkMode', JSON.stringify(isDarkMode)); } catch {}
    }

    return [isDarkMode, setIsDarkMode] as const;
};
