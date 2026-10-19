'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Segmented, Select, Space, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import { compileMetric, listModelDimensions, listModelMetrics } from '@/api/semanticModel';
import { fetchApi } from '@/utils/api';
import { tableQuery } from './sheetData';

const { Text } = Typography;

export type RangeRequest = { dataSourceId: string; sourceName: string; sql: string; name: string };

/**
 * Put data into the sheet at the selected cell: a table, a semantic metric (by dimensions and
 * period, the same definition as Ask and dashboards), your own SQL, or (with AI) a description
 * turned into SQL by the same text-to-SQL path as the SQL editor.
 */
export function DataRangeDialog({
  open, anchorLabel, dataSources, defaultSourceId, aiAvailable, initial, onCancel, onSubmit,
}: {
  open: boolean;
  anchorLabel: string;
  dataSources: Array<{ value: string; label: string }>;
  defaultSourceId?: string | null;
  aiAvailable: boolean;
  /** Editing an existing range's query. */
  initial?: RangeRequest | null;
  onCancel: () => void;
  onSubmit: (req: RangeRequest) => Promise<void>;
}) {
  const t = useTranslations('sheets');
  const [sourceId, setSourceId] = useState<string | null>(null);
  type Mode = 'table' | 'metric' | 'sql' | 'ai';
  const [mode, setMode] = useState<Mode>('table');
  const [metric, setMetric] = useState<string | null>(null);
  const [dims, setDims] = useState<string[]>([]);
  const [grain, setGrain] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [sql, setSql] = useState('');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { schema } = useDataSourceSchema(sourceId);
  const metricsQuery = useQuery({
    queryKey: ['range-metrics', sourceId],
    queryFn: () => Promise.all([listModelMetrics(sourceId!), listModelDimensions(sourceId!)]),
    enabled: open && mode === 'metric' && Boolean(sourceId),
  });
  const [modelMetrics, modelDims] = metricsQuery.data ?? [[], []];
  const hasTimeDim = modelDims.some((d) => dims.includes(d.name) && d.dimension_type === 'time');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (initial) {
      setSourceId(initial.dataSourceId);
      setMode('sql');
      setSql(initial.sql);
      setName(initial.name);
    } else {
      setSourceId(defaultSourceId ?? dataSources[0]?.value ?? null);
      setMode('table');
      setTable(null);
      setSql('');
      setPrompt('');
      setName('');
    }
  }, [open, initial, defaultSourceId, dataSources]);

  const tables = useMemo(
    () => (schema?.tables ?? []).map((tb) => {
      const full = tb.schema ? `${tb.schema}.${tb.name}` : tb.name;
      return { value: full, label: tb.rowCount != null ? `${full} · ${tb.rowCount.toLocaleString()}` : full };
    }),
    [schema],
  );

  const writeSql = async () => {
    if (!sourceId || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi<{ success: boolean; code?: string; error?: string }>('/api/ai/query-editor/generate-code', {
        method: 'POST',
        body: JSON.stringify({ query: prompt.trim(), data_source_id: sourceId, language: 'sql' }),
      });
      if (!res.success || !res.code) throw new Error(res.error || t('ai_failed'));
      setSql(res.code.trim());
      setMode('sql');
      if (!name) setName(prompt.trim().slice(0, 80));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai_failed'));
    } finally {
      setBusy(false);
    }
  };

  const finalSql = mode === 'table' ? (table ? tableQuery(table) : '') : mode === 'metric' ? (metric ? 'metric' : '') : sql.trim();
  const submit = async () => {
    if (!sourceId || !finalSql) return;
    setBusy(true);
    setError(null);
    try {
      // A metric becomes the semantic layer's SQL for it, then refreshes like any other range.
      const rangeSql = mode === 'metric' && metric
        ? await compileMetric(sourceId, { metric, dimensions: dims, time_grain: hasTimeDim ? grain : null })
        : finalSql;
      await onSubmit({
        dataSourceId: sourceId,
        sourceName: dataSources.find((d) => d.value === sourceId)?.label ?? '',
        sql: rangeSql,
        name: name.trim() || (mode === 'table' && table ? table : mode === 'metric' && metric ? [metric, ...dims].join(' by ') : t('range_default_name')),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('query_failed'));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={initial ? t('range_edit_title') : t('range_insert_title')}
      onCancel={onCancel}
      width={640}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onCancel}>{t('cancel')}</Button>
          {mode === 'ai' ? (
            <Button type="primary" icon={<BulbOutlined />} loading={busy} disabled={!sourceId || !prompt.trim()} onClick={() => void writeSql()}>
              {t('range_ai_write')}
            </Button>
          ) : (
            <Button type="primary" loading={busy} disabled={!sourceId || !finalSql} onClick={() => void submit()}>
              {initial ? t('range_update') : t('range_insert')}
            </Button>
          )}
        </Space>
      }
    >
      <Form layout="vertical" requiredMark={false}>
        <Text type="secondary">{t('range_at', { cell: anchorLabel })}</Text>
        <Form.Item label={t('range_source')} style={{ marginTop: 12 }}>
          <Select
            showSearch
            optionFilterProp="label"
            value={sourceId ?? undefined}
            options={dataSources}
            onChange={(v) => { setSourceId(v); setTable(null); }}
            placeholder={t('range_source_placeholder')}
          />
        </Form.Item>
        {!initial ? (
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'table', label: t('range_mode_table') },
              ...(isEnterpriseEdition ? [{ value: 'metric', label: t('range_mode_metric') }] : []),
              { value: 'sql', label: t('range_mode_sql') },
              ...(aiAvailable ? [{ value: 'ai', label: t('range_mode_ai') }] : []),
            ]}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {mode === 'table' ? (
          <Form.Item label={t('range_table')}>
            <Select showSearch value={table ?? undefined} options={tables} onChange={setTable} placeholder={t('range_table_placeholder')} disabled={!sourceId} />
          </Form.Item>
        ) : mode === 'metric' ? (
          <>
            <Form.Item label={t('range_metric')} extra={modelMetrics.length || metricsQuery.isLoading ? undefined : t('range_metric_none')}>
              <Select
                showSearch
                loading={metricsQuery.isLoading}
                value={metric ?? undefined}
                onChange={setMetric}
                placeholder={t('range_metric_placeholder')}
                options={modelMetrics.map((m) => ({ value: m.name, label: m.certified ? `${m.name} ✓` : m.name }))}
                disabled={!sourceId}
              />
            </Form.Item>
            <Space wrap align="start" style={{ width: '100%' }}>
              <Form.Item label={t('range_metric_by')} style={{ minWidth: 280 }}>
                <Select mode="multiple" value={dims} onChange={setDims} placeholder={t('range_metric_by_placeholder')}
                  options={modelDims.map((d) => ({ value: d.name, label: d.name }))} />
              </Form.Item>
              {hasTimeDim ? (
                <Form.Item label={t('range_metric_grain')}>
                  <Select style={{ width: 170 }} value={grain ?? undefined} onChange={setGrain} allowClear
                    options={['day', 'week', 'month', 'quarter', 'year', 'fiscal_quarter', 'fiscal_year'].map((g) => ({ value: g, label: t(`grain_${g}`) }))} />
                </Form.Item>
              ) : null}
            </Space>
          </>
        ) : mode === 'sql' ? (
          <Form.Item label={t('range_sql')}>
            <Input.TextArea value={sql} onChange={(e) => setSql(e.target.value)} autoSize={{ minRows: 5, maxRows: 14 }}
              spellCheck={false} className="wb-sql" placeholder="SELECT …" />
          </Form.Item>
        ) : (
          <Form.Item label={t('range_ai_prompt')} extra={t('range_ai_note')}>
            <Input.TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={t('range_ai_placeholder')} />
          </Form.Item>
        )}
        {mode !== 'ai' ? (
          <Form.Item label={t('range_name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('range_name_placeholder')} />
          </Form.Item>
        ) : null}
        <Text type="secondary" style={{ fontSize: 12 }}>{t('range_live_note')}</Text>
        {error ? <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} /> : null}
      </Form>
    </Modal>
  );
}
