'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Checkbox, Form, Input, InputNumber, Modal, Segmented, Select, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

const { Text } = Typography;

/**
 * "Watch this number": an alert on a saved chart's number, or on one number column of an AI
 * answer. It runs as the person who set it (their row and column security), checks on a schedule,
 * and when it fires says what moved it — see server/ee/modules/alerts (POST /alerts/watch).
 */
export type WatchTarget =
  | { kind: 'chart'; chartId: string; title?: string; currentValue?: number | null }
  | {
      kind: 'answer';
      sql: string;
      dataSourceId: string;
      projectId?: string | null;
      title?: string;
      numberColumns: string[];
      currentValues?: Record<string, number>;
    };

const EVERY = [15, 60, 240, 1440];

export function WatchNumberModal({ open, target, onClose }: { open: boolean; target: WatchTarget | null; onClose: () => void }) {
  const t = useTranslations('alerts_watch');
  const { message } = App.useApp();
  const [direction, setDirection] = useState<'above' | 'below'>('below');
  const [column, setColumn] = useState<string | undefined>();
  const [threshold, setThreshold] = useState<number | null>(null);
  const [every, setEvery] = useState(60);
  const [email, setEmail] = useState(false);
  const [emails, setEmails] = useState('');
  const [teams, setTeams] = useState(false);
  const [teamsUrl, setTeamsUrl] = useState('');
  const [telegram, setTelegram] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = useMemo(() => {
    if (!target) return null;
    if (target.kind === 'chart') return target.currentValue ?? null;
    return column ? target.currentValues?.[column] ?? null : null;
  }, [target, column]);

  useEffect(() => {
    if (!open || !target) return;
    setDirection('below');
    setEvery(60);
    setEmail(false);
    setTeams(false);
    setTelegram(false);
    const first = target.kind === 'answer' ? target.numberColumns[0] : undefined;
    setColumn(first);
    const start = target.kind === 'chart' ? target.currentValue : first ? target.currentValues?.[first] : undefined;
    // A sensible starting line: 10% below today's value (the usual "tell me if it drops").
    setThreshold(typeof start === 'number' && Number.isFinite(start) ? Math.round(start * 0.9 * 100) / 100 : null);
  }, [open, target]);

  const save = async () => {
    if (!target || threshold == null) return;
    const channels: Array<Record<string, unknown>> = [];
    const list = emails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (email && list.length) channels.push({ type: 'email', emails: list });
    if (teams && teamsUrl.trim()) channels.push({ type: 'teams', url: teamsUrl.trim() });
    if (telegram) channels.push({ type: 'telegram' });
    const common = {
      threshold_operator: direction === 'above' ? '>' : '<',
      threshold_value: threshold,
      check_every_minutes: every,
      channels,
    };
    const body =
      target.kind === 'chart'
        ? { ...common, chart_id: target.chartId }
        : {
            ...common,
            sql: target.sql,
            data_source_id: target.dataSourceId,
            value_column: column,
            project_id: target.projectId ?? undefined,
            name: `${target.title || column} ${direction === 'above' ? '>' : '<'} ${threshold}`,
          };
    setSaving(true);
    try {
      await fetchApi('alerts/watch', { method: 'POST', body: JSON.stringify(body) });
      message.success(t('saved'));
      onClose();
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('title')}
      okText={t('save')}
      onOk={() => void save()}
      okButtonProps={{ disabled: threshold == null || (target?.kind === 'answer' && !column), loading: saving }}
      onCancel={onClose}
      destroyOnHidden
    >
      {target ? (
        <Form layout="vertical">
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {target.title ? t('intro_named', { name: target.title }) : t('intro')}
          </Text>
          {target.kind === 'answer' ? (
            <Form.Item label={t('number')} required>
              <Select id="watch-number" value={column} onChange={setColumn} options={target.numberColumns.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
          ) : null}
          <Form.Item label={t('when')} required extra={current != null ? t('now_is', { value: current.toLocaleString() }) : undefined}>
            <Space.Compact style={{ width: '100%' }}>
              <Segmented
                value={direction}
                onChange={(v) => setDirection(v as 'above' | 'below')}
                options={[
                  { label: t('drops_below'), value: 'below' },
                  { label: t('goes_above'), value: 'above' },
                ]}
              />
              <InputNumber id="watch-threshold" value={threshold} onChange={(v) => setThreshold(v == null ? null : Number(v))} style={{ flex: 1 }} />
            </Space.Compact>
          </Form.Item>
          <Form.Item label={t('check_every')}>
            <Select
              id="watch-every"
              value={every}
              onChange={setEvery}
              options={EVERY.map((m) => ({ value: m, label: t(`every_${m}` as never) }))}
            />
          </Form.Item>
          <Form.Item label={t('tell_me')} extra={t('in_app_always')}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Checkbox checked={email} onChange={(e) => setEmail(e.target.checked)}>{t('channel_email')}</Checkbox>
              {email ? <Input id="watch-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={t('emails_placeholder')} /> : null}
              <Checkbox checked={teams} onChange={(e) => setTeams(e.target.checked)}>{t('channel_teams')}</Checkbox>
              {teams ? <Input id="watch-teams" value={teamsUrl} onChange={(e) => setTeamsUrl(e.target.value)} placeholder="https://…webhook.office.com/…" /> : null}
              <Checkbox checked={telegram} onChange={(e) => setTelegram(e.target.checked)}>{t('channel_telegram')}</Checkbox>
            </Space>
          </Form.Item>
        </Form>
      ) : null}
    </Modal>
  );
}
