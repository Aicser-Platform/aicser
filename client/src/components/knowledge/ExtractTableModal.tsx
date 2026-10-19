'use client';

import React, { useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

const { Text } = Typography;

type FieldType = 'text' | 'number' | 'date' | 'boolean';
type Field = { name: string; type: FieldType; instruction: string };
type Row = Record<string, unknown> & { document: string; _error?: string | null };

const blank = (): Field => ({ name: '', type: 'text', instruction: '' });

/**
 * Documents to a table: name the fields to pull out, check them on a few documents, then save one
 * row per document as a table that works like any other connection.
 */
export function ExtractTableModal({ open, libraryId, libraryName, onClose }: {
  open: boolean;
  libraryId: string;
  libraryName: string;
  onClose: () => void;
}) {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const [fields, setFields] = useState<Field[]>([blank()]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const ready = fields.filter((f) => f.name.trim());

  const update = (i: number, patch: Partial<Field>) => {
    setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setRows(null);
  };

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await fetchApi<{ columns: string[]; rows: Row[] }>(
        `/knowledge/libraries/${encodeURIComponent(libraryId)}/extract`,
        { method: 'POST', body: JSON.stringify({ fields: ready, limit: 3 }) },
      );
      setColumns(res.columns);
      setRows(res.rows);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const res = await fetchApi<{ data_source_id: string; name: string; rows: number; failed: number }>(
        `/knowledge/libraries/${encodeURIComponent(libraryId)}/extract/save`,
        { method: 'POST', body: JSON.stringify({ fields: ready, name: t('extract_table_name', { library: libraryName }) }) },
      );
      message.success(t('extract_saved', { rows: res.rows, failed: res.failed }));
      onClose();
      router.push(`/data/sources/${encodeURIComponent(res.data_source_id)}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      title={t('extract_title')}
      onCancel={onClose}
      width={880}
      footer={
        <Space>
          <Button onClick={() => void preview()} loading={busy === 'preview'} disabled={!ready.length || busy === 'save'}>
            {t('extract_preview')}
          </Button>
          <Button type="primary" onClick={() => void save()} loading={busy === 'save'} disabled={!rows || !ready.length}>
            {t('extract_save')}
          </Button>
        </Space>
      }
    >
      <Text type="secondary">{t('extract_hint')}</Text>
      <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
        {fields.map((f, i) => (
          <Space.Compact key={i} style={{ width: '100%' }}>
            <Input
              style={{ width: 200 }}
              value={f.name}
              placeholder={t('extract_field_name')}
              aria-label={t('extract_field_name')}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Select
              style={{ width: 120 }}
              value={f.type}
              onChange={(v) => update(i, { type: v })}
              options={(['text', 'number', 'date', 'boolean'] as FieldType[]).map((v) => ({ value: v, label: t(`extract_type_${v}`) }))}
            />
            <Input
              value={f.instruction}
              placeholder={t('extract_field_instruction')}
              aria-label={t('extract_field_instruction')}
              onChange={(e) => update(i, { instruction: e.target.value })}
            />
            <Button
              icon={<DeleteOutlined />}
              aria-label={t('extract_remove_field')}
              disabled={fields.length === 1}
              onClick={() => setFields((list) => list.filter((_, j) => j !== i))}
            />
          </Space.Compact>
        ))}
        <Button icon={<PlusOutlined />} onClick={() => setFields((list) => [...list, blank()])} disabled={fields.length >= 20}>
          {t('extract_add_field')}
        </Button>
      </Space>
      {rows ? (
        <div style={{ marginTop: 16 }}>
          {rows.some((r) => r._error) ? <Alert type="warning" showIcon message={t('extract_some_failed')} style={{ marginBottom: 8 }} /> : null}
          <Table
            size="small"
            rowKey={(r) => String(r.document_id ?? r.document)}
            pagination={false}
            scroll={{ x: true }}
            dataSource={rows}
            locale={{ emptyText: t('extract_no_documents') }}
            columns={columns.map((c) => ({
              title: c,
              dataIndex: c,
              render: (v: unknown) => (v === null || v === undefined ? <Text type="secondary">—</Text> : String(v)),
            }))}
          />
        </div>
      ) : null}
    </Modal>
  );
}
