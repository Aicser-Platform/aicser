'use client';

import dynamic from 'next/dynamic';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { CeOnboardingModal } from './CeOnboardingModal';

const EEOnboardingBootstrap = dynamic(
  () =>
    import('@/ee/components/onboarding/OnboardingBootstrap').then((m) => ({
      default: m.OnboardingBootstrap,
    })),
  { ssr: false },
);

interface OnboardingBootstrapProps {
  onConnectData?: () => void;
}

/** Mount edition-appropriate onboarding (EE wizard or CE first-run). */
export function OnboardingBootstrap({ onConnectData }: OnboardingBootstrapProps) {
  if (isEnterpriseEdition()) {
    return <EEOnboardingBootstrap />;
  }
  if (!onConnectData) return null;
  return <CeOnboardingModal onConnectData={onConnectData} />;
}
