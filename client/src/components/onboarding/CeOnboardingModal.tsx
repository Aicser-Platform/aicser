'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Steps, Typography } from 'antd';
import { DatabaseOutlined, LineChartOutlined, RocketOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useDataSources } from '@/hooks/useDataSources';

const STORAGE_KEY = 'ce_onboarding_completed';
export const CE_ONBOARDING_AWAITING_DATA = 'ce_onboarding_awaiting_data';
export const CE_ONBOARDING_DATA_CONNECTED = 'ce-onboarding-data-connected';

export function isCeOnboardingComplete(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markCeOnboardingComplete(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
    sessionStorage.removeItem(CE_ONBOARDING_AWAITING_DATA);
  } catch {
    /* ignore */
  }
}

interface CeOnboardingModalProps {
  onConnectData: () => void;
}

/** CE first-run: welcome → connect data → try query editor. */
export function CeOnboardingModal({ onConnectData }: CeOnboardingModalProps) {
  const t = useTranslations('ce_onboarding');
  const router = useRouter();
  const { dataSources, isLoading } = useDataSources();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isLoading || isCeOnboardingComplete()) return;
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    const onDataConnected = () => {
      if (isCeOnboardingComplete()) return;
      setOpen(true);
      setStep(2);
      try {
        sessionStorage.removeItem(CE_ONBOARDING_AWAITING_DATA);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(CE_ONBOARDING_DATA_CONNECTED, onDataConnected);
    return () => window.removeEventListener(CE_ONBOARDING_DATA_CONNECTED, onDataConnected);
  }, []);

  useEffect(() => {
    if (!open || step !== 1) return;
    if (dataSources.length > 0) {
      setStep(2);
    }
  }, [open, step, dataSources.length]);

  const finish = useCallback(() => {
    markCeOnboardingComplete();
    setOpen(false);
  }, []);

  const handleConnect = () => {
    try {
      sessionStorage.setItem(CE_ONBOARDING_AWAITING_DATA, '1');
    } catch {
      /* ignore */
    }
    onConnectData();
    setStep(1);
  };

  const steps = [
    { title: t('step_welcome_title') },
    { title: t('step_data_title') },
    { title: t('step_explore_title') },
  ];

  return (
    <Modal
      open={open}
      onCancel={finish}
      footer={null}
      width={520}
      centered
      destroyOnClose
      title={t('modal_title')}
      maskClosable={false}
    >
      <Steps
        current={step}
        items={steps}
        size="small"
        style={{ marginBottom: 24 }}
      />

      {step === 0 && (
        <>
          <Typography.Paragraph>{t('step_welcome_body')}</Typography.Paragraph>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={finish}>{t('skip')}</Button>
            <Button type="primary" icon={<RocketOutlined />} onClick={() => setStep(1)}>
              {t('get_started')}
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <Typography.Paragraph>{t('step_data_body')}</Typography.Paragraph>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => setStep(0)}>{t('back')}</Button>
            <Button onClick={finish}>{t('skip')}</Button>
            <Button type="primary" icon={<DatabaseOutlined />} onClick={handleConnect}>
              {t('connect_data')}
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <Typography.Paragraph>{t('step_explore_body')}</Typography.Paragraph>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => setStep(1)}>{t('back')}</Button>
            <Button
              type="primary"
              icon={<LineChartOutlined />}
              onClick={() => {
                finish();
                router.push('/query-editor');
              }}
            >
              {t('open_query_editor')}
            </Button>
            <Button
              onClick={() => {
                finish();
                router.push('/dashboards');
              }}
            >
              {t('build_dashboard')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
