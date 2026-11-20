'use client';

import { ReactNode, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE, loadDayjsLocale } from '@/config/locales';
import { applyTypographyForLocale } from '@/config/typography';
import { mergeMessagesWithEnglishFallback } from '@/utils/mergeMessagesWithEnglish';
import { loadLocaleMessages } from '@/utils/loadLocaleMessages';
import { fetchApi } from '@/utils/api';
import { getCeBearerToken } from '@/auth/ce/bearerToken';
import { useAuthStore } from '@/stores/useAuthStore';

function getBrowserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function getInitialTimezone(): string {
    if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('aiser_timezone');
        if (saved) return saved;
    }
    return getBrowserTimezone();
}

function waitForAuthSettled(maxMs = 4000): Promise<void> {
    return new Promise((resolve) => {
        if (!useAuthStore.getState().authLoading) {
            resolve();
            return;
        }
        const started = Date.now();
        const interval = window.setInterval(() => {
            if (!useAuthStore.getState().authLoading || Date.now() - started >= maxMs) {
                window.clearInterval(interval);
                resolve();
            }
        }, 50);
    });
}

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocale] = useState<string>(DEFAULT_LOCALE);
    const [timeZone, setTimeZone] = useState<string>(() => getInitialTimezone());
    const [messages, setMessages] = useState<Record<string, unknown> | null>(null);

    const loadLocaleData = async (targetLocale: string) => {
        try {
            const [loaded] = await Promise.all([
                loadLocaleMessages(targetLocale),
                loadDayjsLocale(targetLocale).catch(() => targetLocale),
            ]);
            if (targetLocale === DEFAULT_LOCALE) {
                setMessages(loaded);
            } else {
                const en = await loadLocaleMessages(DEFAULT_LOCALE);
                setMessages(mergeMessagesWithEnglishFallback(en, loaded));
            }
            setLocale(targetLocale);
            applyTypographyForLocale(targetLocale);
            if (typeof window !== 'undefined') {
                localStorage.setItem('aiser_locale', targetLocale);
            }
        } catch (error) {
            console.error(`Failed to load locale ${targetLocale}:`, error);
            const fallback = await loadLocaleMessages(DEFAULT_LOCALE);
            await loadDayjsLocale(DEFAULT_LOCALE).catch(() => DEFAULT_LOCALE);
            setMessages(fallback);
            setLocale(DEFAULT_LOCALE);
        }
    };

    useEffect(() => {
        async function initLocale() {
            // Paint first with the language this browser last used; the account's saved language
            // only replaces it if it differs.
            const saved = localStorage.getItem('aiser_locale') || DEFAULT_LOCALE;
            await loadLocaleData(saved);
            await waitForAuthSettled();
            const { isAuthenticated } = useAuthStore.getState();
            if (!isAuthenticated && !getCeBearerToken()) return;
            const data = await fetchApi('users/settings').catch(() => null);
            const language = data?.settings?.language;
            if (language && language !== saved) {
                await loadLocaleData(language);
                window.dispatchEvent(new CustomEvent('aicser-locale-change', { detail: language }));
            }
            const userTz = data?.settings?.timezone;
            if (typeof userTz === 'string' && userTz.trim()) {
                setTimeZone(userTz.trim());
                localStorage.setItem('aiser_timezone', userTz.trim());
            }
        }
        void initLocale();
    }, []);

    useEffect(() => {
        const handleLocaleChange = (e: Event) => {
            const newLocale = (e as CustomEvent<string>).detail;
            if (newLocale && newLocale !== locale) {
                void loadLocaleData(newLocale);
            }
        };
        const handleTimezoneChange = (e: Event) => {
            const newTz = (e as CustomEvent<string>).detail;
            const resolved = (typeof newTz === 'string' && newTz.trim()) || getBrowserTimezone();
            setTimeZone(resolved);
            if (typeof window !== 'undefined') {
                localStorage.setItem('aiser_timezone', resolved);
            }
        };

        window.addEventListener('aicser-locale-change', handleLocaleChange);
        window.addEventListener('aicser-timezone-change', handleTimezoneChange);
        return () => {
            window.removeEventListener('aicser-locale-change', handleLocaleChange);
            window.removeEventListener('aicser-timezone-change', handleTimezoneChange);
        };
    }, [locale]);

    if (!messages) {
        return null;
    }

    return (
        <NextIntlClientProvider key={locale} locale={locale} messages={messages} timeZone={timeZone}>
            {children}
        </NextIntlClientProvider>
    );
}
