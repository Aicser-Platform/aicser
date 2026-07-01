'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Typography, Button, Space, Switch } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { chartService } from '../services/chartService';
import { resolveDatePresets } from '../utils/dateFilterPresets';
import { normalizeFilterOptions, type RuntimeFilter, unwrapFilterOptionsResponse } from '../utils/filterOperators';
import {
  FilterDateRangeField,
  FilterSingleDateField,
  FilterNumericRangeField,
  FilterSelectField,
} from '../components/filterFields';

type SlicerMode = 'single' | 'multi' | 'tile' | 'date' | 'dateRange' | 'numericRange' | 'toggle';

type Props = {
  query?: {
    field?: string;
    fields?: string[];
    dataSourceId?: string;
    x?: string;
    tableName?: string;
    mode?: SlicerMode;
    numericMin?: number;
    numericMax?: number;
    cascadeFromField?: string;
  };
  config?: { placeholder?: string; label?: string; slicerLabel?: string };
  readOnly?: boolean;
  dashboardId?: string;
  runtimeFilters?: RuntimeFilter[];
  embedToken?: string;
  onFilter?: (field: string, value: unknown) => void;
};

export function SlicerWidget({
  query = {},
  config = {},
  readOnly = false,
  dashboardId,
  runtimeFilters = [],
  embedToken,
  onFilter,
}: Props) {
  const t = useTranslations('dashboards');
  const datePresets = useMemo(() => resolveDatePresets(t), [t]);

  const field = query.field || query.x || '';
  const fields = useMemo(() => {
    const configured = Array.isArray(query.fields)
      ? query.fields.map(String).filter(Boolean)
      : [];
    const fallback = field ? [field] : [];
    return Array.from(new Set(configured.length > 0 ? configured : fallback));
  }, [query.fields, field]);
  const dataSourceId = query.dataSourceId ? String(query.dataSourceId) : '';
  const tableName = query.tableName;
  const mode: SlicerMode = query.mode || 'single';
  const cascadeFromField = query.cascadeFromField || '';
  const isMulti = mode === 'multi';
  const isTile = mode === 'tile';
  const isDate = mode === 'date';
  const isDateRange = mode === 'dateRange';
  const isNumericRange = mode === 'numericRange';
  const isToggle = mode === 'toggle';
  const isDropdown = !isTile && !isDate && !isDateRange && !isNumericRange && !isToggle;

  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [optionsByField, setOptionsByField] = useState<Record<string, Array<{ label: string; value: string }>>>({});
  const [loading, setLoading] = useState(false);
  const [loadedBounds, setLoadedBounds] = useState<{ min: number; max: number } | null>(null);

  const cascadeKey = useMemo(() => {
    if (!cascadeFromField) return '';
    const parent = runtimeFilters.find((f) => f.field === cascadeFromField);
    return parent ? JSON.stringify({ f: parent.field, o: parent.operator, v: parent.value }) : '';
  }, [cascadeFromField, runtimeFilters]);

  const activeValue = useMemo(() => {
    const match = runtimeFilters.find((f) => f.field === field && (f.operator === '=' || f.operator === 'in'));
    if (!match) return isMulti || isTile ? [] : undefined;
    if (match.operator === 'in') {
      const v = match.value;
      return Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean);
    }
    return isMulti || isTile ? [String(match.value)] : String(match.value);
  }, [runtimeFilters, field, isMulti, isTile]);

  const activeValueForField = (fieldName: string) => {
    const match = runtimeFilters.find((f) => f.field === fieldName && (f.operator === '=' || f.operator === 'in'));
    if (!match) return isMulti || isTile ? [] : undefined;
    if (match.operator === 'in') {
      const v = match.value;
      return Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean);
    }
    return isMulti || isTile ? [String(match.value)] : String(match.value);
  };

  const configuredMin = query.numericMin;
  const configuredMax = query.numericMax;
  const numMin = configuredMin ?? loadedBounds?.min ?? 0;
  const numMax = configuredMax ?? loadedBounds?.max ?? 100;

  useEffect(() => {
    if (!field || !dataSourceId || !dashboardId || isDate || isDateRange || isNumericRange) return;
    setLoading(true);
    chartService
      .getFilterOptions(dashboardId, field, dataSourceId, {
        embedToken,
        tableName,
        runtimeFilters,
        excludeField: field,
      })
      .then((vals) => setOptions(normalizeFilterOptions(unwrapFilterOptionsResponse(vals))))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [field, dataSourceId, dashboardId, tableName, embedToken, isDate, isDateRange, isNumericRange, cascadeKey, runtimeFilters]);

  useEffect(() => {
    if (fields.length <= 1 || !dataSourceId || !dashboardId) return;
    setLoading(true);
    let cancelled = false;
    Promise.all(
      fields.map((fieldName) =>
        chartService
          .getFilterOptions(dashboardId, fieldName, dataSourceId, {
            embedToken,
            tableName,
            runtimeFilters,
            excludeField: fieldName,
          })
          .then((vals) => [fieldName, normalizeFilterOptions(unwrapFilterOptionsResponse(vals))] as const)
          .catch(() => [fieldName, []] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setOptionsByField(Object.fromEntries(entries));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fields, dataSourceId, dashboardId, tableName, embedToken, runtimeFilters]);

  useEffect(() => {
    if (!isNumericRange || !field || !dataSourceId || !dashboardId) return;
    if (configuredMin != null && configuredMax != null) return;
    let cancelled = false;
    chartService
      .getFilterFieldStats(dashboardId, field, dataSourceId, {
        embedToken,
        tableName,
        runtimeFilters: runtimeFilters.filter((f) => f.field !== field),
      })
      .then((stats) => {
        if (cancelled || stats.min == null || stats.max == null) return;
        if (stats.min === stats.max) {
          setLoadedBounds({ min: stats.min - 1, max: stats.max + 1 });
        } else {
          setLoadedBounds({ min: stats.min, max: stats.max });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isNumericRange, field, dataSourceId, dashboardId, tableName, embedToken, configuredMin, configuredMax, runtimeFilters]);

  const label = config.slicerLabel || config.label || field;

  if (!fields.length) {
    return (
      <div className="widget-center" style={{ padding: 16 }}>
        <Typography.Text type="secondary">{t('slicer_pick_field')}</Typography.Text>
      </div>
    );
  }

  if (fields.length > 1) {
    const labelPrefix = config.slicerLabel || config.label || 'Filters';
    return (
      <div className="slicer-widget slicer-filter-block" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Typography.Text className="slicer-widget-label" strong>
          {labelPrefix}
        </Typography.Text>
        {fields.map((fieldName) => (
          <FilterSelectField
            key={fieldName}
            label={fieldName}
            mode={isMulti ? 'multi' : 'single'}
            placeholder={config.placeholder || t('slicer_select_placeholder', { field: fieldName })}
            options={optionsByField[fieldName] || []}
            loading={loading}
            disabled={readOnly}
            value={activeValueForField(fieldName) as string | string[] | undefined}
            maxTagCount={isMulti ? 2 : undefined}
            variant="slicer"
            showSelectAll={isMulti}
            selectAllLabel={t('slicer_select_all')}
            clearAllLabel={t('slicer_clear_all')}
            onChange={(v) => onFilter?.(fieldName, v ?? (isMulti ? [] : null))}
          />
        ))}
      </div>
    );
  }

  if (isTile) {
    const selected = (activeValue as string[]) || [];
    const allValues = options.map((o) => o.value);
    const allSelected = allValues.length > 0 && allValues.every((v) => selected.includes(v));
    return (
      <div className="slicer-widget slicer-tile" style={{ padding: '8px 12px' }}>
        <Typography.Text type="secondary" className="slicer-widget-label" style={{ display: 'block', marginBottom: 6 }}>
          {label}
        </Typography.Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {loading ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('slicer_loading')}
            </Typography.Text>
          ) : (
            options.map((opt) => {
              const isActive = selected.includes(opt.value);
              return (
                <Button
                  key={opt.value}
                  size="small"
                  type={isActive ? 'primary' : 'default'}
                  disabled={readOnly}
                  icon={isActive ? <CheckOutlined /> : undefined}
                  onClick={() => {
                    if (!onFilter) return;
                    const next = isActive
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value];
                    onFilter(field, next.length === 0 ? null : next.length === 1 && !isMulti ? next[0] : next);
                  }}
                  style={{ borderRadius: 20, fontSize: 12 }}
                >
                  {opt.label}
                </Button>
              );
            })
          )}
        </div>
        <Space size={4} style={{ marginTop: 4 }}>
          {!readOnly && options.length > 1 && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, fontSize: 11 }}
              onClick={() => {
                if (!onFilter) return;
                onFilter(field, allSelected ? null : isMulti ? allValues : allValues[0]);
              }}
            >
              {allSelected ? t('slicer_clear_all') : t('slicer_select_all')}
            </Button>
          )}
          {selected.length > 0 && (
            <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => onFilter?.(field, null)}>
              {t('clear_filters')}
            </Button>
          )}
        </Space>
      </div>
    );
  }

  if (isDate) {
    return (
      <div className="slicer-widget" style={{ padding: '8px 12px' }}>
        <Typography.Text type="secondary" className="slicer-widget-label" style={{ display: 'block', marginBottom: 6 }}>
          {label}
        </Typography.Text>
        <FilterSingleDateField
          label={label}
          field={field}
          runtimeFilters={runtimeFilters}
          disabled={readOnly}
          variant="slicer"
          onChange={(val) => {
            if (!onFilter) return;
            onFilter(field, val ? { __range: true, from: val, to: val } : null);
          }}
        />
      </div>
    );
  }

  if (isDateRange) {
    return (
      <div className="slicer-widget slicer-date-range" style={{ padding: '8px 12px' }}>
        <Typography.Text type="secondary" className="slicer-widget-label" style={{ display: 'block', marginBottom: 6 }}>
          {label}
        </Typography.Text>
        <FilterDateRangeField
          label={label}
          field={field}
          runtimeFilters={runtimeFilters}
          presets={datePresets}
          disabled={readOnly}
          variant="slicer"
          clearLabel={t('clear_filters')}
          onClear={() => onFilter?.(field, null)}
          onChange={(from, to) => {
            if (!onFilter) return;
            if (!from && !to) {
              onFilter(field, null);
              return;
            }
            onFilter(field, { __range: true, from: from || '', to: to || '', preset: 'custom' });
          }}
        />
      </div>
    );
  }

  if (isNumericRange) {
    return (
      <div className="slicer-widget slicer-numeric" style={{ padding: '8px 16px 4px' }}>
        <FilterNumericRangeField
          label={label}
          field={field}
          runtimeFilters={runtimeFilters}
          min={numMin}
          max={numMax}
          disabled={readOnly}
          variant="slicer"
          resetLabel={t('slicer_reset_range')}
          onChange={(range) => onFilter?.(field, { __numericRange: true, min: range[0], max: range[1] })}
        />
      </div>
    );
  }

  if (isToggle) {
    const currentMatch = runtimeFilters.find((f) => f.field === field && f.operator === '=');
    const isOn = currentMatch !== undefined && currentMatch.value !== null && currentMatch.value !== false;
    return (
      <div className="slicer-widget" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Typography.Text type="secondary" className="slicer-widget-label" style={{ flex: 1 }}>
          {label}
        </Typography.Text>
        <Switch
          checked={isOn}
          disabled={readOnly}
          onChange={(checked) => onFilter?.(field, checked ? true : null)}
          size="small"
        />
        {isOn && (
          <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => onFilter?.(field, null)}>
            {t('clear_filters')}
          </Button>
        )}
      </div>
    );
  }

  if (isDropdown) {
    const cascadeActive = !!cascadeFromField && !!cascadeKey;
    const dropdownVal = activeValue as string | string[] | undefined;
    return (
      <div className="slicer-widget" style={{ padding: 12 }}>
        <Typography.Text type="secondary" className="slicer-widget-label">
          {label}
        </Typography.Text>
        <FilterSelectField
          label={label}
          mode={isMulti ? 'multi' : 'single'}
          placeholder={config.placeholder || t('slicer_select_placeholder', { field: label })}
          options={options}
          loading={loading}
          disabled={readOnly || !field}
          value={dropdownVal}
          maxTagCount={isMulti ? 3 : undefined}
          variant="slicer"
          showSelectAll={isMulti}
          selectAllLabel={t('slicer_select_all')}
          clearAllLabel={t('slicer_clear_all')}
          onChange={(v) => {
            if (onFilter) onFilter(field, v ?? (isMulti ? [] : null));
          }}
        />
        {cascadeActive && (
          <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 2, display: 'block' }}>
            {t('slicer_cascade_hint', { field: cascadeFromField })}
          </Typography.Text>
        )}
      </div>
    );
  }

  return null;
}

export default SlicerWidget;
