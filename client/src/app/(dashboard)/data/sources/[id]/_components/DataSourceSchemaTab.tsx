'use client';

import React from 'react';
import { Card, Empty, Table, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema } from '@/hooks/useDataSources';

const { Text } = Typography;

type SchemaColumn = { name: string; type: string; nullable?: boolean };

export const DataSourceSchemaTab: React.FC<{ dataSourceId: string }> = ({ dataSourceId }) => {
  const t = useTranslations('data_source_detail');
  const { schema, isLoading } = useDataSourceSchema(dataSourceId);
  const tables = schema?.tables ?? [];

  if (!isLoading && tables.length === 0) {
    return <Empty description={t('schema_unavailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      {tables.map((table) => (
        <Card key={table.name} title={table.name} size="small" style={{ marginBottom: 16 }} loading={isLoading}>
          <Table<SchemaColumn>
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={(table.columns ?? []) as SchemaColumn[]}
            columns={[
              { title: t('data_source_rls_column'), dataIndex: 'name', key: 'name' },
              {
                title: t('data_source_rls_value_type'),
                dataIndex: 'type',
                key: 'type',
                render: (value: string) => <Tag>{value}</Tag>,
              },
              {
                title: 'NULL',
                dataIndex: 'nullable',
                key: 'nullable',
                render: (value?: boolean) => <Text type="secondary">{value === false ? 'NOT NULL' : '—'}</Text>,
              },
            ]}
          />
        </Card>
      ))}
    </>
  );
};

export default DataSourceSchemaTab;
