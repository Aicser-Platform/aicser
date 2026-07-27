'use client';

import React from 'react';
import { Modal, Select } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { PpLabel } from './PpLabel';

type SavedQuery = {
  id: string | number;
  name: string;
  sql?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type Props = {
  value?: string | number;
  onChange: (queryId: string | undefined, snapshot?: SavedQuery) => void;
  disabled?: boolean;
  /** Optional action rendered next to the label (e.g. Write custom SQL icon). */
  labelExtra?: React.ReactNode;
};

/** Picker only — SQL edit lives in SavedQuerySqlEditor. */
export function SavedQueryPicker({ value, onChange, disabled, labelExtra }: Props) {
  const t = useTranslations('dashboards');
  const [queries, setQueries] = React.useState<SavedQuery[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    fetchApi('queries/saved-queries')
      .then((res: { items?: SavedQuery[]; saved_queries?: SavedQuery[] }) => {
        const list = res?.items || res?.saved_queries || (Array.isArray(res) ? res : []);
        setQueries(list as SavedQuery[]);
      })
      .catch(() => setQueries([]))
      .finally(() => setLoading(false));
  }, []);

  const valueStr = value != null && value !== '' ? String(value) : undefined;

  return (
    <div style={{ marginBottom: 4 }}>
      <div className="pp-label-with-extra">
        <PpLabel>{t('saved_query_label')}</PpLabel>
        {labelExtra ? <div className="pp-label-extra">{labelExtra}</div> : null}
      </div>
      <Select
        allowClear
        showSearch
        disabled={disabled}
        loading={loading}
        placeholder={t('saved_query_placeholder')}
        style={{ width: '100%' }}
        value={valueStr}
        optionFilterProp="label"
        options={queries.map((q) => ({ value: String(q.id), label: q.name }))}
        onChange={(id) => {
          if (!id) {
            if (!valueStr) {
              onChange(undefined, undefined);
              return;
            }
            Modal.confirm({
              title: t('switch_to_table_title'),
              content: t('unbind_saved_query_body'),
              okText: t('switch_to_table_ok'),
              okButtonProps: { danger: true },
              cancelText: t('switch_to_table_cancel'),
              onOk: () => onChange(undefined, undefined),
            });
            return;
          }
          const found = queries.find((q) => String(q.id) === String(id));
          onChange(String(id), found);
        }}
      />
    </div>
  );
}

export default SavedQueryPicker;
