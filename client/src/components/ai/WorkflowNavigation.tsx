'use client';

import React from 'react';
import { Button, Progress, Space, Steps } from 'antd';
import { useTranslations } from 'next-intl';

export interface WorkflowStep {
  key: string;
  title: string;
  description?: string;
  isRequired?: boolean;
  canSkip?: boolean;
  isCompleted?: boolean;
}

interface WorkflowNavigationProps {
  currentStep: number;
  totalSteps: number;
  steps: WorkflowStep[];
  onStepChange: (step: number) => void;
  onCancel: () => void;
  onSave?: () => void;
  onComplete: () => void;
  loading?: boolean;
  canProceed?: boolean;
  showProgress?: boolean;
  customActions?: React.ReactNode;
}

export const WorkflowNavigation: React.FC<WorkflowNavigationProps> = ({
  currentStep,
  totalSteps,
  steps,
  onStepChange,
  onCancel,
  onSave,
  onComplete,
  loading = false,
  canProceed = true,
  showProgress = false,
  customActions,
}) => {
  const t = useTranslations('workflow');
  const isLast = currentStep === totalSteps - 1;
  const progressPercent = Math.round(((currentStep + 1) / totalSteps) * 100);

  return (
    <div style={{ marginTop: 24 }}>
      {showProgress && (
        <Progress
          percent={progressPercent}
          size="small"
          style={{ marginBottom: 16 }}
        />
      )}

      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={steps.map((s) => ({
          key: s.key,
          title: s.title,
          description: s.description,
          status: s.isCompleted
            ? 'finish'
            : steps.indexOf(s) === currentStep
              ? 'process'
              : steps.indexOf(s) < currentStep
                ? 'finish'
                : 'wait',
        }))}
        onChange={onStepChange}
      />

      <Space style={{ justifyContent: 'flex-end', width: '100%', display: 'flex' }}>
        <Button onClick={onCancel} disabled={loading}>
          {t('cancel')}
        </Button>

        {currentStep > 0 && (
          <Button onClick={() => onStepChange(currentStep - 1)} disabled={loading}>
            {t('previous')}
          </Button>
        )}

        {customActions}

        {onSave && steps[currentStep]?.canSkip && (
          <Button onClick={onSave} disabled={loading}>
            {t('save_skip')}
          </Button>
        )}

        {!isLast ? (
          <Button
            type="primary"
            onClick={() => onStepChange(currentStep + 1)}
            disabled={!canProceed || loading}
            loading={loading}
          >
            {t('next')}
          </Button>
        ) : (
          <Button
            type="primary"
            onClick={onComplete}
            disabled={!canProceed || loading}
            loading={loading}
          >
            {t('complete')}
          </Button>
        )}
      </Space>
    </div>
  );
};

export default WorkflowNavigation;
