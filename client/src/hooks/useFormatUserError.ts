'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { formatUserError, type UserErrorTranslator } from '@/utils/formatUserError';

/** i18n-aware wrapper for formatUserError in client components. */
export function useFormatUserError() {
  const t = useTranslations('errors');

  const translate: UserErrorTranslator = useCallback(
    (key) => {
      try {
        return t(key as Parameters<typeof t>[0]);
      } catch {
        return undefined;
      }
    },
    [t],
  );

  return useCallback(
    (error: unknown, fallbackKey: Parameters<typeof t>[0] = 'generic', override?: string) =>
      formatUserError(error, override ?? t(fallbackKey), translate),
    [t, translate],
  );
}
