'use client';

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approveShareLink, declineShareLink, organizationShareLinks, turnShareLinkOff, type ShareLink } from '@/services/shareLinks';
import { useTranslations } from 'next-intl';
import { FeatureGate } from '@/ee';
import { App, Button, Form, InputNumber, Segmented, Space, Switch, Table, Tag, Tooltip } from 'antd';
import { InfoHint } from '@/components/ui/InfoHint';
import { fetchApi } from '@/utils/api';

type Policy = { public: 'off' | 'approval' | 'members'; expiry_days: number | null; second_approver: boolean };
const post = (body?: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/** Who may publish outside the organization, for how long, and the off switch. */
export default function PublishingTab() {
  const t = useTranslations('settings');
  const { message } = App.useApp();
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ['publishing-policy'], queryFn: () => fetchApi<Policy>('/api/feed/publishing/policy') });

  const save = async (next: Partial<Policy>) => {
    const body = { public: policy.data?.public ?? 'approval', expiry_days: policy.data?.expiry_days ?? null, second_approver: policy.data?.second_approver ?? false, ...next };
    await fetchApi('/api/feed/publishing/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    void qc.invalidateQueries({ queryKey: ['publishing-policy'] });
    message.success(t('publishing_saved'));
  };
  const takeDown = async () => {
    const taken = await fetchApi<{ posts: string[]; dashboards: string[]; links?: string[] }>('/api/feed/publishing/take-down', post());
    message.open({ type: 'success', key: 'taken-down', duration: 12, content: (
      <span>
        {t('publishing_taken_down', { count: taken.posts.length + taken.dashboards.length + (taken.links?.length ?? 0) })}{' '}
        <Button type="link" size="small" onClick={() => { void fetchApi('/api/feed/publishing/take-down/undo', post()); message.destroy('taken-down'); }}>
          {t('publishing_undo')}
        </Button>
      </span>
    ) });
  };

  return (
    <Form layout="vertical" style={{ maxWidth: 520 }}>
      <Form.Item label={<>{t('publishing_public_label')}<InfoHint text={t('publishing_public_tip')} /></>}>
        <Segmented value={policy.data?.public ?? 'approval'} onChange={(v) => void save({ public: v as Policy['public'] })}
          options={[{ value: 'off', label: t('publishing_mode_off') }, { value: 'approval', label: t('publishing_mode_approval') }, { value: 'members', label: t('publishing_mode_members') }]} />
      </Form.Item>
      <Form.Item label={<>{t('publishing_second_label')}<InfoHint text={t('publishing_second_tip')} /></>}>
        <FeatureGate
          feature="compliance"
          fallback={<Tooltip title={t('enterprise_only_second_approver')}><Switch checked={false} disabled aria-label={t('publishing_second_label')} /></Tooltip>}
        >
          <Switch checked={policy.data?.second_approver ?? false} onChange={(v) => void save({ second_approver: v })} aria-label={t('publishing_second_label')} />
        </FeatureGate>
      </Form.Item>
      <Form.Item label={t('publishing_expiry_label')}>
        <InputNumber key={String(policy.data?.expiry_days)} min={1} max={3650} defaultValue={policy.data?.expiry_days ?? undefined} placeholder={t('publishing_expiry_never')}
          style={{ width: 160 }} onBlur={(e) => { const v = Number(e.target.value) || null; if (v !== (policy.data?.expiry_days ?? null)) void save({ expiry_days: v }); }} />
      </Form.Item>
      <Space>
        <Button danger onClick={() => void takeDown()}>{t('publishing_take_down')}</Button>
        <InfoHint text={t('publishing_take_down_tip')} />
      </Space>
      <ShareLinksList />
    </Form>
  );
}

/** Every link that is on or waiting: where the organization's work can be opened from. */
function ShareLinksList() {
  const t = useTranslations('share_links');
  const { message } = App.useApp();
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ['share-links'], queryFn: organizationShareLinks, retry: false });
  const act = async (action: Promise<unknown>) => {
    try {
      await action;
      void qc.invalidateQueries({ queryKey: ['share-links'] });
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('save_failed'));
    }
  };
  if (!links.data?.length) return null;
  return (
    <Table
      style={{ marginTop: 24 }}
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={links.data}
      columns={[
        { title: t('links_title'), dataIndex: 'title', render: (v: string, r: ShareLink) => <a href={`/s/${r.slug}`} target="_blank" rel="noopener noreferrer">{v || r.slug}</a> },
        { title: t('who'), dataIndex: 'access', render: (v: string, r: ShareLink) => (r.status === 'pending' ? <Tag color="gold">{t('waiting')}</Tag> : t(v === 'public' ? 'who_public' : 'who_organization')) },
        { title: t('views_title'), dataIndex: 'view_count', width: 80 },
        {
          title: '',
          key: 'actions',
          align: 'right' as const,
          render: (_: unknown, r: ShareLink) => (
            <Space size={4}>
              {r.status === 'pending' ? (
                <Tooltip title={r.review?.can_approve ? undefined : t('own_link_tip', { names: r.review?.approvers.join(', ') ?? '' })}>
                  <Button type="link" size="small" disabled={!r.review?.can_approve} onClick={() => void act(approveShareLink(r.id))}>{t('approve')}</Button>
                </Tooltip>
              ) : null}
              {r.status === 'pending' && r.review?.can_approve
                ? <Button type="link" size="small" danger onClick={() => void act(declineShareLink(r.id))}>{t('decline')}</Button>
                : <Button type="link" size="small" danger onClick={() => void act(turnShareLinkOff(r.id))}>{t('turn_off')}</Button>}
            </Space>
          ),
        },
      ]}
    />
  );
}
