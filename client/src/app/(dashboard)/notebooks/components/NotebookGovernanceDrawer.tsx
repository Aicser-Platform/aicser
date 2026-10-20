'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, Tabs, Tag, Typography,
} from 'antd';
import { DownloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  notebookService,
  type NotebookParameterDef,
  type NotebookSettings,
} from '@/services/notebookService';
import { workbookService, type WorkbookSettings } from '@/services/workbookService';

const { Text } = Typography;

const emptySettings: NotebookSettings = {
  parameters: [],
  compute_profile: 'browser',
  git: { branch: 'main', auto_export_on_save: false },
  certification: { status: 'draft', locks_edits: false },
  visual_embeds: [],
};

export function NotebookGovernanceDrawer({
  open,
  notebookId,
  workbookId,
  kind = 'notebook',
  canEdit,
  settings,
  onClose,
  onSettingsChange,
}: {
  open: boolean;
  notebookId?: string;
  workbookId?: string;
  kind?: 'notebook' | 'workbook';
  canEdit: boolean;
  settings: NotebookSettings | WorkbookSettings;
  onClose: () => void;
  onSettingsChange: (s: NotebookSettings | WorkbookSettings) => void;
}) {
  const documentId = kind === 'workbook' ? (workbookId ?? '') : (notebookId ?? '');
  const api = kind === 'workbook' ? workbookService : notebookService;
  const apiBase = kind === 'workbook' ? '/api/workbooks' : '/api/notebooks';
  const t = useTranslations(kind === 'workbook' ? 'sheets' : 'notebooks');
  const { message } = App.useApp();
  const myUserId = useAuthStore((s) => s.user?.user_id ?? s.user?.id ?? '');
  const [local, setLocal] = useState<NotebookSettings>(settings);
  const [audit, setAudit] = useState<Array<{ action: string; created_at?: string }>>([]);
  const [lint, setLint] = useState<Array<{ message: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setLocal(settings);
  }, [open, settings]);

  const refreshAudit = useCallback(async () => {
    const res = await api.audit(documentId);
    setAudit(res.items);
  }, [api, documentId]);

  useEffect(() => {
    if (open) void refreshAudit();
  }, [open, refreshAudit]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.putSettings(documentId, local);
      onSettingsChange(res.settings);
      message.success(t('governance_saved'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('save_error'));
    } finally {
      setSaving(false);
    }
  };

  const runLint = async () => {
    const res = await api.lintSecrets(documentId);
    setLint(res.findings);
    if (res.ok) message.success(t('governance_lint_ok'));
    else message.warning(t('governance_lint_fail'));
  };

  const gitExport = async () => {
    const res = await api.gitExport(documentId);
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(res.manifest.suggested_path || 'notebook-export.json').replace(/\//g, '_')}`;
    a.click();
    onSettingsChange({ ...local, git: { ...local.git, last_export_at: String(res.manifest.exported_at) } });
  };

  const cert = local.certification;
  const isSubmitter = Boolean(cert.submitted_by && myUserId && cert.submitted_by === String(myUserId));
  const canReview = canEdit && cert.status === 'in_review' && !isSubmitter;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={t('governance_title')}
      extra={canEdit ? <Button type="primary" loading={saving} onClick={() => void save()}>{t('save')}</Button> : null}
    >
      <Tabs
        items={[
          {
            key: 'params',
            label: t('governance_params'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Text type="secondary">{t('governance_params_help')}</Text>
                <Form layout="vertical" disabled={!canEdit}>
                  {local.parameters.map((p, i) => (
                    <Space key={p.name} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                      <Input
                        placeholder={t('governance_param_name')}
                        value={p.name}
                        onChange={(e) => {
                          const next = [...local.parameters];
                          next[i] = { ...p, name: e.target.value };
                          setLocal({ ...local, parameters: next });
                        }}
                      />
                      <Select
                        value={p.type}
                        style={{ width: 110 }}
                        options={['string', 'number', 'boolean', 'date'].map((v) => ({ value: v, label: v }))}
                        onChange={(v) => {
                          const next = [...local.parameters];
                          next[i] = { ...p, type: v as NotebookParameterDef['type'] };
                          setLocal({ ...local, parameters: next });
                        }}
                      />
                      <Input
                        placeholder={t('governance_param_default')}
                        value={p.default != null ? String(p.default) : ''}
                        onChange={(e) => {
                          const next = [...local.parameters];
                          next[i] = { ...p, default: e.target.value };
                          setLocal({ ...local, parameters: next });
                        }}
                      />
                      <Switch
                        checked={p.required}
                        onChange={(v) => {
                          const next = [...local.parameters];
                          next[i] = { ...p, required: v };
                          setLocal({ ...local, parameters: next });
                        }}
                      />
                    </Space>
                  ))}
                  {canEdit ? (
                    <Button
                      type="dashed"
                      block
                      onClick={() => setLocal({ ...local, parameters: [...local.parameters, { name: `p${local.parameters.length + 1}`, type: 'string', required: false }] })}
                    >
                      {t('governance_add_param')}
                    </Button>
                  ) : null}
                </Form>
              </Space>
            ),
          },
          {
            key: 'compute',
            label: t('governance_compute'),
            children: (
              <Space direction="vertical">
                <Text type="secondary">{t('governance_compute_help')}</Text>
                <Select
                  disabled={!canEdit}
                  style={{ width: '100%' }}
                  value={local.compute_profile}
                  options={[
                    { value: 'browser', label: t('governance_compute_browser') },
                    { value: 'server', label: t('governance_compute_server') },
                  ]}
                  onChange={(v) => setLocal({ ...local, compute_profile: v })}
                />
              </Space>
            ),
          },
          {
            key: 'git',
            label: t('governance_git'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">{t('governance_git_help')}</Text>
                <Input
                  disabled={!canEdit}
                  placeholder={t('governance_git_remote')}
                  value={local.git.remote_url || ''}
                  onChange={(e) => setLocal({ ...local, git: { ...local.git, remote_url: e.target.value } })}
                />
                <Input
                  disabled={!canEdit}
                  placeholder={t('governance_git_branch')}
                  value={local.git.branch || 'main'}
                  onChange={(e) => setLocal({ ...local, git: { ...local.git, branch: e.target.value } })}
                />
                <Switch
                  disabled={!canEdit}
                  checked={local.git.auto_export_on_save}
                  onChange={(v) => setLocal({ ...local, git: { ...local.git, auto_export_on_save: v } })}
                />
                <Text type="secondary">{t('governance_git_auto')}</Text>
                <Button icon={<DownloadOutlined />} onClick={() => void gitExport()}>{t('governance_git_export')}</Button>
              </Space>
            ),
          },
          {
            key: 'cert',
            label: t('governance_cert'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Tag icon={<SafetyCertificateOutlined />} color={cert.status === 'approved' ? 'success' : cert.status === 'in_review' ? 'processing' : 'default'}>
                  {t(`governance_cert_${cert.status}`)}
                </Tag>
                {cert.note ? <Alert type="info" message={cert.note} /> : null}
                {canEdit ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {cert.status === 'in_review' && isSubmitter ? (
                      <Text type="secondary">{t('governance_cert_review_hint')}</Text>
                    ) : null}
                    <Space wrap>
                      {(cert.status === 'draft' || cert.status === 'rejected') ? (
                        <Button onClick={() => void api.certifySubmit(documentId).then((r) => { onSettingsChange(r.settings); setLocal(r.settings); })}>
                          {t('governance_cert_submit')}
                        </Button>
                      ) : null}
                      {canReview ? (
                        <>
                          <Button type="primary" onClick={() => void api.certifyApprove(documentId, { lock_edits: true }).then((r) => { onSettingsChange(r.settings); setLocal(r.settings); })}>
                            {t('governance_cert_approve')}
                          </Button>
                          <Button danger onClick={() => void api.certifyReject(documentId, {}).then((r) => { onSettingsChange(r.settings); setLocal(r.settings); })}>
                            {t('governance_cert_reject')}
                          </Button>
                        </>
                      ) : null}
                    </Space>
                  </Space>
                ) : null}
              </Space>
            ),
          },
          {
            key: 'security',
            label: t('governance_security'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">{t('governance_security_help')}</Text>
                <Button onClick={() => void runLint()}>{t('governance_run_lint')}</Button>
                {lint.length ? (
                  <Table size="small" pagination={false} dataSource={lint.map((f, i) => ({ key: i, ...f }))} columns={[{ title: t('governance_finding'), dataIndex: 'message' }]} />
                ) : null}
              </Space>
            ),
          },
          {
            key: 'audit',
            label: t('governance_audit'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  icon={<DownloadOutlined />}
                  href={`${apiBase}/${encodeURIComponent(documentId)}/audit/export`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(`${apiBase}/${encodeURIComponent(documentId)}/audit/export`, '_blank');
                  }}
                >
                  {t('governance_audit_export')}
                </Button>
                <Table
                  size="small"
                  pagination={{ pageSize: 8 }}
                  dataSource={audit.map((a, i) => ({ key: i, ...a }))}
                  columns={[
                    { title: t('governance_audit_when'), dataIndex: 'created_at', width: 180 },
                    { title: t('governance_audit_action'), dataIndex: 'action' },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

export { emptySettings };
