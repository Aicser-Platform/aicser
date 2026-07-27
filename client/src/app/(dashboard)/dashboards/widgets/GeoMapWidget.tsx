'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Spin, Empty, Alert } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { CHART_COLORS } from './WidgetRendererConfig';

// Module-level GeoJSON cache — fetched once per page session
const _geoJsonCache: Record<string, object> = {};
const _pendingFetches: Record<string, Promise<object>> = {};

async function loadGeoJson(mapName: string, url: string): Promise<object> {
  if (_geoJsonCache[mapName] !== undefined) return _geoJsonCache[mapName];
  if (_pendingFetches[mapName] !== undefined) return _pendingFetches[mapName];

  const p = fetch(url, { cache: 'force-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`GeoJSON fetch failed: ${r.status}`);
      return r.json();
    })
    .then((json) => {
      _geoJsonCache[mapName] = json;
      echarts.registerMap(mapName, json as any);
      return json;
    });

  _pendingFetches[mapName] = p;
  return p;
}

export interface GeoMapWidgetProps {
  data?: {
    x?: (string | number)[];          // country/region names
    y?: (number | null)[];             // values to map
    series?: { name: string; data: any[] }[];
  };
  config?: {
    mapName?: string;           // 'world' (default)
    geoJsonUrl?: string;        // custom GeoJSON URL
    valueLabel?: string;        // label for the colormap legend
    colorFrom?: string;         // low-end color  (default light blue)
    colorTo?: string;           // high-end color (default dark teal)
    showLabels?: boolean;       // show country name labels
    roam?: boolean;             // allow zoom/pan
    title?: string;
  };
  onChartReady?: (chart: echarts.ECharts) => void;
  minHeight?: number;
}

const DEFAULT_GEOJSON_URL =
  'https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json';

export function GeoMapWidget({ data, config = {}, onChartReady, minHeight }: GeoMapWidgetProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onChartReadyRef = useRef(onChartReady);
  onChartReadyRef.current = onChartReady;

  const mapName = config.mapName || 'world';
  const geoJsonUrl = config.geoJsonUrl || DEFAULT_GEOJSON_URL;

  // Load and register GeoJSON once
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    loadGeoJson(mapName, geoJsonUrl)
      .then(() => { if (!cancelled) setGeoReady(true); })
      .catch((e) => { if (!cancelled) setLoadError(String(e?.message || 'Failed to load map data')); });
    return () => { cancelled = true; };
  }, [mapName, geoJsonUrl]);

  // Render chart once GeoJSON is ready
  useEffect(() => {
    if (!geoReady || !chartRef.current || !data) return;

    // Build name→value pairs
    const names: string[] = (data.x || []).map(String);
    const values: (number | null)[] = data.y || [];
    const mapData = names.map((name, i) => ({
      name,
      value: values[i] ?? null,
    })).filter((d) => d.value !== null);

    const allValues = mapData.map((d) => d.value as number);
    const minVal = allValues.length ? Math.min(...allValues) : 0;
    const maxVal = allValues.length ? Math.max(...allValues) : 100;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, null, { renderer: 'canvas' });
    }

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: true,
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const val = params.value;
          if (val == null || isNaN(Number(val))) return params.name;
          return `<strong>${params.name}</strong><br/>${config.valueLabel || 'Value'}: ${Number(val).toLocaleString()}`;
        },
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        left: 'left',
        bottom: 20,
        text: ['High', 'Low'],
        calculable: true,
        inRange: {
          color: [config.colorFrom || '#b7e4f9', config.colorTo || '#004a80'],
        },
        textStyle: { color: CHART_COLORS.text.secondary, fontSize: 11 },
      },
      series: [
        {
          type: 'map',
          map: mapName,
          roam: config.roam ?? false,
          emphasis: {
            label: { show: true, color: '#fff' },
            itemStyle: { areaColor: '#1677ff' },
          },
          label: {
            show: config.showLabels ?? false,
            fontSize: 9,
            color: CHART_COLORS.text.secondary,
          },
          itemStyle: {
            borderColor: 'rgba(255,255,255,0.4)',
            borderWidth: 0.5,
            areaColor: '#e8f0fe',
          },
          data: mapData,
          nameProperty: 'name',
        } as any,
      ],
    };

    instanceRef.current.setOption(option, { notMerge: true });
    onChartReadyRef.current?.(instanceRef.current);

    const scheduleResize = () => requestAnimationFrame(() => instanceRef.current?.resize());
    window.addEventListener('resize', scheduleResize);
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(chartRef.current);

    return () => {
      window.removeEventListener('resize', scheduleResize);
      ro.disconnect();
    };
  }, [geoReady, data, config]);

  useEffect(() => () => {
    instanceRef.current?.dispose();
    instanceRef.current = null;
  }, []);

  if (loadError) {
    return (
      <div className="widget-center" style={{ flexDirection: 'column', gap: 8, padding: 16 }}>
        <Alert
          type="warning"
          message="Map data unavailable"
          description={`Could not load GeoJSON: ${loadError}. Check network connectivity or configure a custom geoJsonUrl.`}
          showIcon
        />
      </div>
    );
  }

  if (!geoReady) {
    return (
      <div className="widget-center">
        <Spin tip="Loading map…" />
      </div>
    );
  }

  if (!data || ((!data.x || data.x.length === 0) && (!data.series || data.series.length === 0))) {
    return (
      <div className="widget-center" style={{ flexDirection: 'column', gap: 8 }}>
        <GlobalOutlined style={{ fontSize: 32, color: 'var(--ant-color-text-tertiary)' }} />
        <Empty description="No geographic data. Map country names to values in properties." imageStyle={{ height: 0 }} />
      </div>
    );
  }

  return (
    <div className="widget-chart-shell">
      <div
        ref={chartRef}
        className="widget-chart-canvas"
        style={minHeight != null ? { minHeight: `${minHeight}px` } : undefined}
      />
    </div>
  );
}

export default GeoMapWidget;
