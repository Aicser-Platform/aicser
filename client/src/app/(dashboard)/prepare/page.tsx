'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Empty, Form, Input, Modal, Select, Table, Tag, Typography, message } from 'antd';
import { MoreOutlined, ToolOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useDataSources } from '@/hooks/useDataSources';
import { useProjectStore } from '@/stores/useProjectStore';
import { isLakehouseComputeDataSource } from '@/utils/lakehouseComputeSource';
import { getDataSourceSchema } from '@/api/dataSources';
import { createRecipe, listRecipes, type Recipe } from '@/api/prep';
import { useFormatUserError } from '@/hooks/useFormatUserError';
import { useRecipeActions } from '@/components/prep/useRecipeActions';

const { Text } = Typography;

export default function PreparePage() {
  const t = useTranslations('prepare');
  const router = useRouter();
  const formatError = useFormatUserError();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const pid = projectId ? String(projectId) : null;
  const { dataSources } = useDataSources();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const sourceId = Form.useWatch('data_source_id', form) as string | undefined;

  const actions = useRecipeActions();
  const recipes = useQuery({ queryKey: ['prep', 'recipes', pid], queryFn: () => listRecipes(pid) });

  const sources = useMemo(
    () => (dataSources ?? []).filter((ds) => ds.is_active !== false && !isLakehouseComputeDataSource(ds)),
    [dataSources],
  );
  const sourceName = (id: string) => sources.find((s) => String(s.id) === id)?.name ?? t('unknown_source');
  const selectedSource = sources.find((s) => String(s.id) === sourceId);
  const needsTable = Boolean(selectedSource && (selectedSource.type || '').toLowerCase() !== 'file');

  const tables = useQuery({
    queryKey: ['prep', 'tables', sourceId],
    queryFn: () => getDataSourceSchema(sourceId as string, 'source'),
    enabled: needsTable,
    select: (res) =>
      (res.schema?.tables ?? []).map((tb: { name: string; schema?: string }) => {
        const full = tb.schema && !['public', 'main'].includes(tb.schema) ? `${tb.schema}.${tb.name}` : tb.name;
        return { value: full, label: full };
      }),
  });

  const create = useMutation({
    mutationFn: (values: { name: string; data_source_id: string; table?: string }) =>
      createRecipe({ ...values, project_id: pid }),
    onSuccess: (recipe) => router.push(`/prepare/${recipe.id}`),
    onError: (err) => message.error(formatError(err)),
  });

  const columns: ColumnsType<Recipe> = [
    {
      title: t('col_name'),
      dataIndex: 'name',
      render: (name: string, r) => (
        <a onClick={() => router.push(`/prepare/${r.id}`)} href={`/prepare/${r.id}`}>
          {name}
        </a>
      ),
    },
    {
      title: t('col_source'),
      key: 'source',
      render: (_, r) => (
        <Text>
          {sourceName(r.data_source_id)}
          {r.table && r.table !== 'data' ? <Text type="secondary"> · {r.table}</Text> : null}
        </Text>
      ),
    },
    { title: t('col_steps'), key: 'steps', width: 90, render: (_, r) => r.steps.length },
    {
      title: t('col_status'),
      key: 'status',
      width: 150,
      render: (_, r) =>
        r.status === 'published' ? (
          <Tag color="success">{t('status_published', { version: r.version })}</Tag>
        ) : (
          <Tag>{r.version ? t('status_draft_changes', { version: r.version }) : t('status_draft')}</Tag>
        ),
    },
    {
      title: t('col_output'),
      key: 'output',
      width: 180,
      render: (_, r) =>
        r.output?.mode === 'table' ? <Tag color="processing">{t('output_table')}</Tag> : <Tag>{t('output_view')}</Tag>,
    },
    {
      title: t('col_updated'),
      dataIndex: 'updated_at',
      width: 170,
      render: (v?: string | null) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      key: 'actions',
      width: 48,
      render: (_, r) =>
        r.is_owner ? (
          <Dropdown menu={{ items: actions.menu(r) }} trigger={['click']}>
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('more_actions')} />
          </Dropdown>
        ) : null,
    },
  ];

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        icon={<ToolOutlined />}
        title={t('title')}
        description={t('description')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            {t('new_recipe')}
          </Button>
        }
      />
      <Table
        rowKey="id"
        columns={columns}
        dataSource={recipes.data ?? []}
        loading={recipes.isLoading}
        locale={{
          emptyText: (
            <Empty description={t('empty')}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
                {t('new_recipe')}
              </Button>
            </Empty>
          ),
        }}
      />
      <Modal
        open={open}
        title={t('new_recipe')}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText={t('create_and_open')}
        confirmLoading={create.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} preserve={false}>
          <Form.Item name="data_source_id" label={t('field_source')} rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={t('field_source_placeholder')}
              options={sources.map((s) => ({ value: String(s.id), label: s.name }))}
              notFoundContent={t('no_sources')}
            />
          </Form.Item>
          {needsTable ? (
            <Form.Item name="table" label={t('field_table')} rules={[{ required: true }]}>
              <Select showSearch loading={tables.isLoading} options={tables.data ?? []} />
            </Form.Item>
          ) : null}
          <Form.Item name="name" label={t('field_name')} rules={[{ required: true, max: 200 }]}>
            <Input placeholder={t('field_name_placeholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardPageShell>
  );
}
