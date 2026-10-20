'use client';

import React, { useState, useEffect } from 'react';
import nextDynamic from 'next/dynamic';
import { DEFAULT_QUERY_LIMIT } from '@/config/queryLimits';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import LoadingScreen from '@/components/LoadingScreen/LoadingScreen';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { Typography, Space, Button, Tag, Popover, Tooltip, message } from 'antd';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { NarrowViewportNotice } from '@/components/layout/NarrowViewportNotice';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/constants/permissions';
import {
  QuestionCircleOutlined,
  MessageOutlined,
  BulbOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  CodeOutlined,
  ShareAltOutlined,
  EyeOutlined,
  NumberOutlined,
  SearchOutlined,
  BarChartOutlined,
  SortAscendingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import {
  dispatchQueryEditorImport,
  peekQueryEditorImport,
} from '@/utils/queryEditorBridge';
import { useProjectStore } from '@/stores/useProjectStore';
import { useDataSources } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';

/* Lazy load Monaco editor for faster initial page load */
function EditorLoadingPlaceholder() {
  const t = useTranslations('query_editor');
  return (
    <div style={{ flex: 1, minHeight: 400, display: 'flex' }}>
      <AppLoadingIndicator variant="inline" tip={t('loading_editor')} slowAfterMs={8000} />
    </div>
  );
}

const MonacoSQLEditor = nextDynamic(
  () => import('../../../components/data/SQLEditor/MonacoSQLEditor').then((m) => m.default),
  {
    ssr: false,
    loading: () => <EditorLoadingPlaceholder />,
  }
);

const AnimatedAIAvatar = nextDynamic(
  () => import('@/ee').then((m) => ({ default: m.AnimatedAIAvatar })),
  { ssr: false }
);

export const dynamic = 'force-dynamic';

const { Title, Text } = Typography;

// Function to generate query templates based on available data source
const generateQueryTemplates = (
  t: (key: string, values?: Record<string, string | number>) => string,
  tableName?: string,
  schemaName?: string
): Array<{
  name: string;
  description: string;
  sql: string;
  icon: React.ReactNode;
}> => {
  // CRITICAL: For file sources, always use 'data' as table name
  const isFileSource = schemaName === 'file';
  const actualTableName = isFileSource ? 'data' : (tableName || 'your_table');
  const schemaPrefix = schemaName && schemaName !== 'public' && schemaName !== 'main' && !isFileSource
    ? `${schemaName}.` 
    : '';
  const fullTableName = isFileSource ? `"${actualTableName}"` : `${schemaPrefix}${actualTableName}`;
  
  return [
    {
      name: t('tpl_view_all'),
      description: tableName ? t('tpl_view_all_desc_table', { table: actualTableName }) : t('tpl_view_all_desc'),
      sql: `SELECT * FROM ${fullTableName} LIMIT ${DEFAULT_QUERY_LIMIT};`,
      icon: <EyeOutlined />
    },
    {
      name: t('tpl_count'),
      description: tableName ? t('tpl_count_desc_table', { table: actualTableName }) : t('tpl_count_desc'),
      sql: `SELECT COUNT(*) as total_records FROM ${fullTableName};`,
      icon: <NumberOutlined />
    },
    {
      name: t('tpl_find'),
      description: tableName ? t('tpl_find_desc_table', { table: actualTableName }) : t('tpl_find_desc'),
      sql: `SELECT * FROM ${fullTableName} WHERE column_name = 'value' LIMIT ${DEFAULT_QUERY_LIMIT};`,
      icon: <SearchOutlined />
    },
    {
      name: t('tpl_group'),
      description: tableName ? t('tpl_group_desc_table', { table: actualTableName }) : t('tpl_group_desc'),
      sql: `SELECT category, SUM(amount) as total FROM ${fullTableName} GROUP BY category;`,
      icon: <BarChartOutlined />
    },
    {
      name: t('tpl_sort'),
      description: tableName ? t('tpl_sort_desc_table', { table: actualTableName }) : t('tpl_sort_desc'),
      sql: `SELECT * FROM ${fullTableName} ORDER BY date_column DESC LIMIT ${DEFAULT_QUERY_LIMIT};`,
      icon: <SortAscendingOutlined />
    },
    {
      name: t('tpl_join'),
      description: t('tpl_join_desc'),
      sql: isFileSource
        ? `-- File sources use "data" table\n-- For joins, you may need to load multiple files\nSELECT * FROM ${fullTableName} LIMIT ${DEFAULT_QUERY_LIMIT};`
        : (tableName
          ? `SELECT a.*, b.name FROM ${fullTableName} a JOIN ${schemaPrefix}other_table b ON a.id = b.id LIMIT ${DEFAULT_QUERY_LIMIT};`
          : `SELECT a.*, b.name FROM table_a a JOIN table_b b ON a.id = b.id LIMIT ${DEFAULT_QUERY_LIMIT};`),
      icon: <LinkOutlined />
    },
    ...(isFileSource ? [] : [
      {
        name: t('tpl_procedure'),
        description: t('tpl_procedure_desc'),
        sql: `-- Turn on "Routines (write)" in the toolbar, then run.\nCREATE OR REPLACE PROCEDURE ${schemaPrefix || ''}refresh_example()\nLANGUAGE sql\nAS $$\n  -- your logic\n  SELECT 1;\n$$;`,
        icon: <CodeOutlined />
      },
      {
        name: t('tpl_trigger'),
        description: t('tpl_trigger_desc'),
        sql: `-- Turn on "Routines (write)" in the toolbar, then run.\nCREATE OR REPLACE FUNCTION ${schemaPrefix || ''}audit_row()\nRETURNS trigger AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER example_audit\nAFTER INSERT ON ${fullTableName}\nFOR EACH ROW EXECUTE PROCEDURE ${schemaPrefix || ''}audit_row();`,
        icon: <CodeOutlined />
      },
    ]),
  ];
};

export default function QueryEditorPage() {
  const t = useTranslations('query_editor');
  const tCommon = useTranslations('common');
  const { isAuthenticated, authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedQueryId = searchParams?.get('queryId') || '';
  const importFromChat = searchParams?.get('import') === '1';
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id != null ? String(currentProject.id) : undefined;
  const organizationId =
    currentProject?.organization_id ||
    (currentProject as { organizationId?: string } | null)?.organizationId ||
    undefined;
  const { isDarkMode } = useThemeMode();
  const { dataSources } = useDataSources();
  const selectedDataSourceId = useDataSourceStore((s) => s.selectedId);
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedTableName, setSelectedTableName] = useState<string | undefined>();
  const [selectedSchemaName, setSelectedSchemaName] = useState<string | undefined>();

  useEffect(() => {
    if (!importFromChat) return;
    const payload = peekQueryEditorImport();
    if (!payload) return;
    const timer = window.setTimeout(() => dispatchQueryEditorImport(payload), 250);
    return () => window.clearTimeout(timer);
  }, [importFromChat]);

  // Listen for table selection from MonacoSQLEditor
  useEffect(() => {
    const handleTableSelect = (event: CustomEvent) => {
      if (event.detail?.tableName) {
        setSelectedTableName(event.detail.tableName);
        setSelectedSchemaName(event.detail.schemaName);
      }
    };

    window.addEventListener('table-selected', handleTableSelect as EventListener);
    return () => {
      window.removeEventListener('table-selected', handleTableSelect as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);


  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoadingScreen />;
  }

  return (
    <PermissionGuard
      permission={Permission.QUERY_EXECUTE}
      loadingFallback={<AppLoadingIndicator variant="inline" tip={t('loading_editor')} slowAfterMs={8000} />}
      fallback={
        <AccessDenied
          title={t('no_query_permission')}
          description={t('no_query_permission_desc')}
          secondaryAction={{ label: t('open_data_sources'), href: '/data' }}
        />
      }
    >
    <DashboardPageShell fillHeight className="query-editor-page page-wrapper--full-bleed">
        <DashboardPageHeader
          sticky
          icon={<CodeOutlined />}
          title={t('title')}
          extra={
            <Space size={8} wrap className="qe-page-actions">
                  {/* Once at least one data source exists, the Sources panel's own "+"
                      already covers this — a second, equally-prominent button here was
                      just competing for attention. */}
                  {dataSources.length === 0 && (
                    <Button
                      type="primary"
                      icon={<DatabaseOutlined />}
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('query-editor-open-connect-data'));
                      }}
                    >
                      {t('add_data_source')}
                    </Button>
                  )}

                  {isEnterpriseEdition() && (
                    <Tooltip title={t('ask_ai_engine')}>
                      <Button
                        icon={<MessageOutlined />}
                        aria-label={t('ask_ai_engine')}
                        onClick={() => router.push(getChatHref({ data_source_id: selectedDataSourceId }))}
                      />
                    </Tooltip>
                  )}

                  {savedQueryId ? (
                    <Tooltip title={t('publish_to_feed')}>
                      <Button icon={<ShareAltOutlined />} aria-label={t('publish_to_feed')} onClick={() => setPublishOpen(true)} />
                    </Tooltip>
                  ) : null}

                  <Popover
                    content={
                      <div style={{ width: '320px' }}>
                        <div style={{ 
                          fontWeight: 600, 
                          marginBottom: '12px',
                          color: 'var(--ant-color-text)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <BulbOutlined style={{ color: 'var(--ant-color-primary)' }} />
                          {t('query_templates')}
                          {selectedTableName && (
                            <Tag 
                              color="blue" 
                              style={{ 
                                marginLeft: '4px', 
                                fontSize: '10px',
                                height: '20px',
                                lineHeight: '18px',
                                padding: '0 6px'
                              }}
                            >
                              {selectedTableName}
                            </Tag>
                          )}
                        </div>
                        <div className="data-content" style={{ 
                          maxHeight: '300px', 
                          overflowY: 'auto',
                          padding: '4px 0'
                        }}>
                          {generateQueryTemplates(t, selectedTableName, selectedSchemaName).map((template, index) => (
                            <div
                              key={index}
                              onClick={(e) => {
                                e.stopPropagation();
                                const event = new CustomEvent('load-query-template', { 
                                  detail: { sql: template.sql } 
                                });
                                window.dispatchEvent(event);
                                message.success(t('template_loaded', { name: template.name }));
                              }}
                              style={{
                                padding: '12px',
                                margin: '6px 0',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                background: 'var(--ant-color-fill-quaternary)',
                                border: '1px solid var(--ant-color-border-secondary)',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'var(--ant-color-primary-bg)';
                                e.currentTarget.style.borderColor = 'var(--ant-color-primary)';
                                e.currentTarget.style.transform = 'translateX(2px)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--ant-color-fill-quaternary)';
                                e.currentTarget.style.borderColor = 'var(--ant-color-border-secondary)';
                                e.currentTarget.style.transform = 'translateX(0)';
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '18px', lineHeight: 1, color: 'var(--ant-color-primary)', flexShrink: 0 }}>{template.icon}</span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ 
                                    fontWeight: 600, 
                                    fontSize: '14px',
                                    color: 'var(--ant-color-text)',
                                    marginBottom: '4px'
                                  }}>
                                    {template.name}
                                  </div>
                                  <div style={{ 
                                    fontSize: '12px', 
                                    color: 'var(--ant-color-text-secondary)',
                                    lineHeight: '1.5'
                                  }}>
                                    {template.description}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    }
                    title={null}
                    trigger="click"
                    placement="bottomRight"
                    overlayStyle={{ maxWidth: '360px' }}
                  >
                    <Button icon={<BulbOutlined />} aria-label={t('query_templates')} title={t('query_templates')} />
                  </Popover>
            </Space>
          }
        />

        <NarrowViewportNotice message={tCommon('desktop_recommended')} storageKey="query-editor" breakpoint={576} />


        <div
          className="page-body"
          style={{ 
            '--page-body-gap': '0px',
            flex: 1,
            minHeight: 0,
            maxHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--ant-color-bg-layout)',
            marginTop: 0,
            paddingTop: 0,
            position: 'relative',
            zIndex: 1
          } as React.CSSProperties}
        >
            {/* Query Editor - Maximized Space */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                maxHeight: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                padding: 0,
                margin: 0,
                background: 'var(--ant-color-bg-layout)',
                border: 'none',
                width: '100%',
                boxSizing: 'border-box'
              }}
            >
                <div className="query-editor-workspace" style={{ 
                  flex: 1, 
                  minHeight: 0, 
                  maxHeight: '100%', 
                  height: '100%', 
                  display: 'flex', 
                  width: '100%',
                  margin: 0,
                  padding: 0,
                  overflow: 'hidden',
                  boxSizing: 'border-box'
                }}>
                  <MonacoSQLEditor isDarkMode={isDarkMode} defaultSidebarOpen />
                </div>
            </div>
        </div>
      {savedQueryId && (
        <PublishToFeedModal
          open={publishOpen}
          assetType="query"
          sourceQueryId={savedQueryId}
          defaultTitle={t('saved_query_title')}
          projectId={projectId}
          organizationId={organizationId}
          onCancel={() => setPublishOpen(false)}
        />
      )}
    </DashboardPageShell>
    </PermissionGuard>
  );
}
