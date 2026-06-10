'use client';

import type { ComponentType } from 'react';
import type { PricingModalProps } from './PricingModal.types';
// Direct path — not @/ee barrel (TrialExpiryBanner cycle). CE builds alias this to PricingModal.noop.
import PricingModalEE from '@/ee/components/PricingModal';

export type { PricingModalProps } from './PricingModal.types';

const NoopPricingModal: ComponentType<PricingModalProps> = () => null;

const edition = (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase();

const PricingModal: ComponentType<PricingModalProps> =
  edition === 'enterprise' || edition === 'ee' ? PricingModalEE : NoopPricingModal;

export default PricingModal;
