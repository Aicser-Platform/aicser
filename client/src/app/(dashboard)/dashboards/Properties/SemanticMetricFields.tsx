'use client';

import React, { useEffect, useState } from 'react';
import { Select, Switch, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

type Metric = { id: string; name: string; expression?: string; description?: string; certified?: boolean };
type Dimension = { id: string; name: string; expression?: string };

type Props = {
  dataSourceId?: string;
  chartQuery?: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  recommendWhenAvailable?: boolean;
};

export function SemanticMetricFields({
  dataSourceId,
  chartQuery,
  onChange,
  recommendWhenAvailable = false,
}: Props) {
  const t = useTranslations('dashboards');
  const [useSemantic, setUseSemantic] = useState(Boolean(chartQuery?.semantic_metric_id));
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dataSourceId) return;
    setLoading(true);
    Promise.all([
      fetchApi(`semantic/metrics?data_source_id=${encodeURIComponent(dataSourceId)}`),
      fetchApi(`semantic/dimensions?data_source_id=${encodeURIComponent(dataSourceId)}`),
    ])
      .then(([mRes, dRes]) => {
        const m = mRes?.metrics || [];
        const d = dRes?.dimensions || [];
        setMetrics(m);
        setDimensions(d);
        if (recommendWhenAvailable && m.length > 0 && !chartQuery?.semantic_metric_id) {
          const certified = m.filter((x: Metric) => x.certified);
          const pick = (certified.length ? certified : m)[0];
          setUseSemantic(true);
          onChange({
            semantic_metric_id: pick.id,
            semantic_dimension_ids: [],
            data_source_id: dataSourceId,
          });
        }
      })
      .catch(() => {
        setMetrics([]);
        setDimensions([]);
      })
      .finally(() => setLoading(false));
  }, [dataSourceId, recommendWhenAvailable, chartQuery?.semantic_metric_id]);

  const metricId = chartQuery?.semantic_metric_id as string | undefined;
  const dimensionIds = (chartQuery?.semantic_dimension_ids as string[]) || [];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Space>
        <Switch
          checked={useSemantic}
          onChange={(checked) => {
            setUseSemantic(checked);
            if (!checked) {
              onChange({
                semantic_metric_id: undefined,
                semantic_dimension_ids: [],
              });
            }
          }}
          size="small"
        />
        <Typography.Text>{t('semantic_mode_label')}</Typography.Text>
      </Space>
      {useSemantic && (
        <>
          <Select
            loading={loading}
            placeholder={t('semantic_metric_placeholder')}
            style={{ width: '100%' }}
            value={metricId}
            options={metrics.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(id) => {
              const metric = metrics.find((m) => m.id === id);
              onChange({
                semantic_metric_id: id,
                yMetrics: metric?.expression
                  ? [{ field: metric.expression, aggregation: 'sum' }]
                  : chartQuery?.yMetrics,
                aggregate: true,
              });
            }}
          />
          <Select
            mode="multiple"
            loading={loading}
            placeholder={t('semantic_dimension_placeholder')}
            style={{ width: '100%' }}
            value={dimensionIds}
            options={dimensions.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(ids) => {
              const selected = dimensions.filter((d) => ids.includes(d.id));
              const drillPath = selected.map((d) => d.expression || d.name).filter(Boolean);
              onChange({
                semantic_dimension_ids: ids,
                x: selected[0]?.expression || chartQuery?.x,
                drillPath: drillPath.length ? drillPath : chartQuery?.drillPath,
              });
            }}
          />
        </>
      )}
    </Space>
  );
}

export default SemanticMetricFields;
