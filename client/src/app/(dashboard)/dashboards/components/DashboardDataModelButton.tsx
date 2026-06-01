'use client';

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Select, Typography } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { DataModelGraphView } from './DataModelGraphView';
import { DataModelRelationships } from '@/components/data/DataModelRelationships';

type Props = {
  dataSourceIds?: string[];
  dataSourceOptions?: { value: string; label: string }[];
};

/** Builder-only: data model & relationships (lives in page toolbar, not the filter strip). */
export function DashboardDataModelButton({
  dataSourceIds = [],
  dataSourceOptions = [],
}: Props) {
  const t = useTranslations('dashboards');
  const [open, setOpen] = useState(false);
  const [modelSourceId, setModelSourceId] = useState(dataSourceIds[0] || '');

  const sourceLabel = useMemo(() => {
    if (!modelSourceId) return '';
    return dataSourceOptions.find((o) => o.value === modelSourceId)?.label || modelSourceId;
  }, [modelSourceId, dataSourceOptions]);

  if (!dataSourceIds.length) return null;

  return (
    <>
      <Button
        size="small"
        type="text"
        className="studio-context-btn"
        icon={<ApartmentOutlined />}
        onClick={() => {
          if (!modelSourceId && dataSourceIds[0]) setModelSourceId(dataSourceIds[0]);
          setOpen(true);
        }}
      >
        {t('data_model_view')}
      </Button>
      <Drawer
        title={t('data_model_drawer_title')}
        open={open}
        onClose={() => setOpen(false)}
        width={Math.min(640, typeof window !== 'undefined' ? window.innerWidth - 32 : 640)}
        destroyOnHidden
      >
        {dataSourceIds.length > 1 && (
          <Select
            style={{ width: '100%', marginBottom: 16 }}
            value={modelSourceId || undefined}
            onChange={setModelSourceId}
            options={dataSourceIds.map((id) => ({
              value: id,
              label: dataSourceOptions.find((o) => o.value === id)?.label || id,
            }))}
            placeholder={t('data_source')}
          />
        )}
        {modelSourceId ? (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              {t('data_model_drawer_desc', { source: sourceLabel })}
            </Typography.Paragraph>
            <DataModelGraphView dataSourceId={modelSourceId} />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              {t('data_model_relationships_table')}
            </Typography.Title>
            <DataModelRelationships dataSourceId={modelSourceId} compact showPlatformLink />
          </>
        ) : null}
      </Drawer>
    </>
  );
}

export default DashboardDataModelButton;
