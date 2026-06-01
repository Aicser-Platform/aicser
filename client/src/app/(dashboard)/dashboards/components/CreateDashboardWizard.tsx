'use client';

import React, { useState } from 'react';
import { Modal, Steps, Button, Input, Radio, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { DashboardTemplate } from '../services/chartService';

const { Text } = Typography;

export type WizardLayoutChoice = 'blank' | 'kpi' | 'executive' | 'template';

type Props = {
  open: boolean;
  onClose: () => void;
  templates: DashboardTemplate[];
  onCreateWithLayout: (name: string, layout: WizardLayoutChoice) => Promise<void>;
  onCreateFromTemplate: (template: DashboardTemplate, name?: string) => Promise<void>;
  creating?: boolean;
};

export function CreateDashboardWizard({
  open,
  onClose,
  templates,
  onCreateWithLayout,
  onCreateFromTemplate,
  creating = false,
}: Props) {
  const t = useTranslations('dashboards');
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<WizardLayoutChoice>('kpi');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const reset = () => {
    setStep(0);
    setName('');
    setLayout('kpi');
    setTemplateId(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const finish = async () => {
    const title = name.trim() || t('wizard_default_name');
    if (layout === 'template' && templateId) {
      const template = templates.find((x) => x.id === templateId);
      if (template) {
        await onCreateFromTemplate(template, title);
      }
    } else {
      await onCreateWithLayout(title, layout);
    }
    handleClose();
  };

  return (
    <Modal
      title={t('wizard_title')}
      open={open}
      onCancel={handleClose}
      width={560}
      footer={
        <Space>
          {step > 0 && (
            <Button onClick={() => setStep((s) => s - 1)} disabled={creating}>
              {t('wizard_back')}
            </Button>
          )}
          {step < 2 ? (
            <Button type="primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !name.trim()}>
              {t('wizard_next')}
            </Button>
          ) : (
            <Button type="primary" loading={creating} onClick={() => void finish()}>
              {t('wizard_create')}
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: t('wizard_step_name') },
          { title: t('wizard_step_layout') },
          { title: t('wizard_step_review') },
        ]}
      />

      {step === 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text type="secondary">{t('wizard_name_hint')}</Text>
          <Input
            placeholder={t('wizard_name_placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="large"
            autoFocus
          />
        </Space>
      )}

      {step === 1 && (
        <Radio.Group
          value={layout === 'template' ? `template:${templateId}` : layout}
          onChange={(e) => {
            const v = e.target.value as string;
            if (v.startsWith('template:')) {
              setLayout('template');
              setTemplateId(v.replace('template:', ''));
            } else {
              setLayout(v as WizardLayoutChoice);
              setTemplateId(null);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Radio value="kpi">{t('wizard_layout_kpi')}</Radio>
          <Radio value="executive">{t('wizard_layout_executive')}</Radio>
          <Radio value="blank">{t('wizard_layout_blank')}</Radio>
          {templates.slice(0, 4).map((tpl) => (
            <Radio key={tpl.id} value={`template:${tpl.id}`}>
              {tpl.name}
            </Radio>
          ))}
        </Radio.Group>
      )}

      {step === 2 && (
        <Space direction="vertical">
          <Text>
            <strong>{t('wizard_review_name')}:</strong> {name.trim() || t('wizard_default_name')}
          </Text>
          <Text>
            <strong>{t('wizard_review_layout')}:</strong>{' '}
            {layout === 'template' && templateId
              ? templates.find((x) => x.id === templateId)?.name
              : t(`wizard_layout_${layout}` as 'wizard_layout_kpi')}
          </Text>
          <Text type="secondary">{t('wizard_review_hint')}</Text>
        </Space>
      )}
    </Modal>
  );
}
