'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Divider, Empty, InputNumber, List, Modal, Select, Space, Spin, Switch, Tag, TimePicker, Typography } from 'antd';
import { CaretRightOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import type { CellOutput } from '@/services/notebookService';

const { Text } = Typography;

type Frequency = 'hourly' | 'daily' | 'weekdays' | 'weekly';
export type Schedule = {
  enabled: boolean; frequency: Frequency; hour: number; minute: number; weekday: number; timezone: string;
  notify: 'failure' | 'always' | 'never'; timeout_s: number; next_run_at?: string | null; last_run_at?: string | null; last_status?: string | null;
};
export type RunSummary = {
  id: string; trigger: 'schedule' | 'manual'; status: 'queued' | 'running' | 'ok' | 'failed'; error?: string | null;
  duration_ms?: number | null; created_at?: string | null; finished_at?: string | null;
};

const base = (id: string) => `/api/notebook-runs/${encodeURIComponent(id)}`;

export const notebookRuns = {
  schedule: (id: string) => fetchApi<{ schedule: Schedule | null; enabled: boolean }>(`${base(id)}/schedule`),
  save: (id: string, s: Schedule) => fetchApi<{ schedule: Schedule; enabled: boolean }>(`${base(id)}/schedule`, { method: 'PUT', body: JSON.stringify(s) }),
  remove: (id: string) => fetchApi<void>(`${base(id)}/schedule`, { method: 'DELETE' }),
  runNow: (id: string) => fetchApi<RunSummary>(`${base(id)}/run`, { method: 'POST' }),
  runs: (id: string) => fetchApi<{ items: RunSummary[] }>(`${base(id)}/runs`),
  run: (id: string, runId: string) => fetchApi<RunSummary & { outputs: Record<string, CellOutput> }>(`${base(id)}/runs/${encodeURIComponent(runId)}`),
};

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

/**
 * Run a notebook on a schedule (Enterprise). It runs the saved notebook with the owner's
 * access in a sandbox on the server; results stay with each run and can be shown in the notebook.
 */
export function ScheduleDialog({
  open, notebookId, canEdit, onClose, onShowRun,
}: {
  open: boolean;
  notebookId: string;
  canEdit: boolean;
  onClose: () => void;
  onShowRun: (runId: string) => void;
}) {
  const t = useTranslations('notebooks');
  const format = useFormatter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [enabledOnServer, setEnabledOnServer] = useState(true);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [saved, setSaved] = useState<Schedule | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const zoneOptions = useMemo(() => zones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([notebookRuns.schedule(notebookId), notebookRuns.runs(notebookId)]);
      setEnabledOnServer(s.enabled);
      setSaved(s.schedule);
      setDraft(s.schedule ?? { enabled: true, frequency: 'daily', hour: 7, minute: 0, weekday: 0, timezone: browserZone(), notify: 'failure', timeout_s: 600 });
      setRuns(r.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('schedule_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [message, notebookId, t]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load();
  }, [open, load]);

  // While a run is under way, check back every few seconds.
  const active = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(() => {
      notebookRuns.runs(notebookId).then((r) => setRuns(r.items)).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [open, active, notebookId]);

  const patch = (p: Partial<Schedule>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const res = await notebookRuns.save(notebookId, draft);
      setSaved(res.schedule);
      setDraft(res.schedule);
      message.success(res.schedule.enabled ? t('schedule_saved') : t('schedule_paused'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('schedule_save_failed'));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const run = await notebookRuns.runNow(notebookId);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      message.info(t('schedule_run_started'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('schedule_run_failed'));
    } finally {
      setBusy(null);
    }
  };

  const when = (iso?: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const statusTag = (r: RunSummary) => {
    const color = { ok: 'success', failed: 'error', running: 'processing', queued: 'default' }[r.status];
    return <Tag color={color} bordered={false}>{t(`run_status_${r.status}`)}</Tag>;
  };
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    value: d, label: format.dateTime(new Date(Date.UTC(2024, 0, 1 + d)), { weekday: 'long', timeZone: 'UTC' }),
  }));

  return (
    <Modal open={open} onCancel={onClose} title={t('schedule_title')} width={620} footer={null} destroyOnHidden>
      {loading || !draft ? <Spin /> : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {!enabledOnServer ? <Alert type="info" showIcon message={t('schedule_not_set_up')} /> : null}
          <Text type="secondary">{t('schedule_explain')}</Text>
          {canEdit ? (
            <>
              <Space wrap align="center">
                <Switch checked={draft.enabled} onChange={(v) => patch({ enabled: v })} disabled={!enabledOnServer} />
                <Text>{t('schedule_on')}</Text>
              </Space>
              <Space wrap align="center">
                <Select<Frequency>
                  value={draft.frequency}
                  style={{ width: 160 }}
                  onChange={(v) => patch({ frequency: v })}
                  options={(['hourly', 'daily', 'weekdays', 'weekly'] as Frequency[]).map((f) => ({ value: f, label: t(`schedule_${f}`) }))}
                />
                {draft.frequency === 'weekly' ? (
                  <Select value={draft.weekday} style={{ width: 150 }} options={weekdays} onChange={(v) => patch({ weekday: v })} />
                ) : null}
                {draft.frequency === 'hourly' ? (
                  <Space align="center">
                    <Text>{t('schedule_at_minute')}</Text>
                    <InputNumber min={0} max={59} value={draft.minute} onChange={(v) => patch({ minute: Number(v ?? 0) })} style={{ width: 80 }} />
                  </Space>
                ) : (
                  <TimePicker
                    format="HH:mm"
                    minuteStep={5}
                    allowClear={false}
                    value={dayjs().hour(draft.hour).minute(draft.minute)}
                    onChange={(v) => v && patch({ hour: v.hour(), minute: v.minute() })}
                  />
                )}
                <Select showSearch value={draft.timezone} options={zoneOptions} onChange={(v) => patch({ timezone: v })} style={{ width: 220 }} />
              </Space>
              <Space wrap align="center">
                <Text>{t('schedule_notify')}</Text>
                <Select
                  value={draft.notify}
                  style={{ width: 220 }}
                  onChange={(v) => patch({ notify: v })}
                  options={(['failure', 'always', 'never'] as const).map((n) => ({ value: n, label: t(`schedule_notify_${n}`) }))}
                />
              </Space>
              {saved?.enabled && saved.next_run_at ? <Text type="secondary">{t('schedule_next', { when: when(saved.next_run_at) })}</Text> : null}
              <Space wrap>
                <Button type="primary" loading={busy === 'save'} disabled={!enabledOnServer && draft.enabled} onClick={() => void save()}>{t('schedule_save')}</Button>
                <Button icon={<CaretRightOutlined />} loading={busy === 'run'} disabled={!enabledOnServer || active} onClick={() => void runNow()}>{t('schedule_run_now')}</Button>
              </Space>
            </>
          ) : saved ? <Text>{t('schedule_view_only')}</Text> : null}
          <Divider style={{ margin: '4px 0' }}>{t('schedule_runs')}</Divider>
          {!runs.length ? <Empty description={t('schedule_no_runs')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
            <List
              size="small"
              dataSource={runs}
              renderItem={(r) => (
                <List.Item
                  actions={r.status === 'ok' || r.status === 'failed'
                    ? [<Button key="show" size="small" onClick={() => onShowRun(r.id)}>{t('schedule_show_results')}</Button>]
                    : [<ReloadOutlined key="spin" spin />]}
                >
                  <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
                    <Space size={6} wrap>
                      {statusTag(r)}
                      <Text>{when(r.finished_at || r.created_at)}</Text>
                      <Text type="secondary">· {r.trigger === 'schedule' ? t('run_trigger_schedule') : t('run_trigger_manual')}</Text>
                      {r.duration_ms ? <Text type="secondary">· {(r.duration_ms / 1000).toFixed(1)} s</Text> : null}
                    </Space>
                    {r.error ? <Text type="danger" className="nb-run-error">{r.error}</Text> : null}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
