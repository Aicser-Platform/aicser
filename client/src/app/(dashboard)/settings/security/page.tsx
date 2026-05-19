'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useTranslations } from 'next-intl';

/** Security settings live in the main Settings page. Redirect to the Security tab. */
export default function SecuritySettingsRedirect() {
  const router = useRouter();
  const t = useTranslations('settings');
  useEffect(() => {
    router.replace('/settings?tab=security');
  }, [router]);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
      <Spin tip={`${t('tab_security')}...`} />
    </div>
  );
}
