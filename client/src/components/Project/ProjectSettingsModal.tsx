'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Divider, Empty, Form, Input, List, Modal, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, UserAddOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useRoleStore } from '@/stores/useRoleStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  useProjectMembers,
  useUpdateProject,
  useDeleteProject,
  useInviteProjectMember,
  useUpdateProjectMemberRole,
  useRemoveProjectMember,
} from '@/hooks/useProjects';
import { listAvailableProjectMembers } from '@/api/projects';
import type { Project } from '@/types/project';

const { Text } = Typography;

export interface ProjectSettingsModalProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful delete so the caller can clear selection/refresh. */
  onProjectDeleted?: (projectId: string) => void;
}

/**
 * Project settings — edit name/description, manage members, delete project.
 * Wraps the already-built (but previously unconsumed) useProjects.ts mutation
 * hooks and /rbac/roles-backed useRoleStore. Gated by project.my_role:
 * owner/editor can edit + manage members, only owner can delete.
 */
export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  project,
  open,
  onClose,
  onProjectDeleted,
}) => {
  const t = useTranslations('settings');
  const { message, modal } = App.useApp();
  const { projectRoles, fetchProjectRoles } = useRoleStore();

  const [form] = Form.useForm<{ name: string; description?: string }>();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const inviteMember = useInviteProjectMember();
  const updateMemberRole = useUpdateProjectMemberRole();
  const removeMember = useRemoveProjectMember();

  const [inviteUserId, setInviteUserId] = useState<string | undefined>(undefined);
  const [inviteRoleId, setInviteRoleId] = useState<string | undefined>(undefined);

  const canManage = project?.my_role === 'project_owner' || project?.my_role === 'project_editor';
  const isOwner = project?.my_role === 'project_owner';
  const projectId = project?.id;

  const { members, isLoading: membersLoading } = useProjectMembers(open ? projectId : undefined);

  const { data: availableMembers, isLoading: availableLoading } = useQuery({
    queryKey: ['projects', projectId, 'available-members'],
    queryFn: () => listAvailableProjectMembers(projectId!),
    enabled: open && !!projectId && canManage,
  });

  useEffect(() => {
    if (open && project) {
      form.setFieldsValue({ name: project.name, description: project.description || '' });
      void fetchProjectRoles();
      setInviteUserId(undefined);
      setInviteRoleId(undefined);
    }
  }, [open, project, form, fetchProjectRoles]);

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const inviteCandidates = useMemo(
    () => (availableMembers || []).filter((c) => !memberUserIds.has(c.user_id)),
    [availableMembers, memberUserIds]
  );

  const roleLabel = (roleId: string) =>
    projectRoles.find((r) => r.id === roleId)?.display_name || roleId;

  const handleSave = async () => {
    if (!projectId) return;
    try {
      const values = await form.validateFields();
      const updated = await updateProject.mutateAsync({ id: projectId, data: values });
      // Keep the global "active project" store (used by the header/sidebar
      // project switcher) in sync — it's a separate snapshot from the
      // React Query cache this hook invalidates, so editing the active
      // project's name would otherwise look stale until reselected/reloaded.
      const store = useProjectStore.getState();
      if (String(store.currentProject?.id) === String(projectId)) {
        store.selectProject(updated);
      }
      message.success(t('project_settings_saved'));
    } catch (error) {
      if (error instanceof Error) message.error(error.message || t('project_settings_save_failed'));
    }
  };

  const handleInvite = async () => {
    if (!projectId || !inviteUserId || !inviteRoleId) return;
    try {
      await inviteMember.mutateAsync({
        projectId,
        payload: { user_id: inviteUserId, role_id: inviteRoleId },
      });
      message.success(t('project_settings_member_added'));
      setInviteUserId(undefined);
      setInviteRoleId(undefined);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('project_settings_member_add_failed'));
    }
  };

  const handleRoleChange = async (userId: string, roleId: string) => {
    if (!projectId) return;
    try {
      await updateMemberRole.mutateAsync({ projectId, userId, roleId });
      message.success(t('project_settings_member_role_updated'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('project_settings_member_role_update_failed'));
    }
  };

  const handleRemove = (userId: string, label: string) => {
    if (!projectId) return;
    modal.confirm({
      title: t('project_settings_remove_member_title'),
      content: t('project_settings_remove_member_content', { name: label }),
      okText: t('project_settings_remove'),
      okType: 'danger',
      onOk: async () => {
        try {
          await removeMember.mutateAsync({ projectId, userId });
          message.success(t('project_settings_member_removed'));
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('project_settings_member_remove_failed'));
        }
      },
    });
  };

  const handleDelete = () => {
    if (!project) return;
    modal.confirm({
      title: t('project_settings_delete_title'),
      icon: <WarningOutlined style={{ color: 'var(--ant-color-error)' }} />,
      content: t('project_settings_delete_content', { name: project.name }),
      okText: t('project_settings_delete'),
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteProject.mutateAsync(project.id);
          const store = useProjectStore.getState();
          if (String(store.currentProject?.id) === String(project.id)) {
            store.clearProject();
          }
          message.success(t('project_settings_deleted'));
          onProjectDeleted?.(String(project.id));
          onClose();
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('project_settings_delete_failed'));
        }
      },
    });
  };

  return (
    <Modal
      title={t('project_settings_title', { name: project?.name || '' })}
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" disabled={!canManage}>
        <Form.Item name="name" label={t('project_settings_name')} rules={[{ required: true }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label={t('project_settings_description')}>
          <Input.TextArea maxLength={500} rows={2} />
        </Form.Item>
        {canManage && (
          <Form.Item>
            <Button type="primary" loading={updateProject.isPending} onClick={() => void handleSave()}>
              {t('project_settings_save')}
            </Button>
          </Form.Item>
        )}
      </Form>

      <Divider />

      <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
        {t('project_settings_members_title')}
      </Text>

      {canManage && (
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Select
            showSearch
            placeholder={t('project_settings_invite_placeholder')}
            value={inviteUserId}
            onChange={setInviteUserId}
            loading={availableLoading}
            style={{ flex: 1 }}
            optionFilterProp="label"
            options={inviteCandidates.map((c) => ({
              value: c.user_id,
              label: c.email || c.username || c.user_id,
            }))}
          />
          <Select
            placeholder={t('project_settings_role_placeholder')}
            value={inviteRoleId}
            onChange={setInviteRoleId}
            style={{ minWidth: 160 }}
            options={projectRoles.map((r) => ({ value: r.id, label: r.display_name }))}
          />
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            loading={inviteMember.isPending}
            disabled={!inviteUserId || !inviteRoleId}
            onClick={() => void handleInvite()}
          >
            {t('project_settings_invite')}
          </Button>
        </Space.Compact>
      )}

      {membersLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <List
          size="small"
          dataSource={members}
          locale={{ emptyText: <Empty description={t('project_settings_no_members')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(member) => {
            const label = member.full_name || member.email;
            return (
              <List.Item
                actions={
                  canManage
                    ? [
                        <Select
                          key="role"
                          size="small"
                          value={member.role_id}
                          style={{ minWidth: 140 }}
                          disabled={updateMemberRole.isPending}
                          onChange={(roleId) => void handleRoleChange(member.user_id, roleId)}
                          options={projectRoles.map((r) => ({ value: r.id, label: r.display_name }))}
                        />,
                        <Button
                          key="remove"
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          aria-label={t('project_settings_remove')}
                          onClick={() => handleRemove(member.user_id, label)}
                        />,
                      ]
                    : [<Tag key="role">{member.role_display_name || roleLabel(member.role_id)}</Tag>]
                }
              >
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 13 }}>{label}</Text>
                  {member.full_name && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {member.email}
                    </Text>
                  )}
                </Space>
              </List.Item>
            );
          }}
        />
      )}

      {isOwner && (
        <>
          <Divider />
          <Text strong type="danger" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            {t('project_settings_danger_zone')}
          </Text>
          <Button danger icon={<DeleteOutlined />} loading={deleteProject.isPending} onClick={handleDelete}>
            {t('project_settings_delete_project')}
          </Button>
        </>
      )}
    </Modal>
  );
};

export default ProjectSettingsModal;
