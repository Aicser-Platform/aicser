'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState, useEffect } from 'react';
import {
  Card,
  Button,
  Table,
  Space,
  Tag,
  Modal,
  message,
  Typography,
  Tabs,
  Empty,
  Tooltip,
  Form,
  Input,
  Select,
  Alert,
  Segmented,
} from 'antd';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import {
  DeleteOutlined,
  ReloadOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  UploadOutlined,
  MessageOutlined,
  PlusOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { getChatHref } from '@/utils/appPaths';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { KnowledgeCitationDrawer } from '@/components/knowledge/KnowledgeCitationDrawer';
import { KnowledgeSearchPanel } from '@/components/knowledge/KnowledgeSearchPanel';
import { TableRowsSkeleton } from '@/components/ui/TableRowsSkeleton';
import {
  useKnowledgeDocuments,
  useDeleteKnowledgeDocument,
  useUpdateKnowledgeDocument,
  useUploadKnowledgeDocument,
  useReindexKnowledgeBase,
} from '@/hooks/useKnowledge';
import {
  useKnowledgeLibraries,
  useCreateKnowledgeLibrary,
  useDeleteKnowledgeLibrary,
  useUpdateKnowledgeLibrary,
  useBackfillKnowledgeLibraries,
} from '@/hooks/useKnowledgeLibraries';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { Permission, usePermissions } from '@/hooks/usePermissions';
import type { KnowledgeDocument, KnowledgeLibrary } from '@/api/knowledge';

const { Text } = Typography;

// External connector sync (SharePoint/Confluence) — lives here, not in the chat
// data-source panel, since it's a per-library management action like upload/
// reindex, not something you'd reach for mid-conversation.
const ConnectorSyncPanel: React.FC<{ dataSourceId: string | null; canManage: boolean }> = ({
  dataSourceId,
  canManage,
}) => {
  const t = useTranslations('knowledge');
  const authenticatedFetch = useAuthenticatedFetch();
  const [syncLoading, setSyncLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectorType, setConnectorType] = useState<'sharepoint' | 'confluence'>('sharepoint');
  const [siteId, setSiteId] = useState('');
  const [spaceKey, setSpaceKey] = useState('');
  const [configured, setConfigured] = useState<{ sharepoint: boolean; confluence: boolean }>({
    sharepoint: false,
    confluence: false,
  });

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    void authenticatedFetch('/knowledge/connectors/status')
      .then((data: { sharepoint?: { configured?: boolean }; confluence?: { configured?: boolean } }) => {
        if (cancelled) return;
        setConfigured({
          sharepoint: Boolean(data?.sharepoint?.configured),
          confluence: Boolean(data?.confluence?.configured),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setConfigured({ sharepoint: false, confluence: false });
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedFetch]);

  if (!dataSourceId) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('documents_need_library')} />;
  }

  const ready = connectorType === 'sharepoint' ? configured.sharepoint : configured.confluence;
  const canSync =
    canManage &&
    ready &&
    (connectorType === 'sharepoint' ? Boolean(siteId.trim()) : Boolean(spaceKey.trim()));

  const syncExternal = async () => {
    if (!canSync) return;
    setSyncLoading(true);
    try {
      const data = await authenticatedFetch('/knowledge/connectors/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector_type: connectorType,
          data_source_id: dataSourceId,
          site_id: connectorType === 'sharepoint' ? siteId.trim() : undefined,
          space_key: connectorType === 'confluence' ? spaceKey.trim() : undefined,
          limit: 10,
        }),
      });
      const count = typeof data?.ingested_count === 'number' ? data.ingested_count : undefined;
      message.success(
        count != null ? t('connector_sync_done', { count }) : t('connector_sync_started')
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('connector_sync_failed'));
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        {t('connector_sync_title')}
      </Text>
      {!canManage ? (
        <Alert type="info" showIcon message={t('access_denied_desc')} />
      ) : (
        <Space orientation="vertical" style={{ width: '100%' }} size={8}>
          <Select
            value={connectorType}
            onChange={setConnectorType}
            style={{ width: '100%' }}
            options={[
              {
                value: 'sharepoint',
                label: configured.sharepoint
                  ? t('connector_sharepoint_ready')
                  : t('connector_sharepoint_not_ready'),
              },
              {
                value: 'confluence',
                label: configured.confluence
                  ? t('connector_confluence_ready')
                  : t('connector_confluence_not_ready'),
              },
            ]}
            loading={statusLoading}
          />
          {!statusLoading && !ready ? (
            <Alert type="warning" showIcon message={t('connector_not_configured')} />
          ) : null}
          {connectorType === 'sharepoint' ? (
            <Input
              placeholder={t('sharepoint_site_placeholder')}
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={!ready}
            />
          ) : (
            <Input
              placeholder={t('confluence_space_placeholder')}
              value={spaceKey}
              onChange={(e) => setSpaceKey(e.target.value)}
              disabled={!ready}
            />
          )}
          <Button type="primary" loading={syncLoading} disabled={!canSync} onClick={() => void syncExternal()}>
            {t('sync_now')}
          </Button>
        </Space>
      )}
    </div>
  );
};

