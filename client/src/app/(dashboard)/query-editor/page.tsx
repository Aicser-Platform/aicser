'use client';

import React, { useState, useEffect } from 'react';
import nextDynamic from 'next/dynamic';
import { DEFAULT_QUERY_LIMIT } from '@/config/queryLimits';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import LoadingScreen from '@/components/LoadingScreen/LoadingScreen';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { Card, Typography, Alert, Space, Button, Tooltip, Tag, Popover, message, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/constants/permissions';
import {
  QuestionCircleOutlined,
  RocketOutlined,
  BulbOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
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

/* Lazy load Monaco editor for faster initial page load */
function EditorLoadingPlaceholder() {
  const t = useTranslations('query_editor');
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <Spin size="large" tip={t('loading_editor')}>
        <div style={{ minHeight: 80 }} />
      </Spin>
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
    }
  ];
};

export default function QueryEditorPage() {
  const t = useTranslations('query_editor');
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
  const [publishOpen, setPublishOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem('qe_welcome_dismissed') !== 'true';
      } catch {
        return true;
      }
    }
    return true;
  });
  const [editorMode, setEditorMode] = useState<'sql' | 'python'>('sql');
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

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem('qe_welcome_dismissed', 'true');
    } catch {
      // ignore storage errors
    }
  };

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoadingScreen />;
  }

  return (
    <PermissionGuard
      permission={Permission.QUERY_EXECUTE}
      loadingFallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
          <Spin size="large" tip={t('loading_editor')}>
            <div style={{ minHeight: 80 }} />
          </Spin>
        </div>
      }
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
          title={
            <>
              {t('title')}
              {editorMode === 'python' && (
                <Tag color="orange" icon={<CodeOutlined />} style={{ margin: 0, marginLeft: 4 }}>
                  {t('python_mode_tag')}
                </Tag>
              )}
            </>
          }
          extra={
            <Space size={8} wrap className="qe-page-actions">
                  <Button
                    type="primary"
                    size="small"
                    icon={<DatabaseOutlined />}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('query-editor-open-connect-data'));
                    }}
                  >
                    {t('add_data_source')}
                  </Button>

                  {['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()) && (
                    <Button
                      type="default"
                      size="small"
                      icon={<RocketOutlined />}
                      onClick={() => router.push('/chat')}
                    >
                      {t('ask_ai_engine')}
                    </Button>
                  )}

                  {savedQueryId ? (
                    <Button
                      type="default"
                      size="small"
                      icon={<ShareAltOutlined />}
                      onClick={() => setPublishOpen(true)}
                    >
                      {t('publish_to_feed')}
                    </Button>
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
                                background: isDarkMode 
                                  ? 'rgba(255, 255, 255, 0.05)' 
                                  : 'var(--ant-color-fill-quaternary, #f5f5f5)',
                                border: `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'}`,
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = isDarkMode 
                                  ? 'rgba(37, 99, 235, 0.2)' 
                                  : 'var(--ant-color-primary-bg, #e6f4ff)';
                                e.currentTarget.style.borderColor = 'var(--ant-color-primary, #1890ff)';
                                e.currentTarget.style.transform = 'translateX(2px)';
                                e.currentTarget.style.boxShadow = isDarkMode 
                                  ? '0 2px 8px rgba(37, 99, 235, 0.2)' 
                                  : '0 2px 8px rgba(24, 144, 255, 0.15)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = isDarkMode 
                                  ? 'rgba(255, 255, 255, 0.05)' 
                                  : 'var(--ant-color-fill-quaternary, #f5f5f5)';
                                e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)';
                                e.currentTarget.style.transform = 'translateX(0)';
                                e.currentTarget.style.boxShadow = 'none';
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
                    <Button type="default" size="small" icon={<BulbOutlined />}>
                      {t('query_templates')}
                    </Button>
                  </Popover>
            </Space>
          }
        />

        {showWelcome && (
          <div style={{ padding: '8px 12px', margin: 0 }}>
            <Alert
              message={
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--ant-color-text)', lineHeight: '1.6' }}>
                  <InfoCircleOutlined style={{ color: 'var(--ant-color-primary)', fontSize: '18px', flexShrink: 0 }} />
                  <span>{t('welcome_alert')}</span>
                  <Popover
                    title={t('show_tips')}
                    content={
                      <div style={{ maxWidth: 320, whiteSpace: 'pre-line', fontSize: 13, lineHeight: 1.5 }}>
                        {t('welcome_tips')}
                      </div>
                    }
                    trigger="click"
                  >
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }}>
                      {t('show_tips')}
                    </Button>
                  </Popover>
                </div>
              }
              type="info"
              showIcon={false}
              closable
              onClose={handleDismissWelcome}
              style={{ 
                marginTop: 0,
                marginBottom: 0,
                borderRadius: '8px',
                background: isDarkMode 
                  ? 'rgba(24, 144, 255, 0.15)' 
                  : 'var(--ant-color-info-bg, #e6f7ff)',
                border: `1px solid ${isDarkMode ? 'rgba(24, 144, 255, 0.4)' : 'var(--ant-color-info-border, #91d5ff)'}`,
                padding: '14px 18px'
              }}
            />
          </div>
        )}

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
              {editorMode === 'sql' ? (
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
              ) : (
                <Card
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--ant-color-bg-container)',
                    border: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`
                  }}
                  bodyStyle={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '16px',
                    overflow: 'hidden'
                  }}
                >
                  <Alert
                    message={t('python_coming_title')}
                    description={
                      <div>
                        <p style={{ color: 'var(--ant-color-text)', marginBottom: '8px' }}>
                          {t('python_coming_intro')}
                        </p>
                        <ul style={{ 
                          margin: '8px 0', 
                          paddingLeft: '20px',
                          color: 'var(--ant-color-text-secondary)'
                        }}>
                          <li>{t('python_bullet_1')}</li>
                          <li>{t('python_bullet_2')}</li>
                          <li>{t('python_bullet_3')}</li>
                          <li>{t('python_bullet_4')}</li>
                        </ul>
                        <p style={{ marginTop: '12px' }}>
                          <Button 
                            type="link" 
                            onClick={() => setEditorMode('sql')}
                            style={{ padding: 0 }}
                          >
                            {t('switch_to_sql')}
                          </Button>
                        </p>
                      </div>
                    }
                    type="info"
                    showIcon
                    style={{ 
                      marginBottom: '16px',
                      background: isDarkMode 
                        ? 'rgba(24, 144, 255, 0.1)' 
                        : 'var(--ant-color-info-bg)',
                      border: `1px solid ${isDarkMode ? 'rgba(24, 144, 255, 0.3)' : 'var(--ant-color-info-border)'}`
                    }}
                  />
                  <div style={{
                    flex: 1,
                    border: `1px solid ${isDarkMode ? 'var(--ant-color-border, #404040)' : 'var(--ant-color-border-secondary, #e8e8e8)'}`,
                    borderRadius: '8px',
                    padding: '24px',
                    background: isDarkMode 
                      ? 'rgba(255, 255, 255, 0.03)' 
                      : 'var(--ant-color-bg-layout, #f5f5f5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--ant-color-text-secondary)'
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <CodeOutlined style={{ 
                        fontSize: '48px', 
                        marginBottom: '16px', 
                        opacity: isDarkMode ? 0.5 : 0.4,
                        color: isDarkMode ? 'var(--ant-color-text-tertiary, #8c8c8c)' : 'var(--ant-color-text-tertiary, #8c8c8c)'
                      }} />
                      <div style={{ 
                        fontSize: '16px',
                        color: 'var(--ant-color-text)',
                        marginBottom: '4px',
                        fontWeight: 500
                      }}>
                        {t('python_placeholder_title')}
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        marginTop: '8px',
                        color: 'var(--ant-color-text-secondary)'
                      }}>
                        {t('python_placeholder_sub')}
                      </div>
                    </div>
                  </div>
                </Card>
              )}
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
          onSuccess={() => setPublishOpen(false)}
        />
      )}
    </DashboardPageShell>
    </PermissionGuard>
  );
}
