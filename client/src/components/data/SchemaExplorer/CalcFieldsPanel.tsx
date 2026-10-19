'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { App, Button, Empty, List, Space, Tooltip, Typography } from 'antd';
import { DeleteOutlined, FunctionOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { createCalcField, deleteCalcField, listCalcFields, type CalcField } from '@/api/calcFields';
import { CalcFieldBuilderModal } from './CalcFieldBuilderModal';

const { Text } = Typography;

type Props = {
  dataSourceId: string;
  canEdit?: boolean;
  columnOptions?: { label: string; value: string; type?: string }[];
  onInsert?: (field: CalcField) => void;
  onChanged?: () => void;
};

export function CalcFieldsPanel({
  dataSourceId,
  canEdit = true,
  columnOptions = [],
  onInsert,
  onChanged,
}: Props) {
  const t = useTranslations('schema_explorer');
  const { message } = App.useApp();
  const [fields, setFields] = useState<CalcField[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!dataSourceId) return;
    setLoading(true);
    try {
      setFields(await listCalcFields(dataSourceId));
    } catch {
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [dataSourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => setModalOpen(true);

  const save = async (payload: { name: string; expression: string; description: string }) => {
    try {
      await createCalcField(dataSourceId, payload);
      message.success(t('calc_save_ok'));
      setModalOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('calc_save_failed'));
    }
  };

  const remove = async (field: CalcField) => {
    try {
      await deleteCalcField(dataSourceId, field.id);
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('calc_delete_failed'));
    }
  };

  return (
    <div className="calc-fields-panel">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('calc_tab_hint')}
      </Text>
      {canEdit ? (
        <Button type="dashed" size="small" block icon={<PlusOutlined />} onClick={openCreate} style={{ marginBottom: 8 }}>
          {t('calc_modal_title')}
        </Button>
      ) : null}
      {loading ? (
        <Text type="secondary">{t('loading_schema')}</Text>
      ) : fields.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('calc_empty')} />
      ) : (
        <List
          size="small"
          dataSource={fields}
          renderItem={(item) => (
            <List.Item
              actions={[
                onInsert ? (
                  <Button type="link" size="small" onClick={() => onInsert(item)}>
                    {t('calc_insert')}
                  </Button>
                ) : null,
                canEdit ? (
                  <Tooltip title={t('calc_modal_delete')}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => void remove(item)} />
                  </Tooltip>
                ) : null,
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={<FunctionOutlined style={{ color: 'var(--ant-color-purple)' }} />}
                title={
                  <button
                    type="button"
                    className="calc-fields-panel__name"
                    onClick={() => onInsert?.(item)}
                  >
                    {item.name}
                  </button>
                }
                description={<Text type="secondary" code style={{ fontSize: 11 }}>{item.expression}</Text>}
              />
            </List.Item>
          )}
        />
      )}

      <CalcFieldBuilderModal
        open={modalOpen}
        columnOptions={columnOptions}
        onCancel={() => setModalOpen(false)}
        onSave={(p) => void save(p)}
      />
    </div>
  );
}
