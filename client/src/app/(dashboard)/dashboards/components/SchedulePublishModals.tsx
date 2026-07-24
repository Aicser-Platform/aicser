'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Modal, Button, Space, Input, Select, message, Spin, DatePicker, Popconfirm, Tag, Empty, Switch } from 'antd';
import {
  PlusOutlined,
  CalendarOutlined,
  EyeOutlined,
  CopyOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import {
  SCHEDULE_TYPE_OPTIONS,
  EMAIL_REGEX,
  formatRuleText,
  normalizeScheduleType,
} from '../hooks/useAutomationManager';
import { useDataSources } from '@/hooks/useDataSources';

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
  };
  setAutoSendForm: (form: any | ((prev: any) => any)) => void;
  handleSaveAutoSend: () => void;
  externalRecipientInput: string;
  setExternalRecipientInput: (value: string) => void;
  addExternalRecipient: (email: string) => void;
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
  externalRecipientInput,
  setExternalRecipientInput,
  addExternalRecipient,
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
        destroyOnHidden
      >
        <div className="auto-send-modal-body">
          <p className="auto-send-note">{t('schedule_modal_note')}</p>

          <div className="auto-send-section-title">{t('schedule_when')}</div>
          <div className="auto-send-panel">
            <div className="auto-send-schedule-grid">
              <div className="auto-send-schedule-field">
                <div className="auto-send-field-label auto-send-label-with-required">
                  <span>{t('schedule_send_at')}</span>
                  <span className="auto-send-required-indicator" title={t('required_field')} aria-label={t('required_field')}>
                    *
                  </span>
                </div>
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY/MM/DD HH:mm"
                  value={autoSendForm.scheduleAt}
                  onChange={(value) => {
                    if (!value) return;
                    setAutoSendForm((prev: any) => ({ ...prev, scheduleAt: value }));
                  }}
                  allowClear={false}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="auto-send-schedule-field auto-send-schedule-field-frequency">
                <div className="auto-send-field-label auto-send-label-with-required">
                  <span>{t('schedule_repeat')}</span>
                  <span className="auto-send-required-indicator" title={t('required_field')} aria-label={t('required_field')}>
                    *
                  </span>
                </div>
                <Select
                  value={autoSendForm.frequency}
                  onChange={(value) => setAutoSendForm((prev: any) => ({ ...prev, frequency: value }))}
                  options={SCHEDULE_TYPE_OPTIONS}
                />
              </div>
            </div>

            <div className="auto-send-field-label" style={{ marginTop: 12 }}>{t('schedule_data_source')}</div>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('schedule_data_source_placeholder')}
              value={autoSendForm.dataSourceId ?? undefined}
              onChange={(value) =>
                setAutoSendForm((prev: any) => ({
                  ...prev,
                  dataSourceId: value ?? null,
                  refreshDataBeforeSend: value ? prev.refreshDataBeforeSend : false,
                }))
              }
              options={dataSourceOptions}
              style={{ width: '100%' }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="auto-send-field-label" style={{ marginBottom: 2 }}>
                  {t('schedule_refresh_before_send')}
                </div>
                <p className="auto-send-field-help" style={{ margin: 0 }}>
                  {t('schedule_refresh_before_send_hint')}
                </p>
              </div>
              <Switch
                checked={autoSendForm.refreshDataBeforeSend}
                disabled={!autoSendForm.dataSourceId}
                onChange={(checked) => setAutoSendForm((prev: any) => ({ ...prev, refreshDataBeforeSend: checked }))}
              />
            </div>
          </div>

          <div className="auto-send-section-title">{t('schedule_email')}</div>
          <div className="auto-send-panel">
            <div className="auto-send-label-row">
              <div className="auto-send-label-with-icon">
                <CalendarOutlined />
                <span>{t('schedule_recipients')}</span>
              </div>
              <span className="auto-send-required-indicator" title={t('required_field')} aria-label={t('required_field')}>
                *
              </span>
            </div>
            <p className="auto-send-field-help">{t('schedule_recipients_hint')}</p>

            <div className="auto-send-field-label">{t('schedule_dashboard_link')}</div>
            <div className="auto-send-link-row">
              <Input value={sharedDashboardUrl} readOnly />
              <Button icon={<EyeOutlined />} onClick={handlePreviewDashboard}>
                {t('preview')}
              </Button>
              <Button icon={<CopyOutlined />} onClick={handleCopySharedLink}>
                {t('copy')}
              </Button>
            </div>

            <div className="auto-send-field-label auto-send-label-with-required auto-send-inline-label-required">
              <span>{t('schedule_org_members')}</span>
              <span className="auto-send-required-indicator" title={t('required_field')} aria-label={t('required_field')}>
                *
              </span>
            </div>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              optionLabelProp="value"
              placeholder={t('schedule_org_members_placeholder')}
              value={autoSendForm.recipients}
              onChange={(value) => {
                const normalizedRecipients = value
                  .map((email: string) => email.trim())
                  .filter(Boolean)
                  .filter(
                    (email: string, index: number, list: string[]) =>
                      list.findIndex((item) => item.toLowerCase() === email.toLowerCase()) === index
                  );
                setAutoSendForm((prev: any) => ({ ...prev, recipients: normalizedRecipients }));
              }}
              className="auto-send-recipient-select"
              maxTagCount={3}
              maxTagTextLength={18}
              loading={isLoadingOrgMembers}
              options={[
                ...orgMemberEmails.map((email) => ({ value: email, label: orgMemberLabelMap[email] || email })),
                ...autoSendForm.recipients
                  .filter(
                    (email: string) =>
                      !orgMemberEmails.some((orgEmail) => orgEmail.toLowerCase() === email.toLowerCase())
                  )
                  .map((email: string) => ({ value: email, label: `${email} (external)` })),
              ]}
              notFoundContent={isLoadingOrgMembers ? <Spin size="small" /> : t('schedule_no_members')}
            />

            <div className="auto-send-field-label">{t('schedule_external')}</div>
            <div className="auto-send-external-add-row">
              <Input
                value={externalRecipientInput}
                onChange={(e) => setExternalRecipientInput(e.target.value)}
                placeholder={t('schedule_external_placeholder')}
                onPressEnter={(e) => {
                  e.preventDefault();
                  addExternalRecipient(externalRecipientInput);
                }}
              />
              <Button
                type="primary"
                className="auto-send-add-email-btn"
                icon={<PlusOutlined />}
                onClick={() => addExternalRecipient(externalRecipientInput)}
              >
                {t('add')}
              </Button>
            </div>

            <p className="auto-send-recipient-hint">{t('schedule_external_hint')}</p>

            <div className="auto-send-field-label">{t('schedule_subject')}</div>
            <Input
              value={autoSendForm.subject}
              onChange={(e) => setAutoSendForm((prev: any) => ({ ...prev, subject: e.target.value }))}
              placeholder={t('schedule_subject_placeholder')}
              maxLength={255}
            />

            <div className="auto-send-field-label">{t('schedule_message')}</div>
            <Input.TextArea
              className="auto-send-message-input"
              value={autoSendForm.body}
              onChange={(e) => setAutoSendForm((prev: any) => ({ ...prev, body: e.target.value }))}
              placeholder={t('schedule_message_placeholder')}
              autoSize={{ minRows: 4, maxRows: 8 }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title={t('schedule_list_title')}
        open={isAutomationListOpen}
        onCancel={() => setIsAutomationListOpen(false)}
        footer={null}
        width={720}
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
        width={980}
        className="edit-automation-modal"
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
          <div className="edit-automation-layout">
            <div className="edit-automation-col">
              <div className="edit-automation-col-title">{t('schedule_when_col')}</div>
              <div className="edit-automation-card">
                <div className="edit-automation-card-title">{t('schedule_at_time')}</div>
                <div className="edit-automation-trigger-row">
                  <DatePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY/MM/DD HH:mm"
                    value={editingAutomationForm.scheduleAt}
                    onChange={(value) => {
                      if (!value) return;
                      setEditingAutomationForm((prev: any) => (prev ? { ...prev, scheduleAt: value } : prev));
                    }}
                    allowClear={false}
                  />
                  <Select
                    value={editingAutomationForm.frequency}
                    style={{ minWidth: 130 }}
                    onChange={(value) =>
                      setEditingAutomationForm((prev: any) => (prev ? { ...prev, frequency: value } : prev))
                    }
                    options={SCHEDULE_TYPE_OPTIONS}
                  />
                </div>
              </div>

              <div className="edit-automation-card">
                <div className="edit-automation-card-title">{t('schedule_data_source')}</div>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('schedule_data_source_placeholder')}
                  value={editingAutomationForm.dataSourceId ?? undefined}
                  onChange={(value) =>
                    setEditingAutomationForm((prev: any) =>
                      prev
                        ? {
                            ...prev,
                            dataSourceId: value ?? null,
                            refreshDataBeforeSend: value ? prev.refreshDataBeforeSend : false,
                          }
                        : prev
                    )
                  }
                  options={dataSourceOptions}
                  style={{ width: '100%' }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginTop: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="edit-automation-field-label" style={{ marginBottom: 2 }}>
                      {t('schedule_refresh_before_send')}
                    </div>
                    <p className="auto-send-field-help" style={{ margin: 0 }}>
                      {t('schedule_refresh_before_send_hint')}
                    </p>
                  </div>
                  <Switch
                    checked={editingAutomationForm.refreshDataBeforeSend}
                    disabled={!editingAutomationForm.dataSourceId}
                    onChange={(checked) =>
                      setEditingAutomationForm((prev: any) => (prev ? { ...prev, refreshDataBeforeSend: checked } : prev))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="edit-automation-col">
              <div className="edit-automation-col-title">{t('schedule_action_col')}</div>
              <div className="edit-automation-card">
                <div className="edit-automation-card-title">{t('schedule_send_email')}</div>

                <div className="edit-automation-field-label">{t('schedule_to')}</div>
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  optionLabelProp="value"
                  className="edit-automation-recipient-select"
                  placeholder={t('schedule_to_placeholder')}
                  value={editingAutomationForm.recipients}
                  onChange={(value) => {
                    const normalizedRecipients = value
                      .map((email: string) => email.trim())
                      .filter(Boolean)
                      .filter(
                        (email: string, index: number, list: string[]) =>
                          list.findIndex((item) => item.toLowerCase() === email.toLowerCase()) === index
                      );
                    setEditingAutomationForm((prev: any) =>
                      prev ? { ...prev, recipients: normalizedRecipients } : prev
                    );
                  }}
                  options={[
                    ...orgMemberEmails.map((email) => ({ value: email, label: orgMemberLabelMap[email] || email })),
                    ...editingAutomationForm.recipients
                      .filter(
                        (email: string) =>
                          !orgMemberEmails.some((orgEmail) => orgEmail.toLowerCase() === email.toLowerCase())
                      )
                      .map((email: string) => ({ value: email, label: `${email} (external)` })),
                  ]}
                  maxTagCount={3}
                  loading={isLoadingOrgMembers}
                />

                <Input
                  value={externalRecipientInput}
                  onChange={(e) => setExternalRecipientInput(e.target.value)}
                  placeholder={t('schedule_external_enter')}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    const email = externalRecipientInput.trim();
                    if (!EMAIL_REGEX.test(email)) {
                      message.warning('Please enter a valid email address.');
                      return;
                    }
                    setEditingAutomationForm((prev: any) => {
                      if (!prev) return prev;
                      if (prev.recipients.some((item: string) => item.toLowerCase() === email.toLowerCase()))
                        return prev;
                      return { ...prev, recipients: [...prev.recipients, email] };
                    });
                    setExternalRecipientInput('');
                  }}
                />

                <div className="edit-automation-field-label">{t('schedule_subject')}</div>
                <Input
                  value={editingAutomationForm.subject}
                  onChange={(e) =>
                    setEditingAutomationForm((prev: any) => (prev ? { ...prev, subject: e.target.value } : prev))
                  }
                  placeholder={t('schedule_subject_placeholder')}
                  maxLength={255}
                />

                <div className="edit-automation-field-label">{t('schedule_message')}</div>
                <Input.TextArea
                  className="edit-automation-message-input"
                  value={editingAutomationForm.body}
                  onChange={(e) =>
                    setEditingAutomationForm((prev: any) => (prev ? { ...prev, body: e.target.value } : prev))
                  }
                  placeholder={t('schedule_message_placeholder')}
                  autoSize={{ minRows: 6, maxRows: 12 }}
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
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
