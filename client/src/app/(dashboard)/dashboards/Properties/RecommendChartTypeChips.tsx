'use client';

import React from 'react';
import { Tag, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { recommendChartTypes, type ColumnHint } from '../utils/chartRecommendations';
import type { WidgetType } from '../stores/useDashboardStore';

type Props = {
  chartType: WidgetType;
  xField?: string;
  yFields?: string[];
  columns?: ColumnHint[];
  onSelect: (type: WidgetType) => void;
};

export function RecommendChartTypeChips({ chartType, xField, yFields = [], columns = [], onSelect }: Props) {
  const t = useTranslations('dashboards');
  const recs = recommendChartTypes(xField, yFields, columns).filter((r) => r !== chartType);

  if (!xField || recs.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
        {t('recommend_chart_type')}
      </Typography.Text>
      <Space size={4} wrap>
        {recs.slice(0, 3).map((type) => (
          <Tag
            key={type}
            color="processing"
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(type as WidgetType)}
          >
            {t(`chart_type_${type}` as 'line')}
          </Tag>
        ))}
      </Space>
    </div>
  );
}

export default RecommendChartTypeChips;
