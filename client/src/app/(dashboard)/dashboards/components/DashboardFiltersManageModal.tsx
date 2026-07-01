'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Select, Button, Space, Tabs, InputNumber, Typography, Alert, Tag } from 'antd';
import { PlusOutlined, ThunderboltOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';
import shortid from 'shortid';
import { FilterDefaultValueEditor } from './FilterDefaultValueEditor';
import { FilterFieldConflictsAlert } from './FilterFieldConflictsAlert';
import { FilterColumnSelect } from './FilterColumnSelect';
import { FilterTableSelect } from './FilterTableSelect';
import { detectFilterFieldConflicts } from '../utils/filterConflicts';
import { buildSmartFilterDraft } from '../utils/filterInference';
import {
  countWidgetsUsingField,
  inferPrimaryDataSourceId,
  widgetIdsUsingField,
} from '../utils/filterFieldUsage';
import { chartService } from '../services/chartService';
import './AddDashboardDrawer.css';

type DataSourceSchema = {
  id: string | number;
  schema?: { tables?: Array<{ name?: string; columns?: Array<{ name?: string; type?: string } | string> }> };
};

type FilterEditorFormProps = {
  filters: DashboardFilter[];
  dataSourceOptions: { value: string; label: string }[];
  tableOptionsBySource?: Record<string, { value: string; label: string }[]>;
  widgetScopeOptions?: { value: string; label: string }[];
  dataSources?: DataSourceSchema[];
  dashboardId?: string;
  defaultIsGlobal?: boolean;
  widgets?: WidgetInstance[];
  onChange: (filters: DashboardFilter[]) => void;
};

function FilterEditorForm({
  filters,
  dataSourceOptions,
  tableOptionsBySource = {},
  widgetScopeOptions = [],
  dataSources = [],
  dashboardId,
  defaultIsGlobal = true,
  widgets = [],
  onChange,
}: FilterEditorFormProps) {
  const t = useTranslations('dashboards');
  const [detectingIdx, setDetectingIdx] = useState<number | null>(null);

  const addFilter = () => {
    const primaryDs = inferPrimaryDataSourceId(widgets);
    onChange([
      ...filters,
      {
        id: shortid.generate(),
        name: t('new_filter_default'),
        type: 'dropdown',
        field: '',
        isGlobal: defaultIsGlobal,
        ...(primaryDs ? { dataSourceId: primaryDs } : dataSourceOptions[0]?.value ? { dataSourceId: dataSourceOptions[0].value } : {}),
      },
    ]);
  };

  const updateAt = (idx: number, patch: Partial<DashboardFilter>) => {
    onChange(filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const updateField = (idx: number, field: string, tableName?: string, columnType?: string) => {
    const current = filters[idx];
    if (!field) {
      updateAt(idx, { field: '', tableName: undefined });
      return;
    }
    const resolvedTable =
      tableName ||
      current.tableName ||
      (() => {
        if (!field || !current.dataSourceId) return undefined;
        const ds = dataSources.find((d) => String(d.id) === String(current.dataSourceId));
        const tables = ds?.schema?.tables || [];
        for (const tbl of tables) {
          const cols = tbl.columns || [];
          const has = cols.some((col) => {
            const name = typeof col === 'string' ? col : col?.name;
            return name === field;
          });
          if (has) return tbl.name || 'data';
        }
        return undefined;
      })();
    const usage = widgetIdsUsingField(widgets, field);
    const draft = buildSmartFilterDraft({
      field,
      columnType,
      dataSourceId: current.dataSourceId || inferPrimaryDataSourceId(widgets),
      tableName: resolvedTable,
      widgetIdsUsingField: usage,
    });
    updateAt(idx, {
      ...draft,
      id: current.id,
      isGlobal: current.isGlobal ?? defaultIsGlobal,
      name:
        !current.name || current.name === t('new_filter_default')
          ? draft.name
          : current.name,
    });
  };

  const moveFilter = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= filters.length) return;
    const copy = [...filters];
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item);
    onChange(copy);
  };

  const updateDataSource = (idx: number, dataSourceId: string) => {
    updateAt(idx, { dataSourceId, tableName: undefined, field: '' });
  };

  const removeAt = (idx: number) => onChange(filters.filter((_, i) => i !== idx));

  const detectSliderBounds = async (idx: number) => {
    const f = filters[idx];
    if (!dashboardId || !f.field || !f.dataSourceId) return;
    setDetectingIdx(idx);
    try {
      const stats = await chartService.getFilterFieldStats(dashboardId, f.field, f.dataSourceId, {
        tableName: f.tableName,
      });
      if (typeof stats.min === 'number' && typeof stats.max === 'number') {
        const min = stats.min === stats.max ? stats.min - 1 : stats.min;
        const max = stats.min === stats.max ? stats.max + 1 : stats.max;
        updateAt(idx, { numericMin: min, numericMax: max });
      }
    } finally {
      setDetectingIdx(null);
    }
  };

  const filterTypeOptions = [
    { value: 'dropdown', label: t('filter_type_dropdown') },
    { value: 'checkbox', label: t('filter_type_checkbox') },
    { value: 'date', label: t('filter_type_single_date') },
    { value: 'dateRange', label: t('filter_type_date') },
    { value: 'slider', label: t('filter_type_slider') },
    { value: 'search', label: t('filter_type_search') },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message={t('filter_manage_help_title')} description={t('filter_manage_help_body')} />
      {filters.map((f, idx) => {
        const needsDataSource = ['dropdown', 'checkbox', 'slider'].includes(f.type);
        const usageCount = f.field ? countWidgetsUsingField(widgets, f.field) : 0;
        return (
          <div key={f.id || idx} className="filter-editor-row filter-editor-smart-row">
            <Space wrap style={{ width: '100%' }} align="start">
              {dataSourceOptions.length > 0 && (
                <Select
                  placeholder={t('data_source')}
                  style={{ width: 150 }}
                  value={f.dataSourceId}
                  onChange={(v) => updateDataSource(idx, v)}
                  options={dataSourceOptions}
                />
              )}
              <FilterTableSelect
                dataSourceId={f.dataSourceId}
                value={f.tableName}
                onChange={(v) => updateAt(idx, { tableName: v, field: '' })}
              />
              <FilterColumnSelect
                dataSourceId={f.dataSourceId}
                tableName={f.tableName}
                value={f.field}
                onChange={(field, tbl, columnType) => updateField(idx, field, tbl, columnType)}
              />
              {usageCount > 0 ? (
                <Tag color="blue" className="filter-editor-usage-tag">
                  {t('filter_field_usage', { count: usageCount })}
                </Tag>
              ) : f.field ? (
                <Tag className="filter-editor-usage-tag">{t('filter_field_unused')}</Tag>
              ) : null}
              <Select
                value={f.type}
                style={{ width: 130 }}
                onChange={(v) => updateAt(idx, { type: v, defaultValue: undefined })}
                options={filterTypeOptions}
              />
              <Input
                placeholder={t('filter_display_name_placeholder')}
                value={f.name}
                onChange={(e) => updateAt(idx, { name: e.target.value })}
                style={{ width: 130 }}
              />
              <Select
                placeholder={t('filter_width_placeholder')}
                allowClear
                style={{ width: 100 }}
                value={f.displayWidth}
                onChange={(v) => updateAt(idx, { displayWidth: v })}
                options={[
                  { value: 'sm', label: t('filter_width_sm') },
                  { value: 'md', label: t('filter_width_md') },
                  { value: 'lg', label: t('filter_width_lg') },
                ]}
              />
              <FilterDefaultValueEditor filter={f} onChange={(defaultValue) => updateAt(idx, { defaultValue })} />
              {f.type === 'slider' && (
                <>
                  <InputNumber
                    size="small"
                    placeholder={t('filter_slider_min')}
                    style={{ width: 88 }}
                    value={f.numericMin}
                    onChange={(v) => updateAt(idx, { numericMin: v ?? undefined })}
                  />
                  <InputNumber
                    size="small"
                    placeholder={t('filter_slider_max')}
                    style={{ width: 88 }}
                    value={f.numericMax}
                    onChange={(v) => updateAt(idx, { numericMax: v ?? undefined })}
                  />
                  {dashboardId && f.field && f.dataSourceId ? (
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={detectingIdx === idx}
                      onClick={() => void detectSliderBounds(idx)}
                    >
                      {t('filter_detect_bounds')}
                    </Button>
                  ) : null}
                </>
              )}
              {widgetScopeOptions.length > 0 && (
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('filter_scope_placeholder')}
                  style={{ minWidth: 140, maxWidth: 200 }}
                  value={f.affects}
                  options={widgetScopeOptions}
                  onChange={(vals) => updateAt(idx, { affects: vals.length ? vals : undefined })}
                />
              )}
              {needsDataSource && !f.dataSourceId ? (
                <Typography.Text type="warning" style={{ fontSize: 11 }}>
                  {t('filter_requires_source')}
                </Typography.Text>
              ) : null}
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={idx === 0}
                aria-label={t('filter_move_up')}
                onClick={() => moveFilter(idx, -1)}
              />
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={idx === filters.length - 1}
                aria-label={t('filter_move_down')}
                onClick={() => moveFilter(idx, 1)}
              />
              <Button danger type="text" onClick={() => removeAt(idx)}>
                {t('remove')}
              </Button>
            </Space>
          </div>
        );
      })}
      {filters.length === 0 && (
        <Typography.Text type="secondary">{t('filter_editor_empty')}</Typography.Text>
      )}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addFilter} block>
        {t('add_filter')}
      </Button>
    </Space>
  );
}

