'use client';

import React from 'react';
import { Alert, Input, Modal } from 'antd';
import { useTranslations } from 'next-intl';
import { CREATE_NEW_DASHBOARD_ID } from '@/hooks/useAddChartToDashboard';
import { DashboardLibrarySelect } from '@/app/(dashboard)/dashboards/components/DashboardLibrarySelect';

type AddChartToDashboardModalProps = {
  open: boolean;
  dashboards: Array<{ id: string; label: string }>;
  targetDashboardId: string | null;
  onTargetChange: (id: string) => void;
  creatingNew?: boolean;
  newDashboardName?: string;
  onNewDashboardNameChange?: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  subtitle?: string;
};

export function AddChartToDashboardModal({
  open,
  dashboards,
  targetDashboardId,
  onTargetChange,
  creatingNew = false,
  newDashboardName = '',
  onNewDashboardNameChange,
  onConfirm,
  onCancel,
  confirmLoading,
  subtitle,
}: AddChartToDashboardModalProps) {
  const t = useTranslations('chat');
  const noDashboards = dashboards.length === 0 && !targetDashboardId;
  const showCreateForm =
    creatingNew || targetDashboardId === CREATE_NEW_DASHBOARD_ID;

  return (
    <Modal
      title={t('pin_to_dashboard')}
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={
        showCreateForm && noDashboards
          ? t('pin_dashboard_create_and_add')
          : t('pin_to_dashboard_confirm')
      }
      confirmLoading={confirmLoading}
    >
      {noDashboards && !showCreateForm ? (
        <Alert
          type="info"
          showIcon
          message={t('pin_dashboard_no_dashboards')}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {!showCreateForm || !noDashboards ? (
        <DashboardLibrarySelect
          value={
            targetDashboardId === CREATE_NEW_DASHBOARD_ID
              ? CREATE_NEW_DASHBOARD_ID
              : targetDashboardId
          }
          onChange={(id) => onTargetChange(id || CREATE_NEW_DASHBOARD_ID)}
          placeholder={t('pin_dashboard_select')}
          defaultFacet="recent"
          extraOptions={[{ value: CREATE_NEW_DASHBOARD_ID, label: t('pin_dashboard_create_new') }]}
        />
      ) : null}

      {showCreateForm ? (
        <Input
          style={{ marginTop: 12 }}
          placeholder={t('pin_dashboard_name_placeholder')}
          value={newDashboardName}
          onChange={(e) => onNewDashboardNameChange?.(e.target.value)}
          onPressEnter={onConfirm}
          maxLength={120}
          showCount
        />
      ) : null}

      {subtitle ? (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
          {subtitle}
        </p>
      ) : null}
    </Modal>
  );
}

export default AddChartToDashboardModal;
