'use client';

import { ReactNode, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE } from '@/config/locales';
import { applyTypographyForLocale } from '@/config/typography';
import { mergeMessagesWithEnglishFallback } from '@/utils/mergeMessagesWithEnglish';
import { fetchApi } from '@/utils/api';
import { getCeBearerToken } from '@/auth/ce/bearerToken';
import { useAuthStore } from '@/stores/useAuthStore';
import enMessages from '@/messages/en.json';

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

const MESSAGES_MAP: Record<string, () => Promise<any>> = {
    en: () => import('@/messages/en.json'),
    zh: () => import('@/messages/zh.json'),
    ja: () => import('@/messages/ja.json'),
    vi: () => import('@/messages/vi.json'),
    id: () => import('@/messages/id.json'),
    de: () => import('@/messages/de.json'),
    es: () => import('@/messages/es.json'),
    fr: () => import('@/messages/fr.json'),
    th: () => import('@/messages/th.json'),
    km: () => import('@/messages/km.json'),
};

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocale] = useState<string>(DEFAULT_LOCALE);
    const [messages, setMessages] = useState<any>(enMessages);

    const loadLocaleData = async (targetLocale: string) => {
        try {
            const loadFn = MESSAGES_MAP[targetLocale] || MESSAGES_MAP[DEFAULT_LOCALE];
            const msg = await loadFn();
            const loaded = msg.default as Record<string, unknown>;
            if (targetLocale === DEFAULT_LOCALE) {
                setMessages(loaded);
            } else {
                const en = (await MESSAGES_MAP.en()).default as Record<string, unknown>;
                setMessages(mergeMessagesWithEnglishFallback(en, loaded));
            }
            setLocale(targetLocale);
            applyTypographyForLocale(targetLocale);
            if (typeof window !== 'undefined') {
                localStorage.setItem('aiser_locale', targetLocale);
            }
        } catch (error) {
            console.error(`Failed to load locale ${targetLocale}:`, error);
            const fallbackMsg = await MESSAGES_MAP[DEFAULT_LOCALE]();
            setMessages(fallbackMsg.default as Record<string, unknown>);
            setLocale(DEFAULT_LOCALE);
        }
    };

    useEffect(() => {
        async function initLocale() {
            let currentLocale: string = DEFAULT_LOCALE;
            await waitForAuthSettled();
            const { isAuthenticated } = useAuthStore.getState();
            const hasSession = isAuthenticated || !!getCeBearerToken();
            try {
                if (hasSession) {
                    const data = await fetchApi('users/settings').catch(() => null);
                    if (data?.settings?.language) {
                        currentLocale = data.settings.language;
                    } else {
                        const saved = localStorage.getItem('aiser_locale');
                        if (saved) currentLocale = saved;
                    }
                } else {
                    const saved = localStorage.getItem('aiser_locale');
                    if (saved) currentLocale = saved;
                }
            } catch {
                console.warn('Settings fetch failed, using default locale');
            }
            await loadLocaleData(currentLocale);
        }
        initLocale();
    }, []);

    useEffect(() => {
        const handleLocaleChange = (e: any) => {
            const newLocale = e.detail;
            if (newLocale && newLocale !== locale) {
                loadLocaleData(newLocale);
            }
        };

        window.addEventListener('aicser-locale-change', handleLocaleChange);
        return () => window.removeEventListener('aicser-locale-change', handleLocaleChange);
    }, [locale]);

    return (
        <NextIntlClientProvider key={locale} locale={locale} messages={messages} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    );
}
