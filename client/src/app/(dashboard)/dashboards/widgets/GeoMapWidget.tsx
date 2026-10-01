'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Empty, Spin, Tooltip } from 'antd';
import { GlobalOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { CHART_COLORS, formatByValueFormat, getBaseTooltipConfig, isDark } from './WidgetRendererConfig';
import { loadAdmin, loadWorld, registerMap, type AdminLevel } from './mapBoundaries';
import { resolveMapView, type MapView } from './mapView';
import { buildGeoIndex, matchPlaces, shortNames } from '../utils/geoMatch';
import { useDashboardStore } from '../stores/useDashboardStore';

export interface GeoMapWidgetProps {
  data?: {
    x?: (string | number)[];
    y?: (number | null)[];
    series?: { name: string; data: any[] }[];
    /** Dots at exact places: [longitude, latitude, value, name]. */
    points?: [number, number, number | null, string][];
  };
  config?: {
    /** 'auto' (default), 'world', 'continent:Asia', 'country:KHM' */
    mapArea?: string;
    /** For a country: ADM1 states/provinces (default), ADM2 districts, ADM3 communes… */
    mapLevel?: AdminLevel;
    valueLabel?: string;
    colorFrom?: string;
    colorTo?: string;
    showLabels?: boolean;
    /** What each area / dot is labelled with. Older charts: showLabels → 'name'. */
    mapLabel?: 'none' | 'name' | 'short' | 'value' | 'both';
    roam?: boolean;
    valueFormat?: string;
    currencySymbol?: string;
    valueDecimals?: number;
  };
  onChartReady?: (chart: echarts.ECharts) => void;
  minHeight?: number;
}

/** The viewer's country from their browser language ("km-KH" → "KH"), for Auto. */
function homeRegion(): string | undefined {
  try {
    const loc = new Intl.Locale(navigator.language || 'en');
    return (loc.region || (loc as Intl.Locale & { maximize: () => Intl.Locale }).maximize().region) ?? undefined;
  } catch {
    return undefined;
  }
}

export function GeoMapWidget({ data, config = {}, onChartReady, minHeight }: GeoMapWidgetProps) {
  const t = useTranslations('dashboards');
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const onChartReadyRef = useRef(onChartReady);
  onChartReadyRef.current = onChartReady;
  const [view, setView] = useState<MapView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [widgetId, setWidgetId] = useState<string | null>(null);

  // Drill trail from the dashboard (World → Cambodia → Battambang), when on a dashboard.
  useEffect(() => {
    setWidgetId(chartRef.current?.closest('[data-widget-id]')?.getAttribute('data-widget-id') ?? null);
  }, []);
  const drillFilters = useDashboardStore((s) => (widgetId ? s.widgetDrillState?.[widgetId]?.filters : undefined));
  const drill = useMemo(() => (drillFilters || []).map((f: { value: unknown }) => String(f.value)), [drillFilters]);

  const names = useMemo(() => (data?.x || []).map((v) => String(v ?? '')), [data]);
  const values = useMemo<(number | null)[]>(
    () => (data?.y?.length ? data.y : (data?.series?.[0]?.data as (number | null)[]) || []),
    [data],
  );

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDarkMode(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    setIsDarkMode(isDark());
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => (Array.isArray(data?.points) ? data!.points! : []), [data]);
  const pointCoords = useMemo(() => points.map((p) => [p[0], p[1]]), [points]);

  // Which map: the chosen area (or the one the data fits), one level deeper per drill step.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    resolveMapView(
      {
        area: config.mapArea,
        level: config.mapLevel,
        drill,
        values: points.length ? [] : names,
        homeRegion: homeRegion(),
        points: pointCoords,
      },
      { loadWorld, loadAdmin },
    )
      .then((v) => {
        if (cancelled) return;
        registerMap(v.key, v.collection, v.features);
        setView(v);
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [config.mapArea, config.mapLevel, drill, names, points.length, pointCoords]);

  const match = useMemo(() => {
    if (!view || points.length) return null;
    return matchPlaces(names, buildGeoIndex(view.features.map((f) => f.properties)));
  }, [view, names, points.length]);

  useEffect(() => {
    if (!view || (!match && !points.length) || !chartRef.current) return;
    const items = (match ? names : [])
      .map((raw, i) => ({ raw, name: match?.matched.get(raw), value: values[i] }))
      .filter((d) => d.name && d.value != null && Number.isFinite(Number(d.value)))
      // `raw` is the data's own spelling: drill and cross-filter use it, not the map's name.
      .map((d) => ({ name: d.name as string, value: Number(d.value), raw: d.raw }));
    const dots = points
      .filter((p) => p[2] != null && Number.isFinite(Number(p[2])))
      .map((p) => ({ name: p[3], value: [p[0], p[1], Number(p[2])], raw: p[3] }));
    const nums = points.length ? dots.map((d) => d.value[2] as number) : items.map((d) => d.value);
    const lo = nums.length ? Math.min(...nums) : 0;
    const hi = nums.length ? Math.max(...nums) : 1;
    // Dot area follows the value (sqrt keeps a place twice as big from looking four times bigger).
    const size = (v: number) => 6 + 22 * Math.sqrt(hi === lo ? 1 : (v - lo) / (hi - lo));
    const fmt = (v: unknown) =>
      config.valueFormat && config.valueFormat !== 'auto'
        ? formatByValueFormat(v, config.valueFormat, config)
        : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

    // Labels: the area's name, short name, value, or name and value; areas without data show
    // their name only when names are asked for.
    const labelMode = config.mapLabel ?? (config.showLabels ? 'name' : 'none');
    const valueByArea = new Map(items.map((d) => [d.name, d.value]));
    const shorts = shortNames(view.features.map((f) => f.properties.name));
    const areaLabel = (name: string) => {
      const v = valueByArea.get(name);
      if (labelMode === 'short') return shorts.get(name) || name;
      if (labelMode === 'value') return v == null ? '' : fmt(v);
      if (labelMode === 'both') return v == null ? name : `${name}\n${fmt(v)}`;
      return name;
    };

    if (!instanceRef.current) instanceRef.current = echarts.init(chartRef.current, null, { renderer: 'canvas' });
    instanceRef.current.setOption(
      {
        backgroundColor: 'transparent',
        // The app's theme-aware tooltip (the chart library's default drew a blank white box).
        tooltip: {
          ...getBaseTooltipConfig('pie', { appendToBody: true }),
          trigger: 'item',
          formatter: (p: any) => {
            const v = Array.isArray(p.value) ? p.value[2] : p.value;
            return v == null || Number.isNaN(Number(v))
              ? `${p.name}<br/><span style="opacity:.7">${t('map_no_value')}</span>`
              : `<strong>${p.name}</strong><br/>${config.valueLabel || data?.series?.[0]?.name || t('map_value')}: ${fmt(v)}`;
          },
        },
        visualMap: nums.length
          ? {
              min: Math.min(...nums),
              max: Math.max(...nums) === Math.min(...nums) ? Math.min(...nums) + 1 : Math.max(...nums),
              left: 8,
              bottom: 8,
              itemHeight: 90,
              itemWidth: 10,
              // A plain scale with its two end values (no drag handles whose labels collided).
              calculable: false,
              text: [fmt(Math.max(...nums)), fmt(Math.min(...nums))],
              ...(points.length ? { dimension: 2, seriesIndex: 0 } : {}),
              inRange: { color: [config.colorFrom || '#cfe8f3', config.colorTo || '#0b5c8a'] },
              textStyle: { color: CHART_COLORS.text.secondary, fontSize: 11 },
            }
          : undefined,
        // One base map; filled areas and dots are drawn on it.
        geo: {
          map: view.key,
          roam: config.roam ?? true,
          scaleLimit: { min: 0.8, max: 12 },
          nameProperty: 'name',
          selectedMode: false,
          label: {
            show: labelMode !== 'none' && !points.length,
            fontSize: 9,
            color: CHART_COLORS.text.secondary,
            formatter: (p: { name: string }) => areaLabel(p.name),
          },
          emphasis: {
            label: { show: true, formatter: (p: { name: string }) => areaLabel(p.name) || p.name },
            itemStyle: { areaColor: points.length ? undefined : '#f59e0b' },
          },
          itemStyle: {
            areaColor: isDarkMode ? '#2a3140' : '#eef1f5',
            borderColor: isDarkMode ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)',
            borderWidth: 0.5,
          },
        },
        series: points.length
          ? [
              {
                type: 'scatter',
                coordinateSystem: 'geo',
                data: dots,
                symbolSize: (v: number[]) => size(v[2]),
                label: {
                  show: labelMode !== 'none',
                  position: 'right',
                  fontSize: 10,
                  color: CHART_COLORS.text.primary,
                  formatter: (p: { name: string; value: number[] }) =>
                    labelMode === 'value' ? fmt(p.value[2]) : labelMode === 'both' ? `${p.name} ${fmt(p.value[2])}` : p.name,
                },
                encode: { value: 2 },
                itemStyle: { opacity: 0.85, borderColor: '#fff', borderWidth: 0.8 },
                emphasis: { scale: 1.3 },
              },
            ]
          : [{ type: 'map', geoIndex: 0, data: items }],
      } as echarts.EChartsOption,
      { notMerge: true },
    );
    onChartReadyRef.current?.(instanceRef.current);
  }, [view, match, names, values, config, isDarkMode, data, t, points]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const resize = () => requestAnimationFrame(() => instanceRef.current?.resize());
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    window.addEventListener('beforeprint', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('beforeprint', resize);
    };
  }, [view]);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    },
    [],
  );

  const noData = !names.length;
  return (
    <div className="widget-chart-shell geo-map-shell">
      <div ref={chartRef} className="widget-chart-canvas" style={minHeight != null ? { minHeight: `${minHeight}px` } : undefined} />
      {loadError ? (
        <div className="widget-center geo-map-overlay">
          <Empty image={<GlobalOutlined style={{ fontSize: 32 }} />} imageStyle={{ height: 36 }} description={t('map_unavailable')} />
        </div>
      ) : !view ? (
        <div className="widget-center geo-map-overlay">
          <Spin />
        </div>
      ) : noData ? (
        <div className="widget-center geo-map-overlay geo-map-hint">{t('map_pick_location')}</div>
      ) : null}
      {view?.collection.source === 'geoBoundaries' ? (
        // The licence asks for credit: a quiet ⓘ in the corner, shown while the card is hovered.
        <Tooltip title={t('map_credit', { source: 'geoBoundaries', license: view.collection.license || '' })}>
          <InfoCircleOutlined
            className="geo-map-credit-icon"
            tabIndex={0}
            aria-label={t('map_credit', { source: 'geoBoundaries', license: view.collection.license || '' })}
          />
        </Tooltip>
      ) : null}
      <div className="geo-map-footer" hidden={!(match && match.unmatched.length)}>
        {match && match.unmatched.length ? (
          <Tooltip title={match.unmatched.slice(0, 20).join(', ') + (match.unmatched.length > 20 ? '…' : '')}>
            <span className="geo-map-unmatched">
              {t('map_found', { found: match.matched.size, total: match.matched.size + match.unmatched.length })}
            </span>
          </Tooltip>
        ) : (
          <span />
        )}

      </div>
    </div>
  );
}

export default GeoMapWidget;
