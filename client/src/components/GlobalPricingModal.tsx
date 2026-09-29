'use client';

import { useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslations } from 'next-intl';
import PricingModal from '@/components/PricingModal';
import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';

const edition = (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase();
const hostedBilling = (edition === 'enterprise' || edition === 'ee') && !isSelfHostDeploymentFromEnv();

/**
 * Layout-owned listener for `open-pricing-modal`. Upgrade CTAs across Chat, Alerts, Data
 * Platform, and API 402 handlers dispatch this event (optionally with { reason }). Hosted
 * billing opens the plans; self-hosted installs have no plans screen, so the person is told
 * to ask their administrator — both in the user's language.
 */
export default function GlobalPricingModal() {
  const t = useTranslations('common');
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
      if (hostedBilling) {
        if (reason) message.info(t('upgrade_needed_hosted'));
        setOpen(true);
        return;
      }
      modal.info({
        title: t('upgrade_needed_title'),
        content: t('upgrade_needed_self_host'),
        okText: t('ok'),
      });
    };
    window.addEventListener('open-pricing-modal', handler);
    return () => window.removeEventListener('open-pricing-modal', handler);
  }, [message, modal, t]);

  return <PricingModal visible={open} onClose={() => setOpen(false)} />;
}
