'use client';

import React, { useEffect, useState } from 'react';
import {
  Drawer,
  List,
  Button,
  Popconfirm,
  Typography,
  Space,
  Input,
  Empty,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  HistoryOutlined,
  DeleteOutlined,
  UndoOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useDashboardStore, type DashboardVersion } from '../stores/useDashboardStore';

const { Text } = Typography;

interface VersionHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

function relativeTime(epoch: number): string {
  const diff = Date.now() - epoch;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function VersionHistoryDrawer({ open, onClose }: VersionHistoryDrawerProps) {
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const versions = useDashboardStore((s) => s.dashboardVersions);
  const loadVersionHistory = useDashboardStore((s) => s.loadVersionHistory);
  const saveVersionSnapshot = useDashboardStore((s) => s.saveVersionSnapshot);
  const restoreVersionSnapshot = useDashboardStore((s) => s.restoreVersionSnapshot);
  const deleteVersionSnapshot = useDashboardStore((s) => s.deleteVersionSnapshot);

  const [snapshotLabel, setSnapshotLabel] = useState('');

  useEffect(() => {
    if (open && activeDashboardId) {
      loadVersionHistory(activeDashboardId);
    }
  }, [open, activeDashboardId, loadVersionHistory]);

  const handleSave = () => {
    const label = snapshotLabel.trim() || new Date().toLocaleString();
    saveVersionSnapshot(label);
    setSnapshotLabel('');
    message.success('Version snapshot saved');
  };

  const handleRestore = (version: DashboardVersion) => {
    restoreVersionSnapshot(version.id);
    message.success(`Restored: ${version.label}`);
    onClose();
  };

  return (
    <Drawer
      title={
        <Space>
          <HistoryOutlined />
          Version History
        </Space>
      }
      placement="right"
      width={360}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
      extra={null}
    >
      {/* Save snapshot UI */}
      <div style={{ padding: '16px 16px 0' }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          Save a named snapshot of the current dashboard layout. Snapshots are stored locally in the
          browser.
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="Snapshot label (optional)"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onPressEnter={handleSave}
            maxLength={80}
            prefix={<SaveOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
          />
          <Button type="primary" onClick={handleSave}>
            Save
          </Button>
        </Space.Compact>
      </div>

      <div style={{ padding: '12px 16px 4px' }}>
        <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Saved snapshots ({versions.length}/20)
        </Text>
      </div>

      {versions.length === 0 ? (
        <div style={{ padding: 32 }}>
          <Empty
            description="No snapshots yet. Save one above to record the current state."
            imageStyle={{ height: 48 }}
          />
        </div>
      ) : (
        <List
          dataSource={versions}
          renderItem={(v) => (
            <List.Item
              style={{ padding: '10px 16px', alignItems: 'flex-start' }}
              actions={[
                <Tooltip title="Restore this snapshot" key="restore">
                  <Popconfirm
                    title="Restore this version?"
                    description="The current layout will be auto-saved as a recovery point before restoring."
                    onConfirm={() => handleRestore(v)}
                    okText="Restore"
                    cancelText="Cancel"
                  >
                    <Button size="small" icon={<UndoOutlined />} />
                  </Popconfirm>
                </Tooltip>,
                <Popconfirm
                  key="delete"
                  title="Delete this snapshot?"
                  onConfirm={() => deleteVersionSnapshot(v.id)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  cancelText="Cancel"
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Text style={{ fontSize: 13, fontWeight: 500 }} ellipsis>
                    {v.label}
                  </Text>
                }
                description={
                  <Space size={4} wrap>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {relativeTime(v.savedAt)}
                    </Text>
                    <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                      {v.widgets.length} widget{v.widgets.length !== 1 ? 's' : ''}
                    </Tag>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
