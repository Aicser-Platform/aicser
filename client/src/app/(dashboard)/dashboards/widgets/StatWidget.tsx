'use client';

import React, { useId, useMemo } from 'react';
import { Typography } from 'antd';
import {
  CaretDownOutlined,
  CaretUpOutlined,
} from '@ant-design/icons';
import { DashboardIcon } from '../icons';
import { formatStatValue } from '../utils/numberFormatter';
import { useTranslations } from 'next-intl';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';
import { getColorsFromPalette } from './WidgetRendererConfig';
import { getStatValueStyle } from './utils/conditionalFormatting';
import type { ConditionalFormattingRule } from '../Properties/ConditionalFormattingEditor';

const { Text, Title } = Typography;

export type StatLayout =
  | 'default'
  | 'compact'
  | 'centered'
  | 'executive'
  | 'split'
  | 'tile';

function resolveThresholdColor(
  numericValue: number,
  config: StatWidgetProps['config'],
  fallback?: string,
): string | undefined {
  const { thresholdWarn, thresholdCritical, thresholdDirection = 'above' } = config;
  if (thresholdCritical == null && thresholdWarn == null) return fallback ?? config.color;

  const above = thresholdDirection !== 'below';
  const breaches = (limit: number) => (above ? numericValue >= limit : numericValue <= limit);

  if (thresholdCritical != null && breaches(thresholdCritical)) return '#ff4d4f';
  if (thresholdWarn != null && breaches(thresholdWarn)) return '#faad14';
  return fallback ?? config.color;
}

