'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

/** Security settings live in the main Settings page. Redirect to the Security tab. */
export default function SecuritySettingsRedirect() {
  const router = useRouter();
  const t = useTranslations('settings');
  useEffect(() => {
    router.replace('/settings?tab=security');
  }, [router]);
  return <AppLoadingIndicator variant="inline" tip={`${t('tab_security')}...`} />;
}
