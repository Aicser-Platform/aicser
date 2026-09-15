'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Input, List, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, UserAddOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useProjects } from '@/hooks/useProjects';
import { validateShareTarget } from '../embedAssistantShareValidation';

const { Text } = Typography;

interface EmbedAssistantSharePanelProps {
  assistantId: string;
  organizationId?: string;
}

/**
 * Inline "Share with" sub-panel shown in the Access section when
 * visibility="shared" is selected. No dedicated user-search/autocomplete
 * component exists elsewhere in this app (Settings > Team's invite flow
 * takes a raw email in a plain Input, not a lookup against existing users —
 * see TeamTab.tsx) so this mirrors that same email-input pattern rather than
 * inventing a new user-picker. The project picker reuses useProjects, same
 * as TeamTab's "also add to a project" invite step.
 */
export const EmbedAssistantSharePanel: React.FC<EmbedAssistantSharePanelProps> = ({
  assistantId,
  organizationId,
}) => {
  const t = useTranslations('settings');
  const { message } = App.useApp();
  const { projects } = useProjects(organizationId);
  const {
    embedAssistantShares,
    embedAssistantSharesLoading,
    loading,
    loadEmbedAssistantShares,
    addEmbedAssistantShare,
    revokeEmbedAssistantShare,
  } = useSettingsStore();

  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (assistantId) void loadEmbedAssistantShares(assistantId);
  }, [assistantId, loadEmbedAssistantShares]);

  const projectNameById = useMemo(
    () => new Map(projects.map((p: any) => [String(p.id), p.name])),
    [projects]
  );

  const handleAdd = async () => {
    const trimmedEmail = email.trim();
    const err = validateShareTarget(
      { shared_with: trimmedEmail, project_id: projectId },
      {
        both: t('embed_assistant_share_error_both'),
        neither: t('embed_assistant_share_error_neither'),
      }
    );
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    try {
      await addEmbedAssistantShare(assistantId, {
        shared_with: trimmedEmail || undefined,
        project_id: projectId || undefined,
      });
      setEmail('');
      setProjectId(undefined);
      message.success(t('embed_assistant_share_added'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('embed_assistant_share_add_failed'));
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeEmbedAssistantShare(assistantId, shareId);
      message.success(t('embed_assistant_share_revoked'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('embed_assistant_share_revoke_failed'));
    }
  };

  return (
    <div
      style={{
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--ant-color-fill-quaternary)',
      }}
    >
      <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
        {t('embed_assistant_share_title')}
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: 6 }}>
        <Input
          placeholder={t('embed_assistant_share_email_placeholder')}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFormError(null);
          }}
          disabled={!!projectId}
        />
        <Select
          allowClear
          placeholder={t('embed_assistant_share_project_placeholder')}
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setFormError(null);
          }}
          disabled={!!email.trim()}
          style={{ minWidth: 180 }}
          options={projects.map((p: any) => ({ value: p.id, label: p.name }))}
        />
        <Button type="primary" icon={<UserAddOutlined />} loading={loading} onClick={() => void handleAdd()}>
          {t('embed_assistant_share_add')}
        </Button>
      </Space.Compact>
      {formError && (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          {formError}
        </Text>
      )}

      <List
        size="small"
        loading={embedAssistantSharesLoading}
        dataSource={embedAssistantShares}
        locale={{ emptyText: <Empty description={t('embed_assistant_share_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(share) => (
          <List.Item
            actions={[
              <Button
                key="revoke"
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t('embed_assistant_share_revoke')}
                onClick={() => void handleRevoke(share.id)}
              />,
            ]}
          >
            <Space size={6}>
              {share.project_id ? (
                <Tag color="blue">{t('embed_assistant_share_project_tag')}</Tag>
              ) : (
                <Tag color="cyan">{t('embed_assistant_share_user_tag')}</Tag>
              )}
              <Text style={{ fontSize: 13 }}>
                {share.project_id ? projectNameById.get(share.project_id) ?? share.project_id : share.shared_with}
              </Text>
              {share.expires_at && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('embed_assistant_share_expires', {
                    date: new Date(share.expires_at).toLocaleDateString(),
                  })}
                </Text>
              )}
            </Space>
          </List.Item>
        )}
      />
    </div>
  );
};
