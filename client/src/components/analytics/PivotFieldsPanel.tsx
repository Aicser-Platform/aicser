'use client';

import React, { useCallback, useState } from 'react';
import { Button, Select, Tag, Typography } from 'antd';
import { CloseOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import type { Agg } from '@/app/(dashboard)/notebooks/components/chartShape';
import { distinctColumnValues } from './pivotFilters';
import {
  assignFieldToPivotZone,
  emptyPivotLayout,
  reorderInPivotZone,
  removeFieldFromPivot,
  usedInPivot,
  type PivotFieldLayout,
  type PivotZone,
  aggForValueField,
} from './pivotFieldLayout';
import './pivot-fields.css';

export type { PivotFieldLayout } from './pivotFieldLayout';
export { emptyPivotLayout };

const { Text } = Typography;

const DND_TYPE = 'application/x-aicser-pivot-field';

export type PivotFieldsLabels = {
  fieldsTitle: string;
  fieldsHint: string;
  zoneRows: string;
  zoneColumns: string;
  zoneValues: string;
  zoneFilters: string;
  summarize: string;
  addToRow: string;
  addToColumn: string;
  addToValues: string;
  addToFilters: string;
  aggLabel: (agg: Agg) => string;
  filterAll: string;
  dragHint: string;
};

const ZONES: PivotZone[] = ['filters', 'rows', 'columns', 'values'];

function preventDefault(e: React.DragEvent) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function readDragField(e: React.DragEvent): { field: string; fromZone: PivotZone | 'list'; fromIndex: number } | null {
  const raw = e.dataTransfer.getData(DND_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { field: string; fromZone: PivotZone | 'list'; fromIndex: number };
  } catch {
    return null;
  }
}

function ZoneBox({
  zone,
  title,
  fields,
  layout,
  onChange,
  disabled,
  aggOptions,
  labels,
  rowData,
  columns,
}: {
  zone: PivotZone;
  title: string;
  fields: string[];
  layout: PivotFieldLayout;
  onChange: (next: PivotFieldLayout) => void;
  disabled?: boolean;
  aggOptions: Agg[];
  labels: PivotFieldsLabels;
  rowData: unknown[][];
  columns: string[];
}) {
  const [over, setOver] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    preventDefault(e);
    setOver(false);
    if (disabled) return;
    const payload = readDragField(e);
    if (!payload) return;
    let next = removeFieldFromPivot(layout, payload.field);
    if (payload.fromZone !== 'list' && payload.fromZone === zone) {
      const from = payload.fromIndex;
      const to = fields.length;
      next = reorderInPivotZone(next, zone, from, to);
    } else {
      next = assignFieldToPivotZone(next, payload.field, zone);
    }
    onChange(next);
  };

  const showDefaultAgg = zone === 'values' && fields.length > 0;

  return (
    <div
      className={`pivot-fields__zone${over ? ' pivot-fields__zone--over' : ''}`}
      onDragOver={(e) => { preventDefault(e); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="pivot-fields__zone-head">
        <Text strong className="pivot-fields__zone-title">{title}</Text>
        {showDefaultAgg ? (
          <Select
            size="small"
            variant="borderless"
            value={layout.agg}
            onChange={(a) => onChange({ ...layout, agg: a })}
            options={aggOptions.map((a) => ({ value: a, label: labels.aggLabel(a) }))}
            popupMatchSelectWidth={false}
            disabled={disabled}
            aria-label={labels.summarize}
          />
        ) : null}
      </div>
      <div className="pivot-fields__zone-body">
        {fields.length === 0 ? (
          <Text type="secondary" className="pivot-fields__zone-empty">{labels.dragHint}</Text>
        ) : (
          fields.map((f, index) => {
            const fieldAgg = zone === 'values' ? aggForValueField(layout, f) : layout.agg;
            const options = distinctColumnValues(columns, rowData, f);
            return (
              <div key={`${zone}-${f}`} className="pivot-fields__field-block">
                <div className="pivot-fields__tag-row">
                  <Tag
                    draggable={!disabled}
                    className="pivot-fields__tag pivot-fields__tag--draggable"
                    closable={!disabled}
                    onClose={(e) => { e.preventDefault(); onChange(removeFieldFromPivot(layout, f)); }}
                    closeIcon={<CloseOutlined aria-hidden />}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ field: f, fromZone: zone, fromIndex: index }));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    icon={<HolderOutlined aria-hidden />}
                  >
                    {f}
                  </Tag>
                  {zone === 'values' && fields.length > 1 ? (
                    <Select
                      size="small"
                      className="pivot-fields__tag-agg"
                      value={fieldAgg}
                      disabled={disabled}
                      onChange={(a) => onChange({
                        ...layout,
                        valueAggs: { ...layout.valueAggs, [f]: a },
                      })}
                      options={aggOptions.map((a) => ({ value: a, label: labels.aggLabel(a) }))}
                      popupMatchSelectWidth={false}
                    />
                  ) : null}
                </div>
                {zone === 'filters' ? (
                  <Select
                    mode="multiple"
                    size="small"
                    allowClear
                    placeholder={labels.filterAll}
                    className="pivot-fields__filter-select"
                    disabled={disabled}
                    value={layout.filterValues[f]?.length ? layout.filterValues[f] : []}
                    onChange={(vals) => onChange({
                      ...layout,
                      filterValues: { ...layout.filterValues, [f]: vals },
                    })}
                    options={options.map((o) => ({ value: o, label: o }))}
                    maxTagCount="responsive"
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Excel-style PivotTable Fields with drag-and-drop between zones. */
export function PivotFieldsPanel({
  columns,
  rows,
  layout,
  onChange,
  labels,
  disabled,
  compact,
}: {
  columns: string[];
  rows: unknown[][];
  layout: PivotFieldLayout;
  onChange: (next: PivotFieldLayout) => void;
  labels: PivotFieldsLabels;
  disabled?: boolean;
  compact?: boolean;
}) {
  const aggOptions = (['sum', 'avg', 'count', 'min', 'max'] as Agg[]);

  const add = useCallback((field: string, zone: PivotZone) => {
    if (disabled) return;
    onChange(assignFieldToPivotZone(layout, field, zone));
  }, [disabled, layout, onChange]);

  const zoneTitle = (z: PivotZone) => {
    if (z === 'rows') return labels.zoneRows;
    if (z === 'columns') return labels.zoneColumns;
    if (z === 'values') return labels.zoneValues;
    return labels.zoneFilters;
  };

  const zoneFields = (z: PivotZone) => {
    if (z === 'rows') return layout.rows;
    if (z === 'columns') return layout.columns;
    if (z === 'values') return layout.values;
    return layout.filters;
  };

  return (
    <div className={`pivot-fields${compact ? ' pivot-fields--compact' : ''}`}>
      <div className="pivot-fields__list">
        <Text strong>{labels.fieldsTitle}</Text>
        <Text type="secondary" className="pivot-fields__hint">{labels.fieldsHint}</Text>
        <ul className="pivot-fields__items">
          {columns.map((name) => {
            const zone = usedInPivot(layout, name);
            return (
              <li
                key={name}
                draggable={!disabled && !zone}
                className={`pivot-fields__item${zone ? ' pivot-fields__item--used' : ''}`}
                onDragStart={(e) => {
                  if (zone) { e.preventDefault(); return; }
                  e.dataTransfer.setData(DND_TYPE, JSON.stringify({ field: name, fromZone: 'list', fromIndex: -1 }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <span className="pivot-fields__item-name">{name}</span>
                {!disabled ? (
                  <span className="pivot-fields__item-actions">
                    <Button type="text" size="small" icon={<PlusOutlined />} disabled={zone === 'filters'} onClick={() => add(name, 'filters')} aria-label={`${labels.addToFilters}: ${name}`}>
                      F
                    </Button>
                    <Button type="text" size="small" icon={<PlusOutlined />} disabled={zone === 'rows'} onClick={() => add(name, 'rows')} aria-label={`${labels.addToRow}: ${name}`}>
                      R
                    </Button>
                    <Button type="text" size="small" icon={<PlusOutlined />} disabled={zone === 'columns'} onClick={() => add(name, 'columns')} aria-label={`${labels.addToColumn}: ${name}`}>
                      C
                    </Button>
                    <Button type="text" size="small" icon={<PlusOutlined />} disabled={zone === 'values'} onClick={() => add(name, 'values')} aria-label={`${labels.addToValues}: ${name}`}>
                      Σ
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="pivot-fields__areas">
        {ZONES.map((z) => (
          <ZoneBox
            key={z}
            zone={z}
            title={zoneTitle(z)}
            fields={zoneFields(z)}
            layout={layout}
            onChange={onChange}
            disabled={disabled}
            aggOptions={aggOptions}
            labels={labels}
            rowData={rows}
            columns={columns}
          />
        ))}
      </div>
    </div>
  );
}
