'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Button, Space, Spin, Popconfirm, Tag, Empty, Switch } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { formatRuleText, normalizeScheduleType } from '../hooks/useAutomationManager';
import { useDataSources } from '@/hooks/useDataSources';
import { DashboardEmailFields } from './DashboardEmailFields';

interface SchedulePublishModalsProps {
  isAutoSendOpen: boolean;
  setIsAutoSendOpen: (open: boolean) => void;
  isSavingAutoSend: boolean;
  autoSendForm: {
    scheduleAt: any;
    frequency: string;
    recipients: string[];
    subject: string;
    body: string;
    dataSourceId: string | null;
    refreshDataBeforeSend: boolean;
    attachPdfReport?: boolean;
  };
  setAutoSendForm: (form: any | ((prev: any) => any)) => void;
  handleSaveAutoSend: () => void;
  /** @deprecated recipients are typed straight into the guided form */
  externalRecipientInput?: string;
  setExternalRecipientInput?: (value: string) => void;
  addExternalRecipient?: (email: string) => void;
  isLoadingOrgMembers: boolean;
  orgMemberEmails: string[];
  orgMemberLabelMap: Record<string, string>;
  isAutomationListOpen: boolean;
  setIsAutomationListOpen: (open: boolean) => void;
  isLoadingScheduledEmails: boolean;
  scheduledEmails: any[];
  isDeletingScheduleId: string | null;
  isTogglingScheduleId: string | null;
  handleDeleteSchedule: (id: string) => void;
  openEditAutomationModal: (schedule: any) => void;
  handleToggleScheduleEnabled: (schedule: any, enabled: boolean) => void;
  isEditAutomationOpen: boolean;
  setIsEditAutomationOpen: (open: boolean) => void;
  isSavingEditAutomation: boolean;
  editingAutomationForm: any;
  setEditingAutomationForm: (form: any | ((prev: any) => any)) => void;
  handleUpdateSchedule: (activate: boolean) => void;
  sharedDashboardUrl: string;
  handlePreviewDashboard: () => void;
  handleCopySharedLink: () => void;
}

