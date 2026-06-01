'use client';

import React, { useState } from 'react';
import { Modal, Input, Select, Button, Space, Tag } from 'antd';
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';
import shortid from 'shortid';

type Props = {
  filters: DashboardFilter[];
  dataSourceOptions: { value: string; label: string }[];
  tableOptionsBySource?: Record<string, { value: string; label: string }[]>;
  widgetScopeOptions?: { value: string; label: string }[];
  onSave: (filters: DashboardFilter[]) => Promise<void>;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  modalTitle?: string;
};

export function GlobalFiltersEditor({
  filters,
  dataSourceOptions,
  tableOptionsBySource = {},
  widgetScopeOptions = [],
  onSave,
  externalOpen,
  onExternalOpenChange,
  showTrigger = true,
  modalTitle,
}: Props) {
  const t = useTranslations('dashboards');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = onExternalOpenChange ?? setInternalOpen;
  const [draft, setDraft] = useState<DashboardFilter[]>(filters);
  const [saving, setSaving] = useState(false);

  const openEditor = () => {
    setDraft(filters.length ? [...filters] : []);
    setOpen(true);
  };

  const addFilter = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: shortid.generate(),
        name: t('new_filter_default'),
        type: 'dropdown',
        field: '',
        isGlobal: true,
        ...(dataSourceOptions[0]?.value ? { dataSourceId: dataSourceOptions[0].value } : {}),
      },
    ]);
  };

  const updateAt = (idx: number, patch: Partial<DashboardFilter>) => {
    setDraft((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeAt = (idx: number) => setDraft((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.filter((f) => f.field?.trim()));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showTrigger && (
        <>
          <Button size="small" type="default" icon={<SettingOutlined />} onClick={openEditor}>
            {t('manage_filters')}
          </Button>
          {filters.length > 0 && (
            <Tag color="blue" style={{ marginLeft: 4 }}>
              {filters.length}
            </Tag>
          )}
        </>
      )}
      <Modal
        title={modalTitle || t('manage_filters')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        width={720}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {draft.map((f, idx) => {
            const tables = f.dataSourceId ? tableOptionsBySource[f.dataSourceId] || [] : [];
            return (
              <Space key={f.id || idx} wrap style={{ width: '100%' }} align="start">
                <Input
                  placeholder={t('filter_name_placeholder')}
                  value={f.name}
                  onChange={(e) => updateAt(idx, { name: e.target.value })}
                  style={{ width: 110 }}
                />
                <Input
                  placeholder={t('filter_field_placeholder')}
                  value={f.field}
                  onChange={(e) => updateAt(idx, { field: e.target.value })}
                  style={{ width: 110 }}
                />
                <Select
                  value={f.type}
                  style={{ width: 110 }}
                  onChange={(v) => updateAt(idx, { type: v })}
                  options={[
                    { value: 'dropdown', label: t('filter_type_dropdown') },
                    { value: 'checkbox', label: t('filter_type_checkbox') },
                    { value: 'dateRange', label: t('filter_type_date') },
                    { value: 'search', label: t('filter_type_search') },
                  ]}
                />
                {dataSourceOptions.length > 0 && (
                  <Select
                    placeholder={t('data_source')}
                    style={{ width: 130 }}
                    value={f.dataSourceId}
                    onChange={(v) => updateAt(idx, { dataSourceId: v, tableName: undefined })}
                    options={dataSourceOptions}
                  />
                )}
                {tables.length > 0 && (
                  <Select
                    placeholder={t('table')}
                    style={{ width: 120 }}
                    allowClear
                    value={f.tableName}
                    onChange={(v) => updateAt(idx, { tableName: v })}
                    options={tables}
                  />
                )}
                <Input
                  placeholder={t('filter_default_placeholder')}
                  value={f.defaultValue != null ? String(f.defaultValue) : ''}
                  onChange={(e) => updateAt(idx, { defaultValue: e.target.value || undefined })}
                  style={{ width: 100 }}
                />
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
                <Button danger type="text" onClick={() => removeAt(idx)}>
                  {t('remove')}
                </Button>
              </Space>
            );
          })}
          <Button type="dashed" icon={<PlusOutlined />} onClick={addFilter} block>
            {t('add_filter')}
          </Button>
        </Space>
      </Modal>
    </>
  );
}

export default GlobalFiltersEditor;
