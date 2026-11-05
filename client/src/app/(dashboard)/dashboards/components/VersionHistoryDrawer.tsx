'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Input, Popconfirm, Space, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useFormatter, useTranslations } from 'next-intl';
import { HistoryList } from '@/components/history/HistoryList';
import { useDashboardStore, type DashboardVersion } from '../stores/useDashboardStore';

const { Text } = Typography;

interface VersionHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function VersionHistoryDrawer({ open, onClose }: VersionHistoryDrawerProps) {
  const t = useTranslations('asset_history');
  const format = useFormatter();
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const versions = useDashboardStore((s) => s.dashboardVersions);
  const isLoadingVersions = useDashboardStore((s) => s.isLoadingVersions);
  const versionsError = useDashboardStore((s) => s.versionsError);
  const loadVersionHistory = useDashboardStore((s) => s.loadVersionHistory);
  const saveVersionSnapshot = useDashboardStore((s) => s.saveVersionSnapshot);
  const restoreVersionSnapshot = useDashboardStore((s) => s.restoreVersionSnapshot);
  const deleteVersionSnapshot = useDashboardStore((s) => s.deleteVersionSnapshot);

  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open && activeDashboardId) {
      loadVersionHistory(activeDashboardId);
    }
  }, [open, activeDashboardId, loadVersionHistory]);

  const handleSave = async () => {
    const label = snapshotLabel.trim() || new Date().toLocaleString();
    setIsSaving(true);
    try {
      await saveVersionSnapshot(label);
      setSnapshotLabel('');
      message.success(t('snapshot_saved'));
    } catch {
      message.error(t('snapshot_save_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = async (version: DashboardVersion) => {
    setRestoringId(version.id);
    try {
      await restoreVersionSnapshot(version.id);
      message.success(t('restored'));
      onClose();
    } catch {
      message.error(t('restore_failed'));
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (version: DashboardVersion) => {
    setDeletingId(version.id);
    try {
      await deleteVersionSnapshot(version.id);
    } catch {
      message.error(t('snapshot_delete_failed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Drawer title={t('title')} width={420} open={open} onClose={onClose}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{t('snapshot_hint')}</Text>
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input
          placeholder={t('snapshot_label')}
          value={snapshotLabel}
          onChange={(e) => setSnapshotLabel(e.target.value)}
          onPressEnter={handleSave}
          maxLength={80}
          disabled={isSaving}
          prefix={<SaveOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
        />
        <Button type="primary" onClick={handleSave} loading={isSaving}>{t('snapshot_save')}</Button>
      </Space.Compact>
      {versionsError ? <Alert type="error" showIcon message={versionsError} style={{ marginBottom: 12 }} /> : null}
      <HistoryList
        loading={isLoadingVersions && versions.length === 0}
        restoreLabel={t('restore')}
        emptyLabel={t('snapshot_empty')}
        restoringId={restoringId}
        onRestore={(id) => {
          const version = versions.find((v) => v.id === id);
          if (version) void handleRestore(version);
        }}
        entries={versions.map((v) => ({
          id: v.id,
          title: v.label,
          disabled: deletingId === v.id,
          detail: `${format.relativeTime(new Date(v.savedAt))} · ${t('snapshot_charts', { count: v.widgetCount })}`,
          extra: (
            <Popconfirm
              title={t('snapshot_delete_title')}
              onConfirm={() => handleDelete(v)}
              okText={t('snapshot_delete')}
              okButtonProps={{ danger: true }}
            >
              <Tooltip title={t('snapshot_delete')}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={t('snapshot_delete')} loading={deletingId === v.id} />
              </Tooltip>
            </Popconfirm>
          ),
        }))}
      />
    </Drawer>
  );
}
