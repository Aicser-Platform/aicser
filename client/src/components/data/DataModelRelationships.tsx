'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Table, Tag, Space, message, Typography, Modal, Form, Input, Select } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import {
  autoDetectRelationships,
  createRelationship,
  deleteRelationship,
  listRelationships,
  type DataModelRelationship,
} from '@/api/dataModel';

const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

type ModelColumn = {
  name: string;
  type: string;
};

type ModelTable = {
  name: string;
  columns: ModelColumn[];
};

type Props = {
  dataSourceId: string;
  compact?: boolean;
  showPlatformLink?: boolean;
};

export function DataModelRelationships({ dataSourceId, compact = false, showPlatformLink = true }: Props) {
  const t = useTranslations('dashboards');
  const td = useTranslations('data_page');
  const { schema, isLoading: schemaLoading } = useDataSourceSchema(dataSourceId);
  const [rows, setRows] = useState<DataModelRelationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm();
  const fromTable = Form.useWatch('from_table', form);
  const toTable = Form.useWatch('to_table', form);

  const schemaTables = useMemo<ModelTable[]>(() => {
    const tables = ((schema as { tables?: unknown[] } | null)?.tables ?? []) as Array<{
      name?: string;
      columns?: Array<string | { name?: string; type?: string }>;
    }>;

    return tables
      .map((table) => {
        const name = String(table.name || '').trim();
        if (!name) return null;
        return {
          name,
          columns: (table.columns ?? [])
            .map((column) => {
              if (typeof column === 'string') return { name: column, type: 'string' };
              const columnName = String(column?.name || '').trim();
              if (!columnName) return null;
              return { name: columnName, type: String(column?.type || 'string') };
            })
            .filter((column): column is ModelColumn => Boolean(column)),
        };
      })
      .filter((table): table is ModelTable => Boolean(table));
  }, [schema]);

  const tableOptions = useMemo(
    () => schemaTables.map((table) => ({ value: table.name, label: table.name })),
    [schemaTables],
  );

  const columnOptionsForTable = useCallback(
    (tableName?: string) =>
      schemaTables
        .find((table) => table.name === tableName)
        ?.columns.map((column) => ({
          value: column.name,
          label: `${column.name} (${column.type})`,
        })) ?? [],
    [schemaTables],
  );

  const load = useCallback(async () => {
    if (!dataSourceId) return;
    setLoading(true);
    try {
      setRows(await listRelationships(dataSourceId));
    } catch {
      setRows([]);
      message.error(t('relationships_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [dataSourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAutoDetect = async () => {
    setLoading(true);
    try {
      const detected = await autoDetectRelationships(dataSourceId);
      setRows(detected);
      message.success(t('relationships_detected', { count: detected.length }));
    } catch {
      message.error(t('relationships_detect_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      await createRelationship(dataSourceId, {
        from_table: values.from_table,
        from_column: values.from_column,
        to_table: values.to_table,
        to_column: values.to_column,
        join_type: values.join_type || 'LEFT',
        cardinality: values.cardinality || 'one_to_many',
        cross_filter_direction: values.cross_filter_direction || 'single',
        is_active: true,
        assume_integrity: values.assume_integrity || false,
      });
      message.success(t('relationship_added'));
      setAddOpen(false);
      form.resetFields();
      await load();
    } catch {
      message.error(t('relationship_add_failed'));
    }
  };

  const columns = [
    {
      title: t('rel_from'),
      key: 'from',
      render: (_: unknown, r: DataModelRelationship) => `${r.from_table}.${r.from_column}`,
    },
    {
      title: t('rel_to'),
      key: 'to',
      render: (_: unknown, r: DataModelRelationship) => `${r.to_table}.${r.to_column}`,
    },
    {
      title: t('rel_join'),
      dataIndex: 'join_type',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Cardinality',
      dataIndex: 'cardinality',
      render: (v: string) => <Tag color="blue">{v?.replaceAll('_', ' ')}</Tag>,
    },
    {
      title: 'Filter',
      dataIndex: 'cross_filter_direction',
      render: (v: string) => <Tag color={v === 'both' ? 'purple' : undefined}>{v === 'both' ? 'Both' : 'Single'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      render: (_: unknown, r: DataModelRelationship) => (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() =>
            void deleteRelationship(dataSourceId, r.id).then(load).catch(() => message.error(t('rel_delete_failed')))
          }
        />
      ),
    },
  ];

  return (
    <div className={compact ? 'data-model-compact' : 'data-model-panel'}>
      {!compact && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t('data_model_desc')}
        </Typography.Paragraph>
      )}
      <Space style={{ marginBottom: 8 }} wrap>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          {t('refresh')}
        </Button>
        <Button size="small" type="primary" icon={<PlusOutlined />} loading={loading} onClick={() => void handleAutoDetect()}>
          {t('auto_detect_relationships')}
        </Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          {t('add_relationship')}
        </Button>
        {showPlatformLink && isEE && (
          <Link href={`/data-platform?tab=semantic&dataSourceId=${encodeURIComponent(dataSourceId)}`}>
            <Button size="small" icon={<LinkOutlined />}>
              {td('open_semantic_platform')}
            </Button>
          </Link>
        )}
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        locale={{ emptyText: t('no_relationships') }}
      />
      <Modal
        title={t('add_relationship')}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAdd()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ join_type: 'LEFT', cardinality: 'one_to_many', cross_filter_direction: 'single' }}
          onValuesChange={(changed) => {
            if ('from_table' in changed) form.setFieldValue('from_column', undefined);
            if ('to_table' in changed) form.setFieldValue('to_column', undefined);
          }}
        >
          <Form.Item name="from_table" label={t('rel_from_table')} rules={[{ required: true }]}>
            {tableOptions.length > 0 ? (
              <Select
                showSearch
                loading={schemaLoading}
                options={tableOptions}
                placeholder="orders"
                optionFilterProp="label"
              />
            ) : (
              <Input placeholder="orders" />
            )}
          </Form.Item>
          <Form.Item name="from_column" label={t('rel_from_column')} rules={[{ required: true }]}>
            {columnOptionsForTable(fromTable).length > 0 ? (
              <Select
                showSearch
                loading={schemaLoading}
                options={columnOptionsForTable(fromTable)}
                placeholder="customer_id"
                optionFilterProp="label"
              />
            ) : (
              <Input placeholder="customer_id" />
            )}
          </Form.Item>
          <Form.Item name="to_table" label={t('rel_to_table')} rules={[{ required: true }]}>
            {tableOptions.length > 0 ? (
              <Select
                showSearch
                loading={schemaLoading}
                options={tableOptions}
                placeholder="customers"
                optionFilterProp="label"
              />
            ) : (
              <Input placeholder="customers" />
            )}
          </Form.Item>
          <Form.Item name="to_column" label={t('rel_to_column')} rules={[{ required: true }]}>
            {columnOptionsForTable(toTable).length > 0 ? (
              <Select
                showSearch
                loading={schemaLoading}
                options={columnOptionsForTable(toTable)}
                placeholder="id"
                optionFilterProp="label"
              />
            ) : (
              <Input placeholder="id" />
            )}
          </Form.Item>
          <Form.Item name="join_type" label={t('rel_join')}>
            <Select
              options={[
                { value: 'LEFT', label: 'LEFT' },
                { value: 'INNER', label: 'INNER' },
                { value: 'RIGHT', label: 'RIGHT' },
              ]}
            />
          </Form.Item>
          <Form.Item name="cardinality" label="Cardinality">
            <Select
              options={[
                { value: 'one_to_one', label: 'One to one' },
                { value: 'one_to_many', label: 'One to many' },
                { value: 'many_to_many', label: 'Many to many' },
              ]}
            />
          </Form.Item>
          <Form.Item name="cross_filter_direction" label="Cross-filter direction">
            <Select
              options={[
                { value: 'single', label: 'Single direction' },
                { value: 'both', label: 'Both directions' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default DataModelRelationships;
