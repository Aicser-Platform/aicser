import { useState, useEffect } from 'react';
import { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { message } from 'antd';
import { fetchApi } from '@/utils/api';

export interface OrgMember {
  user_id: string;
  email: string | null;
  username: string | null;
}

export interface ScheduledEmail {
  id: string;
  to_emails: string[];
  subject: string;
  body: string;
  time_of_day: string;
  day_of_week: string | null;
  day_of_month: number | null;
  schedule_type: string;
  next_send_at: string;
  last_send_at: string | null;
  enabled: boolean;
  timezone: string;
  created_at: string;
  updated_at: string;
  data_source_id?: string | null;
  refresh_data_before_send?: boolean;
}

export interface AutomationFormState {
  id: string;
  scheduleAt: Dayjs;
  frequency: ScheduleType;
  recipients: string[];
  timezone: string;
  enabled: boolean;
  subject: string;
  body: string;
  dataSourceId: string | null;
  refreshDataBeforeSend: boolean;
}

export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SCHEDULE_TYPE_OPTIONS: Array<{ value: ScheduleType; label: string }> = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export const normalizeScheduleType = (value: string): ScheduleType => {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('once')) return 'once';
  if (raw.includes('weekly')) return 'weekly';
  if (raw.includes('monthly')) return 'monthly';
  return 'daily';
};

export const formatRuleText = (schedule: ScheduledEmail): string => {
  const type = normalizeScheduleType(schedule.schedule_type);
  const time = schedule.time_of_day || '--:--';
  if (type === 'once') return `Once at ${new Date(schedule.next_send_at).toLocaleString()}`;
  if (type === 'weekly') return `Weekly on ${schedule.day_of_week || 'N/A'} at ${time}`;
  if (type === 'monthly') return `Monthly on day ${schedule.day_of_month || 'N/A'} at ${time}`;
  return `Daily at ${time}`;
};

const getDefaultScheduleAt = (): Dayjs => {
  const now = dayjs();
  const remainder = now.minute() % 15;
  const minutesToNextSlot = remainder === 0 ? 15 : 15 - remainder;
  return now.add(minutesToNextSlot, 'minute').second(0).millisecond(0);
};

interface UseAutomationManagerProps {
  activeDashboardId?: string | null;
  activeDashboardName?: string;
  resolvedOrganizationId?: string;
  sharedDashboardUrl: string;
}

