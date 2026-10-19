'use client';

import React, { useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import { useGranteeDirectory } from '@/hooks/access/useGranteeOptions';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text } = Typography;

type AccessAs = {
  levels: { view: boolean; query: boolean; manage: boolean };
  access: {
    unrestricted: boolean;
    policies: { id: string; name: string; predicates: { table: string; sql: string }[] }[];
    denies_ungoverned_tables: boolean;
    columns: { denied: string[]; masked: { column: string; strategy: string }[] };
  } | null;
  sample: { table: string; columns?: string[]; rows?: Record<string, unknown>[]; error?: string } | null;
};

/**
 * Pick a member and see this data source the way they do: their access level, the rows and
 * columns their grants allow, and a sample of a table queried as them (rules applied).
 */
export function SeeAsMemberDrawer({ dataSourceId, organizationId }: { dataSourceId: string; organizationId: string | null }) {
  const t = useTranslations('data_source_detail');
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<string>();
  const [table, setTable] = useState<string>();
  const [result, setResult] = useState<AccessAs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { optionsByType } = useGranteeDirectory({ organizationId, enabled: open });
  const { schema } = useDataSourceSchema(open ? dataSourceId : null);
  const tables = (schema?.tables ?? []).map((tb) => (tb.schema ? `${tb.schema}.${tb.name}` : tb.name));

  const run = async () => {
    if (!member) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (table) q.set('table', table);
      if (projectId) q.set('project_id', String(projectId));
      setResult(await fetchApi<AccessAs>(`/data/sources/${dataSourceId}/access-as/${encodeURIComponent(member)}?${q.toString()}`));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const levelText = (r: AccessAs) =>
    r.levels.manage ? t('see_as_level_manage') : r.levels.query ? t('see_as_level_explore') : r.levels.view ? t('see_as_level_view') : t('see_as_level_none');

  return (
    <>
      <Button icon={<EyeOutlined />} onClick={() => setOpen(true)}>{t('see_as_button')}</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('see_as_title')} size={640}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary">{t('see_as_intro')}</Text>
          <Space wrap>
            <Select
              showSearch
              optionFilterProp="label"
              style={{ width: 260 }}
              placeholder={t('see_as_member')}
              value={member}
              onChange={(v) => { setMember(v); setResult(null); }}
              options={(optionsByType.user ?? []).map((o) => ({ value: o.value, label: o.secondary ? `${o.label} · ${o.secondary}` : o.label }))}
            />
            <Select
              allowClear
              showSearch
              style={{ width: 220 }}
              placeholder={t('see_as_table')}
              value={table}
              onChange={(v) => setTable(v)}
              options={tables.map((name) => ({ value: name, label: name }))}
            />
            <Button type="primary" disabled={!member} loading={loading} onClick={() => void run()}>{t('see_as_run')}</Button>
          </Space>
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {result ? (
            <>
              <section>
                <Text strong>{t('see_as_access')}</Text>
                <div>{levelText(result)}</div>
              </section>
              {result.access ? (
                <>
                  <section>
                    <Text strong>{t('see_as_rows')}</Text>
                    {result.access.unrestricted ? (
                      <div><Tag color="warning">{t('see_as_all_rows')}</Tag></div>
                    ) : (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {result.access.policies.map((p) => (
                          <div key={p.id}>
                            <Text>{p.name}</Text>
                            {p.predicates.map((pr) => (
                              <code key={pr.table} style={{ display: 'block', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pr.table}: {pr.sql}</code>
                            ))}
                          </div>
                        ))}
                        {result.access.denies_ungoverned_tables ? <Text type="secondary" style={{ fontSize: 12 }}>{t('see_as_other_tables_hidden')}</Text> : null}
                      </Space>
                    )}
                  </section>
                  <section>
                    <Text strong>{t('see_as_columns')}</Text>
                    {result.access.columns.denied.length === 0 && result.access.columns.masked.length === 0 ? (
                      <div><Text type="secondary">{t('see_as_all_columns')}</Text></div>
                    ) : (
                      <Space wrap size={4}>
                        {result.access.columns.denied.map((c) => <Tag key={c} color="red">{t('see_as_hidden', { column: c })}</Tag>)}
                        {result.access.columns.masked.map((c) => <Tag key={c.column} color="blue">{t('see_as_masked', { column: c.column })}</Tag>)}
                      </Space>
                    )}
                  </section>
                </>
              ) : null}
              {result.sample ? (
                <section>
                  <Text strong>{t('see_as_sample', { table: result.sample.table })}</Text>
                  {result.sample.error ? (
                    <Alert type="info" showIcon message={result.sample.error} />
                  ) : result.sample.rows?.length ? (
                    <Table
                      size="small"
                      rowKey={(_, i) => String(i)}
                      dataSource={result.sample.rows}
                      pagination={false}
                      scroll={{ x: true }}
                      columns={(result.sample.columns ?? []).map((c) => ({ title: c, dataIndex: c, key: c, render: (v: unknown) => (v == null ? '—' : String(v)) }))}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('see_as_no_rows')} />
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </Space>
      </Drawer>
    </>
  );
}

export default SeeAsMemberDrawer;
