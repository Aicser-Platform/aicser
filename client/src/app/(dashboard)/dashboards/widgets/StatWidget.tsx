'use client';

import React from 'react';
import { Typography } from 'antd';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import { formatStatValue } from '../utils/numberFormatter';
import { useTranslations } from 'next-intl';

const { Text, Title } = Typography;

interface StatWidgetProps {
  data?: {
    x?: any[];
    y?: any[];
    value?: any;
    series?: { name: string; data: any[] }[];
  };
  config: {
    title?: string;
    value?: number | string;
    format?: 'currency' | 'percent' | 'number';
    trendValue?: string;
    showTrend?: boolean;
    trendLabel?: string;
    fontSize?: number;
    color?: string;
  };
}

/**
 * Displays a key metric with optional trend indicator
 * Extracted from WidgetRenderer for better maintainability
 */
export const StatWidget: React.FC<StatWidgetProps> = ({ data, config }) => {
  const t = useTranslations('stat_widget');
  // Extract value from data if available
  let displayValue = config.value;
  let displayTitle = config.title;

  if (data) {
    if (data.value !== undefined && data.value !== null) {
      displayValue = data.value;
    } else if (data.series && data.series.length > 0 && data.series[0]?.data && data.series[0].data.length > 0) {
      displayValue = data.series[0].data[0];
      displayTitle = config.title || data.series[0].name;
    } else if (data.y && data.y.length > 0) {
      displayValue = data.y[0];
      displayTitle = config.title || (data.x && data.x[0]);
    }
  }

  const { format = 'number', trendValue = '+12%', showTrend = true, trendLabel = t('vs_previous_30_days'), fontSize = 32, color } = config;

  const valueToDisplay = displayValue ?? '0';
  const isPositive = String(trendValue).startsWith('+');

  const formattedValue = formatStatValue(valueToDisplay, format);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      <Text type="secondary" style={{ fontSize: '13px', marginBottom: 8, fontWeight: 500 }}>
        {displayTitle || t('key_metric')}
      </Text>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <Title
          level={2}
          className={`studio-stat-value number-${format === 'currency' ? 'currency' : format === 'percent' ? 'percent' : 'large'} number-compact`}
          style={{ margin: 0, fontSize: `${fontSize}px`, fontWeight: 600, color: color || undefined }}
        >
          {formattedValue}
        </Title>
        {showTrend && trendValue && (
          <div
            className={`number-compact ${isPositive ? 'number-positive' : 'number-negative'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: isPositive ? '#52c41a' : '#ff4d4f',
              background: isPositive ? 'rgba(82, 196, 26, 0.1)' : 'rgba(255, 77, 79, 0.1)',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {isPositive ? <CaretUpOutlined /> : <CaretDownOutlined />}
            {trendValue}
          </div>
        )}
      </div>
      {trendLabel && (
        <Text type="secondary" style={{ fontSize: '12px', marginTop: 8 }}>
          {trendLabel}
        </Text>
      )}
    </div>
  );
};
