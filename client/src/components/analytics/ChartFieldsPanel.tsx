'use client';

import React, { useState } from 'react';
import { Button, Select, Tag, Typography } from 'antd';
import { CloseOutlined, HolderOutlined } from '@ant-design/icons';
import type { Agg } from '@/app/(dashboard)/notebooks/components/chartShape';
import {
  assignFieldToChartZone,
  removeFieldFromChart,
  usedInChart,
  type ChartFieldLayout,
  type ChartZone,
} from './pivotFieldLayout';
import './pivot-fields.css';

const { Text } = Typography;
const DND_TYPE = 'application/x-aicser-chart-field';

export type ChartFieldsLabels = {
  fieldsTitle: string;
  fieldsHint: string;
  zoneCategory: string;
  zoneSeries: string;
  zoneValues: string;
  summarize: string;
  dragHint: string;
  aggLabel: (agg: Agg) => string;
};

const CHART_ZONES: ChartZone[] = ['category', 'series', 'values'];

function preventDefault(e: React.DragEvent) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function readDragField(e: React.DragEvent): { field: string; fromZone: ChartZone | 'list' } | null {
  const raw = e.dataTransfer.getData(DND_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { field: string; fromZone: ChartZone | 'list' };
  } catch {
    return null;
  }
}

function zoneFields(layout: ChartFieldLayout, zone: ChartZone): string[] {
  if (zone === 'category') return layout.category ? [layout.category] : [];
  if (zone === 'series') return layout.series ? [layout.series] : [];
  return layout.values;
}

export function ChartFieldsPanel({
  columns,
  layout,
  onChange,
  labels,
  disabled,
  hideSeries,
}: {
  columns: string[];
  layout: ChartFieldLayout;
  onChange: (next: ChartFieldLayout) => void;
  labels: ChartFieldsLabels;
  disabled?: boolean;
  hideSeries?: boolean;
}) {
  const aggOptions = (['sum', 'avg', 'count', 'min', 'max', 'none'] as Agg[]);
  const zones = hideSeries ? CHART_ZONES.filter((z) => z !== 'series') : CHART_ZONES;

  const zoneTitle = (z: ChartZone) => {
    if (z === 'category') return labels.zoneCategory;
    if (z === 'series') return labels.zoneSeries;
    return labels.zoneValues;
  };

  const add = (field: string, zone: ChartZone) => {
    if (disabled) return;
    onChange(assignFieldToChartZone(layout, field, zone));
  };

  return (
    <div className="pivot-fields pivot-fields--chart">
      <div className="pivot-fields__list">
        <Text strong>{labels.fieldsTitle}</Text>
        <Text type="secondary" className="pivot-fields__hint">{labels.fieldsHint}</Text>
        <ul className="pivot-fields__items">
          {columns.map((name) => {
            const zone = usedInChart(layout, name);
            return (
              <li
                key={name}
                draggable={!disabled && !zone}
                className={`pivot-fields__item${zone ? ' pivot-fields__item--used' : ''}`}
                onDragStart={(e) => {
                  if (zone) { e.preventDefault(); return; }
                  e.dataTransfer.setData(DND_TYPE, JSON.stringify({ field: name, fromZone: 'list' }));
                }}
              >
                <span className="pivot-fields__item-name">{name}</span>
                {!disabled ? (
                  <span className="pivot-fields__item-actions">
                    <Button type="text" size="small" disabled={zone === 'category'} onClick={() => add(name, 'category')}>X</Button>
                    {!hideSeries ? (
                      <Button type="text" size="small" disabled={zone === 'series'} onClick={() => add(name, 'series')}>S</Button>
                    ) : null}
                    <Button type="text" size="small" disabled={zone === 'values'} onClick={() => add(name, 'values')}>Y</Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="pivot-fields__areas">
        {zones.map((zone) => (
          <ChartZoneBox
            key={zone}
            zone={zone}
            title={zoneTitle(zone)}
            fields={zoneFields(layout, zone)}
            layout={layout}
            onChange={onChange}
            disabled={disabled}
            labels={labels}
            aggOptions={aggOptions}
          />
        ))}
      </div>
    </div>
  );
}

function ChartZoneBox({
  zone,
  title,
  fields,
  layout,
  onChange,
  disabled,
  labels,
  aggOptions,
}: {
  zone: ChartZone;
  title: string;
  fields: string[];
  layout: ChartFieldLayout;
  onChange: (next: ChartFieldLayout) => void;
  disabled?: boolean;
  labels: ChartFieldsLabels;
  aggOptions: Agg[];
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    preventDefault(e);
    setOver(false);
    if (disabled) return;
    const payload = readDragField(e);
    if (!payload) return;
    onChange(assignFieldToChartZone(layout, payload.field, zone));
  };

  const showAgg = zone === 'values' && fields.length > 0;

  return (
    <div
      className={`pivot-fields__zone${over ? ' pivot-fields__zone--over' : ''}`}
      onDragOver={(e) => { preventDefault(e); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="pivot-fields__zone-head">
        <Text strong className="pivot-fields__zone-title">{title}</Text>
        {showAgg ? (
          <Select
            size="small"
            variant="borderless"
            value={layout.agg}
            onChange={(a) => onChange({ ...layout, agg: a })}
            options={aggOptions.filter((a) => a !== 'none' || layout.values.length === 0).map((a) => ({ value: a, label: labels.aggLabel(a) }))}
            popupMatchSelectWidth={false}
            disabled={disabled}
          />
        ) : null}
      </div>
      <div className="pivot-fields__zone-body">
        {fields.length === 0 ? (
          <Text type="secondary" className="pivot-fields__zone-empty">{labels.dragHint}</Text>
        ) : (
          fields.map((f) => (
            <Tag
              key={`${zone}-${f}`}
              draggable={!disabled}
              className="pivot-fields__tag pivot-fields__tag--draggable"
              closable={!disabled}
              onClose={(e) => { e.preventDefault(); onChange(removeFieldFromChart(layout, f)); }}
              closeIcon={<CloseOutlined aria-hidden />}
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_TYPE, JSON.stringify({ field: f, fromZone: zone }));
              }}
              icon={<HolderOutlined aria-hidden />}
            >
              {f}
            </Tag>
          ))
        )}
      </div>
    </div>
  );
}
