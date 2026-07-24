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
} from 'antd';
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
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { getChatHref } from '@/utils/appPaths';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { usePermissions } from '@/hooks/usePermissions';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { UnifiedAISearchPanel } from '@/components/search/UnifiedAISearchPanel';
import { KnowledgeCitationDrawer } from '@/components/knowledge/KnowledgeCitationDrawer';
import {
  useKnowledgeDocuments,
  useDeleteKnowledgeDocument,
  useUploadKnowledgeDocument,
  useReindexKnowledgeBase,
} from '@/hooks/useKnowledge';
import {
  useKnowledgeLibraries,
  useCreateKnowledgeLibrary,
  useDeleteKnowledgeLibrary,
  useBackfillKnowledgeLibraries,
} from '@/hooks/useKnowledgeLibraries';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { KnowledgeDocument, KnowledgeLibrary } from '@/api/knowledge';

const { Title, Text } = Typography;

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
  const backfill = useBackfillKnowledgeLibraries();

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('libraries');
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
    if (urlTab && ['libraries', 'documents', 'search'].includes(urlTab)) {
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

  const scopeTag = (lib: KnowledgeLibrary) =>
    lib.scope === 'project' ? (
      <Tag bordered className="page-table-tag" color="blue">{t('scope_project')}</Tag>
    ) : (
      <Tag bordered className="page-table-tag" color="purple">{t('scope_company')}</Tag>
    );

  const handleDeleteLibrary = (lib: KnowledgeLibrary) => {
    Modal.confirm({
      title: t('delete_library_confirm'),
      content: lib.name,
      okType: 'danger',
      onOk: async () => {
        await deleteLibrary.mutateAsync(lib.id);
        message.success(t('library_deleted'));
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
      },
    });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failed':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
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
          <Text ellipsis style={{ maxWidth: 280 }}>{name}</Text>
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
            <Tag bordered className="page-table-tag" color={status === 'ready' ? 'success' : status === 'failed' ? 'error' : 'processing'}>
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
      width: 80,
      render: (_: unknown, record: KnowledgeDocument) =>
        canManage ? (
          <Button type="text" danger icon={<DeleteOutlined />} loading={deleting} onClick={() => handleDeleteDoc(record)} />
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
          <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedLibraryId(row.id)}>
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
      width: 160,
      render: (_: unknown, row: KnowledgeLibrary) => (
        <Space>
          <Button
            size="small"
            icon={<MessageOutlined />}
            onClick={() => router.push(getChatHref({ mode: 'ai_search', library_id: row.id }))}
          >
            {t('open_in_chat')}
          </Button>
          {canManage && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteLibrary(row)} />
          )}
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'libraries',
      label: t('tab_libraries'),
      children: (
        <Table
          className="page-data-table"
          rowKey="id"
          columns={libraryColumns}
          dataSource={libraries}
          loading={libsLoading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: t('no_libraries') }}
        />
      ),
    },
    {
      key: 'documents',
      label: t('tab_documents'),
      children: !library ? (
        <Empty description={t('select_library')} />
      ) : (
        <Table
          className="page-data-table"
          rowKey="id"
          columns={docColumns}
          dataSource={documents}
          loading={docsLoading}
          pagination={{ pageSize: 20 }}
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
      key: 'search',
      label: t('tab_search'),
      children: (
        <div style={{ padding: '8px 0' }}>
          <UnifiedAISearchPanel defaultTab="knowledge" defaultLibraryId={selectedLibraryId} />
          <div style={{ marginTop: 24, textAlign: 'center', paddingTop: 16, borderTop: '1px solid var(--ant-color-border-secondary)' }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              {t('search_tab_ai_engine_hint')}
            </Text>
            <Button
              icon={<MessageOutlined />}
              onClick={() =>
                router.push(
                  selectedLibraryId
                    ? getChatHref({ mode: 'ai_search', library_id: selectedLibraryId })
                    : getChatHref({ mode: 'ai_search' }),
                )
              }
            >
              {t('open_ai_search_mode')}
            </Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <DashboardPageShell maxWidth={1400}>
      <DashboardPageHeader
        icon={<BookOutlined />}
        title={t('title_libraries')}
        description={t('subtitle')}
        extra={
          <Space wrap>
            {canManage && (
              <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
                {t('create_library')}
              </Button>
            )}
            {canManage && libraries.length === 0 && orgIdStr ? (
              <Button loading={backfill.isPending} onClick={async () => {
                const res = await backfill.mutateAsync(orgIdStr);
                message.success(t('backfill_created', { count: res.created }));
                void refetchLibs();
              }}>
                {t('import_legacy')}
              </Button>
            ) : null}
            {library ? (
              <>
                <Select
                  style={{ minWidth: 220 }}
                  value={library.id}
                  onChange={setSelectedLibraryId}
                  options={libraries.map((l) => ({ value: l.id, label: l.name }))}
                />
                <Button icon={<ReloadOutlined />} onClick={() => { void refetch(); void refetchLibs(); }} />
                {canManage && (
                <>
                <Button
                  loading={reindexKb.isPending}
                  onClick={async () => {
                    if (!activeDataSourceId) return;
                    const result = await reindexKb.mutateAsync(activeDataSourceId);
                    message.success(result.message || t('reindex_started'));
                  }}
                >
                  {t('reindex')}
                </Button>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  loading={uploadDoc.isPending}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.pdf,.txt,.md,.docx,.csv';
                    input.onchange = async () => {
                      const file = input.files?.[0];
                      if (!file || !activeDataSourceId) return;
                      await uploadDoc.mutateAsync({ file, dataSourceId: activeDataSourceId });
                      message.success(t('upload_success'));
                      void refetch();
                      void refetchLibs();
                    };
                    input.click();
                  }}
                >
                  {t('upload_document')}
                </Button>
                </>
                )}
                <Button
                  icon={<MessageOutlined />}
                  onClick={() => router.push(getChatHref({ mode: 'ai_search', library_id: library.id }))}
                >
                  {t('open_in_chat')}
                </Button>
              </>
            ) : null}
          </Space>
        }
      />

      <div className="page-body">
      <Card className="page-section-card content-card">
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
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (!orgIdStr) return;
            await createLibrary.mutateAsync({
              name: values.name,
              description: values.description,
              organization_id: orgIdStr,
              scope: values.scope,
              project_id: values.scope === 'project' ? projectIdStr : undefined,
            });
            message.success(t('library_created'));
            setCreateOpen(false);
            form.resetFields();
            void refetchLibs();
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
