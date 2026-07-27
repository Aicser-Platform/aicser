'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

/**
 * Profile settings are a tab on the main /settings page.
 * Redirect /settings/profile → /settings?tab=profile to avoid duplicates.
 */
export default function ProfileSettingsRedirect() {
  const router = useRouter();
  const t = useTranslations('settings');
  useEffect(() => {
    router.replace('/settings?tab=profile');
  }, [router]);
  return <AppLoadingIndicator variant="inline" tip={t('loading')} />;
}
