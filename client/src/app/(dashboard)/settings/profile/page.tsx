'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useTranslations } from 'next-intl';

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
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
      <Spin tip={t('loading')} />
    </div>
  );
}
