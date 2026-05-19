'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useTranslations } from 'next-intl';

/**
 * General settings are now a tab on the main /settings page.
 * Redirect /settings/general → /settings?tab=general to avoid duplicates.
 */
export default function GeneralSettingsRedirect() {
  const router = useRouter();
  const t = useTranslations('settings');
  useEffect(() => {
    router.replace('/settings?tab=general');
  }, [router]);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
      <Spin tip={t('loading')} />
    </div>
  );
}
