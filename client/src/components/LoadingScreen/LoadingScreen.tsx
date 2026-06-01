'use client';

import { useTranslations } from 'next-intl';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

type LoadingScreenProps = {
  tip?: string;
};

const LoadingScreen = ({ tip }: LoadingScreenProps) => {
  const t = useTranslations('common');
  return <AppLoadingIndicator variant="full" tip={tip ?? t('loading')} />;
};

export default LoadingScreen;