export const SchedulePublishModals: React.FC<SchedulePublishModalsProps> = ({
  isAutoSendOpen,
  setIsAutoSendOpen,
  isSavingAutoSend,
  autoSendForm,
  setAutoSendForm,
  handleSaveAutoSend,
  isLoadingOrgMembers,
  orgMemberEmails,
  orgMemberLabelMap,
  isAutomationListOpen,
  setIsAutomationListOpen,
  isLoadingScheduledEmails,
  scheduledEmails,
  isDeletingScheduleId,
  isTogglingScheduleId,
  handleDeleteSchedule,
  openEditAutomationModal,
  handleToggleScheduleEnabled,
  isEditAutomationOpen,
  setIsEditAutomationOpen,
  isSavingEditAutomation,
  editingAutomationForm,
  setEditingAutomationForm,
  handleUpdateSchedule,
  sharedDashboardUrl,
  handlePreviewDashboard,
  handleCopySharedLink,
}) => {
  const t = useTranslations('dashboard_tabs');
  const { dataSources } = useDataSources();
  const dataSourceOptions = dataSources.map((ds: { id: string; name: string }) => ({ value: ds.id, label: ds.name }));

  return (
    <>
      <Modal
        title={t('schedule_modal_title')}
        open={isAutoSendOpen}
        onCancel={() => setIsAutoSendOpen(false)}
        onOk={handleSaveAutoSend}
        okText={t('confirm')}
        cancelText={t('cancel')}
        confirmLoading={isSavingAutoSend}
        okButtonProps={{ disabled: autoSendForm.recipients.length === 0 }}
        className="auto-send-modal"
        width={600}
        // Long form: header and Save/Cancel stay on screen; only the body scrolls.
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        <DashboardEmailFields
          form={autoSendForm}
          setForm={setAutoSendForm}
          orgMemberEmails={orgMemberEmails}
          orgMemberLabelMap={orgMemberLabelMap}
          isLoadingOrgMembers={isLoadingOrgMembers}
          dataSourceOptions={dataSourceOptions}
          sharedDashboardUrl={sharedDashboardUrl}
          onPreview={handlePreviewDashboard}
          onCopyLink={handleCopySharedLink}
        />
      </Modal>

      <Modal
        title={t('schedule_list_title')}
        open={isAutomationListOpen}
        onCancel={() => setIsAutomationListOpen(false)}
        footer={null}
        width={720}
        // Long form: header and Save/Cancel stay on screen; only the body scrolls.
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        destroyOnHidden
      >
        {isLoadingScheduledEmails ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin size="small" />
          </div>
        ) : scheduledEmails.length === 0 ? (
          <Empty description={t('schedule_list_empty')} style={{ padding: '20px 0' }} />
        ) : (
          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scheduledEmails.map((schedule) => (
                <div
                  key={schedule.id}
                  style={{
                    border: '1px solid var(--ant-color-border)',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Tag color={schedule.enabled ? 'blue' : 'default'}>
                        {normalizeScheduleType(schedule.schedule_type).toUpperCase()}
                      </Tag>
                      {!schedule.enabled && <Tag color="red">{t('schedule_disabled')}</Tag>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{schedule.subject}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{formatRuleText(schedule)}</div>
                    <div
                      style={{
                        display: 'block',
                        fontSize: 12,
                        color: 'var(--ant-color-text-secondary)',
                        marginBottom: 6,
                        maxWidth: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={schedule.body}
                    >
                      {schedule.body}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
                      {t('schedule_recipients_count', { count: schedule.to_emails.length })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
                      {normalizeScheduleType(schedule.schedule_type) === 'once'
                        ? t('schedule_sent_at', {
                            time: schedule.last_send_at
                              ? new Date(schedule.last_send_at).toLocaleString()
                              : t('schedule_pending'),
                          })
                        : t('schedule_next_send', { time: new Date(schedule.next_send_at).toLocaleString() })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>
                      {t('schedule_timezone', { zone: schedule.timezone })}
                    </div>
                  </div>
                  <Space size={8}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditAutomationModal(schedule)}>
                      {t('schedule_edit')}
                    </Button>
                    <Switch
                      size="small"
                      checked={schedule.enabled}
                      loading={isTogglingScheduleId === schedule.id}
                      onChange={(checked) => handleToggleScheduleEnabled(schedule, checked)}
                    />
                    <Popconfirm
                      title={t('schedule_delete_title')}
                      description={t('schedule_delete_confirm')}
                      onConfirm={() => handleDeleteSchedule(schedule.id)}
                      okText={t('delete')}
                      cancelText={t('cancel')}
                      okButtonProps={{ danger: true, loading: isDeletingScheduleId === schedule.id }}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={isDeletingScheduleId === schedule.id}
                      >
                        {t('delete')}
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={t('schedule_edit_title')}
        open={isEditAutomationOpen}
        width={600}
        className="edit-automation-modal"
        // Long form: header and Save/Cancel stay on screen; only the body scrolls.
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        onCancel={() => {
          setIsEditAutomationOpen(false);
          setEditingAutomationForm(null);
        }}
        footer={
          <Space>
            <Button onClick={() => handleUpdateSchedule(false)} loading={isSavingEditAutomation}>
              {t('schedule_save_only')}
            </Button>
            <Button type="primary" onClick={() => handleUpdateSchedule(true)} loading={isSavingEditAutomation}>
              {t('schedule_save_activate')}
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {editingAutomationForm && (
          <>
            <DashboardEmailFields
              form={editingAutomationForm}
              setForm={(updater) => setEditingAutomationForm((prev: any) => (prev ? updater(prev) : prev))}
              orgMemberEmails={orgMemberEmails}
              orgMemberLabelMap={orgMemberLabelMap}
              isLoadingOrgMembers={isLoadingOrgMembers}
              dataSourceOptions={dataSourceOptions}
              sharedDashboardUrl={sharedDashboardUrl}
              onPreview={handlePreviewDashboard}
              onCopyLink={handleCopySharedLink}
            />
            <div className="edit-automation-enabled-row">
              <span>{t('schedule_enabled')}</span>
              <Switch
                checked={editingAutomationForm.enabled}
                onChange={(checked) =>
                  setEditingAutomationForm((prev: any) => (prev ? { ...prev, enabled: checked } : prev))
                }
              />
            </div>
          </>
        )}
      </Modal>
    </>
  );
};
