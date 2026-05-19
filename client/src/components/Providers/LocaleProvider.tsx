'use client';

import { ReactNode, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE } from '@/config/locales';
import { mergeMessagesWithEnglishFallback } from '@/utils/mergeMessagesWithEnglish';
import { fetchApi } from '@/utils/api';
import enMessages from '@/messages/en.json';

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
            try {
                const data = await fetchApi('users/settings').catch(() => null);
                if (data?.settings?.language) {
                    currentLocale = data.settings.language;
                } else {
                    const saved = localStorage.getItem('aiser_locale');
                    if (saved) currentLocale = saved;
                }
            } catch (err) {
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

        window.addEventListener('aiser-locale-change', handleLocaleChange);
        return () => window.removeEventListener('aiser-locale-change', handleLocaleChange);
    }, [locale]);

    return (
        <NextIntlClientProvider key={locale} locale={locale} messages={messages} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    );
}
