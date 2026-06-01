'use client';

import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, Typography, Empty, Tag } from 'antd';
import { SaveOutlined, FolderOutlined, ProjectOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/useProjectStore';
import { useUpdateProject } from '@/hooks/useProjects';
import type { TabComponentProps } from '../page';

const { Text } = Typography;

export const ProjectTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const { currentProject } = useProjectStore();
  const updateProjectMutation = useUpdateProject();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentProject) {
      form.setFieldsValue({
        name: currentProject.name || '',
        description: (currentProject as any).description || '',
      });
    }
  }, [currentProject, form]);

  // Register Save button in page header
  useEffect(() => {
    if (!currentProject) { onSetAction?.(null); return; }
    onSetAction?.(
      <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>
        {t('save_changes')}
      </Button>
    );
  }, [saving, currentProject, onSetAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFinish = async (values: any) => {
    if (!currentProject?.id) return;
    setSaving(true);
    try {
      await updateProjectMutation.mutateAsync({ id: currentProject.id, data: values });
      message.success('Project updated.');
    } catch {
      message.error('Failed to update project.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentProject) {
    return (
      <Empty
        image={<FolderOutlined style={{ fontSize: 48, color: 'var(--ant-color-text-tertiary)' }} />}
        description={
          <Text type="secondary">No project selected. Choose a project from the header to manage its settings.</Text>
        }
        style={{ padding: '48px 0' }}
      />
    );
  }

  return (
    <Card
      size="small"
      bordered={false}
      style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
    >
      {/* Project header — same pattern as Profile/Organization */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginBottom: 24,
        paddingBottom: 20,
        borderBottom: '1px solid var(--ant-color-border-secondary)',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 10,
          background: 'var(--ant-color-primary-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid var(--ant-color-border)',
          flexShrink: 0,
        }}>
          <ProjectOutlined style={{ fontSize: 28, color: 'var(--ant-color-primary)' }} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ant-color-text)', lineHeight: 1.3 }}>
            {currentProject.name}
          </div>
          <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
              ID: {String(currentProject.id).slice(0, 8)}…
            </Tag>
          </div>
        </div>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="name"
          label="Project name"
          rules={[{ required: true, message: 'Project name is required' }]}
        >
          <Input placeholder="My Project" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="What this project is for…" />
        </Form.Item>
      </Form>
    </Card>
  );
};