function parseHex(color: string): { r: number; g: number; b: number } | null {
  const raw = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  if (short) {
    const [r, g, b] = short[1]!.split('').map((c) => parseInt(c + c, 16));
    return { r: r!, g: g!, b: b! };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!full) return null;
  const n = parseInt(full[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function darkenColor(color: string, factor = 0.42): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const r = Math.round(rgb.r * factor);
  const g = Math.round(rgb.g * factor);
  const b = Math.round(rgb.b * factor);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** Accent from explicit color → palette → brand fallback. */
function resolveStatAccent(config: StatWidgetProps['config']): string {
  if (typeof config.color === 'string' && config.color.trim()) return config.color.trim();
  const paletteId = resolveChartPaletteId(config.colorPalette, config.dashboardDefaultPalette);
  const colors = getColorsFromPalette(paletteId, 1);
  return colors[0] || '#00c2cb';
}

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
  const uid = useId().replace(/:/g, '');
  const data = useMemo(() => {
    if (!values || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = 2;
    const w = width;
    const h = height;
    const step = (w - pad * 2) / (values.length - 1);
    const gradId = `sg-${uid}`;

    if (type === 'bar') {
      const barW = Math.max(2, step - 2);
      return (
        <svg width={w} height={h} style={{ overflow: 'visible' }} aria-hidden>
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
    const last = points[points.length - 1]!;
    const first = points[0]!;
    const areaD = `${pathD} L${last[0].toFixed(1)},${h - pad} L${first[0].toFixed(1)},${h - pad} Z`;

    return (
      <svg width={w} height={h} style={{ overflow: 'visible' }} aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
      </svg>
    );
  }, [values, color, type, height, width, uid]);

  if (!data) return null;
  return <div style={{ lineHeight: 0 }}>{data}</div>;
}

export interface StatWidgetProps {
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
    /** Suppress the internal title text — for callers that already show the
     * title in their own wrapping header (chat's chart-title row, the
     * dashboard-preview grid's TileHeader), so it isn't shown twice. */
    hideTitle?: boolean;
    value?: number | string;
    format?: 'currency' | 'percent' | 'number';
    trendValue?: string;
    showTrend?: boolean;
    trendLabel?: string;
    fontSize?: number;
    color?: string;
    colorPalette?: string;
    dashboardDefaultPalette?: string;
    thresholdWarn?: number;
    thresholdCritical?: number;
    thresholdDirection?: 'above' | 'below';
    showSparkline?: boolean;
    sparklineType?: 'line' | 'bar';
    sparklineColor?: string;
    comparisonPeriodLabel?: string;
    compareLabel?: string;
    iconName?: string;
    /** Structured icon ref (antd | emoji | custom | brand). Prefer over iconName. */
    icon?: unknown;
    layout?: StatLayout;
    goalTarget?: number;
    statUnit?: string;
    currencySymbol?: string;
    /** Which trend direction counts as "good" for coloring — e.g. cost/error-rate/churn
     * KPIs improve by going down, so a decrease should show green, not red. Defaults to
     * 'up' (the historical behavior: any increase is green) for widgets that don't set it. */
    trendGoodDirection?: 'up' | 'down';
    /** Same rule engine as Table/Chart conditional formatting — takes priority over
     * thresholdWarn/thresholdCritical when rules matching column 'value'/'*' are set. */
    conditionalFormatting?: ConditionalFormattingRule[];
  };
  onFilter?: (value: unknown) => void;
  filterValue?: unknown;
  /** Actual query aggregation — authoritative over guessing from the free-text title. */
  query?: {
    yMetric?: string;
    yMetrics?: { field: string; aggregation: string }[];
  };
}

/** Resolve sum/average/latest from the query's real aggregation instead of pattern-matching
 * the widget's free-text title — a KPI titled "Average Order Value" whose query aggregation
 * is actually `sum` was silently re-averaged client-side, disagreeing with the same metric
 * shown in a table or chart. Falls back to the title heuristic only when no aggregation
 * metadata is available at all (older chat-pinned stat widgets). */
export function resolveSeriesAggregation(
  query: StatWidgetProps['query'],
  titleHint: string,
): 'sum' | 'avg' | 'latest' {
  const agg = String(query?.yMetrics?.[0]?.aggregation || query?.yMetric || '').toLowerCase();
  if (agg === 'sum' || agg === 'count' || agg === 'distinct_count') return 'sum';
  if (agg === 'avg' || agg === 'average' || agg === 'mean') return 'avg';
  if (agg === 'none' || agg === 'max' || agg === 'min') return 'latest';
  // No usable aggregation metadata — fall back to the title-text guess.
  if (titleHint.startsWith('total ') || titleHint.includes(' count') || titleHint === 'record count') return 'sum';
  if (titleHint.startsWith('average ') || titleHint.startsWith('avg ')) return 'avg';
  return 'latest';
}

function resolveKpiIcon(icon: unknown, iconName?: string, title?: string, format?: string) {
  return (
    <DashboardIcon
      icon={icon}
      legacyIconName={iconName}
      fallbackText={`${title || ''} ${format || ''}`}
      size={16}
    />
  );
}

function formatComparisonCaption(label?: string): string {
  const raw = (label || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^vs\s+/i, '').trim();
  return cleaned ? `vs ${cleaned}` : '';
}

function GoalProgress({
  value,
  goal,
  color,
  light,
  goodDirection = 'up',
}: {
  value: number;
  goal: number;
  color?: string;
  light?: boolean;
  /** For a "lower is better" target (e.g. error rate ≤ 1%), being under goal is full
   * achievement — a naive value/goal ratio would show a great result (0.3 vs a 1 target)
   * as a nearly-empty bar, reading as under-performance instead of success. */
  goodDirection?: 'up' | 'down';
}) {
  const t = useTranslations('stat_widget');
  if (!Number.isFinite(value) || !Number.isFinite(goal) || goal === 0) return null;
  const pct = goodDirection === 'down'
    ? (value <= goal ? 100 : Math.max(0, 100 - ((value - goal) / Math.abs(goal)) * 100))
    : Math.max(0, Math.min(100, (value / goal) * 100));
  const track = light ? 'rgba(255,255,255,0.22)' : 'var(--ant-color-fill-secondary, rgba(0,0,0,0.06))';
  const fill = color || (light ? '#fff' : 'var(--ant-color-primary, #00c2cb)');
  return (
    <div style={{ width: '100%', maxWidth: 160, marginTop: 8 }} aria-hidden>
      <div style={{ height: 6, borderRadius: 999, background: track, overflow: 'hidden' }}>
        <div
          className="goal-progress-fill"
          style={{
            width: `${pct}%`,
            height: '100%',
            background: fill,
            borderRadius: 999,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          marginTop: 3,
          color: light ? 'rgba(255,255,255,0.65)' : 'var(--ant-color-text-tertiary)',
        }}
      >
        {t('pct_of_goal', { pct: pct.toFixed(0) })}
      </div>
    </div>
  );
}

function TrendBadge({
  value,
  isUp,
  isGood,
  solid,
}: {
  value: string;
  /** Actual numeric direction — drives the arrow, independent of whether it's good. */
  isUp: boolean;
  /** Whether this direction is favorable for the metric — drives color only. */
  isGood: boolean;
  solid?: boolean;
}) {
  const color = isGood ? '#52c41a' : '#ff4d4f';
  return (
    <div
      className={`number-compact ${isGood ? 'number-positive' : 'number-negative'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        color: solid ? '#fff' : color,
        background: solid ? (isGood ? '#52c41a' : '#ff4d4f') : isGood ? 'rgba(82,196,26,0.1)' : 'rgba(255,77,79,0.1)',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
      }}
    >
      {isUp ? <CaretUpOutlined style={{ fontSize: 10 }} aria-hidden /> : <CaretDownOutlined style={{ fontSize: 10 }} aria-hidden />}
      <span aria-live="polite">{value}</span>
    </div>
  );
}

export const StatWidget: React.FC<StatWidgetProps> = ({ data, config, onFilter, filterValue, query }) => {
  const t = useTranslations('stat_widget');

  let displayValue = config.value;
  let displayTitle = config.title;
  let sparklineValues: number[] = data?.sparklineValues || [];
  let comparisonValue = data?.comparisonValue;
  let comparisonLabel = data?.comparisonLabel || config.comparisonPeriodLabel || config.compareLabel;

  if (data) {
    if (data.value !== undefined && data.value !== null) {
      displayValue = data.value;
    } else if (data.series && data.series.length > 0 && data.series[0]?.data?.length > 0) {
      const seriesNums = data.series[0].data.map(Number).filter((n: number) => !isNaN(n));
      const titleHint = String(config.title || data.series[0].name || '').toLowerCase();
      // Prefer full-window aggregate for Total/Count KPIs; latest point only for period KPIs
      const seriesAgg = resolveSeriesAggregation(query, titleHint);
      if (seriesAgg === 'sum') {
        displayValue = seriesNums.reduce((a: number, b: number) => a + b, 0);
      } else if (seriesAgg === 'avg') {
        displayValue = seriesNums.length ? seriesNums.reduce((a: number, b: number) => a + b, 0) / seriesNums.length : 0;
      } else {
        displayValue = data.series[0].data[data.series[0].data.length - 1];
      }
      displayTitle = config.title || data.series[0].name;
      if (!sparklineValues.length) {
        sparklineValues = seriesNums;
      }
      if (data.series.length > 1 && comparisonValue === undefined) {
        const compData = data.series[1].data;
        comparisonValue = compData[compData.length - 1];
        if (!comparisonLabel) comparisonLabel = data.series[1].name;
      }
    } else if (data.y && data.y.length > 0) {
      const yNums = data.y.map(Number).filter((n: number) => !isNaN(n));
      const titleHint = String(config.title || '').toLowerCase();
      const yAgg = resolveSeriesAggregation(query, titleHint);
      if (yAgg === 'sum') {
        displayValue = yNums.reduce((a: number, b: number) => a + b, 0);
      } else if (yAgg === 'avg') {
        displayValue = yNums.length ? yNums.reduce((a: number, b: number) => a + b, 0) / yNums.length : 0;
      } else {
        displayValue = data.y[data.y.length - 1];
      }
      displayTitle = config.title || (data.x && data.x[data.x.length - 1]);
      if (!sparklineValues.length) {
        sparklineValues = yNums;
      }
    }
  }

  const {
    format = 'number',
    trendValue = '',
    showTrend,
    trendLabel = '',
    fontSize = 32,
    showSparkline = false,
    sparklineType = 'line',
    sparklineColor,
    layout = 'default',
    goalTarget,
    statUnit,
    currencySymbol,
  } = config;

  const accent = resolveStatAccent(config);
  const trendVisible = showTrend !== false;

  const currencySym =
    currencySymbol ||
    (format === 'currency' && statUnit && /^[$€£¥₹]/.test(String(statUnit)) ? String(statUnit) : undefined) ||
    (format === 'currency' ? '$' : undefined);
  const unitSuffix =
    format === 'number' && statUnit && !/^[$€£¥₹]/.test(String(statUnit)) ? String(statUnit) : undefined;

  // A query that legitimately returns no rows / all-NULL values must not render as a
  // real "0" — that collapses "we don't know" into "we know it's zero," which is a
  // different (and potentially misleading) claim, especially once threshold coloring
  // or a trend delta gets computed against it.
  const hasValue = displayValue !== null && displayValue !== undefined && displayValue !== '';
  const valueToDisplay = displayValue ?? '0';
  const numericValue = Number(valueToDisplay);
  // Conditional formatting rules (same engine as Table/Chart) take priority over the
  // legacy warn/critical thresholds when configured — they're a strict superset (any
  // operator, multiple rules, custom colors) rather than two fixed severities.
  const cfValueStyle = hasValue ? getStatValueStyle(config.conditionalFormatting, numericValue) : {};
  const valueColor = cfValueStyle.color
    ? cfValueStyle.color
    : hasValue && Number.isFinite(numericValue)
      ? resolveThresholdColor(numericValue, config, accent)
      : accent;

  const formattedValue = hasValue
    ? formatStatValue(valueToDisplay, format, currencySym, unitSuffix)
    : t('no_data_value');

  let computedTrendValue = trendValue;
  let trendIsPositive = trendValue.startsWith('+');
  let trendIsNeutral = !trendValue;

  if (!trendValue && hasValue && comparisonValue !== undefined && comparisonValue !== null) {
    const curr = Number(displayValue);
    const prev = Number(comparisonValue);
    if (!isNaN(curr) && !isNaN(prev) && prev !== 0) {
      const pct = ((curr - prev) / Math.abs(prev)) * 100;
      const sign = pct >= 0 ? '+' : '';
      computedTrendValue = `${sign}${pct.toFixed(1)}%`;
      trendIsPositive = pct >= 0;
      trendIsNeutral = false;
      // AI-generated KPI tiles (report_templates.py's _sql_kpi) send a bare
      // comparisonValue with no label for exactly this reason — same
      // fallback as the sparkline-trend branch below.
      if (!comparisonLabel) comparisonLabel = config.comparisonPeriodLabel || t('prior_period');
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

  const trendIsGood = config.trendGoodDirection === 'down' ? !trendIsPositive : trendIsPositive;
  const showTrendUi = trendVisible && !!computedTrendValue && !trendIsNeutral;
  const comparisonCaption =
    trendLabel || formatComparisonCaption(comparisonLabel || config.comparisonPeriodLabel);
  const sparkColor = sparklineColor || accent;
  const hasSpark = showSparkline && sparklineValues.length >= 2;

  const clickable = typeof onFilter === 'function';
  const clickValue =
    filterValue !== undefined
      ? filterValue
      : data?.x && data.x.length
        ? data.x[data.x.length - 1]
        : displayTitle;

  const ariaTrend = showTrendUi
    ? `, ${trendIsPositive ? 'up' : 'down'} ${computedTrendValue}${
        comparisonCaption ? ` ${comparisonCaption}` : ''
      }`
    : '';
  const ariaLabel = `${displayTitle || t('key_metric')}: ${formattedValue}${ariaTrend}`;
  // Callers embedding this inside their own title header (chat's chart wrapper,
  // the dashboard-preview grid's TileHeader) set hideTitle -- otherwise the
  // same title text rendered twice (once by the wrapping header, once here)
  // for what's normally a single line of chrome elsewhere, but for a KPI's
  // small tile reads as an obvious, cramped duplicate.
  const titleLabel = config.hideTitle ? '' : displayTitle || t('key_metric');

  const interactiveProps = clickable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onFilter?.(clickValue),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFilter?.(clickValue);
          }
        },
        style: { cursor: 'pointer' as const },
      }
    : {};

  const valueClass = `studio-stat-value number-${
    format === 'currency' ? 'currency' : format === 'percent' ? 'percent' : 'large'
  } number-compact`;

  // ── Executive: filled card from palette ──────────────────────────────────
  if (layout === 'executive') {
    const cardColor = config.color ? darkenColor(config.color, 0.55) : darkenColor(accent, 0.45);
    const executiveTrendColor = trendIsGood ? '#9be7b1' : '#ff9a8a';
    const execSpark = sparklineColor || (trendIsGood ? '#a7f3c2' : '#ff9a8a');

    return (
      <div
        {...interactiveProps}
        className="studio-stat-root studio-stat-executive text-white"
        aria-label={ariaLabel}
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          background: cardColor,
          color: '#ffffff',
          borderRadius: 6,
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
          ...(interactiveProps.style || {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.16)',
              color: '#ffffff',
              flex: '0 0 auto',
              fontSize: 16,
            }}
            aria-hidden
          >
            {resolveKpiIcon(config.icon, config.iconName, displayTitle, format)}
          </div>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              role="heading"
              aria-level={2}
              className={`${valueClass} studio-stat-executive-value text-white`}
              style={{
                margin: 0,
                color: '#ffffff',
                fontSize: `${Math.min(Math.max(fontSize, 24), 32)}px`,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
            >
              <span aria-live="polite" title={formattedValue} style={{ color: '#ffffff' }}>{formattedValue}</span>
            </div>
            <div
              className="studio-stat-label studio-stat-executive-label text-white/90"
              style={{
                color: 'rgba(255,255,255,0.9)',
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.3,
                whiteSpace: 'normal',
                overflow: 'visible',
                wordBreak: 'break-word',
              }}
              title={titleLabel}
            >
              {titleLabel}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 10,
            marginTop: 8,
            flex: '0 0 auto',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            {showTrendUi ? (
              <div
                className="studio-stat-trend"
                style={{
                  color: executiveTrendColor,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {trendIsPositive ? <CaretUpOutlined style={{ fontSize: 10 }} aria-hidden /> : <CaretDownOutlined style={{ fontSize: 10 }} aria-hidden />}
                <span aria-live="polite" style={{ color: executiveTrendColor }}>{computedTrendValue.replace(/^\+/, '')}</span>
              </div>
            ) : null}
            {trendVisible && comparisonCaption ? (
              <div
                className="studio-stat-label studio-stat-comparison text-white/70"
                style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2, lineHeight: 1.25 }}
              >
                {comparisonCaption}
              </div>
            ) : null}
            {goalTarget != null && Number.isFinite(Number(goalTarget)) && Number.isFinite(numericValue) ? (
              <GoalProgress value={numericValue} goal={Number(goalTarget)} color="#ffffff" light goodDirection={config.trendGoodDirection} />
            ) : null}
          </div>
          {hasSpark ? (
            <div style={{ width: 110, flex: '0 0 110px', opacity: 0.95 }}>
              <Sparkline values={sparklineValues} color={execSpark} type={sparklineType} height={30} width={108} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Tile: soft palette wash + inline title ───────────────────────────────
  if (layout === 'tile') {
    return (
      <div
        {...interactiveProps}
        aria-label={ariaLabel}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '14px 16px',
          background: withAlpha(accent, 0.1),
          border: `1px solid ${withAlpha(accent, 0.28)}`,
          borderRadius: 6,
          gap: 4,
          ...(interactiveProps.style || {}),
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--ant-color-text-secondary)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleLabel}
        >
          {titleLabel}
        </Text>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <Title level={2} className={valueClass} style={{ margin: 0, fontSize: `${fontSize}px`, fontWeight: 700, color: valueColor, lineHeight: 1.1 }}>
            <span aria-live="polite" title={formattedValue}>{formattedValue}</span>
          </Title>
          {showTrendUi ? <TrendBadge value={computedTrendValue} isUp={trendIsPositive} isGood={trendIsGood} /> : null}
        </div>
        {trendVisible && comparisonCaption ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {comparisonCaption}
          </Text>
        ) : null}
        {goalTarget != null && Number.isFinite(Number(goalTarget)) && Number.isFinite(numericValue) ? (
          <GoalProgress value={numericValue} goal={Number(goalTarget)} color={valueColor} goodDirection={config.trendGoodDirection} />
        ) : null}
        {hasSpark ? (
          <div style={{ marginTop: 6, maxWidth: 140 }}>
            <Sparkline values={sparklineValues} color={sparkColor} type={sparklineType} height={28} width={120} />
          </div>
        ) : null}
      </div>
    );
  }

  // ── Split: value left, sparkline / trend right ───────────────────────────
  if (layout === 'split') {
    return (
      <div
        {...interactiveProps}
        aria-label={ariaLabel}
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '8px 16px',
          borderLeft: `3px solid ${accent}`,
          ...(interactiveProps.style || {}),
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <Title
            level={2}
            className={valueClass}
            style={{ margin: 0, fontSize: `${Math.min(fontSize, 30)}px`, fontWeight: 700, color: valueColor, lineHeight: 1.1 }}
          >
            <span aria-live="polite" title={formattedValue}>{formattedValue}</span>
          </Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {showTrendUi ? <TrendBadge value={computedTrendValue} isUp={trendIsPositive} isGood={trendIsGood} /> : null}
            {trendVisible && comparisonCaption ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {comparisonCaption}
              </Text>
            ) : null}
          </div>
          {goalTarget != null && Number.isFinite(Number(goalTarget)) && Number.isFinite(numericValue) ? (
            <GoalProgress value={numericValue} goal={Number(goalTarget)} color={valueColor} goodDirection={config.trendGoodDirection} />
          ) : null}
        </div>
        <div style={{ flex: '0 0 auto', width: hasSpark ? 120 : 'auto', textAlign: 'right' }}>
          {hasSpark ? (
            <Sparkline values={sparklineValues} color={sparkColor} type={sparklineType} height={40} width={118} />
          ) : showTrendUi ? (
            <TrendBadge value={computedTrendValue} isUp={trendIsPositive} isGood={trendIsGood} solid />
          ) : null}
        </div>
      </div>
    );
  }

  // ── Compact: dense single band ───────────────────────────────────────────
  if (layout === 'compact') {
    return (
      <div
        {...interactiveProps}
        aria-label={ariaLabel}
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '4px 12px',
          ...(interactiveProps.style || {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <Title
            level={2}
            className={valueClass}
            style={{ margin: 0, fontSize: `${Math.min(fontSize, 26)}px`, fontWeight: 700, color: valueColor, lineHeight: 1.1 }}
          >
            <span aria-live="polite" title={formattedValue}>{formattedValue}</span>
          </Title>
          {showTrendUi ? <TrendBadge value={computedTrendValue} isUp={trendIsPositive} isGood={trendIsGood} /> : null}
        </div>
        {hasSpark ? (
          <div style={{ flex: '0 0 72px' }}>
            <Sparkline values={sparklineValues} color={sparkColor} type={sparklineType} height={24} width={72} />
          </div>
        ) : trendVisible && comparisonCaption ? (
          <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
            {comparisonCaption}
          </Text>
        ) : null}
      </div>
    );
  }

  // ── Centered / Default ───────────────────────────────────────────────────
  const isCentered = layout === 'centered';

  return (
    <div
      {...interactiveProps}
      aria-label={ariaLabel}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: isCentered ? '12px 16px' : '8px 16px 8px 14px',
        textAlign: isCentered ? 'center' : 'left',
        alignItems: isCentered ? 'center' : 'flex-start',
        gap: 4,
        borderLeft: isCentered ? undefined : `3px solid ${accent}`,
        ...(interactiveProps.style || {}),
      }}
    >
      {isCentered && (
        <Text
          type="secondary"
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: 2,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleLabel}
        >
          {titleLabel}
        </Text>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: isCentered ? 'center' : 'flex-start',
        }}
      >
        <Title
          level={2}
          className={valueClass}
          style={{ margin: 0, fontSize: `${fontSize}px`, fontWeight: 700, color: valueColor || undefined, lineHeight: 1.1 }}
        >
          <span aria-live="polite" title={formattedValue}>{formattedValue}</span>
        </Title>
        {showTrendUi ? <TrendBadge value={computedTrendValue} isUp={trendIsPositive} isGood={trendIsGood} /> : null}
      </div>

      {trendVisible && comparisonCaption && (
        <Text type="secondary" style={{ fontSize: 11, marginTop: 2 }}>
          {comparisonCaption}
          {comparisonValue !== undefined && comparisonValue !== null && !computedTrendValue && (
            <span style={{ marginLeft: 4 }}>
              ({formatStatValue(comparisonValue, format, currencySym, unitSuffix)})
            </span>
          )}
        </Text>
      )}

      {goalTarget != null && Number.isFinite(Number(goalTarget)) && Number.isFinite(numericValue) ? (
        <GoalProgress value={numericValue} goal={Number(goalTarget)} color={valueColor || accent} goodDirection={config.trendGoodDirection} />
      ) : null}

      {hasSpark && (
        <div style={{ marginTop: 8, width: '100%', maxWidth: isCentered ? 110 : 140 }}>
          <Sparkline
            values={sparklineValues}
            color={sparkColor}
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
