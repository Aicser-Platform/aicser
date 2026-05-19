'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useTranslations } from 'next-intl';

/** Notification settings live in the main Settings page. Redirect to the Notifications tab. */
export default function NotificationsSettingsRedirect() {
  const router = useRouter();
  const t = useTranslations('settings');
  useEffect(() => {
    router.replace('/settings?tab=notifications');
  }, [router]);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
      <Spin tip={`${t('tab_notifications')}...`} />
    </div>
  );
}