type DashboardFiltersManageModalProps = {
  open: boolean;
  onClose: () => void;
  globalFilters: DashboardFilter[];
  pageFilters: DashboardFilter[];
  onSaveGlobal: (filters: DashboardFilter[]) => Promise<void>;
  onSavePage?: (filters: DashboardFilter[]) => Promise<void>;
  canEditPageFilters: boolean;
  dataSourceOptions: { value: string; label: string }[];
  tableOptionsBySource?: Record<string, { value: string; label: string }[]>;
  widgetScopeOptions?: { value: string; label: string }[];
  dataSources?: DataSourceSchema[];
  dashboardId?: string;
  widgets?: WidgetInstance[];
  initialTab?: 'global' | 'page';
};

export function DashboardFiltersManageModal({
  open,
  onClose,
  globalFilters,
  pageFilters,
  onSaveGlobal,
  onSavePage,
  canEditPageFilters,
  dataSourceOptions,
  tableOptionsBySource = {},
  widgetScopeOptions = [],
  dataSources = [],
  dashboardId,
  widgets = [],
  initialTab = 'global',
}: DashboardFiltersManageModalProps) {
  const t = useTranslations('dashboards');
  const [tab, setTab] = useState<'global' | 'page'>(initialTab);
  const [globalDraft, setGlobalDraft] = useState<DashboardFilter[]>(globalFilters);
  const [pageDraft, setPageDraft] = useState<DashboardFilter[]>(pageFilters);
  const [saving, setSaving] = useState(false);

  const draftConflicts = useMemo(
    () => detectFilterFieldConflicts(globalDraft, pageDraft, widgets),
    [globalDraft, pageDraft, widgets],
  );

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setGlobalDraft(globalFilters.length ? [...globalFilters] : []);
    setPageDraft(pageFilters.length ? [...pageFilters] : []);
  }, [open, initialTab, globalFilters, pageFilters]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const sanitize = (draft: DashboardFilter[]) =>
        draft.filter((f) => {
          if (!f.field?.trim()) return false;
          if (['dropdown', 'checkbox', 'slider'].includes(f.type) && !f.dataSourceId) return false;
          return true;
        });
      if (tab === 'global') {
        await onSaveGlobal(sanitize(globalDraft));
      } else if (onSavePage) {
        await onSavePage(sanitize(pageDraft));
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const formProps = {
    dataSourceOptions,
    tableOptionsBySource,
    widgetScopeOptions,
    dataSources,
    dashboardId,
  };

  return (
    <Modal
      title={t('manage_filters')}
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      confirmLoading={saving}
      width={920}
      destroyOnHidden
    >
      {draftConflicts.length > 0 ? (
        <FilterFieldConflictsAlert conflicts={draftConflicts} />
      ) : null}
      {canEditPageFilters && onSavePage ? (
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'global' | 'page')}
          items={[
            {
              key: 'global',
              label: t('global_filters_tab'),
              children: (
                <FilterEditorForm filters={globalDraft} onChange={setGlobalDraft} defaultIsGlobal widgets={widgets} {...formProps} />
              ),
            },
            {
              key: 'page',
              label: t('page_filters_tab'),
              children: (
                <FilterEditorForm
                  filters={pageDraft}
                  onChange={setPageDraft}
                  defaultIsGlobal={false}
                  widgets={widgets}
                  {...formProps}
                />
              ),
            },
          ]}
        />
      ) : (
        <FilterEditorForm filters={globalDraft} onChange={setGlobalDraft} defaultIsGlobal widgets={widgets} {...formProps} />
      )}
    </Modal>
  );
}

export default DashboardFiltersManageModal;
