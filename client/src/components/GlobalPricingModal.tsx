'use client';

import { useEffect, useState } from 'react';
import PricingModal from '@/components/PricingModal';

/**
 * Layout-owned listener for `open-pricing-modal`. Upgrade CTAs across Chat,
 * Alerts, Data Platform, and API 402 handlers dispatch this event; Settings
 * used to be the only mounted listener, so clicks did nothing elsewhere.
 */
export default function GlobalPricingModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-pricing-modal', handler);
    return () => window.removeEventListener('open-pricing-modal', handler);
  }, []);

  return <PricingModal visible={open} onClose={() => setOpen(false)} />;
}
