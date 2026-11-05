'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { App, Form, Input, Modal, Select, Table, Tooltip, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useDataSources } from '@/hooks/useDataSources';
import { fetchApi } from '@/utils/api';

const ACCEPT = '.pbix,.pbit,.twb,.twbx';

type ReportRow = {
  filename: string;
  tool?: string;
  pages?: number;
  visuals?: number;
  calculations?: number;
  shared_calculations?: number;
  error?: string;
};

/** Power BI or Tableau files, rebuilt here by the Agent on a connection the person picks. Several
 *  files show an inventory first (what each holds, what they share) so a move can be planned. */
export function ImportReportModal({ open, projectId, onClose }: { open: boolean; projectId?: string | null; onClose: () => void }) {
  const t = useTranslations('dashboard_tabs');
  const router = useRouter();
  const { message } = App.useApp();
  const { dataSources } = useDataSources(projectId);
  const [files, setFiles] = useState<File[]>([]);
  const [inventory, setInventory] = useState<ReportRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState<string>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFiles([]);
    setInventory(null);
    setSelected([]);
    setNote('');
  };

  const readInventory = async (list: File[]) => {
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f));
    try {
      const res = await fetchApi<{ reports: ReportRow[] }>('/api/bi/migrate/inventory', { method: 'POST', body: fd });
      setInventory(res.reports);
      setSelected(res.reports.filter((r) => !r.error).map((r) => r.filename));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('import_report_failed'));
    }
  };

  const onFiles = (list: File[]) => {
    setFiles(list);
    if (list.length > 1) void readInventory(list);
    else setInventory(null);
  };

  const start = async () => {
    const chosen = files.length > 1 ? files.filter((f) => selected.includes(f.name)) : files;
    if (!chosen.length || !sourceId) return;
    setBusy(true);
    let firstTask: string | null = null;
    let failed = 0;
    for (const file of chosen) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('data_source_id', sourceId);
      if (projectId) fd.append('project_id', String(projectId));
      if (note.trim()) fd.append('note', note.trim());
      try {
        const res = await fetchApi<{ task: { id: string } }>('/api/bi/migrate', { method: 'POST', body: fd });
        firstTask = firstTask ?? res.task.id;
      } catch (e) {
        failed += 1;
        message.error(`${file.name}: ${e instanceof Error ? e.message : t('import_report_failed')}`);
      }
    }
    setBusy(false);
    if (!firstTask) return;
    if (failed === 0) {
      reset();
      onClose();
    }
    router.push(chosen.length > 1 ? '/agent' : `/agent?task=${encodeURIComponent(firstTask)}`);
  };

  const count = files.length > 1 ? selected.length : files.length;
  return (
    <Modal
      open={open}
      title={t('import_report')}
      okText={count > 1 ? t('import_report_start_many', { count }) : t('import_report_start')}
      onOk={() => void start()}
      okButtonProps={{ disabled: !count || !sourceId, loading: busy }}
      onCancel={() => {
        reset();
        onClose();
      }}
      width={inventory ? 760 : 520}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item>
          <Upload.Dragger
            accept={ACCEPT}
            multiple
            showUploadList={!inventory}
            fileList={files.map((f) => ({ uid: f.name, name: f.name, status: 'done' as const }))}
            beforeUpload={(f, list) => {
              // Called once per file with the whole drop; act on the drop once.
              if (f === list[list.length - 1]) onFiles(list as unknown as File[]);
              return false;
            }}
            onRemove={(file) => onFiles(files.filter((f) => f.name !== file.name))}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{t('import_report_drop')}</p>
          </Upload.Dragger>
        </Form.Item>
        {inventory ? (
          <Form.Item>
            <Table<ReportRow>
              size="small"
              rowKey="filename"
              pagination={false}
              scroll={{ y: 280 }}
              dataSource={inventory}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
                getCheckboxProps: (r) => ({ disabled: Boolean(r.error) }),
              }}
              columns={[
                {
                  title: t('import_col_report'),
                  dataIndex: 'filename',
                  render: (name: string, r) => (
                    <>
                      <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 260 }}>{name}</Typography.Text>
                      {r.error ? <Typography.Text type="danger" style={{ display: 'block', fontSize: 12 }}>{r.error}</Typography.Text> : null}
                    </>
                  ),
                },
                { title: t('import_col_tool'), dataIndex: 'tool', width: 100 },
                { title: t('import_col_pages'), dataIndex: 'pages', width: 70, align: 'right' },
                { title: t('import_col_visuals'), dataIndex: 'visuals', width: 70, align: 'right' },
                {
                  title: <Tooltip title={t('import_col_shared_tip')}>{t('import_col_calcs')}</Tooltip>,
                  key: 'calcs',
                  width: 110,
                  align: 'right',
                  render: (_: unknown, r) => r.error ? null : (
                    <>
                      {r.calculations}
                      {r.shared_calculations ? <Typography.Text type="secondary"> · {t('import_shared', { count: r.shared_calculations })}</Typography.Text> : null}
                    </>
                  ),
                },
              ]}
            />
          </Form.Item>
        ) : null}
        <Form.Item label={t('import_report_source')}>
          <Select
            value={sourceId}
            onChange={setSourceId}
            showSearch
            optionFilterProp="label"
            options={dataSources.map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }))}
          />
        </Form.Item>
        <Form.Item label={t('import_report_note')}>
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
