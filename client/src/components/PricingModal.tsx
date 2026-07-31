'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import type { PricingModalProps } from './PricingModal.types';
import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';

export type { PricingModalProps } from './PricingModal.types';

const NoopPricingModal: ComponentType<PricingModalProps> = () => null;

const edition = (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase();
const isEnterpriseEdition = edition === 'enterprise' || edition === 'ee';
const showHostedBilling = isEnterpriseEdition && !isSelfHostDeploymentFromEnv();

const PricingModalEE = dynamic<PricingModalProps>(
  () => import('@/ee').then((m) => m.PricingModalEE as ComponentType<PricingModalProps>),
  { ssr: false },
) as ComponentType<PricingModalProps>;

const PricingModal: ComponentType<PricingModalProps> =
  showHostedBilling ? PricingModalEE : NoopPricingModal;

export default PricingModal;
