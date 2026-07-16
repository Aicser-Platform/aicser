'use client';

import React, { useMemo } from 'react';
import { Typography } from 'antd';
import {
  BarChartOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  DollarOutlined,
  LineChartOutlined,
  NumberOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import { formatStatValue } from '../utils/numberFormatter';
import { useTranslations } from 'next-intl';

const { Text, Title } = Typography;

/** Determine color from threshold config */
function resolveThresholdColor(
  numericValue: number,
  config: StatWidgetProps['config']
): string | undefined {
  const { thresholdWarn, thresholdCritical, thresholdDirection = 'above' } = config;
  if (thresholdCritical == null && thresholdWarn == null) return config.color;

  const above = thresholdDirection !== 'below';
  const breaches = (limit: number) => (above ? numericValue >= limit : numericValue <= limit);

  if (thresholdCritical != null && breaches(thresholdCritical)) return '#ff4d4f';
  if (thresholdWarn != null && breaches(thresholdWarn)) return '#faad14';
  return config.color;
}

/** Inline sparkline using SVG — no extra dep required */
function Sparkline({
  values,
  color = '#00c2cb',
  type = 'line',
  height = 36,
  width = 100,
}: {
  values: number[];
  color?: string;
  type?: 'line' | 'bar';
  height?: number;
  width?: number;
}) {
  const data = useMemo(() => {
    if (!values || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = 2;
    const w = width;
    const h = height;
    const step = (w - pad * 2) / (values.length - 1);

    if (type === 'bar') {
      const barW = Math.max(2, step - 2);
      return (
        <svg width={w} height={h} style={{ overflow: 'visible' }}>
          {values.map((v, i) => {
            const barH = Math.max(2, ((v - min) / range) * (h - pad * 2));
            const x = pad + i * step - barW / 2;
            const y = h - pad - barH;
            return <rect key={i} x={x} y={y} width={barW} height={barH} fill={color} opacity={0.75} rx={1} />;
          })}
        </svg>
      );
    }

    const points = values.map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y] as [number, number];
    });

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${h - pad} L${points[0][0].toFixed(1)},${h - pad} Z`;

    return (
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#sg-${color.replace('#', '')})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Endpoint dot */}
        <circle
          cx={points[points.length - 1][0]}
          cy={points[points.length - 1][1]}
          r={3}
          fill={color}
        />
      </svg>
    );
  }, [values, color, type, height, width]);

  if (!data) return null;
  return <div style={{ lineHeight: 0 }}>{data}</div>;
}

interface StatWidgetProps {
  data?: {
    x?: any[];
    y?: any[];
    value?: any;
    series?: { name: string; data: any[] }[];
    sparklineValues?: number[];
    comparisonValue?: number | string;
    comparisonLabel?: string;
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
    thresholdWarn?: number;
    thresholdCritical?: number;
    thresholdDirection?: 'above' | 'below';
    showSparkline?: boolean;
    sparklineType?: 'line' | 'bar';
    sparklineColor?: string;
    comparisonPeriodLabel?: string;
    // Conditional icon
    iconName?: string;
    // Layout variant
    layout?: 'default' | 'compact' | 'centered' | 'executive';
  };
}

const EXECUTIVE_CARD_COLORS = ['#14532d', '#166534', '#0f3f24', '#177245'];

function pickExecutiveColor(title?: string): string {
  const seed = (title || 'metric').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return EXECUTIVE_CARD_COLORS[seed % EXECUTIVE_CARD_COLORS.length];
}

function resolveKpiIcon(iconName?: string, title?: string, format?: string) {
  const text = `${iconName || ''} ${title || ''} ${format || ''}`.toLowerCase();
  if (text.includes('margin') || text.includes('percent') || text.includes('%')) return <PercentageOutlined />;
  if (text.includes('revenue') || text.includes('sales') || text.includes('profit') || text.includes('cost') || text.includes('expense') || text.includes('usd') || text.includes('currency')) return <DollarOutlined />;
  if (text.includes('trend') || text.includes('growth') || text.includes('rate')) return <LineChartOutlined />;
  if (text.includes('bar') || text.includes('volume')) return <BarChartOutlined />;
  return <NumberOutlined />;
}

export const StatWidget: React.FC<StatWidgetProps> = ({ data, config }) => {
  const t = useTranslations('stat_widget');

  // Extract primary value
  let displayValue = config.value;
  let displayTitle = config.title;
  let sparklineValues: number[] = data?.sparklineValues || [];
  let comparisonValue = data?.comparisonValue;
  let comparisonLabel = data?.comparisonLabel || config.comparisonPeriodLabel;

  if (data) {
    if (data.value !== undefined && data.value !== null) {
      displayValue = data.value;
    } else if (data.series && data.series.length > 0 && data.series[0]?.data?.length > 0) {
      displayValue = data.series[0].data[data.series[0].data.length - 1];
      displayTitle = config.title || data.series[0].name;
      // Use series data as sparkline
      if (!sparklineValues.length) {
        sparklineValues = data.series[0].data.map(Number).filter((n) => !isNaN(n));
      }
      // Second series = comparison
      if (data.series.length > 1 && comparisonValue === undefined) {
        const compData = data.series[1].data;
        comparisonValue = compData[compData.length - 1];
        if (!comparisonLabel) comparisonLabel = data.series[1].name;
      }
    } else if (data.y && data.y.length > 0) {
      displayValue = data.y[data.y.length - 1];
      displayTitle = config.title || (data.x && data.x[data.x.length - 1]);
      if (!sparklineValues.length) {
        sparklineValues = data.y.map(Number).filter((n) => !isNaN(n));
      }
    }
  }

  const {
    format = 'number',
    trendValue = '',
    showTrend = false,
    trendLabel = '',
    fontSize = 32,
    color,
    showSparkline = false,
    sparklineType = 'line',
    sparklineColor,
    layout = 'default',
  } = config;

  const valueToDisplay = displayValue ?? '0';
  const numericValue = Number(valueToDisplay);
  const valueColor =
    Number.isFinite(numericValue) ? resolveThresholdColor(numericValue, config) : config.color;

  const formattedValue = formatStatValue(valueToDisplay, format);

  // Compute trend from comparison if trendValue not set explicitly
  let computedTrendValue = trendValue;
  let trendIsPositive = trendValue.startsWith('+');
  let trendIsNeutral = !trendValue;

  if (!trendValue && comparisonValue !== undefined && comparisonValue !== null) {
    const curr = Number(displayValue);
    const prev = Number(comparisonValue);
    if (!isNaN(curr) && !isNaN(prev) && prev !== 0) {
      const pct = ((curr - prev) / Math.abs(prev)) * 100;
      const sign = pct >= 0 ? '+' : '';
      computedTrendValue = `${sign}${pct.toFixed(1)}%`;
      trendIsPositive = pct >= 0;
      trendIsNeutral = false;
    }
  } else if (!trendValue && comparisonValue === undefined && sparklineValues.length >= 2) {
    const curr = Number(sparklineValues[sparklineValues.length - 1]);
    const prev = Number(sparklineValues[sparklineValues.length - 2]);
    if (!isNaN(curr) && !isNaN(prev) && prev !== 0) {
      const pct = ((curr - prev) / Math.abs(prev)) * 100;
      const sign = pct >= 0 ? '+' : '';
      computedTrendValue = `${sign}${pct.toFixed(1)}%`;
      trendIsPositive = pct >= 0;
      trendIsNeutral = false;
      if (!comparisonLabel) comparisonLabel = config.comparisonPeriodLabel || t('prior_period');
    }
  } else if (trendValue) {
    trendIsPositive = trendValue.startsWith('+');
    trendIsNeutral = false;
  }

  const isCentered = layout === 'centered';
  const isExecutive = layout === 'executive';

  if (isExecutive) {
    const cardColor = color || pickExecutiveColor(displayTitle);
    const executiveTrendColor = trendIsPositive ? '#9be7b1' : '#ff9a8a';
    const sparkColor = sparklineColor || (trendIsPositive ? '#a7f3c2' : '#ff9a8a');

    return (
      <div
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '18px 20px 16px',
          background: cardColor,
          color: '#fff',
          borderRadius: 6,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.16)',
              color: '#d9fbe4',
              flex: '0 0 auto',
              fontSize: 18,
            }}
          >
            {resolveKpiIcon(config.iconName, displayTitle, format)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Title
              level={2}
              className={`studio-stat-value number-${format === 'currency' ? 'currency' : format === 'percent' ? 'percent' : 'large'} number-compact`}
              style={{
                margin: 0,
                color: '#fff',
                fontSize: `${Math.min(Math.max(fontSize, 26), 34)}px`,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: 0,
              }}
            >
              {formattedValue}
            </Title>
            <div
              style={{
                color: 'rgba(255,255,255,0.76)',
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.25,
                marginTop: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={displayTitle || t('key_metric')}
            >
              {displayTitle || t('key_metric')}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
          <div style={{ minWidth: 92 }}>
            {(showTrend || computedTrendValue) && computedTrendValue && !trendIsNeutral ? (
              <div
                className={`number-compact ${trendIsPositive ? 'number-positive' : 'number-negative'}`}
                style={{
                  color: executiveTrendColor,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {trendIsPositive ? <CaretUpOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
                {computedTrendValue.replace(/^\+/, '')}
              </div>
            ) : null}
            <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: 11, marginTop: 3, lineHeight: 1.2 }}>
              {trendLabel || (comparisonLabel ? `vs ${comparisonLabel}` : config.comparisonPeriodLabel || t('prior_period'))}
            </div>
          </div>
          {showSparkline && sparklineValues.length >= 2 ? (
            <div style={{ width: 110, flex: '0 0 110px', opacity: 0.95 }}>
              <Sparkline
                values={sparklineValues}
                color={sparkColor}
                type={sparklineType}
                height={30}
                width={108}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: layout === 'compact' ? '4px 12px' : '0 16px',
        textAlign: isCentered ? 'center' : 'left',
        alignItems: isCentered ? 'center' : 'flex-start',
        gap: 2,
      }}
    >
      {/* Title */}
      <Text type="secondary" style={{ fontSize: '12px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', marginBottom: 2 }}>
        {displayTitle || t('key_metric')}
      </Text>

      {/* Value row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <Title
          level={2}
          className={`studio-stat-value number-${format === 'currency' ? 'currency' : format === 'percent' ? 'percent' : 'large'} number-compact`}
          style={{ margin: 0, fontSize: `${fontSize}px`, fontWeight: 700, color: valueColor || undefined, lineHeight: 1.1 }}
        >
          {formattedValue}
        </Title>

        {/* Trend badge */}
        {(showTrend || computedTrendValue) && computedTrendValue && !trendIsNeutral && (
          <div
            className={`number-compact ${trendIsPositive ? 'number-positive' : 'number-negative'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              color: trendIsPositive ? '#52c41a' : '#ff4d4f',
              background: trendIsPositive ? 'rgba(82, 196, 26, 0.1)' : 'rgba(255, 77, 79, 0.1)',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {trendIsPositive ? <CaretUpOutlined style={{ fontSize: 10 }} /> : <CaretDownOutlined style={{ fontSize: 10 }} />}
            {computedTrendValue}
          </div>
        )}
      </div>

      {/* Trend label / comparison period */}
      {(trendLabel || comparisonLabel) && (
        <Text type="secondary" style={{ fontSize: '11px', marginTop: 2 }}>
          {trendLabel || (comparisonLabel ? `vs ${comparisonLabel}` : '')}
          {comparisonValue !== undefined && comparisonValue !== null && !computedTrendValue && (
            <span style={{ marginLeft: 4 }}>
              ({formatStatValue(comparisonValue, format)})
            </span>
          )}
        </Text>
      )}

      {/* Sparkline */}
      {showSparkline && sparklineValues.length >= 2 && (
        <div style={{ marginTop: 8, width: '100%', maxWidth: 140 }}>
          <Sparkline
            values={sparklineValues}
            color={sparklineColor || config.color || '#00c2cb'}
            type={sparklineType}
            height={32}
            width={isCentered ? 100 : 120}
          />
        </div>
      )}
    </div>
  );
};

export default StatWidget;
