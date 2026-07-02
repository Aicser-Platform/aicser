'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import type { PricingModalProps } from './PricingModal.types';

export type { PricingModalProps } from './PricingModal.types';

const NoopPricingModal: ComponentType<PricingModalProps> = () => null;

const edition = (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase();
const isEnterpriseEdition = edition === 'enterprise' || edition === 'ee';

const PricingModalEE = dynamic(
  () => import('@/ee').then((m) => ({ default: m.PricingModalEE })),
  { ssr: false },
) as ComponentType<PricingModalProps>;

const PricingModal: ComponentType<PricingModalProps> =
  isEnterpriseEdition ? PricingModalEE : NoopPricingModal;

export default PricingModal;
