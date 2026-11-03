'use client';

import React from 'react';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { PluginStateItem } from '@/services/pluginService';

interface PluginConfirmModalProps {
  plugin: PluginStateItem | null;
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PluginConfirmModal: React.FC<PluginConfirmModalProps> = ({
  plugin,
  open,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!plugin) return null;

  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-2">
          <ExclamationCircleOutlined className="text-[var(--ant-color-warning)]" />
          <span>Disable {plugin.name}?</span>
        </span>
      }
      okText="Disable Plug-in"
      okButtonProps={{ danger: true, loading, 'data-testid': 'confirm-disable-plugin-btn' }}
      cancelText="Cancel"
      onOk={onConfirm}
      onCancel={onCancel}
      destroyOnClose
    >
      <p className="mt-2 text-sm leading-relaxed text-[var(--ant-color-text-secondary)]">
        Disabling this plug-in will temporarily hide its charts and pause connector queries for your
        organization. Saved dashboards and database configurations will remain completely safe and
        intact.
      </p>
    </Modal>
  );
};