const KnowledgePageContent: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = useOrganizationStore((s) => s.currentOrganization?.id);
  const projectId = useProjectStore((s) => s.currentProject?.id);
  const orgIdStr = orgId != null ? String(orgId) : undefined;
  const projectIdStr = projectId != null ? String(projectId) : undefined;

  const { libraries, isLoading: libsLoading, refetch: refetchLibs } = useKnowledgeLibraries(
    orgIdStr,
    projectIdStr,
  );
  const createLibrary = useCreateKnowledgeLibrary();
  const deleteLibrary = useDeleteKnowledgeLibrary();
  const backfillLibraries = useBackfillKnowledgeLibraries();

  // One-time migration: knowledge_base data sources created before the Library
  // concept existed (e.g. via direct upload elsewhere) have no KnowledgeLibrary
  // row, so they never appear here even though their documents are real and
  // queryable — this page would look empty/broken despite working data existing.
  // Runs once per org per page load; idempotent server-side (skips sources that
  // already have a library), so a stale-closure re-run just no-ops.
  const backfillAttempted = React.useRef<string | null>(null);
  useEffect(() => {
    if (!orgIdStr || libsLoading || libraries.length > 0) return;
    if (backfillAttempted.current === orgIdStr) return;
    backfillAttempted.current = orgIdStr;
    backfillLibraries.mutate(orgIdStr, {
      onSuccess: (result) => {
        if (result.created > 0) void refetchLibs();
      },
    });
  }, [orgIdStr, libsLoading, libraries.length, backfillLibraries, refetchLibs]);

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('libraries');
  const [advancedSubTab, setAdvancedSubTab] = useState<'connectors' | 'retrieval'>('connectors');
  const [citationDrawerOpen, setCitationDrawerOpen] = useState(false);
  const [highlightDocumentId, setHighlightDocumentId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const citationDocumentId = searchParams?.get('document_id');
  const citationChunkId = searchParams?.get('chunk_id');
  const citationExcerpt = searchParams?.get('excerpt');
  const citationSource = searchParams?.get('source');
  const citationPages = searchParams?.get('pages');
  const urlTab = searchParams?.get('tab');
  const fromCitation = searchParams?.get('from') === 'citation';

  const activeLibrary = useMemo(() => {
    const fromUrl = searchParams?.get('library_id');
    if (fromUrl && libraries.some((l) => l.id === fromUrl)) return fromUrl;
    const fromDs = searchParams?.get('data_source_id');
    if (fromDs) {
      const match = libraries.find((l) => l.data_source_id === fromDs);
      if (match) return match.id;
    }
    return selectedLibraryId ?? libraries[0]?.id ?? null;
  }, [searchParams, libraries, selectedLibraryId]);

  useEffect(() => {
    if (activeLibrary) setSelectedLibraryId(activeLibrary);
  }, [activeLibrary]);

  useEffect(() => {
    if (!urlTab) return;
    if (urlTab === 'search' || urlTab === 'retrieval') {
      setActiveTab('advanced');
      setAdvancedSubTab('retrieval');
      return;
    }
    if (urlTab === 'connectors') {
      setActiveTab('advanced');
      setAdvancedSubTab('connectors');
      return;
    }
    if (urlTab === 'advanced') {
      setActiveTab('advanced');
      return;
    }
    if (['libraries', 'documents'].includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  useEffect(() => {
    if (!fromCitation || !citationDocumentId) return;
    setHighlightDocumentId(citationDocumentId);
    setCitationDrawerOpen(true);
    if (urlTab === 'documents') setActiveTab('documents');
  }, [fromCitation, citationDocumentId, urlTab]);

  const library = libraries.find((l) => l.id === activeLibrary) ?? null;
  const activeDataSourceId = library?.data_source_id ?? null;

  const { documents, isLoading: docsLoading, refetch } = useKnowledgeDocuments(
    activeDataSourceId ?? undefined,
  );
  const { mutateAsync: deleteDocument, isPending: deleting } = useDeleteKnowledgeDocument();
  const { mutateAsync: updateDocument, isPending: renamingDoc } = useUpdateKnowledgeDocument();
  const updateLibrary = useUpdateKnowledgeLibrary();
  const uploadDoc = useUploadKnowledgeDocument();
  const reindexKb = useReindexKnowledgeBase();

  useEffect(() => {
    if (!highlightDocumentId || docsLoading) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`knowledge-doc-${highlightDocumentId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [highlightDocumentId, docsLoading, documents.length]);

  const openAiSearch = (libraryId?: string | null) => {
    router.push(
      libraryId
        ? getChatHref({ mode: 'ai_search', library_id: libraryId })
        : getChatHref({ mode: 'ai_search' }),
    );
  };

  const triggerUpload = () => {
    if (!activeDataSourceId || !canManage) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.txt,.md,.docx,.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !activeDataSourceId) return;
      try {
        await uploadDoc.mutateAsync({
          file,
          dataSourceId: activeDataSourceId,
        });
        message.success(t('upload_success'));
        void refetch();
        void refetchLibs();
      } catch (err) {
        message.error(formatApiValidationError(err));
      }
    };
    input.click();
  };

  const scopeTag = (lib: KnowledgeLibrary) =>
    lib.scope === 'project' ? (
      <Tag bordered className="page-table-tag" color="blue">
        {t('scope_project')}
      </Tag>
    ) : (
      <Tag bordered className="page-table-tag" color="purple">
        {t('scope_company')}
      </Tag>
    );

  const handleDeleteLibrary = (lib: KnowledgeLibrary) => {
    Modal.confirm({
      title: t('delete_library_confirm'),
      content: lib.name,
      okType: 'danger',
      onOk: async () => {
        await deleteLibrary.mutateAsync(lib.id);
        message.success(t('library_deleted'));
        if (selectedLibraryId === lib.id) setSelectedLibraryId(null);
        void refetchLibs();
      },
    });
  };

  const handleDeleteDoc = (doc: KnowledgeDocument) => {
    Modal.confirm({
      title: t('delete_confirm_title'),
      content: t('delete_confirm_content', { name: doc.filename }),
      okType: 'danger',
      onOk: async () => {
        await deleteDocument(doc.id);
        message.success(t('deleted_success'));
        void refetch();
        void refetchLibs();
      },
    });
  };

  const handleRenameDoc = (doc: KnowledgeDocument) => {
    let nextName = doc.filename;
    Modal.confirm({
      title: t('rename_document'),
      content: (
        <Input
          defaultValue={doc.filename}
          onChange={(e) => {
            nextName = e.target.value;
          }}
          maxLength={512}
        />
      ),
      okText: t('save'),
      onOk: async () => {
        const name = nextName.trim();
        if (!name || name === doc.filename) return;
        try {
          await updateDocument({ docId: doc.id, filename: name });
          message.success(t('renamed_success'));
          void refetch();
        } catch (err) {
          message.error(formatApiValidationError(err) || t('rename_failed'));
          throw err;
        }
      },
    });
  };

  const handleRenameLibrary = (lib: KnowledgeLibrary) => {
    let nextName = lib.name;
    Modal.confirm({
      title: t('rename_library'),
      content: (
        <Input
          defaultValue={lib.name}
          onChange={(e) => {
            nextName = e.target.value;
          }}
          maxLength={120}
        />
      ),
      okText: t('save'),
      onOk: async () => {
        const name = nextName.trim();
        if (!name || name === lib.name) return;
        try {
          await updateLibrary.mutateAsync({ libraryId: lib.id, name });
          message.success(t('library_renamed'));
          void refetchLibs();
        } catch (err) {
          message.error(formatApiValidationError(err) || t('rename_failed'));
          throw err;
        }
      },
    });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />;
      case 'failed':
        return <CloseCircleOutlined style={{ color: 'var(--ant-color-error)' }} />;
      case 'processing':
        return <LoadingOutlined />;
      default:
        return null;
    }
  };

  const docColumns = [
    {
      title: t('col_filename'),
      dataIndex: 'filename',
      key: 'filename',
      render: (name: string) => (
        <Space>
          <BookOutlined />
          <Text ellipsis style={{ maxWidth: 280 }}>
            {name}
          </Text>
        </Space>
      ),
    },
    {
      title: t('col_status'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string, record: KnowledgeDocument) => (
        <Tooltip title={record.error_message ?? undefined}>
          <Space>
            {statusIcon(status)}
            <Tag
              bordered
              className="page-table-tag"
              color={status === 'ready' ? 'success' : status === 'failed' ? 'error' : 'processing'}
            >
              {status}
            </Tag>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: t('col_chunks'),
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 90,
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: KnowledgeDocument) =>
        canManage ? (
          <Space>
            <Button
              type="text"
              icon={<EditOutlined />}
              loading={renamingDoc}
              aria-label={t('rename')}
              onClick={() => handleRenameDoc(record)}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
              aria-label={t('delete_confirm_title')}
              onClick={() => handleDeleteDoc(record)}
            />
          </Space>
        ) : null,
    },
  ];

  const libraryColumns = [
    {
      title: t('library_name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row: KnowledgeLibrary) => (
        <Space>
          <BookOutlined />
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => {
              setSelectedLibraryId(row.id);
              setActiveTab('documents');
            }}
          >
            {name}
          </Button>
          {scopeTag(row)}
        </Space>
      ),
    },
    {
      title: t('library_documents'),
      key: 'docs',
      width: 120,
      render: (_: unknown, row: KnowledgeLibrary) =>
        `${row.ready_document_count ?? 0} / ${row.document_count ?? 0}`,
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 220,
      render: (_: unknown, row: KnowledgeLibrary) => (
        <Space wrap>
          <Button size="small" icon={<MessageOutlined />} onClick={() => openAiSearch(row.id)}>
            {t('open_in_chat')}
          </Button>
          {canManage ? (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => handleRenameLibrary(row)}>
                {t('rename')}
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteLibrary(row)}
              />
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  const librarySelectOptions = libraries.map((l) => ({ value: l.id, label: l.name }));
  const retrievalDataSourceOptions = libraries
    .filter((l) => l.data_source_id)
    .map((l) => ({ value: l.data_source_id, label: l.name }));

  const tabItems = [
    {
      key: 'libraries',
      label: t('tab_libraries'),
      children: libsLoading && libraries.length === 0 ? (
        <div style={{ padding: '8px 0' }}>
          <TableRowsSkeleton columns={libraryColumns.length} rows={5} />
        </div>
      ) : (
        <Table
          className="page-data-table"
          rowKey="id"
          columns={libraryColumns}
          dataSource={libraries}
          loading={libsLoading}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space orientation="vertical" size={4}>
                    <Text strong>{t('empty_libraries_title')}</Text>
                    <Text type="secondary">{t('empty_libraries_desc')}</Text>
                  </Space>
                }
              >
                {canManage ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                    {t('create_library')}
                  </Button>
                ) : null}
              </Empty>
            ),
          }}
        />
      ),
    },
    {
      key: 'documents',
      label: t('tab_documents'),
      children: !library ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space orientation="vertical" size={4}>
              <Text strong>{t('documents_need_library')}</Text>
              <Text type="secondary">{t('empty_libraries_desc')}</Text>
            </Space>
          }
        >
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('create_library')}
            </Button>
          ) : null}
        </Empty>
      ) : docsLoading && documents.length === 0 ? (
        <div style={{ padding: '8px 0' }}>
          <TableRowsSkeleton columns={docColumns.length} rows={6} />
        </div>
      ) : (
        <Table
          className="page-data-table"
          rowKey="id"
          columns={docColumns}
          dataSource={documents}
          loading={docsLoading}
          pagination={{ pageSize: 20 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space orientation="vertical" size={4}>
                    <Text strong>{t('empty_documents_title')}</Text>
                    <Text type="secondary">{t('empty_documents_desc')}</Text>
                  </Space>
                }
              >
                {canManage ? (
                  <Button
                    type="primary"
                    icon={<UploadOutlined />}
                    loading={uploadDoc.isPending}
                    onClick={triggerUpload}
                  >
                    {t('upload_document')}
                  </Button>
                ) : null}
              </Empty>
            ),
          }}
          onRow={(record) => ({
            id: `knowledge-doc-${record.id}`,
            style:
              record.id === highlightDocumentId
                ? {
                    background: 'color-mix(in srgb, var(--ant-color-primary) 10%, transparent)',
                  }
                : undefined,
          })}
        />
      ),
    },
    {
      key: 'advanced',
      label: t('tab_advanced'),
      children: (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Segmented
            value={advancedSubTab}
            onChange={(v) => setAdvancedSubTab(v as 'connectors' | 'retrieval')}
            options={[
              { label: t('advanced_connectors'), value: 'connectors' },
              { label: t('advanced_retrieval'), value: 'retrieval' },
            ]}
          />
          {advancedSubTab === 'connectors' ? (
            <ConnectorSyncPanel dataSourceId={activeDataSourceId} canManage={canManage} />
          ) : (
            <div style={{ maxWidth: 880 }}>
              {!library ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('retrieval_empty_library')}
                />
              ) : (
                <KnowledgeSearchPanel
                  dataSourceId={activeDataSourceId}
                  dataSourceOptions={retrievalDataSourceOptions}
                  showDataSourceSelector={retrievalDataSourceOptions.length > 1}
                  onDataSourceChange={(id) => {
                    const match = libraries.find((l) => l.data_source_id === id);
                    if (match) setSelectedLibraryId(match.id);
                  }}
                  showRetrievalHint={false}
                  defaultTopK={8}
                />
              )}
            </div>
          )}
        </Space>
      ),
    },
  ];

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        icon={<BookOutlined />}
        title={t('title_libraries')}
        description={t('subtitle')}
        extra={
          <Space wrap>
            {canManage && library ? (
              <Button
                type="primary"
                icon={<UploadOutlined />}
                loading={uploadDoc.isPending}
                onClick={triggerUpload}
              >
                {t('upload_document')}
              </Button>
            ) : canManage ? (
              <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
                {t('create_library')}
              </Button>
            ) : null}
            <Button icon={<MessageOutlined />} onClick={() => openAiSearch(library?.id)}>
              {t('open_ai_search_mode')}
            </Button>
            {canManage && library ? (
              <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                {t('create_library')}
              </Button>
            ) : null}
          </Space>
        }
      />

      <div className="page-body">
        <Card className="page-section-card content-card">
          {library ? (
            <div className="page-panel-toolbar" style={{ marginBottom: 12 }}>
              <div className="page-panel-toolbar__row">
                <div className="page-panel-toolbar__filters">
                  <Select
                    style={{ minWidth: 200 }}
                    value={library.id}
                    onChange={setSelectedLibraryId}
                    options={librarySelectOptions}
                    placeholder={t('select_library')}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      void refetch();
                      void refetchLibs();
                    }}
                  />
                  {canManage ? (
                    <Button
                      loading={reindexKb.isPending}
                      onClick={async () => {
                        if (!activeDataSourceId) return;
                        try {
                          const result = await reindexKb.mutateAsync(activeDataSourceId);
                          message.success(result.message || t('reindex_started'));
                        } catch (err) {
                          message.error(formatApiValidationError(err));
                        }
                      }}
                    >
                      {t('reindex')}
                    </Button>
                  ) : null}
                </div>
                <Text type="secondary">{t('upload_trust')}</Text>
              </div>
            </div>
          ) : null}
          <Tabs className="page-tabs" activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
        </Card>
      </div>

      <KnowledgeCitationDrawer
        open={citationDrawerOpen}
        onClose={() => {
          setCitationDrawerOpen(false);
          setHighlightDocumentId(null);
          if (fromCitation) {
            router.replace('/knowledge', { scroll: false });
          }
        }}
        documentId={citationDocumentId}
        chunkId={citationChunkId}
        source={citationSource || undefined}
        excerpt={citationExcerpt || undefined}
        pages={citationPages || undefined}
      />

      <Modal
        title={t('create_library')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.submit()}
        confirmLoading={createLibrary.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (!orgIdStr) return;
            try {
              const created = await createLibrary.mutateAsync({
                name: values.name,
                description: values.description,
                organization_id: orgIdStr,
                scope: values.scope,
                project_id: values.scope === 'project' ? projectIdStr : undefined,
              });
              message.success(t('library_created'));
              setCreateOpen(false);
              form.resetFields();
              setSelectedLibraryId(created.id);
              setActiveTab('documents');
              void refetchLibs();
            } catch (err) {
              message.error(formatApiValidationError(err));
            }
          }}
        >
          <Form.Item name="name" label={t('library_name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('library_description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="scope" label={t('library_scope')} initialValue="organization">
            <Select
              options={[
                { value: 'organization', label: t('scope_company') },
                { value: 'project', label: t('scope_project') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardPageShell>
  );
};

const KnowledgePage: React.FC = () => {
  const t = useTranslations('knowledge');
  const { hasPermission, loading } = usePermissions();
  const canAccess =
    hasPermission(Permission.KNOWLEDGE_VIEW) ||
    hasPermission(Permission.KNOWLEDGE_SEARCH) ||
    hasPermission(Permission.KNOWLEDGE_MANAGE_LIBRARIES) ||
    hasPermission(Permission.KNOWLEDGE_EDIT);
  const canManage =
    hasPermission(Permission.KNOWLEDGE_MANAGE_LIBRARIES) ||
    hasPermission(Permission.KNOWLEDGE_EDIT);

  if (!loading && !canAccess) {
    return (
      <AccessDenied
        title={t('access_denied_title')}
        description={t('access_denied_desc')}
        secondaryAction={{ label: t('open_ai_search_mode'), href: getChatHref({ mode: 'ai_search' }) }}
      />
    );
  }

  return <KnowledgePageContent canManage={canManage} />;
};

export default KnowledgePage;
