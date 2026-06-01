'use client';

import React, { useEffect, useState } from 'react';
import { Select, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

type SavedQuery = { id: string; name: string; sql?: string; description?: string };

type Props = {
  value?: string;
  onChange: (queryId: string | undefined, snapshot?: SavedQuery) => void;
};

export function SavedQueryPicker({ value, onChange }: Props) {
  const t = useTranslations('dashboards');
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchApi('queries/saved-queries')
      .then((res: { items?: SavedQuery[]; saved_queries?: SavedQuery[] }) => {
        const list = res?.items || res?.saved_queries || (Array.isArray(res) ? res : []);
        setQueries(list as SavedQuery[]);
      })
      .catch(() => setQueries([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {t('saved_query_label')}
      </Typography.Text>
      <Select
        allowClear
        showSearch
        loading={loading}
        placeholder={t('saved_query_placeholder')}
        style={{ width: '100%' }}
        value={value}
        options={queries.map((q) => ({ value: q.id, label: q.name }))}
        onChange={(id) => {
          const found = queries.find((q) => q.id === id);
          onChange(id, found);
        }}
      />
    </div>
  );
}

export default SavedQueryPicker;
