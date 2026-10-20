'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Drawer, Dropdown, Input, List, Modal, Space, Tag, Tooltip, Typography, message } from 'antd';
import { ArrowLeftOutlined, ExperimentOutlined, ExportOutlined, HistoryOutlined, MoreOutlined, SaveOutlined, TableOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useRecipeActions } from '@/components/prep/useRecipeActions';
import { DashboardPageHeader, DashboardPageLoading, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { RecipeEditor } from '@/components/prep/RecipeEditor';
import {
  getRecipe,
  getRecipeImpact,
  listRecipeVersions,
  publishRecipe,
  restoreRecipeVersion,
  saveRecipeAsTable,
  updateRecipe,
  type PrepStep,
  type Recipe,
} from '@/api/prep';
import { useFormatUserError } from '@/hooks/useFormatUserError';
import { describeStep } from '@/components/prep/recipeSteps';

const { Text } = Typography;
const AUTOSAVE_MS = 700;

export default function RecipePage() {
  const t = useTranslations('prepare');
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '');
  const router = useRouter();
  const actions = useRecipeActions({ afterDelete: () => router.push('/prepare') });
  const qc = useQueryClient();
  const formatError = useFormatUserError();

  const recipe = useQuery({ queryKey: ['prep', 'recipe', id], queryFn: () => getRecipe(id), enabled: Boolean(id) });
  // Local edits win; until the first edit, show the saved steps.
  const [edited, setSteps] = useState<PrepStep[] | null>(null);
  const steps = edited ?? recipe.data?.steps ?? null;
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tableOpen, setTableOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setRecipe = (r: Recipe) => {
    qc.setQueryData(['prep', 'recipe', id], r);
    qc.invalidateQueries({ queryKey: ['prep', 'recipes'] });
  };

  const changeSteps = (next: PrepStep[]) => {
    setSteps(next);
    setSaving('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        setRecipe(await updateRecipe(id, { steps: next }));
        setSaving('saved');
      } catch (err) {
        setSaving('error');
        message.error(formatError(err));
      }
    }, AUTOSAVE_MS);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const rename = async (name: string) => {
    if (!name.trim() || name === recipe.data?.name) return;
    try {
      setRecipe(await updateRecipe(id, { name: name.trim() }));
    } catch (err) {
      message.error(formatError(err));
    }
  };

  const impact = useQuery({
    queryKey: ['prep', 'impact', id, JSON.stringify(steps)],
    queryFn: () => getRecipeImpact(id),
    enabled: publishOpen,
  });
  const breaking = Boolean(impact.data && (impact.data.removed.length || impact.data.retyped.length));
  const contracts = impact.data?.contracts ?? [];
  const blocked = contracts.some((c) => c.on_breach === 'block');
  const dependents = impact.data
    ? [...impact.data.pipelines.map((p) => t('impact_pipeline', { name: p })),
       ...(impact.data.saved_table ? [t('impact_table', { name: impact.data.saved_table })] : []),
       ...impact.data.metrics.map((m) => t('impact_metric', { name: m }))]
    : [];

  const versions = useQuery({
    queryKey: ['prep', 'versions', id],
    queryFn: () => listRecipeVersions(id),
    enabled: historyOpen,
  });

  const publish = useMutation({
    mutationFn: () => publishRecipe(id, note),
    onSuccess: (r) => {
      setRecipe(r);
      setPublishOpen(false);
      setNote('');
      message.success(t('published_toast', { version: r.version }));
    },
    onError: (err) => message.error(formatError(err)),
  });

  const restore = useMutation({
    mutationFn: (version: number) => restoreRecipeVersion(id, version),
    onSuccess: (r) => {
      setRecipe(r);
      setSteps(r.steps);
      setHistoryOpen(false);
      message.success(t('restored_toast'));
    },
    onError: (err) => message.error(formatError(err)),
  });

  const saveTable = useMutation({
    mutationFn: () => saveRecipeAsTable(id, tableName || undefined),
    onSuccess: (res) => {
      setTableOpen(false);
      qc.invalidateQueries({ queryKey: ['prep', 'recipe', id] });
      Modal.success({
        title: t('saved_table_title', { name: res.name }),
        content: res.truncated
          ? t('saved_table_truncated', { rows: res.rows })
          : t('saved_table_body', { rows: res.rows, columns: res.columns }),
        okText: t('open_connection'),
        onOk: () => router.push(`/data/sources/${res.data_source_id}`),
      });
    },
    onError: (err) => message.error(formatError(err)),
  });

  if (recipe.isLoading || !recipe.data || steps === null) {
    return (
      <DashboardPageShell>
        {recipe.isError ? <Text type="danger">{formatError(recipe.error)}</Text> : <DashboardPageLoading />}
      </DashboardPageShell>
    );
  }

  const r = recipe.data;
  const statusTag =
    r.status === 'published' ? (
      <Tag color="success">{t('status_published', { version: r.version })}</Tag>
    ) : (
      <Tag>{r.version ? t('status_draft_changes', { version: r.version }) : t('status_draft')}</Tag>
    );

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        icon={<Button type="text" icon={<ArrowLeftOutlined />} aria-label={t('back')} onClick={() => router.push('/prepare')} />}
        title={
          <Space size={8} wrap>
            <Typography.Text strong style={{ fontSize: 'inherit' }} editable={{ onChange: rename, triggerType: ['icon', 'text'] }}>
              {r.name}
            </Typography.Text>
            {statusTag}
          </Space>
        }
        description={
          <Space size={8}>
            <span>{t('editor_description')}</span>
            <Text type="secondary">
              {saving === 'saving' ? t('saving') : saving === 'saved' ? t('saved') : saving === 'error' ? t('save_failed') : ''}
            </Text>
          </Space>
        }
        extra={
          <Space wrap>
            {/* One primary action (Publish); the rest are icons named on hover. */}
            <Tooltip title={t('history')}>
              <Button icon={<HistoryOutlined />} aria-label={t('history')} onClick={() => setHistoryOpen(true)} />
            </Tooltip>
            <Tooltip title={t('save_as_table')}>
              <Button icon={<TableOutlined />} aria-label={t('save_as_table')} onClick={() => { setTableName(`${r.name} (prepared)`); setTableOpen(true); }} />
            </Tooltip>
            {r.output?.data_source_id ? (
              // The saved result, handed on: open it, or start a model or an AI decision on it.
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'open', label: t('use_open_table'), onClick: () => router.push(`/data/sources/${r.output!.data_source_id}`) },
                    ...(isEnterpriseEdition()
                      ? [
                          { key: 'predict', icon: <ExperimentOutlined />, label: t('use_predict'), onClick: () => router.push(`/models?new=1&source=${encodeURIComponent(r.output!.data_source_id!)}`) },
                          { key: 'decide', icon: <ThunderboltOutlined />, label: t('use_decide'), onClick: () => router.push(`/ai-decisions?new=1&source=${encodeURIComponent(r.output!.data_source_id!)}`) },
                        ]
                      : []),
                  ],
                }}
              >
                <Tooltip title={t('use_result')}>
                  <Button icon={<ExportOutlined />} aria-label={t('use_result')} />
                </Tooltip>
              </Dropdown>
            ) : null}
            <Button type="primary" icon={<SaveOutlined />} onClick={() => setPublishOpen(true)} disabled={r.status === 'published'}>
              {t('publish')}
            </Button>
            {r.is_owner ? (
              <Dropdown
                trigger={['click']}
                menu={{ items: (actions.menu(r) ?? []).filter((item) => item && item.key !== 'rename') }}
              >
                <Button icon={<MoreOutlined />} aria-label={t('more_actions')} />
              </Dropdown>
            ) : null}
          </Space>
        }
      />

      <RecipeEditor
        dataSourceId={r.data_source_id}
        table={r.table}
        projectId={r.project_id}
        steps={steps}
        onChange={changeSteps}
        columnMeta={r.column_meta}
        outputDataSourceId={r.output?.data_source_id}
        onColumnMetaChange={r.is_owner ? async (meta) => setRecipe(await updateRecipe(id, { column_meta: meta })) : undefined}
      />

      <Modal
        open={publishOpen}
        title={t('publish_title', { version: r.version + 1 })}
        onCancel={() => setPublishOpen(false)}
        onOk={() => publish.mutate()}
        okText={t('publish')}
        okButtonProps={{ disabled: blocked }}
        confirmLoading={publish.isPending}
      >
        <Text type="secondary">{t('publish_hint')}</Text>
        {contracts.length ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message={blocked ? t('contract_blocked') : t('contract_warning')}
            description={contracts
              .map((c) => t('contract_line', { table: c.table ?? t('this_table'), columns: c.breaches.map((b) => b.column).filter(Boolean).join(', ') }))
              .join(' ')}
          />
        ) : null}
        {breaking ? (
          <Alert
            type={dependents.length ? 'warning' : 'info'}
            showIcon
            style={{ marginTop: 8 }}
            message={t('impact_title', {
              removed: impact.data!.removed.length,
              retyped: impact.data!.retyped.length,
            })}
            description={
              <Space direction="vertical" size={2}>
                <Text>
                  {[...impact.data!.removed, ...impact.data!.retyped.map((r) => `${r.column} (${r.from} → ${r.to})`)].join(', ')}
                </Text>
                {dependents.length ? <Text>{t('impact_used_by', { list: dependents.join(', ') })}</Text> : null}
              </Space>
            }
          />
        ) : null}
        <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('publish_note')} rows={3} maxLength={1000} style={{ marginTop: 8 }} />
      </Modal>

      <Modal
        open={tableOpen}
        title={t('save_as_table')}
        onCancel={() => setTableOpen(false)}
        onOk={() => saveTable.mutate()}
        okText={t('save_as_table')}
        confirmLoading={saveTable.isPending}
      >
        <Text type="secondary">{t('save_as_table_hint')}</Text>
        <Input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={200} style={{ marginTop: 8 }} aria-label={t('field_name')} />
      </Modal>

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('history')} width={460}>
        <List
          loading={versions.isLoading}
          locale={{ emptyText: t('no_versions') }}
          dataSource={versions.data ?? []}
          renderItem={(v) => (
            <List.Item
              actions={[
                <Button key="restore" size="small" loading={restore.isPending && restore.variables === v.version} onClick={() => restore.mutate(v.version)}>
                  {t('restore')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={t('version_label', { version: v.version })}
                description={
                  <Space direction="vertical" size={2}>
                    {v.note ? <Text>{v.note}</Text> : null}
                    <Text type="secondary">
                      {t('version_meta', { steps: v.steps.length, date: v.created_at ? new Date(v.created_at).toLocaleString() : '' })}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {v.steps.slice(0, 4).map((s) => describeStep(s, (k) => k)).join(' → ')}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>
    </DashboardPageShell>
  );
}
