'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Checkbox, Input, Modal, Select, Space, Typography } from 'antd';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/useProjectStore';
import { notebookService, type NotebookCell } from '@/services/notebookService';
import { chartModelFor, publishSource } from './notebookPublish';

const { Text } = Typography;

export type PublishTarget = 'library' | 'dashboard';

/**
 * Save a notebook chart or pivot to the chart library, or add it to a dashboard, with its data
 * bound: a SQL result as a saved query (live), a Python result as a dataset (snapshot).
 */
export function PublishDialog({
  open, target, cell, cells, notebookId, frameFor, onClose,
}: {
  open: boolean;
  target: PublishTarget;
  cell: NotebookCell | null;
  cells: NotebookCell[];
  notebookId: string;
  /** Full data of a Python result, for saving it as a dataset. */
  frameFor: (name: string) => Promise<{ columns: string[]; rows: unknown[][] } | null>;
  onClose: () => void;
}) {
  const t = useTranslations('notebooks');
  const { message } = App.useApp();
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [title, setTitle] = useState('');
  const [dashboards, setDashboards] = useState<Array<{ value: string; label: string }>>([]);
  const [dashboardId, setDashboardId] = useState<string | undefined>();
  const [alsoShare, setAlsoShare] = useState(false);
  const [shareChartId, setShareChartId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const source = useMemo(() => (cell ? publishSource(cell, cells) : null), [cell, cells]);
  const model = useMemo(() => (cell ? chartModelFor(cell) : null), [cell]);

  useEffect(() => {
    if (!open || !cell) return;
    const spec = cell.chart || {};
    setTitle(cell.type === 'pivot'
      ? t('publish_default_pivot', { from: spec.from ?? '' })
      : [spec.y?.join(', ') || t('agg_count'), spec.x ? t('publish_by', { x: spec.x }) : ''].filter(Boolean).join(' '));
    if (target !== 'dashboard') return;
    void import('@/app/(dashboard)/dashboards/services/chartService').then(async ({ chartService }) => {
      try {
        const list = await chartService.listDashboards(projectId, { limit: 100 });
        setDashboards(list.map((d: { id: string; name?: string; title?: string }) => ({ value: String(d.id), label: d.name || d.title || t('untitled') })));
      } catch {
        setDashboards([]);
      }
    });
  }, [open, cell, target, projectId, t]);

  const publish = async () => {
    if (!cell || !source || !model || source.kind === 'missing') return;
    if (target === 'dashboard' && !dashboardId) {
      message.warning(t('publish_pick_dashboard'));
      return;
    }
    setBusy(true);
    try {
      const { createSavedQuery } = await import('@/services/savedQueryBindService');
      let sql: string;
      let dataSourceId: string;
      if (source.kind === 'sql') {
        sql = source.sql;
        dataSourceId = source.dataSourceId;
      } else {
        // A Python result has no query to re-run: keep it as a dataset and chart that.
        const frame = await frameFor(source.name);
        if (!frame) throw new Error(t('chart_not_run', { name: source.name }));
        const saved = await notebookService.saveDataset(`${title} (data)`, frame.columns, frame.rows, projectId ? String(projectId) : null);
        dataSourceId = String(saved.data_source?.id ?? '');
        if (!dataSourceId) throw new Error(t('dataset_failed'));
        const { getDataSourceSchema } = await import('@/api/dataSources');
        const schema = (await getDataSourceSchema(dataSourceId)).schema;
        const table = schema?.tables?.[0]?.name ?? `${title} (data)`;
        sql = `SELECT * FROM "${table.replace(/"/g, '""')}"`;
      }
      const savedQueryId = await createSavedQuery({
        name: title, sql, projectId,
        metadata: { source: 'notebook', notebook_id: notebookId, data_source_id: dataSourceId, dataSourceId },
      });
      if (!savedQueryId) throw new Error(t('publish_failed'));
      const chartQuery = { ...model.chartQuery, saved_query_id: savedQueryId };

      if (target === 'library') {
        const { chartBuilderService } = await import('@/app/(dashboard)/chart-designer/services/chartBuilderService');
        const created = await chartBuilderService.createChart(
          { title, chartType: model.chartType, dataSourceId, chartQuery, chartOptions: model.chartOptions },
          projectId,
        );
        message.success(
          <span>
            {t('publish_saved')}{' '}
            <a href="/chart-designer">{t('publish_open_library')}</a>
          </span>,
        );
        const createdId = (created as { id?: string | number } | null)?.id;
        if (alsoShare && createdId != null) {
          // Same publish step as the chart library, Ask AI, SQL editor and dashboards.
          setShareChartId(String(createdId));
        } else {
          onClose();
        }
      } else {
        const { stageSavedQueryBind, buildBindNavigateUrl } = await import('@/app/(dashboard)/dashboards/utils/queryBindBridge');
        const payload = {
          savedQueryId, name: title, sql, dataSourceId, chartQuery, chartType: model.chartType,
          target: 'dashboard' as const, dashboardId, dataMode: 'live' as const,
        };
        stageSavedQueryBind(payload);
        onClose();
        router.push(buildBindNavigateUrl(payload));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('publish_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal
      open={open && !shareChartId}
      title={target === 'library' ? t('save_to_library') : t('add_to_dashboard')}
      okText={target === 'library' ? t('save') : t('add')}
      okButtonProps={{ disabled: !source || source.kind === 'missing' || !title.trim() }}
      confirmLoading={busy}
      onOk={() => void publish()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <label className="nb-field" style={{ width: '100%' }}>
          <span className="nb-field__label">{t('publish_title')}</span>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {target === 'dashboard' ? (
          <label className="nb-field" style={{ width: '100%' }}>
            <span className="nb-field__label">{t('publish_dashboard')}</span>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('publish_pick_dashboard')}
              value={dashboardId}
              options={dashboards}
              onChange={setDashboardId}
              notFoundContent={t('publish_no_dashboards')}
            />
          </label>
        ) : null}
        {source?.kind === 'sql' ? (
          <Text type="secondary">{t('publish_live', { name: source.name })}</Text>
        ) : source?.kind === 'python' ? (
          <Alert type="info" showIcon message={t('publish_snapshot', { name: source.name })} />
        ) : (
          <Alert type="warning" showIcon message={t('publish_missing')} />
        )}
        {model?.dropped.length ? <Alert type="warning" showIcon message={t('publish_dropped')} /> : null}
        {target === 'library' ? (
          <Checkbox checked={alsoShare} onChange={(e) => setAlsoShare(e.target.checked)}>
            {t('publish_also_share')}
          </Checkbox>
        ) : null}
      </Space>
    </Modal>
    {shareChartId ? (
      <PublishToFeedModal
        open
        assetType="chart"
        assetId={shareChartId}
        defaultTitle={title}
        projectId={projectId ? String(projectId) : undefined}
        onCancel={() => { setShareChartId(null); onClose(); }}
        onSuccess={() => { setShareChartId(null); onClose(); }}
      />
    ) : null}
    </>
  );
}
