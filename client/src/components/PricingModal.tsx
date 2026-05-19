'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

interface PricingModalProps {
  visible?: boolean;
  onClose?: () => void;
  onUpgrade?: (planType: string, isYearly: boolean) => void;
  currentPlan?: string;
  loading?: boolean;
  [key: string]: unknown;
}

const PricingModal = dynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.PricingModalEE }))) as any,
  { ssr: false }
) as ComponentType<PricingModalProps>;

export default PricingModal;
