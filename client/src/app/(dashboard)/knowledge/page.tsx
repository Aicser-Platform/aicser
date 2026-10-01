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
  Collapse,
  Dropdown,
  Empty,
  Tooltip,
  Form,
  Input,
  Select,
  Alert,
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
  RedoOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useTranslations } from 'next-intl';
import './knowledge.css';
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
  useRetryKnowledgeDocument,
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
      ) : !statusLoading && !configured.sharepoint && !configured.confluence ? (
        // Nothing connected: say what's needed and who does it, instead of a disabled form.
        <Alert
          type="info"
          showIcon
          message={t('connectors_none_title')}
          description={t('connectors_none_desc')}
        />
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
  // Folded sections under the documents (occasional tasks), opened by deep links too.
  const [openPanels, setOpenPanels] = useState<string[]>([]);
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
    // Old links (?tab=search / retrieval / advanced / connectors / documents) keep working.
    if (['search', 'retrieval', 'test-search'].includes(urlTab)) setOpenPanels(['test-search']);
    else if (['connectors', 'advanced', 'sync'].includes(urlTab)) setOpenPanels(['sync']);
  }, [urlTab]);

  useEffect(() => {
    if (!fromCitation || !citationDocumentId) return;
    setHighlightDocumentId(citationDocumentId);
    setCitationDrawerOpen(true);
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
  const retryDoc = useRetryKnowledgeDocument();
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);

  const handleRetryDoc = async (doc: KnowledgeDocument) => {
    try {
      setRetryingDocId(doc.id);
      await retryDoc.mutateAsync(doc.id);
      message.success(t('retry_queued'));
      void refetch();
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setRetryingDocId(null);
    }
  };

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
              {t(`doc_status_${['ready', 'failed', 'processing', 'pending', 'queued'].includes(status) ? status : 'processing'}` as never)}
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
      width: 120,
      render: (_: unknown, record: KnowledgeDocument) =>
        canManage ? (
          <Space>
            {record.status !== 'ready' && (
              <Tooltip title={t('retry')}>
                <Button
                  type="text"
                  icon={<RedoOutlined />}
                  loading={retryingDocId === record.id}
                  aria-label={t('retry')}
                  onClick={() => handleRetryDoc(record)}
                />
              </Tooltip>
            )}
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

  const librarySelectOptions = libraries.map((l) => ({ value: l.id, label: l.name }));
  const retrievalDataSourceOptions = libraries
    .filter((l) => l.data_source_id)
    .map((l) => ({ value: l.data_source_id, label: l.name }));

  const documentsView = (
    !library ? (
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
      )
  );

  const libraryMenu: MenuProps['items'] = library
    ? [
        { key: 'rename', icon: <EditOutlined />, label: t('rename'), onClick: () => handleRenameLibrary(library) },
        {
          key: 'reindex',
          icon: <RedoOutlined />,
          label: (
            <Tooltip title={t('reindex_hint')} placement="left">
              <span>{t('reindex')}</span>
            </Tooltip>
          ),
          onClick: async () => {
            if (!activeDataSourceId) return;
            try {
              const result = await reindexKb.mutateAsync(activeDataSourceId);
              message.success(result.message || t('reindex_started'));
            } catch (err) {
              message.error(formatApiValidationError(err));
            }
          },
        },
        { type: 'divider' },
        { key: 'delete', icon: <DeleteOutlined />, danger: true, label: t('delete_library'), onClick: () => handleDeleteLibrary(library) },
      ]
    : [];

  // One screen, master–detail: pick a library on the left; its documents are the main
  // content; checking search and syncing from apps are occasional, so they stay folded
  // until asked for (they replaced four tabs that split one job into four places).
  const libraryList = (
    <div className="kb-library-list" role="listbox" aria-label={t('libraries_heading')}>
      <div className="kb-library-list__head">
        <Text type="secondary" strong>
          {t('libraries_heading')}
        </Text>
        {canManage ? (
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            aria-label={t('create_library')}
            title={t('create_library')}
          />
        ) : null}
      </div>
      {libsLoading && libraries.length === 0 ? (
        <TableRowsSkeleton columns={1} rows={4} />
      ) : (
        libraries.map((lib) => {
          const active = lib.id === library?.id;
          return (
            <button
              type="button"
              key={lib.id}
              role="option"
              aria-selected={active}
              className={`kb-library-item${active ? ' kb-library-item--active' : ''}`}
              onClick={() => {
                setSelectedLibraryId(lib.id);
                setHighlightDocumentId(null);
              }}
            >
              <BookOutlined />
              <span className="kb-library-item__name">{lib.name}</span>
              <span className="kb-library-item__count">{lib.document_count ?? 0}</span>
            </button>
          );
        })
      )}
    </div>
  );

  const libraryDetail = !library ? (
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
  ) : (
    <div className="kb-detail">
      <div className="kb-detail__head">
        <div className="kb-detail__title">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {library.name}
          </Typography.Title>
          {scopeTag(library)}
          <Text type="secondary">
            {t('library_ready_count', {
              ready: library.ready_document_count ?? 0,
              total: library.document_count ?? 0,
            })}
          </Text>
        </div>
        <Space wrap>
          {canManage ? (
            <Button type="primary" icon={<UploadOutlined />} loading={uploadDoc.isPending} onClick={triggerUpload}>
              {t('upload_document')}
            </Button>
          ) : null}
          <Button icon={<MessageOutlined />} onClick={() => openAiSearch(library.id)}>
            {t('ask_about_library')}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            aria-label={t('refresh')}
            title={t('refresh')}
            onClick={() => {
              void refetch();
              void refetchLibs();
            }}
          />
          {canManage ? (
            <Dropdown menu={{ items: libraryMenu }} trigger={['click']}>
              <Button icon={<MoreOutlined />} aria-label={t('more_actions')} title={t('more_actions')} />
            </Dropdown>
          ) : null}
        </Space>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {t('upload_trust')}
      </Text>

      {documentsView}

      <Collapse
        ghost
        className="kb-more"
        activeKey={openPanels}
        onChange={(keys) => setOpenPanels(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
        items={[
          {
            key: 'test-search',
            label: (
              <span>
                <Text strong>{t('tab_test_search')}</Text>
                <Text type="secondary"> · {t('tab_desc_test_search')}</Text>
              </span>
            ),
            children: (
              <KnowledgeSearchPanel
                dataSourceId={activeDataSourceId}
                dataSourceOptions={retrievalDataSourceOptions}
                showDataSourceSelector={false}
                showRetrievalHint={false}
                defaultTopK={8}
              />
            ),
          },
          {
            key: 'sync',
            label: (
              <span>
                <Text strong>{t('tab_sync')}</Text>
                <Text type="secondary"> · {t('tab_desc_sync')}</Text>
              </span>
            ),
            children: <ConnectorSyncPanel dataSourceId={activeDataSourceId} canManage={canManage} />,
          },
        ]}
      />
    </div>
  );

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        icon={<BookOutlined />}
        title={t('title_libraries')}
        description={t('subtitle')}
        extra={
          canManage ? (
            <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('create_library')}
            </Button>
          ) : null
        }
      />

      <div className="page-body">
        <Card className="page-section-card content-card">
          <div className={`kb-layout${libraries.length > 1 ? '' : ' kb-layout--single'}`}>
            {libraries.length > 1 ? (
              <>
                {libraryList}
                <Select
                  className="kb-library-select"
                  value={library?.id}
                  onChange={setSelectedLibraryId}
                  options={librarySelectOptions}
                  aria-label={t('select_library')}
                />
              </>
            ) : null}
            {libraryDetail}
          </div>
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
