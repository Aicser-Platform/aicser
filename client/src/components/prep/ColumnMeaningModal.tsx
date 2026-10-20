'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Divider, Form, Input, Modal, Select, Space, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import type { ColumnMeaning } from '@/api/prep';
import { COLUMN_ROLES, guessRole } from '@/constants/columnRoles';

const { Text } = Typography;

const quote = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`);

/**
 * What one output column means: a description, a role and whether it holds personal data.
 * Saved on the recipe and written onto the table the recipe produces, where Ask and the semantic
 * model read it. Certification stays in one place: tables by data contracts, metrics in the model.
 */
export function ColumnMeaningModal({
  open,
  column,
  kind,
  value,
  outputDataSourceId,
  onClose,
  onSave,
}: {
  open: boolean;
  column: string;
  kind: string;
  value?: ColumnMeaning;
  outputDataSourceId?: string | null;
  onClose: () => void;
  onSave: (meaning: ColumnMeaning) => Promise<void>;
}) {
  const t = useTranslations('prepare');
  const tr = useTranslations('column_roles');
  const [form] = Form.useForm<ColumnMeaning>();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const canModel = isEnterpriseEdition && Boolean(outputDataSourceId);
  const { schema } = useDataSourceSchema(open && canModel ? outputDataSourceId! : null);
  const outTable = schema?.tables?.[0];
  const outRef = outTable ? [outTable.schema, outTable.name].filter(Boolean).map((p) => quote(String(p))).join('.') : null;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ description: value?.description ?? '', role: value?.role ?? guessRole(column, kind), personal: Boolean(value?.personal) });
  }, [open, value, column, kind, form]);

  const role = Form.useWatch('role', form);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await onSave({ description: v.description?.trim() || null, role: v.role ?? null, personal: Boolean(v.personal) });
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // A draft in the model, on the table this recipe produced; it is certified there, not here.
  const addToModel = async (kindToAdd: 'metric' | 'dimension') => {
    if (!outputDataSourceId || !outRef) return;
    setAdding(kindToAdd);
    const col = `${outRef}.${quote(column)}`;
    const base = column.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const description = form.getFieldValue('description') || undefined;
    try {
      if (kindToAdd === 'metric') {
        const expression = role === 'id' ? `COUNT(DISTINCT ${col})` : role === 'count' || role === 'amount' ? `SUM(${col})` : `COUNT(DISTINCT ${col})`;
        const name = role === 'amount' || role === 'count' ? `total_${base}` : `distinct_${base}`;
        await fetchApi('semantic/metrics', { method: 'POST', body: JSON.stringify({ name, expression, description, data_source_id: outputDataSourceId }) });
      } else {
        await fetchApi('semantic/dimensions', {
          method: 'POST',
          body: JSON.stringify({ name: base, expression: col, description, data_source_id: outputDataSourceId, dimension_type: role === 'date' ? 'time' : 'category' }),
        });
      }
      message.success(t(kindToAdd === 'metric' ? 'meaning_metric_added' : 'meaning_dimension_added'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal
      open={open}
      title={t('meaning_title', { column })}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t('meaning_save')}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="description" label={t('meaning_description')} extra={t('meaning_description_hint')}>
          <Input.TextArea rows={2} maxLength={500} placeholder={t('meaning_description_placeholder')} />
        </Form.Item>
        <Form.Item name="role" label={t('meaning_role')}>
          <Select
            options={COLUMN_ROLES.map((r) => ({
              value: r,
              label: (
                <Space direction="vertical" size={0}>
                  <span>{tr(`role_${r}`)}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>{tr(`role_${r}_desc`)}</Text>
                </Space>
              ),
            }))}
            optionLabelProp="value"
            labelRender={({ value: v }) => tr(`role_${v}`)}
          />
        </Form.Item>
        <Form.Item name="personal" valuePropName="checked" style={{ marginBottom: 8 }}>
          <Checkbox>{t('meaning_personal')}</Checkbox>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('meaning_where')}</Text>
      {isEnterpriseEdition ? (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong>{t('meaning_model_title')}</Text>
          {canModel && outRef ? (
            <Space wrap style={{ marginTop: 8 }}>
              <Button size="small" icon={<PlusOutlined />} loading={adding === 'metric'} onClick={() => void addToModel('metric')}>
                {t(role === 'amount' || role === 'count' ? 'meaning_add_total' : 'meaning_add_distinct')}
              </Button>
              <Button size="small" icon={<PlusOutlined />} loading={adding === 'dimension'} onClick={() => void addToModel('dimension')}>
                {t('meaning_add_dimension')}
              </Button>
            </Space>
          ) : (
            <Alert style={{ marginTop: 8 }} type="info" showIcon message={t('meaning_model_needs_table')} />
          )}
        </>
      ) : null}
    </Modal>
  );
}

export default ColumnMeaningModal;
