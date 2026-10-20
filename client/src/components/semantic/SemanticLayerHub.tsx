'use client';

import React, { useMemo, useState } from 'react';
import nextDynamic from 'next/dynamic';
import { Button, Checkbox, Empty, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CalendarOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/utils/api';
import { NodeIndexOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { useDataSources } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import type { DataSource } from '@/stores/useDataSourceStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { semanticLayerStudioHref } from '@/app/(dashboard)/data/sources/[id]/_components/tabParam';
import {
  isSingleTableFileSource,
  semanticReadinessFromOverview,
  semanticSectionForReadiness,
  SEMANTIC_READINESS_TAG_COLOR,
  type SemanticReadiness,
} from '@/components/semantic/semanticReadiness';

const { Text, Paragraph } = Typography;

import { isModelEligibleDataSource } from '@/components/data/modelEligible';
import { isLakehouseComputeDataSource } from '@/utils/lakehouseComputeSource';
import {
  addDomainSource,
  createDomain,
  domainDiff,
  domainsForSource,
  getCalendar,
  listDomains,
  removeDomainSource,
  setCalendar,
} from '@/api/semanticDomains';
import { useFormatUserError } from '@/hooks/useFormatUserError';

const ConnectModelVisualizeWizard = isEnterpriseEdition
  ? nextDynamic(() => import('@/ee').then((m) => m.ConnectModelVisualizeWizard), { ssr: false })
  : null;

export function SemanticLayerHub() {
  const t = useTranslations('semantic_layer_hub');
  const router = useRouter();
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const waitingForProject = isEnterpriseEdition && !currentProjectId;
  const { dataSources, isLoading } = useDataSources();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [draftWizardOpen, setDraftWizardOpen] = useState(false);

  const qc = useQueryClient();
  const formatError = useFormatUserError();
  const domainsQuery = useQuery({ queryKey: ['semantic-domains'], queryFn: listDomains });
  const domains = useMemo(() => domainsQuery.data ?? [], [domainsQuery.data]);
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [domainModalOpen, setDomainModalOpen] = useState(false);
  const [domainForm] = Form.useForm();
  const [calendarForm] = Form.useForm();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const locale = useLocale();
  const openCalendar = async () => {
    try {
      calendarForm.setFieldsValue(await getCalendar());
    } catch {
      calendarForm.setFieldsValue({ fiscal_year_start_month: 1, week_start: 'monday' });
    }
    setCalendarOpen(true);
  };
  const saveCalendar = async () => {
    try {
      await setCalendar(calendarForm.getFieldsValue());
      await qc.invalidateQueries({ queryKey: ['semantic-domains'] });
      message.success(t('calendar_saved'));
      setCalendarOpen(false);
    } catch (err) {
      message.error(formatError(err));
    }
  };

  const eligible = useMemo(
    () =>
      (dataSources || []).filter((ds) =>
        isModelEligibleDataSource(ds.type),
      ),
    [dataSources],
  );
  const rows = useMemo(() => {
    if (domainFilter === 'all') return eligible;
    if (domainFilter === 'none') return eligible.filter((ds) => domainsForSource(domains, String(ds.id)).length === 0);
    const domain = domains.find((d) => d.id === domainFilter);
    return eligible.filter((ds) => domain?.source_ids.includes(String(ds.id)));
  }, [eligible, domains, domainFilter]);

  const setSourceDomains = async (sourceId: string, next: string[]) => {
    const current = domainsForSource(domains, sourceId).map((d) => d.id);
    const { add, remove } = domainDiff(current, next);
    try {
      await Promise.all([
        ...add.map((id) => addDomainSource(id, sourceId)),
        ...remove.map((id) => removeDomainSource(id, sourceId)),
      ]);
      await qc.invalidateQueries({ queryKey: ['semantic-domains'] });
    } catch (err) {
      message.error(formatError(err));
    }
  };

  const submitDomain = async (values: { name: string; description?: string; is_core?: boolean }) => {
    try {
      await createDomain(values);
      await qc.invalidateQueries({ queryKey: ['semantic-domains'] });
      setDomainModalOpen(false);
      domainForm.resetFields();
    } catch (err) {
      message.error(formatError(err));
    }
  };

  const overviewQueries = useQueries({
    queries: eligible.map((ds) => ({
      queryKey: ['semantic-overview-hub', ds.id, currentProjectId],
      queryFn: () =>
        fetchApi<Record<string, number>>(
          `semantic/overview/${encodeURIComponent(ds.id)}${
            currentProjectId ? `?project_id=${encodeURIComponent(String(currentProjectId))}` : ''
          }`,
        ),
      staleTime: 60_000,
    })),
  });

  const overviewById = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    eligible.forEach((ds, i) => {
      map[ds.id] = (overviewQueries[i]?.data as Record<string, number>) || {};
    });
    return map;
  }, [eligible, overviewQueries]);

  const hasAnySource = (dataSources || []).length > 0;

  // Two uploads of the same file look identical by name; tell them apart by when they arrived.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((ds) => counts.set(ds.name, (counts.get(ds.name) ?? 0) + 1));
    return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
  }, [rows]);

  const kindLabel = (row: DataSource): string => {
    if (isLakehouseComputeDataSource(row)) return t('kind_lakehouse');
    const type = (row.type || '').toLowerCase();
    if (type === 'file') return t('kind_file');
    if (type.startsWith('sample')) return t('kind_sample');
    return (row.db_type || row.type || '').toUpperCase();
  };

  const columns: ColumnsType<DataSource> = [
    {
      title: t('col_source'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {kindLabel(row)}
            {duplicateNames.has(name) && row.created_at
              ? ` · ${t('added_on', { date: new Date(row.created_at).toLocaleDateString() })}`
              : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: t('col_domain'),
      key: 'domain',
      width: 240,
      render: (_, row) => (
        <Select
          mode="multiple"
          size="small"
          style={{ width: '100%' }}
          placeholder={t('domain_unassigned')}
          value={domainsForSource(domains, String(row.id)).map((d) => d.id)}
          onChange={(next: string[]) => void setSourceDomains(String(row.id), next)}
          options={domains.map((d) => ({ value: d.id, label: d.is_core ? `${d.name} · ${t('core_badge')}` : d.name }))}
          notFoundContent={t('no_domains')}
          aria-label={t('col_domain')}
        />
      ),
    },
    {
      title: t('col_readiness'),
      key: 'stats',
      width: 280,
      render: (_, row) => {
        const ov = overviewById[row.id] || {};
        const metrics = Number(ov.metric_count) || 0;
        const joins = Number(ov.join_count) || 0;
        const certified = Number(ov.certified_metric_count) || 0;
        const readiness = semanticReadinessFromOverview(ov, {
          singleTableSource: isSingleTableFileSource(row.type, undefined),
        });
        return (
          <Space direction="vertical" size={4}>
            <Tag color={SEMANTIC_READINESS_TAG_COLOR[readiness]}>{t(`readiness_${readiness}`)}</Tag>
            <Space size={[4, 4]} wrap>
              <Tag>{t('stat_metrics_short', { count: metrics })}</Tag>
              <Tag>{t('stat_joins_short', { count: joins })}</Tag>
              {certified > 0 ? (
                <Tag icon={<SafetyCertificateOutlined />} color="green">
                  {t('stat_certified_short', { count: certified })}
                </Tag>
              ) : null}
            </Space>
          </Space>
        );
      },
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 200,
      render: (_, row) => {
        const ov = overviewById[row.id] || {};
        const readiness = semanticReadinessFromOverview(ov, {
          singleTableSource: isSingleTableFileSource(row.type, undefined),
        });
        const section = semanticSectionForReadiness(readiness);
        const continueSetup = readiness !== 'ready';
        return (
          <Button
            type="primary"
            size="small"
            onClick={() => router.push(semanticLayerStudioHref(row.id, continueSetup ? section : undefined))}
          >
            {continueSetup ? t('continue_setup') : t('open_semantic_layer')}
          </Button>
        );
      },
    },
  ];

  const description =
    isEnterpriseEdition && currentProject?.name
      ? t('subtitle_project', { project: currentProject.name })
      : t('subtitle');

  if (waitingForProject) {
    return (
      <DashboardPageShell>
        <DashboardPageHeader title={t('title')} description={t('subtitle')} />
        <AppLoadingIndicator variant="full" tip={t('waiting_project')} />
      </DashboardPageShell>
    );
  }

  const wizardSources = rows
    .filter((r) => selectedRowKeys.includes(r.id))
    .map((r) => ({ id: r.id, name: r.name, type: r.type }));

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        title={t('title')}
        description={description}
        extra={
          isEnterpriseEdition && ConnectModelVisualizeWizard && rows.length > 0 ? (
            <Tooltip title={wizardSources.length === 0 ? t('ai_draft_tip') : undefined}>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                disabled={wizardSources.length === 0}
                onClick={() => setDraftWizardOpen(true)}
              >
                {wizardSources.length > 0
                  ? t('ai_draft_selected', { count: wizardSources.length })
                  : t('ai_draft_select_hint')}
              </Button>
            </Tooltip>
          ) : null
        }
      />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Segmented
            value={domainFilter}
            onChange={(v) => setDomainFilter(String(v))}
            options={[
              { value: 'all', label: t('domain_all') },
              ...domains.map((d) => ({
                value: d.id,
                label: d.is_core && d.name.toLowerCase() !== t('core_badge').toLowerCase() ? `${d.name} · ${t('core_badge')}` : d.name,
              })),
              { value: 'none', label: t('domain_unassigned') },
            ]}
          />
          <Button size="small" onClick={() => setDomainModalOpen(true)}>
            {t('new_domain')}
          </Button>
          <Button size="small" icon={<CalendarOutlined />} onClick={() => void openCalendar()}>
            {t('calendar')}
          </Button>
        </div>
        <Table<DataSource>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          rowSelection={
            isEnterpriseEdition
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys as string[]),
                }
              : undefined
          }
          pagination={rows.length > 12 ? { pageSize: 12 } : false}
          locale={{
            emptyText: (
              <Empty description={hasAnySource ? t('empty_ineligible') : t('empty')}>
                {hasAnySource ? (
                  <Button type="primary" onClick={() => router.push('/data')}>
                    {t('view_data_sources')}
                  </Button>
                ) : (
                  <Button type="primary" onClick={() => router.push('/data')}>
                    {t('connect_data')}
                  </Button>
                )}
              </Empty>
            ),
          }}
        />
      </div>
      <Modal
        open={domainModalOpen}
        title={t('new_domain')}
        onCancel={() => setDomainModalOpen(false)}
        onOk={() => domainForm.submit()}
        okText={t('create_domain')}
        destroyOnHidden
      >
        <Paragraph type="secondary">{t('domain_explainer')}</Paragraph>
        <Form form={domainForm} layout="vertical" onFinish={submitDomain} preserve={false}>
          <Form.Item name="name" label={t('domain_name')} rules={[{ required: true, max: 120 }]}>
            <Input placeholder={t('domain_name_placeholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('domain_description')}>
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
          <Form.Item name="is_core" valuePropName="checked" extra={t('domain_core_hint')}>
            <Checkbox>{t('domain_is_core')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={calendarOpen}
        title={t('calendar_title')}
        onCancel={() => setCalendarOpen(false)}
        onOk={() => void saveCalendar()}
        okText={t('calendar_save')}
        destroyOnHidden
      >
        <Paragraph type="secondary">{t('calendar_explainer')}</Paragraph>
        <Form form={calendarForm} layout="vertical" preserve={false}>
          <Form.Item name="fiscal_year_start_month" label={t('calendar_fiscal_start')}>
            <Select
              style={{ width: 220 }}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: i + 1,
                label: new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' }),
              }))}
            />
          </Form.Item>
          <Form.Item name="week_start" label={t('calendar_week_start')}>
            <Segmented options={[{ value: 'monday', label: t('calendar_monday') }, { value: 'sunday', label: t('calendar_sunday') }]} />
          </Form.Item>
        </Form>
      </Modal>
      {ConnectModelVisualizeWizard ? (
        <ConnectModelVisualizeWizard
          open={draftWizardOpen}
          sources={wizardSources}
          onClose={() => setDraftWizardOpen(false)}
        />
      ) : null}
    </DashboardPageShell>
  );
}

export default SemanticLayerHub;