export const useAutomationManager = ({
  activeDashboardId,
  activeDashboardName,
  resolvedOrganizationId,
  sharedDashboardUrl,
}: UseAutomationManagerProps) => {
  // Auto-send modal state
  const [isAutoSendOpen, setIsAutoSendOpen] = useState(false);
  const [isSavingAutoSend, setIsSavingAutoSend] = useState(false);
  const [autoSendForm, setAutoSendForm] = useState<{
    scheduleAt: Dayjs;
    frequency: ScheduleType;
    recipients: string[];
    smartSummaryEnabled: boolean;
    subject: string;
    body: string;
    dataSourceId: string | null;
    refreshDataBeforeSend: boolean;
  }>({
    scheduleAt: getDefaultScheduleAt(),
    frequency: 'daily',
    recipients: [],
    smartSummaryEnabled: true,
    subject: `Dashboard Update: ${activeDashboardName || 'Dashboard'}`,
    body: `Automated dashboard delivery for ${activeDashboardName || 'Dashboard'} (daily).`,
    dataSourceId: null,
    refreshDataBeforeSend: false,
  });

  // Automation list modal state
  const [isAutomationListOpen, setIsAutomationListOpen] = useState(false);
  const [isLoadingScheduledEmails, setIsLoadingScheduledEmails] = useState(false);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [isDeletingScheduleId, setIsDeletingScheduleId] = useState<string | null>(null);
  const [isTogglingScheduleId, setIsTogglingScheduleId] = useState<string | null>(null);

  // Edit automation modal state
  const [isEditAutomationOpen, setIsEditAutomationOpen] = useState(false);
  const [isSavingEditAutomation, setIsSavingEditAutomation] = useState(false);
  const [editingAutomationForm, setEditingAutomationForm] = useState<AutomationFormState | null>(null);

  // Org members state
  const [isLoadingOrgMembers, setIsLoadingOrgMembers] = useState(false);
  const [orgMemberEmails, setOrgMemberEmails] = useState<string[]>([]);
  const [orgMemberLabelMap, setOrgMemberLabelMap] = useState<Record<string, string>>({});
  const [externalRecipientInput, setExternalRecipientInput] = useState('');

  // Update auto-send form when dashboard name changes
  useEffect(() => {
    if (!activeDashboardName) return;
    setAutoSendForm((prev) => {
      const defaultSubject = `Dashboard Update: ${activeDashboardName}`;
      const defaultBody = `Automated dashboard delivery for ${activeDashboardName} (${prev.frequency}).`;
      if (prev.subject === defaultSubject && prev.body === defaultBody) {
        return prev;
      }
      return {
        ...prev,
        subject: prev.subject || defaultSubject,
        body: prev.body || defaultBody,
      };
    });
  }, [activeDashboardName]);

  // Load org members when modals open
  useEffect(() => {
    if ((!isAutoSendOpen && !isEditAutomationOpen) || !resolvedOrganizationId) return;

    let isMounted = true;
    setIsLoadingOrgMembers(true);

    fetchApi(`/rbac/organizations/${resolvedOrganizationId}/members`)
      .then((data: OrgMember[]) => {
        if (!isMounted) return;
        const members = Array.isArray(data) ? data : [];
        const labelMap: Record<string, string> = {};
        const emails: string[] = [];

        members.forEach((member) => {
          const email = member.email?.trim();
          if (!email) return;
          const key = email.toLowerCase();
          if (emails.some((item) => item.toLowerCase() === key)) return;

          emails.push(email);
          labelMap[email] = member.username ? `${member.username} (${email})` : email;
        });

        setOrgMemberEmails(emails);
        setOrgMemberLabelMap(labelMap);
      })
      .catch(() => {
        if (!isMounted) return;
        setOrgMemberEmails([]);
        setOrgMemberLabelMap({});
      })
      .finally(() => {
        if (isMounted) setIsLoadingOrgMembers(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isAutoSendOpen, isEditAutomationOpen, resolvedOrganizationId]);

  // Load scheduled emails when list modal opens
  useEffect(() => {
    if (!isAutomationListOpen) return;

    let isMounted = true;
    setIsLoadingScheduledEmails(true);

    fetchApi('/schedule-email/automation')
      .then((data: any) => {
        if (!isMounted) return;
        if (data && Array.isArray(data.items)) {
          setScheduledEmails(data.items);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setScheduledEmails([]);
      })
      .finally(() => {
        if (isMounted) setIsLoadingScheduledEmails(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isAutomationListOpen]);

  const refreshScheduledEmails = async () => {
    try {
      const data: any = await fetchApi('/schedule-email/automation');
      if (data && Array.isArray(data.items)) {
        setScheduledEmails(data.items);
      }
    } catch {
      // Silent fail on refresh
    }
  };

  const openAutoSendModal = () => {
    if (!activeDashboardId) {
      message.warning('Select a dashboard first.');
      return;
    }

    const frequency: ScheduleType = 'daily';
    const subject = `Dashboard Update: ${activeDashboardName || 'Dashboard'}`;
    const body = `Automated dashboard delivery for ${activeDashboardName || 'Dashboard'} (${frequency}).\n\nView dashboard: ${sharedDashboardUrl}`;

    setAutoSendForm((prev) => ({
      ...prev,
      scheduleAt: getDefaultScheduleAt(),
      frequency,
      subject,
      body,
    }));

    setIsAutoSendOpen(true);
  };

  const handleSaveAutoSend = async () => {
    if (!autoSendForm.scheduleAt) {
      message.warning('Please select a schedule date and time.');
      return;
    }
    if (autoSendForm.recipients.length === 0) {
      message.warning('Please select at least one recipient.');
      return;
    }

    const invalidEmail = autoSendForm.recipients.find((email) => !EMAIL_REGEX.test(email));
    if (invalidEmail) {
      message.warning(`Invalid email: ${invalidEmail}`);
      return;
    }
    if (!autoSendForm.subject.trim()) {
      message.warning('Please enter email subject.');
      return;
    }
    if (!autoSendForm.body.trim()) {
      message.warning('Please enter email message.');
      return;
    }

    setIsSavingAutoSend(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      await fetchApi('/schedule-email/automation', {
        method: 'POST',
        body: JSON.stringify({
          recipients: autoSendForm.recipients,
          subject: autoSendForm.subject.trim(),
          body: autoSendForm.body.trim(),
          schedule_type: autoSendForm.frequency,
          schedule_at: autoSendForm.scheduleAt.toISOString(),
          time_of_day: autoSendForm.scheduleAt.format('HH:mm'),
          day_of_week: autoSendForm.frequency === 'weekly' ? autoSendForm.scheduleAt.format('dddd') : null,
          day_of_month: autoSendForm.frequency === 'monthly' ? autoSendForm.scheduleAt.date() : null,
          timezone,
          enabled: true,
          data_source_id: autoSendForm.dataSourceId,
          refresh_data_before_send: autoSendForm.refreshDataBeforeSend && !!autoSendForm.dataSourceId,
        }),
      });

      message.success('Auto send settings saved to database.');
      setIsAutoSendOpen(false);
      await refreshScheduledEmails();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save auto send settings.';
      message.error(errorMessage);
    } finally {
      setIsSavingAutoSend(false);
    }
  };

  const addExternalRecipient = (rawEmail: string) => {
    const email = rawEmail.trim();
    if (!email) {
      message.warning('Please enter an email address.');
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      message.warning('Please enter a valid email address.');
      return;
    }

    setAutoSendForm((prev) => {
      if (prev.recipients.some((item) => item.toLowerCase() === email.toLowerCase())) {
        message.info('This email is already added.');
        return prev;
      }
      return { ...prev, recipients: [...prev.recipients, email] };
    });
    setExternalRecipientInput('');
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    setIsDeletingScheduleId(scheduleId);
    try {
      await fetchApi(`/schedule-email/automation/${scheduleId}`, {
        method: 'DELETE',
      });
      message.success('Automation deleted.');
      setScheduledEmails(scheduledEmails.filter((item) => item.id !== scheduleId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete automation.';
      message.error(errorMessage);
    } finally {
      setIsDeletingScheduleId(null);
    }
  };

  const openEditAutomationModal = (schedule: ScheduledEmail) => {
    const scheduleAt = dayjs(schedule.next_send_at);
    const frequency = normalizeScheduleType(schedule.schedule_type);

    setEditingAutomationForm({
      id: schedule.id,
      scheduleAt: scheduleAt.isValid() ? scheduleAt : getDefaultScheduleAt(),
      frequency,
      recipients: Array.isArray(schedule.to_emails) ? schedule.to_emails : [],
      timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      enabled: Boolean(schedule.enabled),
      subject: schedule.subject || `Dashboard Update: ${activeDashboardName || 'Dashboard'}`,
      body: schedule.body || `Automated dashboard delivery for ${activeDashboardName || 'Dashboard'} (${frequency}).`,
      dataSourceId: schedule.data_source_id ?? null,
      refreshDataBeforeSend: Boolean(schedule.refresh_data_before_send),
    });
    setIsEditAutomationOpen(true);
  };

  const handleUpdateSchedule = async (enabledOverride?: boolean) => {
    if (!editingAutomationForm) return;
    if (!editingAutomationForm.scheduleAt) {
      message.warning('Please select a schedule date and time.');
      return;
    }
    if (editingAutomationForm.recipients.length === 0) {
      message.warning('Please select at least one recipient.');
      return;
    }

    const invalidEmail = editingAutomationForm.recipients.find((email) => !EMAIL_REGEX.test(email));
    if (invalidEmail) {
      message.warning(`Invalid email: ${invalidEmail}`);
      return;
    }
    if (!editingAutomationForm.subject.trim()) {
      message.warning('Please enter email subject.');
      return;
    }
    if (!editingAutomationForm.body.trim()) {
      message.warning('Please enter email message.');
      return;
    }

    setIsSavingEditAutomation(true);
    try {
      await fetchApi(`/schedule-email/automation/${editingAutomationForm.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          recipients: editingAutomationForm.recipients,
          subject: editingAutomationForm.subject,
          body: editingAutomationForm.body,
          schedule_type: editingAutomationForm.frequency,
          schedule_at: editingAutomationForm.scheduleAt.toISOString(),
          time_of_day: editingAutomationForm.scheduleAt.format('HH:mm'),
          day_of_week:
            editingAutomationForm.frequency === 'weekly' ? editingAutomationForm.scheduleAt.format('dddd') : null,
          day_of_month: editingAutomationForm.frequency === 'monthly' ? editingAutomationForm.scheduleAt.date() : null,
          timezone: editingAutomationForm.timezone,
          enabled: enabledOverride ?? editingAutomationForm.enabled,
          data_source_id: editingAutomationForm.dataSourceId,
          refresh_data_before_send:
            editingAutomationForm.refreshDataBeforeSend && !!editingAutomationForm.dataSourceId,
        }),
      });

      message.success('Automation updated.');
      setIsEditAutomationOpen(false);
      setEditingAutomationForm(null);
      await refreshScheduledEmails();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update automation.';
      message.error(errorMessage);
    } finally {
      setIsSavingEditAutomation(false);
    }
  };

  const handleToggleScheduleEnabled = async (schedule: ScheduledEmail, enabled: boolean) => {
    setIsTogglingScheduleId(schedule.id);
    try {
      const frequency = normalizeScheduleType(schedule.schedule_type);
      const scheduleAt = dayjs(schedule.next_send_at);
      const effectiveScheduleAt = scheduleAt.isValid() ? scheduleAt : getDefaultScheduleAt();

      await fetchApi(`/schedule-email/automation/${schedule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          recipients: schedule.to_emails,
          subject: schedule.subject,
          body: schedule.body,
          schedule_type: frequency,
          schedule_at: effectiveScheduleAt.toISOString(),
          time_of_day: schedule.time_of_day || effectiveScheduleAt.format('HH:mm'),
          day_of_week: frequency === 'weekly' ? schedule.day_of_week : null,
          day_of_month: frequency === 'monthly' ? schedule.day_of_month : null,
          timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          enabled,
          data_source_id: schedule.data_source_id ?? null,
          refresh_data_before_send: Boolean(schedule.refresh_data_before_send),
        }),
      });
      await refreshScheduledEmails();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update automation status.';
      message.error(errorMessage);
    } finally {
      setIsTogglingScheduleId(null);
    }
  };

  return {
    // Auto-send
    isAutoSendOpen,
    setIsAutoSendOpen,
    isSavingAutoSend,
    autoSendForm,
    setAutoSendForm,
    openAutoSendModal,
    handleSaveAutoSend,
    externalRecipientInput,
    setExternalRecipientInput,
    addExternalRecipient,

    // Automation list
    isAutomationListOpen,
    setIsAutomationListOpen,
    isLoadingScheduledEmails,
    scheduledEmails,
    isDeletingScheduleId,
    isTogglingScheduleId,
    handleDeleteSchedule,
    openEditAutomationModal,
    handleToggleScheduleEnabled,

    // Edit automation
    isEditAutomationOpen,
    setIsEditAutomationOpen,
    isSavingEditAutomation,
    editingAutomationForm,
    setEditingAutomationForm,
    handleUpdateSchedule,

    // Org members
    isLoadingOrgMembers,
    orgMemberEmails,
    orgMemberLabelMap,

    // Helper function to open automation list modal
    openAutomationListModal: () => setIsAutomationListOpen(true),
  };
};
