'use client';

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Select, Typography } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { DataModelWorkbenchPanel } from '@/components/data/DataModelWorkbenchPanel';
import { semanticLayerStudioHref } from '@/app/(dashboard)/data/sources/[id]/_components/tabParam';
import { useRouter } from 'next/navigation';

type Props = {
  dataSourceIds?: string[];
  dataSourceOptions?: { value: string; label: string }[];
};

/** Builder shortcut: same relationship workbench as semantic layer & dashboard modeling. */
export function DashboardDataModelButton({
  dataSourceIds = [],
  dataSourceOptions = [],
}: Props) {
  const t = useTranslations('dashboards');
  const router = useRouter();
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
        type="text"
        block
        className="!justify-start !text-left text-text-secondary"
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
        size={Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 32 : 720)}
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
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t('data_model_drawer_desc', { source: sourceLabel })}
            </Typography.Paragraph>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, marginBottom: 12 }}
              onClick={() => {
                setOpen(false);
                router.push(semanticLayerStudioHref(modelSourceId, 'joins'));
              }}
            >
              {t('open_semantic_layer_joins')}
            </Button>
            <DataModelWorkbenchPanel
              primarySourceId={modelSourceId}
              scope="single"
              showProjectScopeToggle
              variant="embedded"
              canvasMinHeight={400}
              showRelationshipTable
            />
          </>
        ) : null}
      </Drawer>
    </>
  );
}

export default DashboardDataModelButton;
