'use client';

import React from 'react';
import { App, Button, Checkbox, Collapse, Input, Select, Space, Spin, Typography } from 'antd';
import { CopyOutlined, EyeOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useFormatter, useTranslations } from 'next-intl';
import { GuidedForm, GuidedStep, GuidedSummary } from '@/components/guided/GuidedForm';
import { ScheduleWhen } from '@/components/guided/ScheduleWhen';
import { EMAIL_REGEX, normalizeScheduleType } from '../hooks/useAutomationManager';

const { Text } = Typography;

export type DashboardEmailForm = {
  scheduleAt: Dayjs | null;
  frequency: string;
  recipients: string[];
  subject: string;
  body: string;
  dataSourceId: string | null;
  refreshDataBeforeSend: boolean;
  attachPdfReport?: boolean;
};

/**
 * "Email this dashboard" as three plain questions — when, who, what's in it — with a sentence
 * that says what will happen, the way "New alert" works. Subject, message and the data refresh
 * source are there when wanted, folded away by default.
 */
export function DashboardEmailFields({
  form, setForm, orgMemberEmails, orgMemberLabelMap, isLoadingOrgMembers, dataSourceOptions,
  sharedDashboardUrl, onPreview, onCopyLink,
}: {
  form: DashboardEmailForm;
  setForm: (updater: (prev: DashboardEmailForm) => DashboardEmailForm) => void;
  orgMemberEmails: string[];
  orgMemberLabelMap: Record<string, string>;
  isLoadingOrgMembers: boolean;
  dataSourceOptions: Array<{ value: string; label: string }>;
  sharedDashboardUrl: string;
  onPreview: () => void;
  onCopyLink: () => void;
}) {
  const t = useTranslations('dashboard_tabs');
  const format = useFormatter();
  const { message } = App.useApp();
  const patch = (p: Partial<DashboardEmailForm>) => setForm((prev) => ({ ...prev, ...p }));
  const frequency = normalizeScheduleType(form.frequency);

  const setRecipients = (values: string[]) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    const rejected: string[] = [];
    for (const raw of values) {
      const email = raw.trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      if (!EMAIL_REGEX.test(email)) {
        rejected.push(email);
        continue;
      }
      seen.add(email.toLowerCase());
      kept.push(email);
    }
    if (rejected.length) message.warning(t('email_invalid', { email: rejected[0] }));
    patch({ recipients: kept });
  };

  const at = form.scheduleAt;
  const time = at ? format.dateTime(at.toDate(), { hour: '2-digit', minute: '2-digit' }) : '';
  const when = !at ? '' : frequency === 'once'
    ? t('email_when_once', { date: format.dateTime(at.toDate(), { dateStyle: 'medium' }), time })
    : frequency === 'weekly'
      ? t('email_when_weekly', { day: format.dateTime(at.toDate(), { weekday: 'long' }), time })
      : frequency === 'monthly'
        ? t('email_when_monthly', { day: at.date(), time })
        : t('email_when_daily', { time });
  const sentence = t('email_sentence', { when, n: form.recipients.length, pdf: form.attachPdfReport ? 'yes' : 'no' });

  const members = orgMemberEmails.map((email) => ({ value: email, label: orgMemberLabelMap[email] || email }));
  const outside = form.recipients
    .filter((email) => !orgMemberEmails.some((m) => m.toLowerCase() === email.toLowerCase()))
    .map((email) => ({ value: email, label: t('email_outside', { email }) }));

  return (
    <GuidedForm>
      <GuidedStep n={1} title={t('email_step_when')}>
        <Space wrap align="start">
          <Select
            value={frequency}
            style={{ width: 150 }}
            onChange={(v) => patch({ frequency: v })}
            options={(['once', 'daily', 'weekly', 'monthly'] as const).map((f) => ({ value: f, label: t(`email_freq_${f}`) }))}
          />
          <ScheduleWhen frequency={frequency} value={form.scheduleAt} onChange={(v) => patch({ scheduleAt: v })} />
        </Space>
      </GuidedStep>

      <GuidedStep n={2} title={t('email_step_who')} hint={t('email_who_hint')}>
        <Select
          mode="tags"
          value={form.recipients}
          onChange={setRecipients}
          tokenSeparators={[',', ';', ' ']}
          options={[...members, ...outside]}
          optionFilterProp="label"
          placeholder={t('email_who_placeholder')}
          notFoundContent={isLoadingOrgMembers ? <Spin size="small" /> : null}
          style={{ width: '100%' }}
          maxTagCount="responsive"
        />
      </GuidedStep>

      <GuidedStep n={3} title={t('email_step_what')}>
        <Space size={6} wrap>
          <Text>{t('email_link')}</Text>
          <Button size="small" icon={<EyeOutlined />} onClick={onPreview} disabled={!sharedDashboardUrl}>{t('preview')}</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={onCopyLink} disabled={!sharedDashboardUrl}>{t('copy')}</Button>
        </Space>
        <Checkbox checked={Boolean(form.attachPdfReport)} onChange={(e) => patch({ attachPdfReport: e.target.checked })}>
          {t('email_attach_pdf')}
        </Checkbox>
        <Checkbox
          checked={form.refreshDataBeforeSend}
          onChange={(e) => patch({ refreshDataBeforeSend: e.target.checked })}
        >
          {t('email_refresh')}
        </Checkbox>
        {form.refreshDataBeforeSend ? (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('email_refresh_source')}
            value={form.dataSourceId ?? undefined}
            onChange={(v) => patch({ dataSourceId: v ?? null })}
            options={dataSourceOptions}
            style={{ width: '100%' }}
            status={form.dataSourceId ? undefined : 'warning'}
          />
        ) : null}
        {form.refreshDataBeforeSend && !form.dataSourceId ? (
          <Text type="warning" className="guided-form__hint">{t('email_refresh_pick')}</Text>
        ) : null}
      </GuidedStep>

      <Collapse
        ghost
        size="small"
        items={[{
          key: 'message',
          label: t('email_customise'),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Input value={form.subject} onChange={(e) => patch({ subject: e.target.value })} maxLength={255}
                addonBefore={t('schedule_subject')} placeholder={t('schedule_subject_placeholder')} />
              <Input.TextArea value={form.body} onChange={(e) => patch({ body: e.target.value })}
                autoSize={{ minRows: 3, maxRows: 8 }} placeholder={t('schedule_message_placeholder')} aria-label={t('schedule_message')} />
            </Space>
          ),
        }]}
      />

      <GuidedSummary missing={form.recipients.length ? undefined : t('email_need_who')}>{sentence}</GuidedSummary>
    </GuidedForm>
  );
}
