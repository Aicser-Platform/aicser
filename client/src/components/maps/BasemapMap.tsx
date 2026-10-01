'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './BasemapMap.css';

/**
 * A street map (MapLibre GL, BSD-3-Clause) with analysis layers on top: areas shaded by value,
 * places coloured by group, and sites as labelled pins. Basemap tiles come from OpenFreeMap
 * (OpenStreetMap data, © OpenStreetMap contributors); set NEXT_PUBLIC_BASEMAP_STYLE_URL (and
 * _DARK) to use your own tiles, e.g. a self-hosted Protomaps file.
 */

const LIGHT_STYLE = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
const DARK_STYLE = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL_DARK || 'https://tiles.openfreemap.org/styles/dark';

/** Colour-blind-safe categorical palette (Okabe–Ito plus two). */
export const GROUP_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000', '#7F3C8D', '#11A579'];

export type BasemapLayers = {
  points?: FeatureCollection | null;
  sites?: FeatureCollection | null;
  areas?: FeatureCollection | null;
};

export type BasemapMapProps = BasemapLayers & {
  dark?: boolean;
  height?: number | string;
  /** How places are coloured: by `group` (nearest site, hotspot), by `covered`, or one colour. */
  pointColor?: 'group' | 'covered' | 'single';
  /** Shows a small popup for a clicked feature; return null to skip. */
  describe?: (props: Record<string, unknown>, kind: 'point' | 'site' | 'area') => string | null;
  ariaLabel: string;
  /** Shown if the basemap can't load (translated by the caller). */
  failedText?: string;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function groupColorExpression() {
  const expr: unknown[] = ['match', ['%', ['to-number', ['coalesce', ['get', 'group'], -1]], GROUP_COLORS.length]];
  GROUP_COLORS.forEach((c, i) => expr.push(i, c));
  expr.push('#94a3b8');
  return ['case', ['==', ['coalesce', ['get', 'group'], null], null], '#94a3b8', expr];
}

function boundsOf(collections: Array<FeatureCollection | null | undefined>): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [x, y] = coords as number[];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      return;
    }
    coords.forEach(visit);
  };
  collections.forEach((fc) => fc?.features.forEach((f) => visit((f.geometry as { coordinates?: unknown })?.coordinates)));
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

export default function BasemapMap({
  points, sites, areas, dark = false, height = 520, pointColor = 'group', describe, ariaLabel, failedText,
}: BasemapMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const describeRef = useRef(describe);
  useEffect(() => {
    describeRef.current = describe;
  });

  // Create the map once per theme.
  useEffect(() => {
    let cancelled = false;
    let map: import('maplibre-gl').Map | null = null;
    void import('maplibre-gl').then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        center: [104.9, 11.55],
        zoom: 5,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.on('error', (e) => {
        // A failed tile or style load leaves a blank map; say so instead.
        if (String((e as { error?: Error }).error?.message || '').includes('style')) setFailed(true);
      });
      map.on('load', () => {
        if (cancelled || !map) return;
        map.addSource('areas', { type: 'geojson', data: EMPTY });
        map.addSource('points', { type: 'geojson', data: EMPTY });
        map.addSource('sites', { type: 'geojson', data: EMPTY });
        map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': '#0d7a78', 'fill-opacity': 0.35 } });
        map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': '#0d7a78', 'line-width': 1, 'line-opacity': 0.7 } });
        map.addLayer({
          id: 'points-circle', type: 'circle', source: 'points',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4, 15, 7],
            'circle-color': '#0072B2',
            'circle-opacity': 0.8,
            'circle-stroke-width': 0.5,
            'circle-stroke-color': dark ? '#0f1519' : '#ffffff',
          },
        });
        map.addLayer({
          id: 'sites-circle', type: 'circle', source: 'sites',
          paint: { 'circle-radius': 8, 'circle-color': dark ? '#f8fafc' : '#15212b', 'circle-stroke-width': 3, 'circle-stroke-color': groupColorExpression() as never },
        });
        map.addLayer({
          id: 'sites-label', type: 'symbol', source: 'sites',
          layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': dark ? '#f8fafc' : '#15212b', 'text-halo-color': dark ? '#0f1519' : '#ffffff', 'text-halo-width': 1.5 },
        });
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '260px' });
        const show = (kind: 'point' | 'site' | 'area') => (e: import('maplibre-gl').MapLayerMouseEvent) => {
          const f = e.features?.[0];
          const text = f && describeRef.current?.(f.properties as Record<string, unknown>, kind);
          if (!text) return;
          const el = document.createElement('div');
          el.className = 'basemap-popup';
          el.textContent = text;
          popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map!);
        };
        map.on('click', 'sites-circle', show('site'));
        map.on('click', 'points-circle', show('point'));
        map.on('click', 'areas-fill', show('area'));
        for (const layer of ['sites-circle', 'points-circle', 'areas-fill']) {
          map.on('mouseenter', layer, () => { map!.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layer, () => { map!.getCanvas().style.cursor = ''; });
        }
        mapRef.current = map;
        setReady(true);
      });
    }).catch(() => setFailed(true));
    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [dark]);

  // Push data and styling whenever the layers change.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('areas') as import('maplibre-gl').GeoJSONSource).setData(areas ?? EMPTY);
    (map.getSource('points') as import('maplibre-gl').GeoJSONSource).setData(points ?? EMPTY);
    (map.getSource('sites') as import('maplibre-gl').GeoJSONSource).setData(sites ?? EMPTY);

    const values = (areas?.features ?? []).map((f) => Number((f.properties as { value?: unknown })?.value ?? 0)).filter(Number.isFinite);
    const max = values.length ? Math.max(...values) : 0;
    const min = values.length ? Math.min(...values) : 0;
    const areaColor = areas?.features.some((f) => (f.properties as { group?: unknown })?.group != null) && !max
      ? groupColorExpression()
      : max > min
        ? ['interpolate', ['linear'], ['to-number', ['coalesce', ['get', 'value'], 0]], min, '#e0f3f1', (min + max) / 2, '#3cb8b4', max, '#084c4b']
        : '#3cb8b4';
    map.setPaintProperty('areas-fill', 'fill-color', areaColor as never);
    map.setPaintProperty('areas-fill', 'fill-opacity', max > min ? 0.55 : 0.25);
    map.setPaintProperty(
      'points-circle',
      'circle-color',
      (pointColor === 'covered'
        ? ['case', ['==', ['get', 'covered'], true], '#009E73', '#D55E00']
        : pointColor === 'group'
          ? groupColorExpression()
          : '#0072B2') as never,
    );
    const bounds = boundsOf([points, sites, areas]);
    if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 600 });
  }, [ready, points, sites, areas, pointColor]);

  return (
    <div className="basemap-map" style={{ height }} role="region" aria-label={ariaLabel}>
      <div ref={containerRef} className="basemap-map__canvas" />
      {failed && failedText ? <div className="basemap-map__failed">{failedText}</div> : null}
    </div>
  );
}
