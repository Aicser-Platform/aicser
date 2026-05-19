'use client';

import React from 'react';
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

interface SchedulePublishModalsProps {
  // Auto send modal
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

  // Automation list modal
  isAutomationListOpen: boolean;
  setIsAutomationListOpen: (open: boolean) => void;
  isLoadingScheduledEmails: boolean;
  scheduledEmails: any[];
  isDeletingScheduleId: string | null;
  isTogglingScheduleId: string | null;
  handleDeleteSchedule: (id: string) => void;
  openEditAutomationModal: (schedule: any) => void;
  handleToggleScheduleEnabled: (schedule: any, enabled: boolean) => void;

  // Edit automation modal
  isEditAutomationOpen: boolean;
  setIsEditAutomationOpen: (open: boolean) => void;
  isSavingEditAutomation: boolean;
  editingAutomationForm: any;
  setEditingAutomationForm: (form: any | ((prev: any) => any)) => void;
  handleUpdateSchedule: (activate: boolean) => void;

  // Shared
  sharedDashboardUrl: string;
  handlePreviewDashboard: () => void;
  handleCopySharedLink: () => void;
}

export const SchedulePublishModals: React.FC<SchedulePublishModalsProps> = ({
  // Auto send modal
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

  // Automation list modal
  isAutomationListOpen,
  setIsAutomationListOpen,
  isLoadingScheduledEmails,
  scheduledEmails,
  isDeletingScheduleId,
  isTogglingScheduleId,
  handleDeleteSchedule,
  openEditAutomationModal,
  handleToggleScheduleEnabled,

  // Edit automation modal
  isEditAutomationOpen,
  setIsEditAutomationOpen,
  isSavingEditAutomation,
  editingAutomationForm,
  setEditingAutomationForm,
  handleUpdateSchedule,

  // Shared
  sharedDashboardUrl,
  handlePreviewDashboard,
  handleCopySharedLink,
}) => {
  return (
    <>
      {/* Auto Send Modal */}
      <Modal
        title="Auto send dashboard"
        open={isAutoSendOpen}
        onCancel={() => setIsAutoSendOpen(false)}
        onOk={handleSaveAutoSend}
        okText="Confirm"
        cancelText="Cancel"
        confirmLoading={isSavingAutoSend}
        okButtonProps={{ disabled: autoSendForm.recipients.length === 0 }}
        className="auto-send-modal"
        destroyOnClose
      >
        <div className="auto-send-modal-body">
          <p className="auto-send-note">
            All data will be calculated because "Analyze data based on visitors' permissions" feature doesn't apply to
            Auto-send dashboard.
          </p>

          <div className="auto-send-section-title">Step 1. Set schedule</div>
          <div className="auto-send-panel">
            <div className="auto-send-schedule-grid">
              <div className="auto-send-schedule-field">
                <div className="auto-send-field-label auto-send-label-with-required">
                  <span>Send date and time</span>
                  <span className="auto-send-required-indicator" title="Required field" aria-label="Required field">
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
                  <span>Repeat</span>
                  <span className="auto-send-required-indicator" title="Required field" aria-label="Required field">
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
          </div>

          <div className="auto-send-section-title">Step 2. Compose email</div>
          <div className="auto-send-panel">
            <div className="auto-send-label-row">
              <div className="auto-send-label-with-icon">
                <CalendarOutlined />
                <span>Recipients</span>
              </div>
              <span className="auto-send-required-indicator" title="Required field" aria-label="Required field">
                *
              </span>
            </div>
            <p className="auto-send-field-help">Add at least one recipient to enable Confirm.</p>

            <div className="auto-send-field-label">Dashboard link</div>
            <div className="auto-send-link-row">
              <Input value={sharedDashboardUrl} readOnly />
              <Button icon={<EyeOutlined />} onClick={handlePreviewDashboard}>
                Preview
              </Button>
              <Button icon={<CopyOutlined />} onClick={handleCopySharedLink}>
                Copy
              </Button>
            </div>

            <div className="auto-send-field-label auto-send-label-with-required auto-send-inline-label-required">
              <span>Organization members</span>
              <span className="auto-send-required-indicator" title="Required field" aria-label="Required field">
                *
              </span>
            </div>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              optionLabelProp="value"
              placeholder="Select organization members"
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
              notFoundContent={isLoadingOrgMembers ? <Spin size="small" /> : 'No organization members found'}
            />

            <div className="auto-send-field-label">External recipients (optional)</div>
            <div className="auto-send-external-add-row">
              <Input
                value={externalRecipientInput}
                onChange={(e) => setExternalRecipientInput(e.target.value)}
                placeholder="Add external email"
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
                Add
              </Button>
            </div>

            <p className="auto-send-recipient-hint">
              Select organization members above. Use Add for emails outside your organization.
            </p>

            <div className="auto-send-field-label">Title</div>
            <Input
              value={autoSendForm.subject}
              onChange={(e) => setAutoSendForm((prev: any) => ({ ...prev, subject: e.target.value }))}
              placeholder="Email subject"
              maxLength={255}
            />

            <div className="auto-send-field-label">Message</div>
            <Input.TextArea
              className="auto-send-message-input"
              value={autoSendForm.body}
              onChange={(e) => setAutoSendForm((prev: any) => ({ ...prev, body: e.target.value }))}
              placeholder="Email message/body"
              autoSize={{ minRows: 5, maxRows: 10 }}
            />
          </div>
        </div>
      </Modal>

      {/* Scheduled Automations List Modal */}
      <Modal
        title="Scheduled Automations"
        open={isAutomationListOpen}
        onCancel={() => setIsAutomationListOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        {isLoadingScheduledEmails ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin size="small" />
          </div>
        ) : scheduledEmails.length === 0 ? (
          <Empty description="No automations yet" style={{ padding: '20px 0' }} />
        ) : (
          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
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
                      {!schedule.enabled && <Tag color="red">Disabled</Tag>}
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
                      {schedule.to_emails.length} recipient{schedule.to_emails.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
                      {normalizeScheduleType(schedule.schedule_type) === 'once'
                        ? `Sent at: ${schedule.last_send_at ? new Date(schedule.last_send_at).toLocaleString() : 'Pending'}`
                        : `Next send: ${new Date(schedule.next_send_at).toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>
                      Timezone: {schedule.timezone}
                    </div>
                  </div>
                  <Space size={8}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditAutomationModal(schedule)}>
                      Edit
                    </Button>
                    <Switch
                      size="small"
                      checked={schedule.enabled}
                      loading={isTogglingScheduleId === schedule.id}
                      onChange={(checked) => handleToggleScheduleEnabled(schedule, checked)}
                    />
                    <Popconfirm
                      title="Delete automation"
                      description="Are you sure you want to delete this automation?"
                      onConfirm={() => handleDeleteSchedule(schedule.id)}
                      okText="Delete"
                      cancelText="Cancel"
                      okButtonProps={{ danger: true, loading: isDeletingScheduleId === schedule.id }}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={isDeletingScheduleId === schedule.id}
                      >
                        Delete
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Automation Modal */}
      <Modal
        title="Edit Automation"
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
              Save only
            </Button>
            <Button type="primary" onClick={() => handleUpdateSchedule(true)} loading={isSavingEditAutomation}>
              Save and activate
            </Button>
          </Space>
        }
        destroyOnClose
      >
        {editingAutomationForm && (
          <div className="edit-automation-layout">
            <div className="edit-automation-col">
              <div className="edit-automation-col-title">When the following conditions are met:</div>
              <div className="edit-automation-step">Step 1</div>
              <div className="edit-automation-card">
                <div className="edit-automation-card-title">At scheduled time</div>
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
            </div>

            <div className="edit-automation-col">
              <div className="edit-automation-col-title">Perform the following actions:</div>
              <div className="edit-automation-step">Step 2</div>
              <div className="edit-automation-card">
                <div className="edit-automation-card-title">Send an email message</div>

                <div className="edit-automation-field-label">To</div>
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  optionLabelProp="value"
                  className="edit-automation-recipient-select"
                  placeholder="Add recipients"
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
                  placeholder="Add external email and press Enter"
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

                <div className="edit-automation-field-label">Title</div>
                <Input
                  value={editingAutomationForm.subject}
                  onChange={(e) =>
                    setEditingAutomationForm((prev: any) => (prev ? { ...prev, subject: e.target.value } : prev))
                  }
                  placeholder="Email subject"
                  maxLength={255}
                />

                <div className="edit-automation-field-label">Message</div>
                <Input.TextArea
                  className="edit-automation-message-input"
                  value={editingAutomationForm.body}
                  onChange={(e) =>
                    setEditingAutomationForm((prev: any) => (prev ? { ...prev, body: e.target.value } : prev))
                  }
                  placeholder="Email message/body"
                  autoSize={{ minRows: 8, maxRows: 14 }}
                />

                <div className="edit-automation-enabled-row">
                  <span>Enabled</span>
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
