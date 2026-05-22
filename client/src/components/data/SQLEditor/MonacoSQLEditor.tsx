'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Layout,
  Button,
  Space,
  Typography,
  Select,
  Table,
  Tag,
  Tabs,
  Input,
  Tooltip,
  Progress,
  Dropdown,
  Menu,
  message,
  Card,
  Collapse,
  Badge,
  Divider,
  Alert,
  Modal,
  Form,
  Tree,
  Spin,
  Switch,
  Grid,
} from 'antd';
import { useTranslations } from 'next-intl';
import MemoryOptimizedEditor, { type MemoryOptimizedEditorHandle } from '@/components/ai/MemoryOptimizedEditor';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import LoadingStates, { QueryLoading } from '@/components/ui/LoadingStates';
import {
  PlayCircleOutlined,
  DatabaseOutlined,
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  DownloadOutlined,
  ExpandOutlined,
  CloudOutlined,
  ApiOutlined,
  FileOutlined,
  FileTextOutlined,
  BulbOutlined,
  RocketOutlined,
  BarChartOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  CodeOutlined
} from '@ant-design/icons';
import { enhancedDataService } from '@/services/enhancedDataService';
import { fetchApi } from '@/utils/api';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
const EnhancedDataPanel = dynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.EnhancedDataPanel }))) as any,
  { ssr: false }
) as React.ComponentType<{ onCollapse?: () => void; onTableClick?: (tableName: string, schemaName: string) => void; onColumnClick?: (tableName: string, columnName: string, schemaName: string) => void; compact?: boolean; [key: string]: unknown }>;
const AnimatedAIAvatar = dynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.AnimatedAIAvatar }))) as any,
  { ssr: false }
) as React.ComponentType<{ size?: number; isSpeaking?: boolean; isThinking?: boolean }>;
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { buildSQLCompletionItems, SQL_LANGUAGE_CONFIG } from '../../../utils/sqlCompletion';
import type { SchemaTable } from '../../../utils/sqlCompletion';

const { Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Panel } = Collapse;

// Function to suggest chart types based on query results
const suggestChartTypes = (results: any[]) => {
  if (!results || results.length === 0) return [];

  const firstRow = results[0];
  const columns = Object.keys(firstRow);
  const numericColumns = columns.filter((col) => typeof firstRow[col] === 'number' || !isNaN(Number(firstRow[col])));
  const textColumns = columns.filter((col) => typeof firstRow[col] === 'string' && isNaN(Number(firstRow[col])));

  const suggestions = [];

  if (numericColumns.length >= 2 && textColumns.length >= 1) {
    suggestions.push({ icon: '📊', name: 'Bar Chart' });
    suggestions.push({ icon: '📈', name: 'Line Chart' });
  }

  if (numericColumns.length >= 1 && textColumns.length >= 1) {
    suggestions.push({ icon: '🥧', name: 'Pie Chart' });
    suggestions.push({ icon: '📊', name: 'Column Chart' });
  }

  if (numericColumns.length >= 2) {
    suggestions.push({ icon: '🔍', name: 'Scatter Plot' });
    suggestions.push({ icon: '📊', name: 'Area Chart' });
  }

  if (results.length > 10) {
    suggestions.push({ icon: '📊', name: 'Histogram' });
  }

  return suggestions.length > 0
    ? suggestions
    : [
        { icon: '📊', name: 'Bar Chart' },
        { icon: '📈', name: 'Line Chart' },
        { icon: '🥧', name: 'Pie Chart' },
      ];
};

interface MonacoSQLEditorProps {
  isDarkMode?: boolean;
  onQueryResult?: (result: any) => void;
  onChartCreate?: (chartData: any) => void;
  selectedDataSource?: string;
  onDataSourceChange?: (dataSourceId: string) => void;
  /** When true, the data source panel starts expanded (e.g. on /query-editor). */
  defaultSidebarOpen?: boolean;
}

interface DataSource {
  id: string;
  name: string;
  type: 'file' | 'database' | 'warehouse' | 'api' | 'cube' | 'knowledge_base' | 'sample_duckdb' | 'google_sheets';
  status: 'connected' | 'disconnected' | 'error';
  config: Record<string, any>;
  metadata?: Record<string, any>;
  connection_info?: any;
  lastUsed?: string;
  rowCount?: number;
  columns?: string[];
  size?: string;
  description?: string;
  businessContext?: string;
  db_type?: string;
  schema?: string;
}

interface SchemaInfo {
  database: string;
  schema: string;
  tables: TableInfo[];
  lastRefreshed: string;
}

interface TableInfo {
  name: string;
  fields: FieldInfo[];
  rowCount?: number;
  size?: string;
  description?: string;
  lastModified?: string;
  schema?: string; // optional schema name when provided by backend
}

interface FieldInfo {
  name: string;
  type: string;
  description?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  foreignKey?: boolean;
  sampleValues?: any[];
}

type QueryTab = {
  key: string;
  title: string;
  sql: string;
  python?: string;
  language?: QueryLanguage;
};

type QueryLanguage = 'sql' | 'python';

const resolveLanguage = (language?: string | null): QueryLanguage => (language === 'python' ? 'python' : 'sql');

import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useDataSourceSchema, useDataSources } from '@/hooks/useDataSources';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { DEFAULT_QUERY_LIMIT, ROW_LIMIT_PRESETS } from '@/config/queryLimits';

const DEFAULT_SQL_SNIPPET = `SELECT * FROM data LIMIT ${DEFAULT_QUERY_LIMIT};`;
const MIN_EDITOR_HEIGHT = 120;
const RUN_BAR_HEIGHT = 52;
const TABS_ROW_HEIGHT = 40;
const MIN_TOP_SECTION_HEIGHT = TABS_ROW_HEIGHT + MIN_EDITOR_HEIGHT + RUN_BAR_HEIGHT; // tabs + editor + run bar
const DEFAULT_EDITOR_HEIGHT = 260;
const computeMaxEditorHeight = () => {
  if (typeof window === 'undefined') return 1600;
  return Math.max(500, window.innerHeight - 220);
};
const buildPythonTemplate = (baseSql: string, dataSourceName?: string) => `# Python code to query data source
import pandas as pd

# Connect to data source: ${dataSourceName || 'selected source'}
# Example query:
df = pd.read_sql(\"\"\"
${baseSql}
\"\"\", connection)
print(df.head())`;

const MonacoSQLEditor: React.FC<MonacoSQLEditorProps> = ({
  isDarkMode = false,
  onQueryResult,
  onChartCreate,
  selectedDataSource: propSelectedDataSource,
  onDataSourceChange,
  defaultSidebarOpen = false,
}) => {
  const t = useTranslations('monaco_sql_editor');
  const authenticatedFetch = useAuthenticatedFetch();
  const { session } = useAuthStore();
  const authToken = session?.access_token;
  const { currentProject, currentProjectId } = useProjectStore();
  const organizationId =
    currentProject && 'organization_id' in currentProject && currentProject.organization_id != null
      ? String(currentProject.organization_id)
      : '';
  const projectId = currentProjectId != null ? String(currentProjectId) : '';

  // DataSourceStore integration
  const { selectedId: selectedDataSourceId, select: selectDataSource } = useDataSourceStore();
  const { dataSources: contextDataSources, isLoading: dataSourcesLoading } = useDataSources();
  const { schema: selectedDataSourceSchema } = useDataSourceSchema(selectedDataSourceId);
  const qcSql = useQueryClient();
  const refreshDataSources = () => qcSql.invalidateQueries({ queryKey: ['data-sources'] });
  const contextDataSourceRaw = contextDataSources.find((ds) => ds.id === selectedDataSourceId) ?? null;

  // Derive selectedDataSource from store
  const contextDataSource = contextDataSourceRaw ?? null;
  const selectedDataSource: DataSource | null = contextDataSource
    ? {
        id: contextDataSource.id,
        name: contextDataSource.name,
        type: contextDataSource.type,
        status:
          contextDataSource.connection_status === 'connected'
            ? 'connected'
            : contextDataSource.connection_status === 'failed'
              ? 'error'
              : 'disconnected',
        config: contextDataSource.connection_config || {},
        metadata: contextDataSource.metadata || {},
        connection_info: contextDataSource.connection_config,
        lastUsed: contextDataSource.last_accessed,
        rowCount: contextDataSource.row_count,
        columns: [],
        size: contextDataSource.size?.toString(),
        description: contextDataSource.description,
        db_type: contextDataSource.db_type,
      }
    : null;

  // Get schema from context
  const schema = selectedDataSourceSchema;
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  const [sqlQuery, setSqlQuery] = useState(DEFAULT_SQL_SNIPPET);
  const [editorLanguage, setEditorLanguage] = useState<QueryLanguage>('sql');

  const isPromqlDataSource = useMemo(() => {
    const dt = (selectedDataSource?.db_type || '').toLowerCase();
    const cfg = (selectedDataSource?.config as Record<string, unknown> | undefined) || {};
    const ty = String(cfg.type || '').toLowerCase();
    return dt === 'prometheus_source' || ty === 'prometheus_source';
  }, [selectedDataSource]);

  const monacoEditorLanguage =
    editorLanguage === 'sql' && isPromqlDataSource ? 'plaintext' : editorLanguage;

  const [selectedSchema, setSelectedSchema] = useState('public');
  const [selectedTable, setSelectedTable] = useState('sales_data');
  const [isLoadingSchema, setIsLoadingSchema] = useState<boolean>(false);
  const [isExecuting, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('results');
  // Query tabs - support both SQL and Python
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      key: 'q-1',
      title: 'Query 1',
      sql: DEFAULT_SQL_SNIPPET,
      python: buildPythonTemplate(DEFAULT_SQL_SNIPPET),
      language: 'sql',
    },
  ]);
  const [activeQueryKey, setActiveQueryKey] = useState<string>('q-1');
  const [previewChart, setPreviewChart] = useState<any>(null);
  const [openTableTabs, setOpenTableTabs] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [showTableSchema, setShowTableSchema] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('sidebarCollapsed');
        if (stored === null) return !defaultSidebarOpen; // first visit: open if defaultSidebarOpen
        return stored === 'true';
      }
    } catch {
      // ignore
    }
    return !defaultSidebarOpen;
  });
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [executionStatus, setExecutionStatus] = useState<string>('');
  const [selectedEngine, setSelectedEngine] = useState<string>('auto');
  const [resolvedEngine, setResolvedEngine] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const screens = Grid.useBreakpoint();
  const isDesktopLayout = screens.lg ?? false;
  const isStackedLayout = !isDesktopLayout;
  const effectiveSidebarCollapsed = isStackedLayout ? false : sidebarCollapsed;


  // Load query execution history from backend (persisted across sessions; authenticatedFetch returns parsed JSON)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await authenticatedFetch('/api/queries/execution-history?limit=50')) as { items?: any[] };
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setQueryHistory(items.map((r: any) => ({
          id: r.id,
          state: r.state || (r.status === 'success' ? 'success' : 'error'),
          started: r.started || '',
          duration: r.duration || '00:00:0.00',
          progress: r.progress ?? (r.state === 'success' ? 100 : 0),
          rows: r.rows ?? 0,
          sql: r.sql || '',
          status: r.status || r.state,
          database: r.database || '',
          user: r.user || 'current_user',
          engine: r.engine || 'unknown',
          error: r.error
        })));
      } catch (_) {
        // Keep in-memory only on failure
      }
    })();
    return () => { cancelled = true; };
  }, [authenticatedFetch]);

  // Sync collapse state from other components via event
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (typeof detail?.collapsed === 'boolean') {
          setSidebarCollapsed(detail.collapsed);
          try {
            window.localStorage.setItem('sidebarCollapsed', detail.collapsed ? 'true' : 'false');
          } catch {}
        }
      } catch {}
    };
    window.addEventListener('sidebar-collapse-changed', handler as EventListener);
    return () => window.removeEventListener('sidebar-collapse-changed', handler as EventListener);
  }, []);
  const [isQueryValid, setIsQueryValid] = useState<boolean>(true);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isRefreshingSchema, setIsRefreshingSchema] = useState(false);
  const [showConnectDataModal, setShowConnectDataModal] = useState(false);
  const [hasCube, setHasCube] = useState(false);
  const [selectedView, setSelectedView] = useState<string>('');
  const [openViewTabs, setOpenViewTabs] = useState<string[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);
  const [aiAssistantInput, setAiAssistantInput] = useState<string>('');
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [perfPlan, setPerfPlan] = useState<any>(null);
  const [perfSuggestions, setPerfSuggestions] = useState<string[]>([]);
  const [editingTabKey, setEditingTabKey] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string>('');
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [permEmail, setPermEmail] = useState('');
  const [permLoading, setPermLoading] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [chartDesignerActiveKeys, setChartDesignerActiveKeys] = useState<string[]>([]);
  const [savedQueries, setSavedQueries] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [isSavingTabs, setIsSavingTabs] = useState(false);
  const [showSaveSnapshotModal, setShowSaveSnapshotModal] = useState(false);
  const [saveSnapshotName, setSaveSnapshotName] = useState('');
  const [showVersionsModalForQueryId, setShowVersionsModalForQueryId] = useState<number | null>(null);
  const [savedQueryVersions, setSavedQueryVersions] = useState<{ id: number; sql: string; created_at: string }[]>([]);
  const [versionsModalQueryRecord, setVersionsModalQueryRecord] = useState<{ name: string; metadata?: Record<string, unknown> } | null>(null);
  const [rowLimit, setRowLimit] = useState<string>(String(DEFAULT_QUERY_LIMIT));
  const [controlRowLimit, setControlRowLimit] = useState<string>(String(DEFAULT_QUERY_LIMIT));
  const [limitSource, setLimitSource] = useState<'control' | 'query'>('control');
  const [maxEditorHeight, setMaxEditorHeight] = useState<number>(computeMaxEditorHeight);

  useEffect(() => {
    const openConnectDataModal = () => setShowConnectDataModal(true);
    window.addEventListener('query-editor-open-connect-data', openConnectDataModal);
    return () => window.removeEventListener('query-editor-open-connect-data', openConnectDataModal);
  }, []);

  const [editorHeight, setEditorHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_EDITOR_HEIGHT;
    const stored = Number(window.localStorage.getItem('qe_editor_height'));
    const initial = Number.isFinite(stored) ? stored : DEFAULT_EDITOR_HEIGHT;
    return Math.min(Math.max(initial, MIN_TOP_SECTION_HEIGHT), computeMaxEditorHeight());
  });
  const editorResizeStateRef = useRef({
    isResizing: false,
    startY: 0,
    startHeight: editorHeight,
  });
  const clampEditorHeight = useCallback(
    (value: number) => Math.min(Math.max(value, MIN_TOP_SECTION_HEIGHT), maxEditorHeight),
    [maxEditorHeight]
  );
  const rowLimitOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [...ROW_LIMIT_PRESETS];
    if (limitSource === 'query' && rowLimit && !opts.some((option) => option.value === rowLimit)) {
      opts.push({ value: rowLimit, label: rowLimit });
    }
    return opts;
  }, [limitSource, rowLimit]);
  useEffect(() => {
    const handleWindowResize = () => {
      setMaxEditorHeight(computeMaxEditorHeight());
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }
  }, []);
  useEffect(() => {
    if (!editorResizeStateRef.current.isResizing) {
      editorResizeStateRef.current.startHeight = editorHeight;
    }
    try {
      window.localStorage.setItem('qe_editor_height', String(editorHeight));
    } catch {
      // ignore storage failures
    }
  }, [editorHeight]);
  const normalizeTabs = (tabs: Array<Partial<QueryTab>>) =>
    tabs.map((tab, index) => {
      const sql = tab.sql ?? DEFAULT_SQL_SNIPPET;
      const language = resolveLanguage(tab.language);
      return {
        key: tab.key ?? `tab-${index}`,
        title: tab.title ?? `Query ${index + 1}`,
        sql,
        python: tab.python ?? buildPythonTemplate(sql, selectedDataSource?.name),
        language,
      };
    });

  // Next default tab title: "Query N" where N is the next number (avoids duplicate "Query 2" when loading from backend)
  const getNextDefaultTabTitle = useCallback((existingTabs: QueryTab[]) => {
    const used = new Set<number>();
    existingTabs.forEach(t => {
      const m = (t.title || '').match(/^Query\s+(\d+)$/i);
      if (m) used.add(parseInt(m[1], 10));
    });
    let n = 1;
    while (used.has(n)) n++;
    return `Query ${n}`;
  }, []);
  const getPythonTemplate = (tab?: Pick<QueryTab, 'sql' | 'python'> | null, fallbackDataSourceName?: string | null) =>
    tab?.python && tab.python.trim().length > 0
      ? tab.python
      : buildPythonTemplate(tab?.sql ?? DEFAULT_SQL_SNIPPET, fallbackDataSourceName || selectedDataSource?.name);
  const stripSqlComments = (query: string) => query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const extractLimitFromQuery = (query: string): number | null => {
    const normalized = stripSqlComments(query);
    // Check for LIMIT (MySQL/PostgreSQL) or TOP (SQL Server)
    const limitMatch = normalized.match(/\blimit\s+(\d+)/i);
    const topMatch = normalized.match(/\btop\s+(\d+)/i);

    if (limitMatch) {
      const parsed = parseInt(limitMatch[1], 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (topMatch) {
      const parsed = parseInt(topMatch[1], 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const appendLimitClause = (query: string, limit: number, dbType?: string) => {
    if (!limit || Number.isNaN(limit)) return query;

    const trimmed = query.trim().replace(/;+\s*$/, '');
    const dbTypeLower = (dbType || '').toLowerCase();

    // SQL Server uses TOP, MySQL/PostgreSQL use LIMIT
    if (dbTypeLower === 'sqlserver' || dbTypeLower === 'mssql') {
      // For SQL Server, use TOP clause
      // Check if SELECT already exists
      const selectMatch = trimmed.match(/^(\s*SELECT\s+)(.*)/i);
      if (selectMatch) {
        // Insert TOP after SELECT
        return `${selectMatch[1]}TOP ${limit} ${selectMatch[2]};`;
      } else {
        // If no SELECT found, just append (shouldn't happen for valid SQL)
        return `${trimmed}\nTOP ${limit};`;
      }
    } else {
      // MySQL, PostgreSQL, and others use LIMIT
      return `${trimmed}\nLIMIT ${limit};`;
    }
  };

  // Listen for query template loading events from parent page
  useEffect(() => {
    const handleTemplateLoad = (event: CustomEvent) => {
      const templateSql = event.detail?.sql;
      if (!templateSql) {
        return;
      }
      // Use state directly instead of refs
      const tabs = queryTabs;
      const targetKey = activeQueryKey || tabs[0]?.key;
      const pythonTemplate = buildPythonTemplate(templateSql, selectedDataSource?.name);
      if (targetKey) {
        setQueryTabs((prev) =>
          prev.map((t) => (t.key === targetKey ? { ...t, sql: templateSql, python: pythonTemplate } : t))
        );
      }
      const lang = editorLanguage || 'sql';
      const resolvedLanguage = resolveLanguage(lang);
      setEditorLanguage(resolvedLanguage);
      setSqlQuery(resolvedLanguage === 'python' ? pythonTemplate : templateSql);
      message.success(t('toast_template_loaded'));
    };

    window.addEventListener('load-query-template', handleTemplateLoad as EventListener);
    return () => {
      window.removeEventListener('load-query-template', handleTemplateLoad as EventListener);
    };
  }, [queryTabs, activeQueryKey, editorLanguage, selectedDataSource?.name]);

  // When user selects a data source and schema loads, set starter SQL if editor still has default snippet
  useEffect(() => {
    if (editorLanguage !== 'sql' || !selectedDataSourceId || !schema) return;
    const trimmed = sqlQuery.trim();
    if (trimmed !== DEFAULT_SQL_SNIPPET.trim()) return; // leave user's query as-is
    const tables = schema.tables;
    if (!tables || tables.length === 0) return;
    const isFile = selectedDataSource?.type === 'file';
    const firstTable = tables[0];
    const tableName = isFile ? 'data' : firstTable?.name || 'data';
    const schemaName = isFile ? undefined : firstTable?.schema || 'public';
    let fullTableRef: string;
    if (isFile || !schemaName || schemaName === 'public') {
      fullTableRef = tableName.includes(' ') || tableName.includes('-') ? `"${tableName}"` : tableName;
    } else {
      const s = schemaName.includes(' ') ? `"${schemaName}"` : schemaName;
      const t = tableName.includes(' ') ? `"${tableName}"` : tableName;
      fullTableRef = `${s}.${t}`;
    }
    const starterSql = `SELECT * FROM ${fullTableRef} LIMIT ${DEFAULT_QUERY_LIMIT};`;
    setSqlQuery(starterSql);
    setQueryTabs((prev) => prev.map((t) => (t.key === activeQueryKey ? { ...t, sql: starterSql } : t)));
  }, [selectedDataSourceId, schema, selectedDataSource?.type, activeQueryKey, editorLanguage, sqlQuery]);

  useEffect(() => {
    if (editorLanguage !== 'sql') {
      setLimitSource('control');
      setRowLimit(controlRowLimit);
      return;
    }
    const detectedLimit = extractLimitFromQuery(sqlQuery);
    if (detectedLimit !== null) {
      setLimitSource('query');
      setRowLimit(detectedLimit.toString());
    } else {
      setLimitSource('control');
      setRowLimit(controlRowLimit);
    }
  }, [sqlQuery, editorLanguage, controlRowLimit]);

  const handleRowLimitChange = (value: string) => {
    setControlRowLimit(value);
    setRowLimit(value);
    setLimitSource('control');
  };
  const handleEditorResizeMove = useCallback(
    (event: MouseEvent) => {
      if (!editorResizeStateRef.current.isResizing) return;
      const delta = event.clientY - editorResizeStateRef.current.startY;
      const next = clampEditorHeight(editorResizeStateRef.current.startHeight + delta);
      setEditorHeight(next);
    },
    [clampEditorHeight]
  );
  const stopEditorResize = useCallback(() => {
    if (!editorResizeStateRef.current.isResizing) return;
    editorResizeStateRef.current.isResizing = false;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleEditorResizeMove);
    window.removeEventListener('mouseup', stopEditorResize);
  }, [handleEditorResizeMove]);
  const startEditorResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      editorResizeStateRef.current.isResizing = true;
      editorResizeStateRef.current.startY = event.clientY;
      editorResizeStateRef.current.startHeight = editorHeight;
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleEditorResizeMove);
      window.addEventListener('mouseup', stopEditorResize);
    },
    [editorHeight, handleEditorResizeMove, stopEditorResize]
  );
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleEditorResizeMove);
      window.removeEventListener('mouseup', stopEditorResize);
    };
  }, [handleEditorResizeMove, stopEditorResize]);

  // Enhanced data sources with real integration capabilities
  const enhancedDatabases = [
    {
      value: 'duckdb',
      label: 'DuckDB - Local Analytics',
      type: 'database',
      status: 'connected',
      description: 'Fast in-memory analytical database for local development',
      icon: <DatabaseOutlined />,
    },
    {
      value: 'postgresql',
      label: 'PostgreSQL - Production DB',
      type: 'database',
      status: 'connected',
      description: 'Primary production database with ACID compliance',
      icon: <DatabaseOutlined />,
    },
    {
      value: 'snowflake',
      label: 'Snowflake - Cloud Data',
      type: 'warehouse',
      status: 'connected',
      description: 'Cloud data warehouse for large-scale analytics',
      icon: <CloudOutlined />,
    },
    {
      value: 'bigquery',
      label: 'BigQuery - Google Analytics',
      type: 'warehouse',
      status: 'connected',
      description: 'Google Cloud data warehouse with ML capabilities',
      icon: <CloudOutlined />,
    },
    {
      value: 'api_rest',
      label: 'REST API - External Service',
      type: 'api',
      status: 'connected',
      description: 'External REST API for real-time data',
      icon: <ApiOutlined />,
    },
    {
      value: 'csv_files',
      label: 'CSV Files - Local Data',
      type: 'file',
      status: 'connected',
      description: 'Local CSV files for data analysis',
      icon: <FileOutlined />,
    },
  ];

  const enhancedSchemas = [
    {
      value: 'public',
      label: 'public',
      description: 'Public schema with core business data',
      tables: ['sales_data', 'user_analytics', 'product_catalog'],
    },
    {
      value: 'analytics',
      label: 'analytics',
      description: 'Analytics and reporting data',
      tables: ['kpi_metrics', 'dashboard_data', 'performance_metrics'],
    },
    {
      value: 'staging',
      label: 'staging',
      description: 'Staging data for testing and development',
      tables: ['test_data', 'dev_samples', 'qa_datasets'],
    },
    {
      value: 'warehouse',
      label: 'warehouse',
      description: 'Data warehouse for historical analysis',
      tables: ['historical_sales', 'user_behavior', 'market_trends'],
    },
  ];

  const enhancedTables = [
    {
      name: 'sales_data',
      fields: [
        { name: 'date', type: 'DATE', description: 'Sale Date', nullable: false, primaryKey: false },
        { name: 'product_id', type: 'INTEGER', description: 'Product ID', nullable: false, primaryKey: true },
        { name: 'product_name', type: 'VARCHAR(255)', description: 'Product Name', nullable: false },
        { name: 'category', type: 'VARCHAR(100)', description: 'Product Category', nullable: true },
        { name: 'amount', type: 'DECIMAL(10,2)', description: 'Sale Amount', nullable: false },
        { name: 'region', type: 'VARCHAR(100)', description: 'Sales Region', nullable: true },
        { name: 'customer_id', type: 'INTEGER', description: 'Customer ID', nullable: false, foreignKey: true },
      ],
      rowCount: 125000,
      size: '15.2 MB',
      description: 'Core sales transaction data with product and customer information',
      lastModified: '2024-01-15',
    },
    {
      name: 'user_analytics',
      fields: [
        { name: 'user_id', type: 'INTEGER', description: 'User ID', nullable: false, primaryKey: true },
        { name: 'session_id', type: 'VARCHAR(50)', description: 'Session ID', nullable: false },
        { name: 'session_duration', type: 'INTEGER', description: 'Session Duration (minutes)', nullable: true },
        { name: 'page_views', type: 'INTEGER', description: 'Page Views Count', nullable: true },
        { name: 'conversion', type: 'BOOLEAN', description: 'Conversion Status', nullable: false },
        { name: 'timestamp', type: 'TIMESTAMP', description: 'Event Timestamp', nullable: false },
        { name: 'device_type', type: 'VARCHAR(50)', description: 'Device Type', nullable: true },
      ],
      rowCount: 89000,
      size: '8.7 MB',
      description: 'User behavior and session analytics data',
      lastModified: '2024-01-15',
    },
    {
      name: 'product_catalog',
      fields: [
        { name: 'product_id', type: 'INTEGER', description: 'Product ID', nullable: false, primaryKey: true },
        { name: 'name', type: 'VARCHAR(255)', description: 'Product Name', nullable: false },
        { name: 'category', type: 'VARCHAR(100)', description: 'Product Category', nullable: false },
        { name: 'price', type: 'DECIMAL(10,2)', description: 'Product Price', nullable: false },
        { name: 'inventory', type: 'INTEGER', description: 'Inventory Count', nullable: false },
        { name: 'created_at', type: 'TIMESTAMP', description: 'Creation Date', nullable: false },
        { name: 'updated_at', type: 'TIMESTAMP', description: 'Last Update', nullable: false },
      ],
      rowCount: 1500,
      size: '2.1 MB',
      description: 'Product catalog with pricing and inventory information',
      lastModified: '2024-01-15',
    },
  ];

  // Fetch tabs from backend and apply to state (used on auth ready and on visibility refocus)
  const fetchTabsFromBackend = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (organizationId) params.set('organization_id', organizationId);
      if (projectId) params.set('project_id', projectId);
      const qs = params.toString();
      const url = qs ? `/api/queries/tabs?${qs}` : '/api/queries/tabs';
      const data = await authenticatedFetch(url) as { tabs?: QueryTab[]; active_key?: string };
      if (data && Array.isArray(data.tabs) && data.tabs.length) {
        const normalized = normalizeTabs(data.tabs);
        setQueryTabs(normalized);
        const active = data.active_key || normalized[0].key;
        setActiveQueryKey(active);
        const found = normalized.find((t: QueryTab) => t.key === active);
        if (found) {
          const foundLanguage = resolveLanguage(found.language);
          setEditorLanguage(foundLanguage);
          setSqlQuery(foundLanguage === 'python' ? getPythonTemplate(found, selectedDataSource?.name) : (found.sql ?? DEFAULT_SQL_SNIPPET));
        }
        return true;
      }
    } catch {
      // 401 / network: keep current state
    }
    return false;
  }, [authenticatedFetch, selectedDataSource?.name, organizationId, projectId]);

  // Load persisted tabs: localStorage first (instant), then backend when auth is ready
  useEffect(() => {
    // 1) Restore from localStorage immediately so we don't flash default tab
    try {
      const raw = localStorage.getItem('qe_tabs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.tabs) && parsed.tabs.length) {
          const normalized = normalizeTabs(parsed.tabs);
          setQueryTabs(normalized);
          setActiveQueryKey(parsed.activeKey || normalized[0].key);
          const found = normalized.find((t: QueryTab) => t.key === (parsed.activeKey || normalized[0].key));
          if (found) {
            const foundLanguage = resolveLanguage(found.language);
            setEditorLanguage(foundLanguage);
            setSqlQuery(foundLanguage === 'python' ? getPythonTemplate(found, selectedDataSource?.name) : (found.sql ?? DEFAULT_SQL_SNIPPET));
          }
        }
      }
    } catch { }

    // 2) When auth token is available, load from backend (overwrites with server state)
    let cancelled = false;
    const loadFromBackend = async () => {
      const applied = await fetchTabsFromBackend();
      if (cancelled || !applied) return;
    };
    if (authToken) {
      loadFromBackend();
    } else {
      // Auth may still be resolving (e.g. after refresh); retry once after delay
      const t = window.setTimeout(() => {
        if (!cancelled) fetchTabsFromBackend();
      }, 1200);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
    return () => { cancelled = true; };
  }, [authToken, fetchTabsFromBackend, selectedDataSource?.name]);

  // Refetch tabs when user returns to the tab/window (cross-tab sync after save elsewhere)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && authToken) {
        fetchTabsFromBackend();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [authToken, fetchTabsFromBackend]);

  // Same org/project scope as query tabs for saved queries and snapshots
  const queriesScopeParams = useMemo(() => {
    const p = new URLSearchParams();
    if (organizationId) p.set('organization_id', organizationId);
    if (projectId) p.set('project_id', projectId);
    return p.toString();
  }, [organizationId, projectId]);
  const savedQueriesUrl = queriesScopeParams ? `/api/queries/saved-queries?${queriesScopeParams}` : '/api/queries/saved-queries';
  const snapshotsUrl = queriesScopeParams ? `/api/queries/snapshots?${queriesScopeParams}` : '/api/queries/snapshots';

  // Load saved queries and snapshots when Saved Queries & Snapshots modal opens (same scope as tabs)
  useEffect(() => {
    if (!showSavedModal) return;
    let cancelled = false;
    (async () => {
      try {
        const [savedRes, snapRes] = await Promise.all([
          authenticatedFetch(savedQueriesUrl).catch(() => ({ items: [] })),
          authenticatedFetch(snapshotsUrl).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const savedList = Array.isArray((savedRes as any)?.items) ? (savedRes as any).items : [];
        const snapList = Array.isArray((snapRes as any)?.items) ? (snapRes as any).items : [];
        setSavedQueries(savedList.filter(Boolean));
        setSnapshots(snapList.filter(Boolean));
      } catch {
        if (!cancelled) {
          setSavedQueries([]);
          setSnapshots([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [showSavedModal, authenticatedFetch, savedQueriesUrl, snapshotsUrl]);

  // Load version history when History modal is opened
  useEffect(() => {
    if (showVersionsModalForQueryId == null) {
      setSavedQueryVersions([]);
      return;
    }
    const qs = queriesScopeParams ? `?${queriesScopeParams}` : '';
    (async () => {
      try {
        const j = await authenticatedFetch(
          `/api/queries/saved-queries/${showVersionsModalForQueryId}/versions${qs}`
        ) as { items?: { id: number; sql: string; created_at: string }[] };
        setSavedQueryVersions(Array.isArray(j?.items) ? j.items : []);
      } catch {
        setSavedQueryVersions([]);
      }
    })();
  }, [showVersionsModalForQueryId, authenticatedFetch, queriesScopeParams]);

  // Persist tabs on change
  useEffect(() => {
    try {
      localStorage.setItem('qe_tabs', JSON.stringify({ tabs: queryTabs, activeKey: activeQueryKey }));
    } catch {}
  }, [queryTabs, activeQueryKey]);

  // Persist tabs to backend (use same auth and org/project scope as load). silent = true for auto-save (no toast).
  const saveTabsToBackend = useCallback(async (tabs: QueryTab[], activeKey: string, silent?: boolean) => {
    try {
      setIsSavingTabs(true);
      const params = new URLSearchParams();
      if (organizationId) params.set('organization_id', organizationId);
      if (projectId) params.set('project_id', projectId);
      const qs = params.toString();
      const url = qs ? `/api/queries/tabs?${qs}` : '/api/queries/tabs';
      await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs, active_key: activeKey })
      });
      if (!silent) message.success(t('tabs_saved_ok'));
    } catch {
      if (!silent) message.error(t('tabs_save_failed'));
    } finally {
      setIsSavingTabs(false);
    }
  }, [authenticatedFetch, organizationId, projectId]);

  // Ctrl+S save shortcut and Ctrl+Enter run (use refs so handler always has latest; Monaco Ctrl+Enter registered in onMonacoMount)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const tabs = queryTabsRef.current;
        const activeKey = activeQueryKeyRef.current;
        try { localStorage.setItem('qe_tabs', JSON.stringify({ tabs, activeKey })); } catch { }
        saveTabsToBackend(tabs, activeKey);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runHandlerRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveTabsToBackend]);

  // Refs for debounced auto-save (timeout must see latest state)
  const queryTabsRef = useRef<QueryTab[]>(queryTabs);
  const activeQueryKeyRef = useRef<string>(activeQueryKey);
  const sqlQueryRef = useRef<string>(sqlQuery);
  const editorLanguageRef = useRef<QueryLanguage>(editorLanguage);
  queryTabsRef.current = queryTabs;
  activeQueryKeyRef.current = activeQueryKey;
  sqlQueryRef.current = sqlQuery;
  editorLanguageRef.current = editorLanguage;

  // Ref for run handler so shortcuts (window + Monaco Ctrl+Enter) always call latest
  const runHandlerRef = useRef<() => void>(() => {});

  // Debounced auto-save: persist current tab content to backend after 2s of no typing
  useEffect(() => {
    const t = window.setTimeout(() => {
      const tabs = queryTabsRef.current;
      const activeKey = activeQueryKeyRef.current;
      const sql = sqlQueryRef.current;
      const lang = editorLanguageRef.current;
      if (!tabs.length || !activeKey) return;
      const merged = tabs.map((tab) =>
        tab.key === activeKey
          ? { ...tab, sql: lang === 'sql' ? sql : tab.sql, python: lang === 'python' ? sql : tab.python, language: lang }
          : tab
      );
      saveTabsToBackend(merged, activeKey, true);
    }, 2000);
    return () => window.clearTimeout(t);
  }, [sqlQuery, activeQueryKey, editorLanguage, saveTabsToBackend]);

  // Schema is now loaded automatically by DataSourceContext when selectDataSource is called

  // Register SQL completion, language config, and Ctrl+Enter run on the same Monaco instance the editor uses
  const handleMonacoMount = useCallback((editor: unknown, monacoInstance: unknown) => {
    const monaco = monacoInstance as {
      languages: { setLanguageConfiguration: (lang: string, config: unknown) => { dispose: () => void }; registerCompletionItemProvider: (lang: string, provider: unknown) => { dispose: () => void } };
      KeyMod?: { CtrlCmd: number };
      KeyCode?: { Enter: number };
      editor?: { IStandaloneCodeEditor: unknown };
    };
    const standAlone = editor as { addAction?: (action: { id: string; label: string; keybindings?: number[]; run: (ed: unknown) => void }) => void };
    if (standAlone?.addAction && monaco?.KeyMod != null && monaco?.KeyCode != null) {
      standAlone.addAction({
        id: 'run-query-editor',
        label: 'Run SQL/Python',
        keybindings: [monaco.KeyMod.CtrlCmd! | monaco.KeyCode.Enter!],
        run: () => { runHandlerRef.current?.(); },
      });
    }
    if (!monaco?.languages) return () => {};
    const disposableConfig = monaco.languages.setLanguageConfiguration('sql', SQL_LANGUAGE_CONFIG as never);
    const disposableProvider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '\n', '{'],
      provideCompletionItems: (model: { getValueInRange: (r: unknown) => string; getWordUntilPosition: (p: unknown) => { word: string; startColumn: number; endColumn: number } }, position: { lineNumber: number; column: number }) => {
        const textUntil = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const tables = (schemaRef.current?.tables || []) as SchemaTable[];
        const suggestions = buildSQLCompletionItems({
          textUntil,
          word: word.word || '',
          range,
          tables,
        });
        return { suggestions };
      },
    });
    return () => {
      disposableProvider?.dispose();
      disposableConfig?.dispose();
    };
  }, []);

  // Validate SQL against loaded schema (simple FROM table check)
  // NOTE: This is a best-effort validation. We allow queries to execute even if table not found in cached schema
  // because the backend will validate against the actual database schema.
  const validateQueryAgainstSchema = (sql: string) => {
    try {
      const q = (sql || '').toLowerCase();
      const m = q.match(/from\s+([a-z0-9_\.]+)/i);
      if (!m) {
        // No table referenced; allow queries
        setIsQueryValid(true);
        setValidationMessage(null);
        return true;
      }

      let tableName = m[1];
      let schemaName: string | null = null;

      // Handle schema.table format (e.g., "aiser_warehouse.customers")
      if (tableName.includes('.')) {
        const parts = tableName.split('.');
        schemaName = parts[0];
        tableName = parts[1];
      }

      // If file-based data source, supported table is 'data' (inline) or file table name
      const ds = selectedDataSource;
      if (ds && ds.type === 'file') {
        if (tableName === 'data' || tableName === (ds.name && ds.name.replace(/\.[^/.]+$/, '').toLowerCase())) {
          setIsQueryValid(true);
          setValidationMessage(null);
          return true;
        }
        // Warn but allow execution - backend will validate
        setIsQueryValid(true);
        setValidationMessage(
          `Note: Table '${tableName}' not found in cached schema. Query will be validated by backend.`
        );
        return true;
      }

      // Get schema from context
      const schemaTables = schema?.tables || [];
      const availableTables = schemaTables.map((t: any) => t.name?.toLowerCase() || '').filter(Boolean);
      const availableSchemas = schemaTables
        .map((t: any) => (t.schema || 'public')?.toLowerCase() || 'public')
        .filter(Boolean);

      // Check if table exists (with or without schema prefix)
      const tableExists = availableTables.includes(tableName.toLowerCase());
      const schemaExists = schemaName ? availableSchemas.includes(schemaName.toLowerCase()) : true;

      if (tableExists && schemaExists) {
        setIsQueryValid(true);
        setValidationMessage(null);
        return true;
      }

      // For cube sources
      if (selectedDataSourceId && selectedDataSource?.type === 'cube') {
        const allCubeTables = schemaTables.map((t: any) => t.name?.toLowerCase() || '').filter(Boolean);
        if (allCubeTables.includes(tableName.toLowerCase())) {
          setIsQueryValid(true);
          setValidationMessage(null);
          return true;
        }
        // Warn but allow - backend will validate
        setIsQueryValid(true);
        setValidationMessage(
          `Note: Cube table '${tableName}' not found in cached schema. Query will be validated by backend.`
        );
        return true;
      }

      // Default: Warn but ALLOW execution - backend will do actual validation
      // This is important because:
      // 1. Schema cache might be stale
      // 2. Tables might exist but not be in cache yet
      // 3. Backend has the authoritative schema
      setIsQueryValid(true);
      setValidationMessage(
        schemaName
          ? `Note: Table '${schemaName}.${tableName}' not found in cached schema. Query will be validated by backend.`
          : `Note: Table '${tableName}' not found in cached schema. Query will be validated by backend.`
      );
      return true;
    } catch (e) {
      // On any error, allow the query - backend will validate
      setIsQueryValid(true);
      setValidationMessage(null);
      return true;
    }
  };

  // Re-validate when SQL or schema changes
  useEffect(() => {
    validateQueryAgainstSchema(sqlQuery);
  }, [sqlQuery, schema, selectedDataSource, selectedDataSourceId]);

  const refreshSchema = async () => {
    setIsRefreshingSchema(true);
    try {
      // Simulate schema refresh
      await new Promise((resolve) => setTimeout(resolve, 1000));
      message.success(t('schema_refreshed_ok'));
    } catch (error) {
      message.error(t('schema_refresh_failed'));
    } finally {
      setIsRefreshingSchema(false);
    }
  };

  const handleHistoryItemClick = (sql: string) => {
    setSqlQuery(sql || '');
  };

  const pendingRerunSqlRef = useRef<string | null>(null);
  const editorInsertRef = useRef<MemoryOptimizedEditorHandle>(null);
  /** Live editor content for the *active* tab only (updated on every keystroke via onContentChange). */
  const latestEditorContentRef = useRef<string>('');
  // When sqlQuery is set externally (e.g. load from backend, switch tab), sync ref for current tab
  useEffect(() => { latestEditorContentRef.current = sqlQuery; }, [sqlQuery]);

  // Re-run: load SQL into editor, then execute once state has updated
  const handleHistoryRerun = useCallback((record: { sql?: string }) => {
    const sql = (record?.sql || '').trim();
    if (!sql) return;
    pendingRerunSqlRef.current = sql;
    setSqlQuery(sql);
    setEditorLanguage('sql');
    setError(null);
  }, []);

  // Export functions
  const exportToCSV = (data: any[]) => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map((row) => headers.map((header) => `"${row[header]}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `query_results_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = (data: any[]) => {
    if (data.length === 0) return;

    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `query_results_${new Date().toISOString().slice(0, 10)}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /** Download current editor content as a .sql or .py file (no duplication with Saved Queries). */
  const downloadCurrentQueryAsFile = useCallback(() => {
    const content = editorLanguage === 'python' ? (sqlQuery || '') : (sqlQuery || '');
    const ext = editorLanguage === 'python' ? 'py' : 'sql';
    const blob = new Blob([content], { type: ext === 'sql' ? 'text/plain' : 'text/x-python' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `query_${new Date().toISOString().slice(0, 10)}.${ext}`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    message.success(`Downloaded as .${ext} file`);
  }, [sqlQuery, editorLanguage]);

  const handleCreateChart = (chartType: string, data: any[], existingConfig?: any) => {
    try {
      if (!data || data.length === 0) {
        message.warning(t('chart_no_data'));
        return;
      }
      if (!data || data.length === 0) {
        message.warning(t('chart_no_data'));
        return;
      }

      // CRITICAL: Intelligently analyze data structure
      const firstRow = data[0];
      if (!firstRow || typeof firstRow !== 'object') {
        message.error(t('invalid_data_format'));
        return;
      }

      const columns: string[] = Object.keys(firstRow);
      if (columns.length === 0) {
        message.error(t('no_columns'));
        return;
      }

      // Enhanced column detection - handle various data types
      const numericColumns: string[] = [];
      const textColumns: string[] = [];
      const dateColumns: string[] = [];

      columns.forEach((col: string) => {
        const sampleValue = firstRow[col];
        if (sampleValue === null || sampleValue === undefined) {
          return; // Skip null/undefined columns
        }

        // Check if numeric (including strings that can be parsed as numbers)
        if (typeof sampleValue === 'number') {
          numericColumns.push(col);
        } else if (typeof sampleValue === 'string') {
          // Try to parse as number
          const numValue = Number(sampleValue);
          if (!isNaN(numValue) && sampleValue.trim() !== '') {
            numericColumns.push(col);
          } else {
            // Check if date-like
            const dateValue = new Date(sampleValue);
            if (!isNaN(dateValue.getTime()) && sampleValue.length > 5) {
              dateColumns.push(col);
            } else {
              textColumns.push(col);
            }
          }
        } else if (sampleValue instanceof Date) {
          dateColumns.push(col);
        }
      });

      // Determine best columns for chart - use config if available, otherwise auto-detect
      const xColumn =
        existingConfig?.xAxisField ||
        previewChart?.config?.xAxisField ||
        textColumns[0] ||
        dateColumns[0] ||
        columns[0];
      const yColumn =
        existingConfig?.yAxisField ||
        previewChart?.config?.yAxisField ||
        numericColumns[0] ||
        columns.find((col: string) => !textColumns.includes(col) && !dateColumns.includes(col)) ||
        columns[1] ||
        columns[0];
      const yColumn2 = numericColumns[1] || null;

      // Handle axis swap for chart generation - define effective columns
      let effectiveXColumn = xColumn;
      let effectiveYColumn = yColumn;
      if (existingConfig?.swapAxes && xColumn && yColumn) {
        // When swapped, use yColumn for x-axis and xColumn for y-axis
        effectiveXColumn = yColumn;
        effectiveYColumn = xColumn;
      }

      // Apply data transformations: filter, sort, aggregation
      let processedData = Array.isArray(data) ? [...data] : [];

      // Apply filter if specified
      if (existingConfig?.filter && existingConfig.filter.trim() !== '') {
        try {
          const filterExpr = existingConfig.filter.trim();
          // Simple filter evaluation (basic support for >, <, >=, <=, ==, !=)
          processedData = processedData.filter((row: any) => {
            try {
              // Try to evaluate simple expressions like "value > 100"
              const match = filterExpr.match(/(\w+)\s*(>|<|>=|<=|==|!=)\s*(.+)/);
              if (match) {
                const [, field, op, value] = match;
                const fieldVal = row[field.trim()];
                const compareVal = isNaN(Number(value)) ? value.trim().replace(/['"]/g, '') : Number(value);
                const numFieldVal = typeof fieldVal === 'number' ? fieldVal : Number(fieldVal);
                const numCompareVal = typeof compareVal === 'number' ? compareVal : Number(compareVal);

                switch (op) {
                  case '>':
                    return numFieldVal > numCompareVal;
                  case '<':
                    return numFieldVal < numCompareVal;
                  case '>=':
                    return numFieldVal >= numCompareVal;
                  case '<=':
                    return numFieldVal <= numCompareVal;
                  case '==':
                    return numFieldVal === numCompareVal || String(fieldVal) === String(compareVal);
                  case '!=':
                    return numFieldVal !== numCompareVal && String(fieldVal) !== String(compareVal);
                  default:
                    return true;
                }
              }
              return true;
            } catch {
              return true;
            }
          });
        } catch (e) {
          console.warn('Filter evaluation failed:', e);
        }
      }

      // Apply sort if specified
      if (existingConfig?.sortOrder && existingConfig.sortOrder !== 'none' && yColumn) {
        processedData.sort((a: any, b: any) => {
          const aVal = typeof a[yColumn] === 'number' ? a[yColumn] : Number(a[yColumn]) || 0;
          const bVal = typeof b[yColumn] === 'number' ? b[yColumn] : Number(b[yColumn]) || 0;
          return existingConfig.sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });
      }

      // Apply aggregation if specified
      if (existingConfig?.aggregation && existingConfig.aggregation !== 'none' && yColumn && xColumn) {
        const grouped: Record<string, number[]> = {};
        processedData.forEach((row: any) => {
          const key = String(row[xColumn] || 'Unknown');
          const val = typeof row[yColumn] === 'number' ? row[yColumn] : Number(row[yColumn]) || 0;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(val);
        });

        processedData = Object.entries(grouped).map(([key, values]) => {
          let aggregatedValue = 0;
          switch (existingConfig.aggregation) {
            case 'sum':
              aggregatedValue = values.reduce((a, b) => a + b, 0);
              break;
            case 'avg':
              aggregatedValue = values.reduce((a, b) => a + b, 0) / values.length;
              break;
            case 'count':
              aggregatedValue = values.length;
              break;
            case 'min':
              aggregatedValue = Math.min(...values);
              break;
            case 'max':
              aggregatedValue = Math.max(...values);
              break;
          }
          return { [xColumn]: key, [yColumn]: aggregatedValue };
        });
      }

      // Use processed data
      const actualData = processedData;

      // Intelligent chart type selection and data mapping
      const normalizedChartType = chartType.toLowerCase().replace(/\s+/g, ' ').trim();
      let chartData: any = {};
      let chartConfig: any = {};

      switch (normalizedChartType) {
        case 'bar chart':
        case 'column chart':
        case 'bar':
        case 'column':
          if (!effectiveXColumn || !effectiveYColumn) {
            message.error(t('bar_chart_cols'));
            return;
          }
          chartData = {
            xAxis: actualData.map((row) => {
              const val = row[effectiveXColumn];
              return val !== null && val !== undefined ? String(val) : '';
            }),
            yAxis: actualData.map((row) => {
              const val = row[effectiveYColumn];
              return typeof val === 'number' ? val : Number(val) || 0;
            }),
          };
          chartConfig = {
            chartType: 'bar',
            title: { text: `${effectiveXColumn} vs ${effectiveYColumn}` },
            showTitle: true,
            showLegend: true,
            showTooltip: true,
            showGrid: true,
          };
          break;

        case 'line chart':
        case 'line':
          if (!effectiveXColumn || !effectiveYColumn) {
            message.error(t('line_chart_cols'));
            return;
          }
          chartData = {
            xAxis: actualData.map((row) => {
              const val = row[effectiveXColumn];
              return val !== null && val !== undefined ? String(val) : '';
            }),
            yAxis: actualData.map((row) => {
              const val = row[effectiveYColumn];
              return typeof val === 'number' ? val : Number(val) || 0;
            }),
          };
          chartConfig = {
            chartType: 'line',
            title: { text: `${effectiveXColumn} Trend` },
            showTitle: true,
            showLegend: true,
            showTooltip: true,
            showGrid: true,
          };
          break;

        case 'pie chart':
        case 'pie':
          if (!effectiveXColumn || !effectiveYColumn) {
            message.error(t('pie_chart_cols'));
            return;
          }
          chartData = {
            series: actualData
              .filter((row) => {
                const val = row[effectiveYColumn];
                return val !== null && val !== undefined && (typeof val === 'number' || !isNaN(Number(val)));
              })
              .map((row) => ({
                name: String(row[effectiveXColumn] || 'Unknown'),
                value:
                  typeof row[effectiveYColumn] === 'number'
                    ? row[effectiveYColumn]
                    : Number(row[effectiveYColumn]) || 0,
              })),
          };
          chartConfig = {
            chartType: 'pie',
            title: { text: `${effectiveXColumn} Distribution` },
            showTitle: true,
            showLegend: true,
            showTooltip: true,
          };
          break;

        case 'scatter plot':
        case 'scatter':
          if (numericColumns.length < 2) {
            message.error(t('scatter_cols'));
            return;
          }
          // For scatter plots, use effective columns if available, otherwise use first two numeric columns
          const scatterX =
            effectiveXColumn && numericColumns.includes(effectiveXColumn) ? effectiveXColumn : numericColumns[0];
          const scatterY =
            effectiveYColumn && numericColumns.includes(effectiveYColumn) ? effectiveYColumn : numericColumns[1];
          chartData = {
            series: actualData
              .filter((row) => {
                const val1 = row[scatterX];
                const val2 = row[scatterY];
                return val1 !== null && val1 !== undefined && val2 !== null && val2 !== undefined;
              })
              .map((row) => ({
                value: [
                  typeof row[scatterX] === 'number' ? row[scatterX] : Number(row[scatterX]) || 0,
                  typeof row[scatterY] === 'number' ? row[scatterY] : Number(row[scatterY]) || 0,
                ],
                name: `${row[scatterX]}, ${row[scatterY]}`,
              })),
          };
          chartConfig = {
            chartType: 'scatter',
            title: { text: `${scatterX} vs ${scatterY}` },
            showTitle: true,
            showLegend: true,
            showTooltip: true,
            showGrid: true,
          };
          break;

        default:
          // Fallback: try to create a bar chart with available columns
          if (xColumn && yColumn) {
            chartData = {
              xAxis: actualData.map((row) => String(row[xColumn] || '')),
              yAxis: actualData.map((row) => {
                const val = row[yColumn];
                return typeof val === 'number' ? val : Number(val) || 0;
              }),
            };
            chartConfig = {
              chartType: 'bar',
              title: { text: `${xColumn} vs ${yColumn}` },
              showTitle: true,
              showLegend: true,
              showTooltip: true,
              showGrid: true,
            };
          } else {
            message.error(
              'Unable to determine suitable columns for chart. Please ensure your query returns at least one text and one numeric column.'
            );
            return;
          }
      }

      // Validate chart data before creating widget
      if (!chartData || Object.keys(chartData).length === 0) {
        message.error(t('chart_gen_failed'));
        return;
      }

      // Create chart widget data with proper structure
      // CRITICAL: Normalize config.title to be a string (not an object) for ChartWidget compatibility
      // Merge with existing config to preserve user settings
      // Preserve existing title if user has edited it
      const existingTitle = previewChart?.title || previewChart?.name || existingConfig?.title;
      const defaultTitle =
        typeof chartConfig.title === 'object' && chartConfig.title?.text
          ? chartConfig.title.text
          : typeof chartConfig.title === 'string'
            ? chartConfig.title
            : 'Untitled Chart';
      const finalTitle =
        existingTitle && existingTitle !== 'Untitled Chart' && existingTitle !== defaultTitle
          ? existingTitle
          : defaultTitle;

      // Validate axis fields against available columns
      const validXField =
        existingConfig?.xAxisField && columns.includes(existingConfig.xAxisField)
          ? existingConfig.xAxisField
          : textColumns[0] || dateColumns[0] || columns[0];
      const validYField =
        existingConfig?.yAxisField && columns.includes(existingConfig.yAxisField)
          ? existingConfig.yAxisField
          : numericColumns[0] ||
            columns.find((col: string) => !textColumns.includes(col) && !dateColumns.includes(col)) ||
            columns[1] ||
            columns[0];

      const normalizedConfig = {
        ...existingConfig,
        ...chartConfig,
        title: finalTitle,
        chartType: chartConfig.chartType,
        // Preserve axis fields if valid, otherwise use defaults
        xAxisField: validXField,
        yAxisField: validYField,
        // Preserve data transformation settings
        aggregation: existingConfig?.aggregation || 'none',
        filter: existingConfig?.filter || '',
        sortOrder: existingConfig?.sortOrder || 'none',
        swapAxes: existingConfig?.swapAxes || false,
        // Preserve other user settings
        colorPalette: existingConfig?.colorPalette || chartConfig.colorPalette,
        legendShow: existingConfig?.legendShow !== undefined ? existingConfig.legendShow : chartConfig.showLegend,
        tooltipShow: existingConfig?.tooltipShow !== undefined ? existingConfig.tooltipShow : chartConfig.showTooltip,
        showGrid: existingConfig?.showGrid !== undefined ? existingConfig.showGrid : chartConfig.showGrid,
      };

      const chartWidget = {
        id: previewChart?.id || `chart-${Date.now()}`,
        type: chartConfig.chartType,
        name: finalTitle,
        title: finalTitle,
        config: normalizedConfig,
        data: chartData,
        query: sqlQuery,
        dataSourceId: selectedDataSource?.id || selectedDataSourceId || '',
        // Add raw data for reference
        rawData: actualData,
        // Store original columns for robust axis selection
        originalColumns: columns,
        numericColumns: numericColumns,
        textColumns: textColumns,
        dateColumns: dateColumns,
        // Metadata
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Set preview chart and switch to preview tab
      setPreviewChart((prevChart: any) => {
        // Only show message if this is a new chart generation, not a type change
        // Check if we already have a previewChart with the same rawData (indicating a type change)
        const isTypeChange = prevChart && prevChart.rawData === actualData && prevChart.id !== chartWidget.id;
        if (!isTypeChange) {
          message.success({
            content: `Chart "${normalizedConfig.title}" preview created!`,
            duration: 2,
          });
        }
        return chartWidget;
      });
      // Only switch tab if not already in preview (to avoid disrupting user if they're switching chart types)
      setActiveTab((prevTab) => (prevTab !== 'preview' ? 'preview' : prevTab));
    } catch (error: any) {
      console.error('Error creating chart:', error);
      message.error({
        content: `Failed to create chart: ${error.message || 'Unknown error'}`,
        duration: 5,
      });
    }
  };

  const handleDesignerPanelHover = (panelKey: string) => {
    setChartDesignerActiveKeys([panelKey]);
  };

  const handleDesignerPanelLeave = (panelKey: string) => {
    setChartDesignerActiveKeys((prev) => (prev[0] === panelKey ? [] : prev));
  };

  const handleDesignerCollapseChange = (keys: string | string[]) => {
    const normalizedKeys = Array.isArray(keys) ? keys : keys ? [keys] : [];
    setChartDesignerActiveKeys(normalizedKeys as string[]);
  };

  const handleChartGenerate = (chartConfig: any) => {
    if (onChartCreate) {
      const chartWidget = {
        type: chartConfig.chartType,
        name: chartConfig.title.text,
        title: chartConfig.title.text,
        config: chartConfig,
        data: chartConfig.data,
        query: sqlQuery,
        dataSourceId: selectedDataSource,
        rawData: chartConfig.rawData,
      };
      onChartCreate(chartWidget);
    }
  };

  const saveChartAsset = async (assetData: any, successMessage: string) => {
    try {
      const response = await authenticatedFetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assetData),
      });
      const responseText = await response.text().catch(() => '');
      let result: any = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
        }
      }
      if (response.status === 401) {
        message.error(t('auth_required_chart'));
        return null;
      }
      if (!response.ok) {
        const errorMsg = result?.error || result?.detail || result?.message || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }
      if (!result || !(result.id || result.asset_id)) {
        throw new Error('Save failed - unexpected response format');
      }
      message.success(successMessage);
      return result;
    } catch (error: any) {
      console.error('Failed to save chart:', error);
      message.error(`Failed to save chart: ${error.message || 'Unknown error'}`);
      return null;
    }
  };

  const handleAIGenerate = async () => {
    if (!aiAssistantInput.trim()) {
      message.warning(t('enter_query_description'));
      return;
    }

    if (!selectedDataSourceId) {
      message.warning(t('select_ds_first'));
      return;
    }

    setAiGenerating(true);
    try {
      // authenticatedFetch (fetchApi) returns parsed JSON on success or throws on error
      const result = await authenticatedFetch('/api/ai/query-editor/generate-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: aiAssistantInput.trim(),
          data_source_id: selectedDataSourceId,
          language: editorLanguage, // 'sql' or 'python'
          current_sql: sqlQuery.trim() || undefined, // Send current SQL from editor
        }),
      });
      console.log('AI generation result (Query Editor):', {
        success: result.success,
        hasCode: !!result.code,
        codeLength: result.code?.length || 0,
        language: result.language,
        // Only log first 100 chars of code to avoid spam
        codePreview: result.code?.substring(0, 100) || 'N/A',
      });

      if (result.success && result.code) {
        // Backend already validates and cleans SQL properly - trust the response
        const desiredLanguage: QueryLanguage = result.language ? resolveLanguage(result.language) : editorLanguage;
        const generatedCode = result.code.trim();

        // Show validation warning if present (backend validation found issues but query is still usable)
        if (result.validation_warning) {
          message.warning({
            content: `Validation warning: ${result.validation_warning}`,
            duration: 5,
          });
        }

        console.log('✅ Generated code received from backend (already validated and cleaned):', {
          codeLength: generatedCode.length,
          language: desiredLanguage,
          hasValidationWarning: !!result.validation_warning,
          preview: generatedCode.substring(0, 100) + '...',
        });

        // Update the active query tab with generated code
        if (queryTabs.length > 0) {
          // Use activeQueryKey (the correct variable name)
          const currentActiveKey = activeQueryKey || queryTabs[0]?.key;
          const activeTab = queryTabs.find((t) => t.key === currentActiveKey) || queryTabs[0];
          const nextLanguage: QueryLanguage = desiredLanguage;

          const updatedTabs = queryTabs.map((t) =>
            t.key === activeTab.key
              ? {
                  ...t,
                  sql: nextLanguage === 'sql' ? generatedCode : t.sql,
                  python: nextLanguage === 'python' ? generatedCode : t.python,
                  language: nextLanguage,
                }
              : t
          );
          setQueryTabs(updatedTabs);

          // CRITICAL: Update editor value - code is ready to run directly
          setSqlQuery(generatedCode);

          // Update editor language if needed
          setEditorLanguage(nextLanguage);
        } else {
          // Create new tab if none exists
          const newTabKey = `query-${Date.now()}`;
          const nextLanguage: QueryLanguage = desiredLanguage;
          const newTab = {
            key: newTabKey,
            title: 'Query 1',
            sql: nextLanguage === 'sql' ? generatedCode : DEFAULT_SQL_SNIPPET,
            python:
              nextLanguage === 'python' ? generatedCode : buildPythonTemplate(generatedCode, selectedDataSource?.name),
            language: nextLanguage,
          };
          setQueryTabs([newTab]);
          setActiveQueryKey(newTabKey);
          // CRITICAL: Set the SQL query - code is ready to run directly
          setSqlQuery(generatedCode);
          setEditorLanguage(nextLanguage);
        }

        // Show simple success message - code is ready to run
        message.success({
          content: `Generated ${result.language?.toUpperCase() || 'SQL'} code successfully! Ready to run.`,
          duration: 3,
        });

        // Clear input
        setAiAssistantInput('');
      } else {
        // More detailed error message
        const errorMsg = result.error || result.detail || 'Failed to generate code. Please try again.';
        console.error('AI generation failed:', result);
        message.error({
          content: errorMsg,
          duration: 5,
        });
      }
    } catch (error: any) {
      console.error('AI generation error:', error);
      const errorMessage = error?.message || error?.toString() || 'Failed to generate code. Please try again.';
      message.error({
        content: `Error: ${errorMessage}`,
        duration: 5,
      });
    } finally {
      setAiGenerating(false);
    }
  };

  // Python execution handler
  const handleExecutePython = async () => {
    setExecuting(true);
    setLoading(true);
    setError(null);
    setExecutionTime(null);
    setResolvedEngine(null); // Clear resolved engine when starting new execution
    setExecutionStatus('Executing Python script...');

    try {
      const startTime = Date.now();

      // Determine data source id
      const dsId = selectedDataSource?.id || selectedDataSourceId || '';
      if (!dsId) {
        throw new Error(
          'No data source selected. Please select a data source from the left panel before executing your script.'
        );
      }

      if (!sqlQuery.trim()) {
        throw new Error('Please enter a Python script to execute.');
      }

      setExecutionStatus('Executing Python script...');

      // Execute Python script - extract SQL from Python and execute it
      // The generated Python code should contain SQL that we can extract and execute
      // For now, we'll execute the Python code which should call the API internally
      // In the future, we can add a dedicated Python execution endpoint

      // Extract SQL query from Python code if it contains API calls
      const pythonCode = sqlQuery;
      const sqlMatch = pythonCode.match(/sql_query\s*=\s*['"`]([\s\S]*?)['"`]/i);
      const extractedSQL = sqlMatch ? sqlMatch[1] : null;

      if (extractedSQL) {
        // If Python code contains SQL, execute the SQL directly
        const engineParam = selectedEngine && selectedEngine !== 'auto' ? selectedEngine : undefined;
        const result = await enhancedDataService.executeMultiEngineQuery(extractedSQL, dsId, engineParam);

        const executionTime = Date.now() - startTime;

        if (result && result.success) {
          let resultData = result.data || [];
          if (!Array.isArray(resultData)) {
            resultData = resultData ? [resultData] : [];
          }

          setResults(resultData);
          setExecutionTime(result.execution_time || executionTime);
          // Update resolved engine state for display
          const resolvedEngineValue = result.engine || (engineParam as string) || 'auto';
          setResolvedEngine(resolvedEngineValue);
          setExecutionStatus('Python script completed successfully');
          setActiveTab('results');

          if (onQueryResult) {
            onQueryResult({
              data: resultData,
              columns: result.columns || [],
              rowCount: result.row_count || resultData.length,
              executionTime: result.execution_time || executionTime,
              query: extractedSQL,
              dataSourceId: dsId,
            });
          }

          message.success(`Python script executed successfully! (${executionTime}ms)`);
        } else {
          throw new Error(result.error || 'Python script execution failed');
        }
      } else {
        // If no SQL found, show info message
        message.info(
          'Python execution: The script should contain SQL queries that will be executed. For now, please use SQL queries directly.'
        );
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.toString() || 'Failed to execute Python script';
      console.error('❌ Python execution error:', err);
      setError(errorMessage);
      setExecutionStatus('Python execution failed');
      message.error(`Python execution failed: ${errorMessage}`);
    } finally {
      setExecuting(false);
      setLoading(false);
    }
  };

  const handleExecuteQuery = async () => {
    setExecuting(true);
    setLoading(true);
    setError(null);
    setExecutionTime(null);
    setResolvedEngine(null); // Clear resolved engine when starting new execution
    setResolvedEngine(null); // Clear resolved engine when starting new execution
    setExecutionStatus('Analyzing query...');
    let executedSql = sqlQuery;
    let appendedLimit = false;

    try {
      const startTime = Date.now();

      // Respect the limit the user has set: use LIMIT/TOP in the SQL if present; otherwise use Row Limit control (or no limit if "All").
      if (editorLanguage === 'sql' && !isPromqlDataSource) {
        const existingLimit = extractLimitFromQuery(sqlQuery);
        const limitInQuery = existingLimit !== null || limitSource === 'query';
        if (!limitInQuery && rowLimit !== 'all') {
          const parsedLimit = parseInt(rowLimit, 10);
          if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
            executedSql = appendLimitClause(sqlQuery, parsedLimit, selectedDataSource?.db_type);
            appendedLimit = true;
          }
        }
      }

      // Determine data source id - prioritize selectedDataSource from EnhancedDataPanel
      const dsId = selectedDataSource?.id || selectedDataSourceId || '';
      if (!dsId) {
        throw new Error(
          'No data source selected. Please select a data source from the left panel before executing your query.'
        );
      }

      // Log for debugging - include full context
      console.log('🔍 Executing query:', {
        sql: executedSql.substring(0, 200),
        dataSourceId: dsId,
        dataSourceName: selectedDataSource?.name,
        dataSourceType: selectedDataSource?.type,
        dataSourceDbType: selectedDataSource?.db_type,
        selectedDatabase: selectedDataSourceId || '',
        engine: selectedEngine,
        availableTables: (schema?.tables || []).map((t: any) => t.name).slice(0, 10), // Show first 10 tables
      });

      // Warn if query references a table that might not exist in current data source (SQL sources only)
      const queryLower = executedSql.toLowerCase();
      const fromMatch = queryLower.match(/from\s+([a-z0-9_\.]+)/);
      const schemaTables = schema?.tables || [];
      if (!isPromqlDataSource && fromMatch && schemaTables.length > 0) {
        const referencedTable = fromMatch[1].split('.').pop()?.toLowerCase();
        const tableExists = schemaTables.some((t: any) => t.name?.toLowerCase() === referencedTable);
        if (!tableExists) {
          const availableTableNames = schemaTables
            .map((t: any) => t.name)
            .filter(Boolean)
            .join(', ');
          console.warn(
            `⚠️ Query references table '${referencedTable}' which may not exist in data source '${selectedDataSource?.name}'. Available tables: ${availableTableNames}`
          );
        }
      }

      if (!executedSql.trim()) {
        throw new Error(
          editorLanguage === 'sql' && isPromqlDataSource
            ? t('enter_promql')
            : 'Please enter a SQL query to execute.'
        );
      }

      setExecutionStatus('Executing query...');

      // Use enhancedDataService to run multi-engine queries (server-side routing)
      // If engine is 'auto' or empty, pass undefined to let backend auto-select
      const engineParam = selectedEngine && selectedEngine !== 'auto' ? selectedEngine : undefined;
      const result = await enhancedDataService.executeMultiEngineQuery(executedSql, dsId, engineParam);

      const executionTime = Date.now() - startTime;

      if (result && result.success) {
        // Ensure results are properly set - handle both array and object formats
        let resultData = result.data || [];

        // Handle case where data might not be an array
        if (!Array.isArray(resultData)) {
          console.warn('⚠️ Result data is not an array, converting:', typeof resultData, resultData);
          resultData = resultData ? [resultData] : [];
        }

        console.log('✅ Query result received:', {
          success: result.success,
          dataLength: resultData.length,
          dataType: Array.isArray(resultData) ? 'array' : typeof resultData,
          firstRow: resultData.length > 0 ? resultData[0] : null,
          columns: result.columns || [],
          engine: result.engine,
          rowCount: result.row_count || resultData.length,
        });

        // Log if data is empty but success is true
        if (resultData.length === 0) {
          console.warn('⚠️ Query executed successfully but returned no data rows');
          message.info(t('query_no_results_success'));
        }

        setResults(resultData);
        setExecutionTime(result.execution_time || executionTime);
        // Update resolved engine state for display
        const resolvedEngineValue = result.engine || (engineParam as string) || 'auto';
        setResolvedEngine(resolvedEngineValue);
        setExecutionStatus('Query completed successfully');

        // Switch to results tab to show the results (even if empty, so user can see the status)
        setActiveTab('results');

        if (onQueryResult) {
          onQueryResult({
            data: result.data || [],
            columns: result.columns || [],
            rowCount: result.row_count || (result.data || []).length,
            executionTime: result.execution_time || executionTime,
            query: executedSql,
            dataSourceId: dsId,
          });
        }

        const durationMs = result.execution_time || executionTime;
        const historyItem = {
          id: Date.now(),
          state: 'success',
          started: new Date().toLocaleTimeString(),
          duration: `00:00:${(durationMs / 1000).toFixed(2)}`,
          progress: 100,
          rows: result.row_count || (result.data || []).length,
          sql: executedSql,
          status: 'success',
          database: selectedDataSourceId || '',
          schema: selectedSchema,
          user: 'current_user',
          queryType: sqlQuery.trim().toUpperCase().split(' ')[0],
          engine: result.engine || (engineParam as string) || 'unknown',
        };

        setQueryHistory(prev => [historyItem, ...prev.slice(0, 49)]);
        try {
          await authenticatedFetch('/api/queries/execution-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_source_id: selectedDataSourceId || '',
              sql: executedSql,
              status: 'success',
              rows: historyItem.rows,
              engine: historyItem.engine,
              duration_ms: durationMs
            })
          });
        } catch (_) { /* persist best-effort */ }
        if (appendedLimit) {
          const limitLabel = Number(rowLimit).toLocaleString();
          message.info(`Applied row limit of ${limitLabel} rows.`);
        }
        message.success(
          `Query executed successfully using ${historyItem.engine}. ${(historyItem.rows || 0).toLocaleString()} rows returned.`
        );
      } else {
        setExecutionStatus('Query failed');
        setSelectedEngine('unknown');
        throw new Error(result.error || 'Query execution failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed';
      setExecutionStatus('Query failed');
      setSelectedEngine('unknown');
      setError(errorMessage);
      setLoading(false);
      // Remove duplicate message.error to avoid confusion - error is now displayed in Alert
      console.error('Query execution error:', error);

      // Add failed query to history
      const historyItem = {
        id: Date.now(),
        state: 'error',
        started: new Date().toLocaleTimeString(),
        duration: '00:00:00.00',
        progress: 0,
        rows: 0,
        sql: executedSql,
        status: 'error',
        database: selectedDataSourceId || '',
        schema: selectedSchema,
        user: 'current_user',
        queryType: sqlQuery.trim().toUpperCase().split(' ')[0],
        engine: 'error',
        error: errorMessage,
      };

      setQueryHistory(prev => [historyItem, ...prev.slice(0, 49)]);
      try {
        await authenticatedFetch('/api/queries/execution-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data_source_id: selectedDataSourceId || '',
            sql: executedSql,
            status: 'error',
            rows: 0,
            engine: 'error',
            error_message: errorMessage
          })
        });
      } catch (_) { /* persist best-effort */ }
    } finally {
      setExecuting(false);
      setLoading(false);
    }
  };

  // Keep run handler ref updated so shortcuts (window + Monaco Ctrl+Enter) always invoke latest
  useEffect(() => {
    runHandlerRef.current = () => {
      if (editorLanguageRef.current === 'python') handleExecutePython();
      else handleExecuteQuery();
    };
  }, [handleExecuteQuery, handleExecutePython, editorLanguage]);

  // After Re-run from history: when sqlQuery updates to match pending rerun SQL, execute once
  useEffect(() => {
    const pending = pendingRerunSqlRef.current;
    if (pending != null && sqlQuery.trim() === pending.trim()) {
      pendingRerunSqlRef.current = null;
      handleExecuteQuery();
    }
  }, [sqlQuery]);

  // Generate columns dynamically from query results
  const generateColumns = (data: any[]) => {
    if (!data || data.length === 0) return [];

    const firstRow = data[0];
    const columnKeys = Object.keys(firstRow);

    return columnKeys.map((key, index) => ({
      title: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
      dataIndex: key,
      key: key,
      render: (value: any) => {
        if (typeof value === 'number') {
          return value?.toLocaleString();
        }
        return value;
      },
      width: 150,
      sorter: (a: any, b: any) => {
        const aVal = a[key];
        const bVal = b[key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return aVal - bVal;
        }
        return String(aVal).localeCompare(String(bVal));
      },
    }));
  };

  const columns = generateColumns(results);

  const historyColumns = [
    {
      title: 'Status',
      key: 'status',
      render: (record: any) => (
        <Badge
          status={record.state === 'success' ? 'success' : record.state === 'running' ? 'processing' : 'error'}
          text={
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              {record.state === 'success' ? '✅ Success' : record.state === 'running' ? '🔄 Running' : '❌ Failed'}
            </span>
          }
        />
      ),
    },
    {
      title: 'Started',
      dataIndex: 'started',
      key: 'started',
      render: (value: string) => <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{value}</span>,
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      render: (value: string) => <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{value}</span>,
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (record: any) => (
        <Progress
          percent={record.progress}
          size="small"
          status={record.state === 'success' ? 'success' : record.state === 'running' ? 'active' : 'exception'}
          showInfo={false}
        />
      ),
    },
    {
      title: 'Rows',
      dataIndex: 'rows',
      key: 'rows',
      render: (value: number) => value?.toLocaleString(),
    },
    {
      title: 'Engine',
      dataIndex: 'engine',
      key: 'engine',
      render: (value: string) => {
        const getEngineIcon = (engine: string) => {
          switch (engine) {
            case 'duckdb':
              return '🦆';
            case 'cube':
              return '📊';
            case 'spark':
              return '⚡';
            case 'direct_sql':
              return '🗄️';
            case 'pandas':
              return '🐼';
            case 'demo':
              return '🎯';
            case 'error':
              return '❌';
            default:
              return '🔧';
          }
        };

        return (
          <span style={{ fontSize: '11px' }}>
            {getEngineIcon(value)} {value}
          </span>
        );
      },
    },
    {
      title: 'User',
      dataIndex: 'user',
      key: 'user',
      render: (value: string) => <span style={{ fontSize: '11px' }}>{value}</span>,
    },
    {
      title: 'SQL Query',
      dataIndex: 'sql',
      key: 'sql',
      render: (value: string) => (
        <Tooltip title={value} placement="topLeft">
          <div
            style={{
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '10px',
              maxWidth: '200px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onClick={() => handleHistoryItemClick(value)}
          >
            {value}
          </div>
        </Tooltip>
      ),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      render: (record: any) => (
        <Space size="small">
          <Tooltip title={t('tooltip_load_into_editor')}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleHistoryItemClick(record.sql)}
            />
          </Tooltip>
          <Tooltip title={t('tooltip_load_and_run')}>
            <Button
              size="small"
              type="text"
              icon={<PlayCircleOutlined />}
              onClick={() => handleHistoryRerun(record)}
            />
          </Tooltip>
          <Tooltip title={t('tooltip_remove_from_history')}>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={async () => {
                const id = record?.id ?? record?.history_id;
                if (id == null) return;
                try {
                  await authenticatedFetch(`/api/queries/execution-history/${id}`, { method: 'DELETE' });
                  setQueryHistory((prev) => prev.filter((r: any) => (r.id ?? r.history_id) !== id));
                  message.success(t('removed_from_history'));
                } catch (err: any) {
                  message.error(err?.message || t('delete_failed'));
                }
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ant-color-bg-layout)',
        color: 'var(--ant-color-text)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Top Bar removed per UX request */}

      {/* Main Content - Two Column Layout - Match AI Chat page design */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isStackedLayout ? 'column' : 'row',
          gap: isStackedLayout ? 16 : 0,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Main Panel - SQL Editor & Results */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
          height: '100%',
          maxHeight: '100%'
        }}>
          {/* Aicser AI Assistant Prompt Bar */}
          <div style={{
            padding: '8px 16px',
            background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
            flexShrink: 0,
            borderRadius: '8px 8px 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Tooltip
                title={
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t('ai_assistant_title')}</div>
                    <div style={{ fontSize: '12px' }}>{t('ai_assistant_hint')}</div>
                    <div style={{ fontSize: '11px', marginTop: '6px', color: 'var(--ant-color-text-secondary)' }}>
                      {t('ai_assistant_example')}
                    </div>
                  </div>
                }
                placement="bottomLeft"
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <AnimatedAIAvatar
                    size={24}
                    isSpeaking={!!aiAssistantInput && !aiGenerating}
                    isThinking={aiGenerating}
                  />
                </div>
              </Tooltip>
              <Input
                placeholder={t('ai_assistant_placeholder')}
                style={{ flex: 1, height: '36px', borderRadius: '6px' }}
                size="middle"
                value={aiAssistantInput}
                onChange={(e) => setAiAssistantInput(e.target.value)}
                onPressEnter={handleAIGenerate}
                disabled={aiGenerating}
              />
              <Button
                size="middle"
                type="primary"
                icon={<RocketOutlined />}
                style={{
                  height: '36px',
                  borderRadius: '6px',
                  flexShrink: 0,
                }}
                onClick={handleAIGenerate}
                loading={aiGenerating}
                disabled={!selectedDataSourceId || !aiAssistantInput.trim()}
              >
                Generate {editorLanguage === 'python' ? 'Python' : 'SQL'}
              </Button>
            </div>
          </div>

          {/* Query workspace: two panels at same level - (1) Editor+Run (2) Results - resize between them */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
              maxHeight: '100%',
              height: '100%',
              background: 'var(--ant-color-bg-container)',
              border: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
              borderRadius: '8px',
            }}
          >
            {/* Top panel: Tabs + Editor + Run (fixed height, flexShrink: 0 - never goes under results) */}
            <div style={{
              height: editorHeight,
              minHeight: MIN_TOP_SECTION_HEIGHT,
              maxHeight: maxEditorHeight,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)'
            }}>
            {/* Query Tabs - inside top panel so they move with editor+run */}
            <div style={{ padding: '4px 16px', flexShrink: 0, background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Language Switcher */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--ant-color-text-secondary)' }}>{t('label_language')}</Text>
                <Select
                  value={editorLanguage}
                  onChange={(val) => {
                    const nextLanguage = resolveLanguage(val as string);
                    if (nextLanguage === editorLanguage) return;
                    const currentActiveKey = activeQueryKeyRef.current;
                    const activeTab = queryTabs.find(t => t.key === currentActiveKey);
                    const pythonText = getPythonTemplate(activeTab, selectedDataSource?.name);
                    setQueryTabs(prev => prev.map(t => {
                      if (t.key !== currentActiveKey) return t;
                      if (nextLanguage === 'python') {
                        return { ...t, python: pythonText, language: nextLanguage };
                      }
                      return { ...t, language: nextLanguage };
                    }));
                    setEditorLanguage(nextLanguage);
                    if (nextLanguage === 'python') {
                      setSqlQuery(pythonText);
                    } else {
                      setSqlQuery(activeTab?.sql ?? DEFAULT_SQL_SNIPPET);
                    }
                  }}
                  size="small"
                  style={{ width: 120 }}
                  options={[
                    { value: 'sql', label: 'SQL' },
                    // { value: 'python', label: 'Python' }
                  ]}
                />
              </div>
              <Tabs
                size="small"
                type="editable-card"
                hideAdd={false}
                activeKey={activeQueryKey}
                tabBarExtraContent={
                  <Space size="small" style={{ marginLeft: 8 }}>
                    <Tooltip title={t('tooltip_save_query_script')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<SaveOutlined />}
                        aria-label={t('aria_save_to_saved_queries')}
                        onClick={async () => {
                          const tab = queryTabs.find(t => t.key === activeQueryKey);
                          const name = (tab?.title || '').trim() || `Query ${queryTabs.length + 1}`;
                          const content = latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
                          if (!content) {
                            message.warning(t('no_query_to_save'));
                            return;
                          }
                          try {
                            await authenticatedFetch(savedQueriesUrl, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name,
                                sql: content,
                                metadata: { tabKey: tab?.key, language: editorLanguage }
                              })
                            });
                            message.success(t('saved_to_list', { name }));
                            setShowSavedModal(true);
                            const [savedRes] = await Promise.all([
                              authenticatedFetch(savedQueriesUrl).catch(() => ({ items: [] }))
                            ]);
                            setSavedQueries(Array.isArray((savedRes as any)?.items) ? (savedRes as any).items.filter(Boolean) : []);
                          } catch (e: unknown) {
                            const err = e as { message?: string };
                            message.error(err?.message || t('save_failed_name_exists'));
                          }
                        }}
                      />
                    </Tooltip>
                    <Tooltip title={t('tooltip_save_result_snapshot')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<FileTextOutlined />}
                        aria-label={t('aria_save_as_snapshot')}
                        onClick={() => {
                          const tab = queryTabs.find(t => t.key === activeQueryKey);
                          setSaveSnapshotName(tab?.title ? `${t('snapshot')}: ${tab.title}` : `${t('snapshot')} ${new Date().toISOString().slice(0, 10)}`);
                          setShowSaveSnapshotModal(true);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title={editorLanguage === 'python' ? t('tooltip_download_py') : t('tooltip_download_sql')}>
                      <Button type="text" size="small" icon={<DownloadOutlined />} aria-label={t('aria_download_tab_as_file')} onClick={downloadCurrentQueryAsFile} disabled={!sqlQuery.trim()} />
                    </Tooltip>
                    <Tooltip title={t('tooltip_saved_queries_snapshots')}>
                      <Button type="text" size="small" icon={<UnorderedListOutlined />} aria-label={t('aria_saved_queries_snapshots')} onClick={() => setShowSavedModal(true)} />
                    </Tooltip>
                  </Space>
                }
                onChange={(key) => {
                  // Prefer ref (updated on every keystroke), then editor.getValue(), then state (avoids losing changes due to 300ms debounce)
                  const fromRef = latestEditorContentRef.current;
                  const fromEditor = typeof editorInsertRef.current?.getValue === 'function' ? editorInsertRef.current.getValue() : '';
                  const liveContent = (fromRef && fromRef.trim() !== '') ? fromRef : (fromEditor || sqlQuery);
                  const merged = queryTabs.map(t => {
                    if (t.key !== activeQueryKey) return t;
                    if (editorLanguage === 'python') {
                      return { ...t, python: liveContent, language: editorLanguage };
                    }
                    return { ...t, sql: liveContent, language: editorLanguage };
                  });
                  setQueryTabs(merged);
                  saveTabsToBackend(merged, activeQueryKey, true);

                  setActiveQueryKey(key);
                  const tab = merged.find(t => t.key === key);
                  if (tab) {
                    const nextLanguage = resolveLanguage(tab.language);
                    const nextContent = nextLanguage === 'python' ? getPythonTemplate(tab, selectedDataSource?.name) : (tab.sql ?? DEFAULT_SQL_SNIPPET);
                    setEditorLanguage(nextLanguage);
                    setSqlQuery(nextContent);
                    latestEditorContentRef.current = nextContent;
                  }
                }}
                onEdit={(targetKey, action) => {
                  if (action === 'add') {
                    const newKey = `q-${Date.now()}`;
                    const defaultPython = buildPythonTemplate(DEFAULT_SQL_SNIPPET, selectedDataSource?.name);
                    const newTitle = getNextDefaultTabTitle(queryTabs);
                    const newTab = {
                      key: newKey,
                      title: newTitle,
                      sql: DEFAULT_SQL_SNIPPET,
                      python: defaultPython,
                      language: editorLanguage
                    };
                    const next = [...queryTabs, newTab];
                    setQueryTabs(next);
                    setActiveQueryKey(newKey);
                    setSqlQuery(editorLanguage === 'python' ? defaultPython : DEFAULT_SQL_SNIPPET);
                    saveTabsToBackend(next, newKey, true);
                  } else if (action === 'remove') {
                    const key = String(targetKey);
                    const idx = queryTabs.findIndex(t => t.key === key);
                    const newTabs = queryTabs.filter(t => t.key !== key);
                    const nextActiveKey = activeQueryKey === key && newTabs.length
                      ? newTabs[Math.max(0, idx - 1)].key
                      : activeQueryKey;
                    setQueryTabs(newTabs);
                    if (activeQueryKey === key && newTabs.length) {
                      const next = newTabs[Math.max(0, idx - 1)];
                      const nextLanguage = resolveLanguage(next.language);
                      setActiveQueryKey(next.key);
                      setEditorLanguage(nextLanguage);
                      setSqlQuery(nextLanguage === 'python' ? getPythonTemplate(next, selectedDataSource?.name) : (next.sql ?? DEFAULT_SQL_SNIPPET));
                    } else if (!newTabs.length) {
                      setActiveQueryKey('');
                      setEditorLanguage('sql');
                      setSqlQuery(DEFAULT_SQL_SNIPPET);
                    }
                    saveTabsToBackend(newTabs, newTabs.length ? nextActiveKey : '', true);
                  }
                }}
                items={queryTabs.map(t => ({
                  key: t.key,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {editingTabKey === t.key ? (
                        <input
                          value={titleDraft}
                          autoFocus
                          onChange={e => setTitleDraft(e.target.value)}
                          onBlur={() => {
                            const idx = queryTabs.findIndex(x => x.key === t.key);
                            const fallbackTitle = idx >= 0 ? `Query ${idx + 1}` : t.title;
                            const newTitle = (titleDraft || '').trim() || fallbackTitle;
                            const nextTabs = queryTabs.map(x => x.key === t.key ? { ...x, title: newTitle } : x);
                            setQueryTabs(nextTabs);
                            setEditingTabKey(null);
                            saveTabsToBackend(nextTabs, activeQueryKey, true);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                          style={{ width: 100 }}
                        />
                      ) : (
                        <>
                          <span onDoubleClick={() => { setEditingTabKey(t.key); setTitleDraft(t.title ?? ''); }}>{t.title}</span>
                          {/* <Tooltip title="Save this query">
                    setQueryTabs(prev => [...prev, newTab]);
                    setActiveQueryKey(newKey);
                    setSqlQuery(editorLanguage === 'python' ? defaultPython : DEFAULT_SQL_SNIPPET);
                  } else if (action === 'remove') {
                    const key = String(targetKey);
                    const idx = queryTabs.findIndex(t => t.key === key);
                    const newTabs = queryTabs.filter(t => t.key !== key);
                    const nextActiveKey = activeQueryKey === key && newTabs.length
                      ? newTabs[Math.max(0, idx - 1)].key
                      : activeQueryKey;
                    setQueryTabs(newTabs);
                    if (activeQueryKey === key && newTabs.length) {
                      const next = newTabs[Math.max(0, idx - 1)];
                      const nextLanguage = resolveLanguage(next.language);
                      setActiveQueryKey(next.key);
                      setEditorLanguage(nextLanguage);
                      setSqlQuery(nextLanguage === 'python' ? getPythonTemplate(next, selectedDataSource?.name) : (next.sql ?? DEFAULT_SQL_SNIPPET));
                    } else if (!newTabs.length) {
                      setActiveQueryKey('');
                      setEditorLanguage('sql');
                      setSqlQuery(DEFAULT_SQL_SNIPPET);
                    }
                    saveTabsToBackend(newTabs, newTabs.length ? nextActiveKey : '', true);
                  }
                }}
                items={queryTabs.map(t => ({
                  key: t.key,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {editingTabKey === t.key ? (
                        <input
                          value={titleDraft}
                          autoFocus
                          onChange={e => setTitleDraft(e.target.value)}
                          onBlur={() => {
                            const idx = queryTabs.findIndex(x => x.key === t.key);
                            const fallbackTitle = idx >= 0 ? `Query ${idx + 1}` : t.title;
                            const newTitle = (titleDraft || '').trim() || fallbackTitle;
                            const nextTabs = queryTabs.map(x => x.key === t.key ? { ...x, title: newTitle } : x);
                            setQueryTabs(nextTabs);
                            setEditingTabKey(null);
                            saveTabsToBackend(nextTabs, activeQueryKey, true);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                          style={{ width: 100 }}
                        />
                      ) : (
                        <>
                          <span onDoubleClick={() => { setEditingTabKey(t.key); setTitleDraft(t.title ?? ''); }}>{t.title}</span>
                          {/* <Tooltip title="Save this query">
                          <Button
                            type="text"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={async (e) => {
                              e.stopPropagation();
                              // Get current SQL from editor if this is the active tab
                          const baseLanguage = resolveLanguage(t.language);
                          const isActiveTab = t.key === activeQueryKey;
                          const currentSql = baseLanguage === 'python'
                            ? (isActiveTab ? sqlQuery : getPythonTemplate(t, selectedDataSource?.name))
                            : (isActiveTab ? sqlQuery : (t.sql ?? DEFAULT_SQL_SNIPPET));
                              try {
                                // Check for duplicate name first
                                const checkRes = await authenticatedFetch(savedQueriesUrl);
                                if (checkRes.ok) {
                                  const checkData = await checkRes.json();
                                  const existingQueries = Array.isArray(checkData.items) ? checkData.items : [];
                                  const duplicate = existingQueries.find((q: any) => q.name === t.title);
                                  if (duplicate) {
                                    message.warning(`Query name "${t.title}" already exists. Please rename the tab first.`);
                                    return;
                                  }
                                }
                                
                                const res = await authenticatedFetch(savedQueriesUrl, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ 
                                    name: t.title, 
                                    sql: currentSql, 
                                    metadata: { 
                                      language: baseLanguage,
                                      tabKey: t.key 
                                    } 
                                  })
                                });
                                if (res.status === 403 || res.status === 401) { 
                                  setPermissionModalVisible(true); 
                                  return; 
                                }
                                if (!res.ok) {
                                  const errorData = await res.json().catch(() => ({ detail: res.statusText }));
                                  const errorMsg = errorData.detail || errorData.error || 'Failed to save';
                                  if (errorMsg.includes('already exists')) {
                                    message.warning(errorMsg);
                                  } else {
                                    message.error(errorMsg);
                                  }
                                  return;
                                }
                                message.success(`Query "${t.title}" saved successfully`);
                                // Reload saved queries
                                const reload = await authenticatedFetch(savedQueriesUrl);
                                if (reload.ok) { 
                                  const j = await reload.json(); 
                                  setSavedQueries(Array.isArray(j.items) ? j.items : []); 
                                }
                              } catch (err: any) {
                                message.error(err.message || 'Failed to save query');
                              }
                            }}
                            style={{ padding: '0 4px', height: '20px' }}
                          />
                        </Tooltip> */}
                          </>
                        )}
                      </div>
                    ),
                  }))}
                />
                {/* Saved Queries icon - moved to right of tabs */}
                {/* <Tooltip title="Show Saved Queries & Snapshots">
                        </>
                      )}
                    </div>
                  )
                }))}
              />
              {/* Saved Queries icon - moved to right of tabs */}
                {/* <Tooltip title="Show Saved Queries & Snapshots">
              <Button 
                size="small" 
                icon={<FolderOutlined />}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  padding: '0 4px'
                }}
                onClick={async () => {
                  try {
                    const res = await authenticatedFetch(savedQueriesUrl);
                    if (res.status === 403 || res.status === 401) { 
                      setPermissionModalVisible(true); 
                      return; 
                    }
                    if (res.ok) {
                      const j = await res.json();
                      setSavedQueries(Array.isArray(j.items) ? j.items : []);
                      // Also load snapshots
                      const snapRes = await authenticatedFetch(snapshotsUrl);
                      if (snapRes.ok) {
                        const snapJ = await snapRes.json();
                        setSnapshots(Array.isArray(snapJ.items) ? snapJ.items : []);
                      }
                      setShowSavedModal(true);
                    } else { 
                      message.error(t('load_saved_queries_failed')); 
                    }
                  } catch (err: any) { 
                    message.error(t('load_saved_queries_failed')); 
                  }
                }} 
              />
            </Tooltip> */}
              </div>

              {/* SQL Editor - fills space between Tabs and Run bar */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  padding: '16px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  <MemoryOptimizedEditor
                    ref={editorInsertRef}
                    height="100%"
                    language={monacoEditorLanguage}
                    theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                    value={sqlQuery}
                    onContentChange={(v) => { latestEditorContentRef.current = v ?? ''; }}
                    onMonacoMount={handleMonacoMount}
                    onChange={(value) => {
                      const v = value || '';
                      const currentActiveKey = activeQueryKeyRef.current;
                      setSqlQuery(v);
                      setQueryTabs(prev => prev.map(t => {
                        if (t.key !== currentActiveKey) return t;
                        if (editorLanguage === 'python') {
                          return { ...t, python: v, language: editorLanguage };
                        }
                        return { ...t, sql: v, language: editorLanguage };
                      }));
                    }}
                    enableSuggestions={editorLanguage === 'sql' && !isPromqlDataSource}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      roundedSelection: false,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'on',
                      suggestOnTriggerCharacters: true,
                      quickSuggestions: editorLanguage === 'sql' ? { other: true, comments: false, strings: true } : false,
                      quickSuggestionsDelay: 50,
                      parameterHints: { enabled: editorLanguage === 'sql' },
                      scrollbar: {
                        vertical: 'visible',
                        horizontal: 'visible',
                      },
                    }}
                  />
                </div>
              </div>

              {/* Query Controls & Execute Button - part of top section */}
            <div style={{
              padding: '8px 16px',
              borderTop: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
              background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
              flexShrink: 0
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    size="middle"
                    loading={isExecuting}
                    onClick={() => runHandlerRef.current?.()}
                    disabled={isLoadingSchema || !sqlQuery.trim() || !selectedDataSourceId}
                  >
                    {editorLanguage === 'python'
                      ? t('run_python')
                      : isPromqlDataSource
                        ? t('run_promql')
                        : t('run_sql')}
                  </Button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text style={{ fontSize: 'var(--font-size-sm)' }}>{t('label_row_limit')}</Text>
                    <Space size={4}>
                      <Select
                        value={rowLimit}
                        onChange={handleRowLimitChange}
                        style={{ width: '100px' }}
                        size="small"
                        disabled={limitSource === 'query'}
                        options={rowLimitOptions}
                      />
                      {limitSource === 'query' && (
                        <Tooltip title={t('limit_detected_in_sql')}>
                          <Tag color="blue" style={{ margin: 0 }}>{t('in_sql')}</Tag>
                        </Tooltip>
                      )}
                    </Space>
                  </div>
                </div>

                  {/* Harmonized Engine selector with status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text style={{ fontSize: 'var(--font-size-sm)' }}>{t('label_engine')}</Text>
                    <Select
                      value={selectedEngine}
                      onChange={(val) => {
                        setSelectedEngine(val);
                        setResolvedEngine(null); // Clear resolved engine when user changes selection
                      }}
                      size="small"
                      style={{ width: 140 }}
                      placeholder="Select engine"
                      options={[
                        { value: 'auto', label: 'Auto' },
                        ...enhancedDataService
                          .getAvailableQueryEngines()
                          .map((e) => ({ value: e.type, label: e.name })),
                      ]}
                    />
                    {/* Show resolved engine status after execution */}
                    {resolvedEngine && !isExecuting && (
                      <Tag color="success" style={{ margin: 0 }}>
                        <ThunderboltOutlined style={{ marginRight: '4px' }} />
                        {resolvedEngine}
                      </Tag>
                    )}
                    {/* Show execution status */}
                    {isExecuting && (
                      <Tag color="processing" style={{ margin: 0 }}>
                        <SyncOutlined spin style={{ marginRight: '4px' }} />
                        {executionStatus || 'Executing...'}
                      </Tag>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ClockCircleOutlined style={{ fontSize: 'var(--font-size-base)' }} />
                    <Text style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}>
                      {executionTime ? `00:00:${(executionTime / 1000).toFixed(2)}` : '00:00:00.00'}
                    </Text>
                  </div>

                </div>
              </div>
            </div>

            {/* Resize handle: border between Run button and Query Results - drag to split */}
            <div
              onMouseDown={startEditorResize}
              style={{
                cursor: 'row-resize',
                height: '10px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px 16px',
                background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
                borderTop: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
              }}
              title={t('tooltip_drag_resize')}
            >
              <div
                style={{
                  width: '64px',
                  height: '3px',
                  borderRadius: '999px',
                  background: 'var(--ant-color-border)',
                }}
              />
            </div>

            {/* Error Display - tight to control bar */}
            {error && (
              <Alert
                message="Query Error"
                description={error}
                type="error"
                showIcon
                closable
                onClose={() => setError(null)}
                style={{ margin: '0 16px 8px 16px' }}
              />
            )}
            {!isQueryValid && validationMessage && (
              <Alert
                message="Query Validation"
                description={validationMessage}
                type="warning"
                showIcon
                style={{ margin: '0 16px 8px 16px' }}
              />
            )}

            {/* Results - directly under Run / errors, no extra gap */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                borderTop: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
                background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
              }}
            >
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                size="small"
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  height: '100%',
                  maxHeight: '100%',
                  overflow: 'hidden',
                }}
                tabBarStyle={{
                  margin: 0,
                  padding: '0 12px 0 16px',
                  minHeight: 40,
                  background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
                  borderBottom: `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
                  flexShrink: 0,
                }}
              >
                <TabPane tab={t('tab_query_results')} key="results">
                  <div
                    style={{
                      padding: '8px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      background: 'transparent',
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <div>
                        {executionTime && (
                          <Text type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>
                            {t('execution_time_ms', { ms: executionTime })}
                          </Text>
                        )}
                      </div>
                      <Space size="small">
                        <Tooltip title={t('save_as_snapshot')}>
                          <Button
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={() => {
                              const tab = queryTabs.find(t => t.key === activeQueryKey);
                              setSaveSnapshotName(tab?.title ? `${t('snapshot')}: ${tab.title}` : `${t('snapshot')} ${new Date().toISOString().slice(0, 10)}`);
                              setShowSaveSnapshotModal(true);
                            }}
                            disabled={results.length === 0}
                          >
                            {t('save')}
                          </Button>
                        </Tooltip>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => exportToCSV(results)}
                          disabled={results.length === 0}
                        >
                          CSV
                        </Button>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => exportToJSON(results)}
                          disabled={results.length === 0}
                        >
                          JSON
                        </Button>
                      </Space>
                    </div>
                    <div
                      className="data-content"
                      style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'transparent' }}
                    >
                      {isExecuting || loading ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            padding: '24px 16px',
                            gap: '12px',
                          }}
                        >
                          <QueryLoading
                            message={executionStatus || t('executing_query')}
                            progress={
                              executionStatus && executionStatus.toLowerCase().includes('executing') ? 50 : undefined
                            }
                          />
                          <div
                            style={{
                              textAlign: 'center',
                              maxWidth: '400px',
                              color: 'var(--ant-color-text-secondary)',
                            }}
                          >
                            <Text type="secondary" style={{ fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                              {t('please_wait_processing')}
                            </Text>
                            <Text type="secondary" style={{ fontSize: '12px' }}>
                              {t('processing_may_take_moments')}
                            </Text>
                          </div>
                        </div>
                      ) : results && results.length > 0 ? (
                        <div style={{ background: 'transparent' }}>
                          <Table
                            dataSource={results}
                            columns={columns}
                            size="small"
                            pagination={{
                              pageSize: 100,
                              showSizeChanger: true,
                              pageSizeOptions: ['50', '100', '250', '500'],
                              showTotal: (total, range) => t('rows_range_total', { from: range[0], to: range[1], total }),
                            }}
                            scroll={{ y: 'calc(100vh - 600px)' }}
                            rowKey={(record, index) => `row-${index}`}
                            style={{ background: 'transparent' }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--ant-color-text-secondary)',
                            background: 'transparent',
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 14 }}>
                            {t('no_results_to_display')}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </TabPane>
                <TabPane tab={t('tab_performance')} key="performance">
                  <div
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      maxHeight: '100%',
                      height: '100%',
                      overflow: 'hidden',
                      background: 'transparent',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, maxHeight: '100%', overflow: 'hidden' }}
                    >
                      <div
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
                      >
                        <Space style={{ marginBottom: 8, flexShrink: 0 }}>
                          <Button
                            type="primary"
                            size="small"
                            icon={<BulbOutlined />}
                            loading={perfLoading}
                            onClick={async () => {
                              if (!selectedDataSourceId && !selectedDataSource?.id) {
                                message.warning(t('select_ds_analyze'));
                                return;
                              }
                              if (!sqlQuery || !sqlQuery.trim()) {
                                message.warning(t('enter_sql_analyze'));
                                return;
                              }
                              setPerfLoading(true);
                              setPerfPlan(null);
                              setPerfSuggestions([]);
                              try {
                                const dataSourceId = selectedDataSource?.id || selectedDataSourceId || '';
                                const res = await authenticatedFetch(`/api/data/sources/${dataSourceId}/analyze`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ sql: sqlQuery }),
                                });

                                if (!res.ok) {
                                  const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                                  throw new Error(errorData.error || errorData.detail || `HTTP ${res.status}`);
                                }

                                const j = await res.json();
                                if (j.success) {
                                  setPerfPlan(j.plan);
                                  setPerfSuggestions(j.suggestions || []);
                                  message.success(
                                    `Analysis complete${j.suggestions?.length ? ` - ${j.suggestions.length} suggestions` : ''}`
                                  );
                                } else {
                                  throw new Error(j.error || j.detail || 'Analysis failed');
                                }
                              } catch (e: any) {
                                console.error('Performance analysis failed:', e);
                                message.error(e.message || 'Analysis failed. Please check your query and try again.');
                                setPerfPlan(null);
                                setPerfSuggestions([]);
                              } finally {
                                setPerfLoading(false);
                              }
                            }}
                          >
                            {t('analyze_query_performance')}
                          </Button>
                          {perfPlan && (
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(perfPlan, null, 2));
                                message.success(t('plan_copied'));
                              }}
                            >
                              Copy Plan
                            </Button>
                          )}
                        </Space>
                        <Card
                          size="small"
                          title={
                            <Space>
                              <BulbOutlined />
                              <span>{t('performance_suggestions')}</span>
                              {perfSuggestions.length > 0 && (
                                <Badge count={perfSuggestions.length} style={{ backgroundColor: '#52c41a' }} />
                              )}
                            </Space>
                          }
                          style={{
                            marginBottom: 8,
                            flexShrink: 0,
                            background: 'transparent',
                          }}
                          bodyStyle={{ background: 'transparent', padding: '12px' }}
                        >
                          <div
                            className="data-content"
                            style={{
                              maxHeight: '200px',
                              overflowY: 'auto',
                              overflowX: 'hidden',
                              background: 'transparent',
                              paddingRight: '8px',
                              paddingBottom: '4px',
                              scrollbarGutter: 'stable',
                              scrollBehavior: 'smooth',
                            }}
                          >
                            {perfSuggestions.length ? (
                              <ul style={{ paddingLeft: 18, margin: 0, listStyle: 'disc' }}>
                                {perfSuggestions.map((s, i) => (
                                  <li key={i} style={{ fontSize: 12, marginBottom: '6px', lineHeight: '1.5' }}>
                                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: '6px' }} />
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <Text
                                type="secondary"
                                style={{ fontSize: 12, background: 'transparent', fontStyle: 'italic' }}
                              >
                                {perfLoading
                                  ? 'Analyzing query...'
                                  : t('no_suggestions_yet')}
                              </Text>
                            )}
                          </div>
                        </Card>
                        <Card
                          size="small"
                          title={
                            <Space>
                              <FileTextOutlined />
                              <span>{t('execution_plan')}</span>
                              {perfPlan && <Tag color="success">{t('available')}</Tag>}
                            </Space>
                          }
                          style={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'transparent',
                          }}
                          bodyStyle={{
                            flex: 1,
                            minHeight: 0,
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'transparent',
                          }}
                          extra={
                            perfPlan && (
                              <Button
                                size="small"
                                type="text"
                                icon={<CopyOutlined />}
                                onClick={() => {
                                  navigator.clipboard.writeText(JSON.stringify(perfPlan, null, 2));
                                  message.success(t('plan_copied_short'));
                                }}
                              >
                                Copy
                              </Button>
                            )
                          }
                        >
                          <div
                            className="data-content"
                            style={{
                              flex: 1,
                              minHeight: 0,
                              maxHeight: '100%',
                              overflowY: 'auto',
                              overflowX: 'auto',
                              background: isDarkMode ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.02)',
                              padding: '12px',
                              borderRadius: '4px',
                              paddingRight: '8px',
                              paddingBottom: '8px',
                              scrollbarGutter: 'stable',
                              scrollBehavior: 'smooth',
                            }}
                          >
                            <pre
                              style={{
                                fontSize: 11,
                                whiteSpace: 'pre-wrap',
                                margin: 0,
                                background: 'transparent',
                                fontFamily: 'monospace',
                                lineHeight: '1.5',
                              }}
                            >
                              {perfPlan ? (
                                JSON.stringify(perfPlan, null, 2)
                              ) : (
                                <Text type="secondary" style={{ fontStyle: 'italic' }}>
                                  {perfLoading
                                    ? 'Generating execution plan...'
                                    : t('no_execution_plan_yet')}
                                </Text>
                              )}
                            </pre>
                          </div>
                        </Card>
                      </div>
                      {/* <div style={{ width: 280, flexShrink: 0 }}>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => exportToCSV(results)}
                          disabled={results.length === 0}
                        >
                          CSV
                        </Button>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => exportToJSON(results)}
                          disabled={results.length === 0}
                        >
                          JSON
                        </Button>
                      </Space>
                    </div>
                    <div className="data-content" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'transparent' }}>
                      {isExecuting || loading ? (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          padding: '24px 16px',
                          gap: '12px'
                        }}>
                          <QueryLoading
                            message={executionStatus || 'Executing query...'}
                            progress={executionStatus && executionStatus.toLowerCase().includes('executing') ? 50 : undefined}
                          />
                          <div style={{
                            textAlign: 'center',
                            maxWidth: '400px',
                            color: 'var(--ant-color-text-secondary)'
                          }}>
                            <Text type="secondary" style={{ fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                              Please wait while we process your request...
                            </Text>
                            <Text type="secondary" style={{ fontSize: '12px' }}>
                              This may take a few moments depending on query complexity and data size.
                            </Text>
                          </div>
                        </div>
                      ) : results && results.length > 0 ? (
                        <div style={{ background: 'transparent' }}>
                          <Table
                            dataSource={results}
                            columns={columns}
                            size="small"
                            pagination={{
                              pageSize: 100,
                              showSizeChanger: true,
                              pageSizeOptions: ['50', '100', '250', '500'],
                              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} rows`,
                            }}
                            scroll={{ y: 'calc(100vh - 600px)' }}
                            rowKey={(record, index) => `row-${index}`}
                            style={{ background: 'transparent' }}
                          />
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          color: 'var(--ant-color-text-secondary)',
                          background: 'transparent'
                        }}>
                          <Text type="secondary" style={{ fontSize: 14 }}>
                            {t('no_results_to_display')}
                          </Text>
                        </div>
                      )}
                    </div>
                  </div>
                </TabPane>
                <TabPane tab={t('tab_performance')} key="performance">
                  <div style={{
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    maxHeight: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    background: 'transparent'
                  }}>
                    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, maxHeight: '100%', overflow: 'hidden' }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                        <Space style={{ marginBottom: 8, flexShrink: 0 }}>
                          <Button
                            type="primary"
                            size="small"
                            icon={<BulbOutlined />}
                            loading={perfLoading}
                            onClick={async () => {
                              if (!selectedDataSourceId && !selectedDataSource?.id) {
                                message.warning(t('select_ds_analyze'));
                                return;
                              }
                              if (!sqlQuery || !sqlQuery.trim()) {
                                message.warning(t('enter_sql_analyze'));
                                return;
                              }
                              setPerfLoading(true);
                              setPerfPlan(null);
                              setPerfSuggestions([]);
                              try {
                                const dataSourceId = selectedDataSource?.id || selectedDataSourceId || '';
                                const res = await authenticatedFetch(`/api/data/sources/${dataSourceId}/analyze`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ sql: sqlQuery })
                                });

                                if (!res.ok) {
                                  const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                                  throw new Error(errorData.error || errorData.detail || `HTTP ${res.status}`);
                                }

                                const j = await res.json();
                                if (j.success) {
                                  setPerfPlan(j.plan);
                                  setPerfSuggestions(j.suggestions || []);
                                  message.success(`Analysis complete${j.suggestions?.length ? ` - ${j.suggestions.length} suggestions` : ''}`);
                                } else {
                                  throw new Error(j.error || j.detail || 'Analysis failed');
                                }
                              } catch (e: any) {
                                console.error('Performance analysis failed:', e);
                                message.error(e.message || 'Analysis failed. Please check your query and try again.');
                                setPerfPlan(null);
                                setPerfSuggestions([]);
                              } finally {
                                setPerfLoading(false);
                              }
                            }}
                          >
                            {t('analyze_query_performance')}
                          </Button>
                          {perfPlan && (
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(perfPlan, null, 2));
                                message.success(t('plan_copied'));
                              }}
                            >
                              Copy Plan
                            </Button>
                          )}
                        </Space>
                        <Card
                          size="small"
                          title={
                            <Space>
                              <BulbOutlined />
                              <span>{t('performance_suggestions')}</span>
                              {perfSuggestions.length > 0 && (
                                <Badge count={perfSuggestions.length} style={{ backgroundColor: '#52c41a' }} />
                              )}
                            </Space>
                          }
                          style={{
                            marginBottom: 8,
                            flexShrink: 0,
                            background: 'transparent'
                          }}
                          bodyStyle={{ background: 'transparent', padding: '12px' }}
                        >
                          <div className="data-content" style={{
                            maxHeight: '200px',
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            background: 'transparent',
                            paddingRight: '8px',
                            paddingBottom: '4px',
                            scrollbarGutter: 'stable',
                            scrollBehavior: 'smooth'
                          }}>
                            {perfSuggestions.length ? (
                              <ul style={{ paddingLeft: 18, margin: 0, listStyle: 'disc' }}>
                                {perfSuggestions.map((s, i) => (
                                  <li key={i} style={{ fontSize: 12, marginBottom: '6px', lineHeight: '1.5' }}>
                                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: '6px' }} />
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <Text type="secondary" style={{ fontSize: 12, background: 'transparent', fontStyle: 'italic' }}>
                                {perfLoading ? t('analyzing_query') : t('no_suggestions_yet')}
                              </Text>
                            )}
                          </div>
                        </Card>
                        <Card
                          size="small"
                          title={
                            <Space>
                              <FileTextOutlined />
                              <span>{t('execution_plan')}</span>
                              {perfPlan && <Tag color="success">{t('available')}</Tag>}
                            </Space>
                          }
                          style={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'transparent'
                          }}
                          bodyStyle={{
                            flex: 1,
                            minHeight: 0,
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            background: 'transparent'
                          }}
                          extra={perfPlan && (
                            <Button
                              size="small"
                              type="text"
                              icon={<CopyOutlined />}
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(perfPlan, null, 2));
                                message.success(t('plan_copied_short'));
                              }}
                            >
                              Copy
                            </Button>
                          )}
                        >
                          <div className="data-content" style={{
                            flex: 1,
                            minHeight: 0,
                            maxHeight: '100%',
                            overflowY: 'auto',
                            overflowX: 'auto',
                            background: isDarkMode ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.02)',
                            padding: '12px',
                            borderRadius: '4px',
                            paddingRight: '8px',
                            paddingBottom: '8px',
                            scrollbarGutter: 'stable',
                            scrollBehavior: 'smooth'
                          }}>
                            <pre style={{
                              fontSize: 11,
                              whiteSpace: 'pre-wrap',
                              margin: 0,
                              background: 'transparent',
                              fontFamily: 'monospace',
                              lineHeight: '1.5'
                            }}>
                              {perfPlan ? JSON.stringify(perfPlan, null, 2) : (
                                <Text type="secondary" style={{ fontStyle: 'italic' }}>
                                  {perfLoading ? t('generating_execution_plan') : t('no_execution_plan_yet')}
                                </Text>
                              )}
                            </pre>
                          </div>
                        </Card>
                      </div>
                      {/* <div style={{ width: 280, flexShrink: 0 }}>
                    <Card 
                      size="small" 
                      title={t('materialized_views')}
                      style={{ background: 'transparent' }}
                      bodyStyle={{ background: 'transparent' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Button size="small" onClick={async () => {
                          if (!selectedDataSourceId) { message.warning(t('select_data_source')); return; }
                          const name = prompt('MV name (letters/underscores)');
                          if (!name) return;
                          try {
                            const res = await authenticatedFetch(`/api/data/sources/${selectedDataSourceId}/materialized-views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, sql: sqlQuery }) });
                            if (!res.ok) throw new Error('Create failed');
                            message.success(t('materialized_view_created'));
                          } catch { message.error(t('create_failed')); }
                        }}>{t('create_mv_from_sql')}</Button>
                        <Button size="small" onClick={async () => {
                          if (!selectedDataSourceId) { message.warning(t('select_data_source')); return; }
                          try {
                            const res = await authenticatedFetch(`/api/data/sources/${selectedDataSourceId}/materialized-views`);
                            const j = await res.json();
                            if (!res.ok) throw new Error('Load failed');
                            Modal.info({ title: 'Materialized Views', width: 520, content: (
                                <ul className="data-content" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                {(j.materialized_views||[]).map((mv:any) => <li key={`${mv.schema}.${mv.name}`}>{mv.schema}.{mv.name}</li>)}
                              </ul>
                            )});
                          } catch { message.error(t('load_failed')); }
                        }}>{t('list_mvs')}</Button>
                      </Space>
                    </Card>
                    </div> */}
                    </div>
                  </div>
                </TabPane>

                {/* Chart Preview Tab */}
                {/* <TabPane 
                    </div>
                  </div>
                </TabPane>

                {/* Chart Preview Tab */}
                {/* <TabPane 
                tab="Chart Preview" 
                key="preview"
              >
                <div style={{ 
                  padding: '0',
                  display: 'flex', 
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  height: '100%',
                  maxHeight: '100%',
                  background: 'transparent',
                  overflow: 'hidden',
                  width: '100%',
                  position: 'relative'
                }}>
                  {previewChart ? (
                      <div style={{ 
                        display: 'flex', 
                      flexDirection: 'row', 
                      flex: 1, 
                      minHeight: 0,
                      height: '100%',
                      overflow: 'hidden',
                      gap: '8px',
                      padding: '8px',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}>

                      <div style={{ 
                        flex: '1 1 70%',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        background: 'transparent',
                        overflow: 'hidden',
                        padding: '0',
                        height: '100%',
                        minHeight: 0
                      }}>
                        <div style={{
                          width: '100%',
                          height: '100%',
                          minHeight: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'stretch',
                          overflow: 'hidden',
                          position: 'relative'
                        }}>
                          <ChartWidget
                            key={`chart-${previewChart.id}-${previewChart.config?.chartType || previewChart.type}-${previewChart.config?.colorPalette || 'default'}-${previewChart.config?.legendShow !== false ? 'legend' : 'no-legend'}-${previewChart.config?.tooltipShow !== false ? 'tooltip' : 'no-tooltip'}-${previewChart.config?.showGrid !== false ? 'grid' : 'no-grid'}`}
                            widget={previewChart}
                            config={{
                              ...previewChart.config,
                              padding: 8,
                              responsive: true
                            }}
                            data={previewChart.data || {}}
                            isDarkMode={isDarkMode}
                            showEditableTitle={true}
                            onTitleChange={(newTitle) => {
                              setPreviewChart({
                                ...previewChart,
                                title: newTitle,
                                name: newTitle,
                                config: {
                                  ...previewChart.config,
                                  title: newTitle
                                }
                              });
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ 
                        flex: '0 0 30%',
                        minWidth: 0,
                        maxWidth: '30%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0',
                        overflow: 'hidden',
                        background: 'transparent',
                        padding: '0',
                        height: '100%',
                        minHeight: 0
                      }}>
                        <div style={{ 
                          background: isDarkMode ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-container)',
                          padding: '12px',
                          height: '100%',
                          flex: 1,
                          minHeight: 0,
                          maxHeight: '100%',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          position: 'relative'
                        }}>
                          <div
                            className="data-content"
                            style={{
                              flex: 1,
                              minHeight: 0,
                              maxHeight: '100%',
                              overflowY: 'auto',
                              overflowX: 'hidden',
                              width: '100%',
                              paddingRight: '8px',
                              paddingBottom: '8px',
                              scrollbarGutter: 'stable',
                              WebkitOverflowScrolling: 'touch',
                              scrollBehavior: 'smooth'
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          <Button 
                            type="primary" 
                            size="small"
                            icon={<BarChartOutlined />}
                                  onClick={async () => {
                                    try {
                                      if (!previewChart) {
                                        message.warning(t('no_chart_to_add'));
                                        return;
                                      }
                                      if (onChartCreate) {
                                onChartCreate(previewChart);
                                message.success(t('chart_added_dashboard'));
                                      } else {
                                        const chartTitle = previewChart.title || previewChart.name || 'Untitled Chart';
                                        const assetData = {
                                          asset_type: 'chart',
                                          title: chartTitle,
                                          conversation_id: null,
                                          content: {
                                            type: previewChart.type || previewChart.config?.chartType || 'bar',
                                            config: previewChart.config || {},
                                            data: previewChart.data || {},
                                            query: previewChart.query,
                                            dataSourceId: previewChart.dataSourceId
                                          },
                                          data_source_id: previewChart.dataSourceId || null,
                                          metadata: {
                                            chartType: previewChart.config?.chartType || previewChart.type,
                                            dataSourceId: previewChart.dataSourceId,
                                            query: previewChart.query,
                                            name: chartTitle,
                                            description: `Chart generated from query: ${previewChart.query?.substring(0, 100) || 'N/A'}`,
                                            source: 'query-editor'
                                          }
                                        };
                                        await saveChartAsset(
                                          assetData,
                                          'Chart saved to library! You can add it to a dashboard from the library.'
                                        );
                                      }
                                    } catch (error: any) {
                                      console.error('Error adding chart to dashboard:', error);
                                      message.error(`Failed to add chart: ${error.message || 'Unknown error'}`);
                                    }
                                  }}
                                  style={{ flex: 1, minWidth: '120px' }}
                                >
                                  {onChartCreate ? 'Add to Dashboard' : 'Save to Library'}
                          </Button>
                          <Button 
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={async () => {
                              if (previewChart) {
                                try {
                                        const chartTitle = previewChart.title || previewChart.name || 'Untitled Chart';
                                        const assetData = {
                                          asset_type: 'chart',
                                          title: chartTitle,
                                          conversation_id: null,
                                          content: {
                                            type: previewChart.type || previewChart.config?.chartType || 'bar',
                                            config: previewChart.config || {},
                                            data: previewChart.data || {},
                                            query: previewChart.query,
                                            dataSourceId: previewChart.dataSourceId
                                          },
                                          data_source_id: previewChart.dataSourceId || null,
                                          metadata: {
                                            chartType: previewChart.config?.chartType || previewChart.type,
                                            dataSourceId: previewChart.dataSourceId,
                                            query: previewChart.query,
                                            name: chartTitle,
                                            description: `Chart generated from query: ${previewChart.query?.substring(0, 100) || 'N/A'}`,
                                            source: 'query-editor'
                                          }
                                        };
                                        await saveChartAsset(
                                          assetData,
                                          'Chart saved to library! You can add it to a dashboard from the library.'
                                        );
                                } catch (error) {
                                        // saveChartAsset already handles messaging
                                }
                              }
                            }}
                                  style={{ flex: 1, minWidth: '100px' }}
                          >
                            Save Chart
                          </Button>
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => {
                                    Modal.confirm({
                                      title: 'Clear Chart Preview?',
                                      content: 'This will remove the current chart preview. Continue?',
                                      okText: 'Clear',
                                      cancelText: 'Cancel',
                                      onOk: () => {
                                        setPreviewChart(null);
                                        message.info(t('chart_preview_cleared'));
                                      }
                                    });
                                  }}
                                >
                                  Clear
                                </Button>
                              </div>

                              <Collapse
                                activeKey={chartDesignerActiveKeys}
                                onChange={handleDesignerCollapseChange}
                                ghost
                                size="small"
                                expandIconPosition="end"
                                style={{ background: 'transparent' }}
                              >
                                <Panel
                                  key="basic"
                                  header={
                                    <div
                                      onMouseEnter={() => handleDesignerPanelHover('basic')}
                                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                      <EditOutlined style={{ fontSize: '12px', color: 'var(--ant-color-primary)' }} />
                                      <span style={{ fontSize: '11px', fontWeight: 500 }}>{t('basic_settings')}</span>
                                    </div>
                                  }
                                >
                                  <div
                                    onMouseEnter={() => handleDesignerPanelHover('basic')}
                                    onMouseLeave={() => handleDesignerPanelLeave('basic')}
                                  >
                                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                                      <Input
                                        size="small"
                                        value={previewChart.title || previewChart.name || t('untitled_chart')}
                                        onChange={(e) => {
                                          const newTitle = e.target.value;
                                          setPreviewChart({
                                            ...previewChart,
                                            title: newTitle,
                                            name: newTitle,
                                            config: {
                                              ...previewChart.config,
                                              title: newTitle
                                            }
                                          });
                                        }}
                                        placeholder={t('chart_title_placeholder')}
                                        prefix={<EditOutlined style={{ fontSize: '10px', color: 'var(--ant-color-text-tertiary)' }} />}
                                      />
                                      <Select
                                        size="small"
                                        value={previewChart.config?.chartType || 'bar'}
                                        style={{ width: '100%' }}
                                        onChange={(value) => {
                                          try {
                                            if (!previewChart.rawData || previewChart.rawData.length === 0) {
                                              message.warning(t('cannot_change_chart_type'));
                                              return;
                                            }
                                            const columns = previewChart.originalColumns || (previewChart.rawData[0] ? Object.keys(previewChart.rawData[0]) : []);
                                            const numericColumns = previewChart.numericColumns || [];
                                            const textColumns = previewChart.textColumns || [];
                                            const dateColumns = previewChart.dateColumns || [];
                                            let preservedXField = previewChart.config?.xAxisField;
                                            let preservedYField = previewChart.config?.yAxisField;
                                            if (!preservedXField || !columns.includes(preservedXField)) {
                                              preservedXField = textColumns[0] || dateColumns[0] || columns[0];
                                            }
                                            if (!preservedYField || !columns.includes(preservedYField)) {
                                              preservedYField = numericColumns[0] || columns.find((col: string) => !textColumns.includes(col) && !dateColumns.includes(col)) || columns[1] || columns[0];
                                            }
                                            const existingConfig = {
                                              ...previewChart.config,
                                              title: previewChart.title || previewChart.name,
                                              xAxisField: preservedXField,
                                              yAxisField: preservedYField,
                                              colorPalette: previewChart.config?.colorPalette,
                                              legendShow: previewChart.config?.legendShow,
                                              tooltipShow: previewChart.config?.tooltipShow,
                                              showGrid: previewChart.config?.showGrid,
                                              animation: previewChart.config?.animation,
                                              aggregation: previewChart.config?.aggregation,
                                              filter: previewChart.config?.filter,
                                              sortOrder: previewChart.config?.sortOrder,
                                              swapAxes: previewChart.config?.swapAxes
                                            };
                                            const chartTypeName = value.charAt(0).toUpperCase() + value.slice(1) + ' Chart';
                                            handleCreateChart(chartTypeName, previewChart.rawData, existingConfig);
                                          } catch (error) {
                                            console.error('Error changing chart type:', error);
                                            message.error(t('change_chart_type_failed'));
                                          }
                                        }}
                                      >
                                        <Select.Option value="bar">{t('chart_type_bar')}</Select.Option>
                                        <Select.Option value="line">{t('chart_type_line')}</Select.Option>
                                        <Select.Option value="pie">{t('chart_type_pie')}</Select.Option>
                                        <Select.Option value="scatter">{t('chart_type_scatter')}</Select.Option>
                                      </Select>
                        </Space>
                      </div>
                                </Panel>
                                <Panel
                                  key="data"
                                  header={
                                    <div
                                      onMouseEnter={() => handleDesignerPanelHover('data')}
                                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                      <DatabaseOutlined style={{ fontSize: '12px', color: 'var(--ant-color-primary)' }} />
                                      <span style={{ fontSize: '11px', fontWeight: 500 }}>{t('data_configuration')}</span>
                                    </div>
                                  }
                                >
                                  <div
                                    onMouseEnter={() => handleDesignerPanelHover('data')}
                                    onMouseLeave={() => handleDesignerPanelLeave('data')}
                                  >
                                    {previewChart.rawData && previewChart.rawData.length > 0 ? (() => {
                                      const columns: string[] = previewChart.originalColumns || (previewChart.rawData[0] ? Object.keys(previewChart.rawData[0]) : []);
                                      const numericColumns: string[] = previewChart.numericColumns || columns.filter((col: string) => {
                                        const val = previewChart.rawData[0]?.[col];
                                        return typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== undefined);
                                      });
                                      const textColumns: string[] = previewChart.textColumns || columns.filter((col: string) => {
                                        const val = previewChart.rawData[0]?.[col];
                                        return typeof val === 'string' && isNaN(Number(val)) && val !== null && val !== undefined;
                                      });
                                      const dateColumns: string[] = previewChart.dateColumns || [];
                                      const chartType = previewChart.config?.chartType || 'bar';
                                      const currentXField = previewChart.config?.xAxisField;
                                      const currentYField = previewChart.config?.yAxisField;
                                      const validXField = currentXField && columns.includes(currentXField)
                                        ? currentXField
                                        : (textColumns[0] || dateColumns[0] || columns[0]);
                                      const validYField = currentYField && columns.includes(currentYField)
                                        ? currentYField
                                        : (numericColumns[0] || columns.find((col: string) => !textColumns.includes(col) && !dateColumns.includes(col)) || columns[1] || columns[0]);
                                      const showTransforms = chartType !== 'pie';

                                      return (
                                        <Space direction="vertical" style={{ width: '100%' }} size={10}>
                                          {chartType !== 'pie' && (
                                            <>
                                              <div>
                                                <Text strong style={{ fontSize: '10px', display: 'block', marginBottom: '3px', color: 'var(--ant-color-text-secondary)' }}>
                                                  {t('x_axis')}
                                                </Text>
                                                <Select
                                                  size="small"
                                                  value={validXField}
                                                  style={{ width: '100%' }}
                                                  onChange={(value) => {
                                                    try {
                                                      const newConfig = {
                                                        ...previewChart.config,
                                                        xAxisField: value,
                                                        yAxisField: validYField,
                                                        aggregation: previewChart.config?.aggregation || 'none',
                                                        filter: previewChart.config?.filter || '',
                                                        sortOrder: previewChart.config?.sortOrder || 'none',
                                                        swapAxes: previewChart.config?.swapAxes || false
                                                      };
                                                      const chartTypeName = (chartType.charAt(0).toUpperCase() + chartType.slice(1)) + ' Chart';
                                                      handleCreateChart(chartTypeName, previewChart.rawData, newConfig);
                                                    } catch (error) {
                                                      console.error('Error changing X-axis:', error);
                                                      message.error(t('update_x_axis_failed'));
                                                    }
                                                  }}
                                                  showSearch
                                                  filterOption={(input, option) => {
                                                    const label = typeof option?.children === 'string' ? option.children : '';
                                                    return label.toLowerCase().includes(input.toLowerCase());
                                                  }}
                                                >
                                                  {columns.map(col => (
                                                    <Select.Option key={col} value={col}>
                                                      <span>{col}</span>
                                                      {numericColumns.includes(col) && <Tag color="green" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('numeric')}</Tag>}
                                                      {textColumns.includes(col) && <Tag color="blue" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('text')}</Tag>}
                                                      {dateColumns.includes(col) && <Tag color="purple" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('date')}</Tag>}
                                                    </Select.Option>
                                                  ))}
                                                </Select>
                                              </div>
                                              <div>
                                                <Text strong style={{ fontSize: '10px', display: 'block', marginBottom: '3px', color: 'var(--ant-color-text-secondary)' }}>
                                                  {t('y_axis')}
                                                </Text>
                                                <Select
                                                  size="small"
                                                  value={validYField}
                                                  style={{ width: '100%' }}
                                                  onChange={(value) => {
                                                    try {
                                                      const newConfig = {
                                                        ...previewChart.config,
                                                        yAxisField: value,
                                                        xAxisField: validXField,
                                                        aggregation: previewChart.config?.aggregation || 'none',
                                                        filter: previewChart.config?.filter || '',
                                                        sortOrder: previewChart.config?.sortOrder || 'none',
                                                        swapAxes: previewChart.config?.swapAxes || false
                                                      };
                                                      const chartTypeName = (chartType.charAt(0).toUpperCase() + chartType.slice(1)) + ' Chart';
                                                      handleCreateChart(chartTypeName, previewChart.rawData, newConfig);
                                                    } catch (error) {
                                                      console.error('Error changing Y-axis:', error);
                                                      message.error(t('update_y_axis_failed'));
                                                    }
                                                  }}
                                                  showSearch
                                                  filterOption={(input, option) => {
                                                    const label = typeof option?.children === 'string' ? option.children : '';
                                                    return label.toLowerCase().includes(input.toLowerCase());
                                                  }}
                                                >
                                                  {columns.map(col => (
                                                    <Select.Option key={col} value={col}>
                                                      <span>{col}</span>
                                                      {numericColumns.includes(col) && <Tag color="green" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('numeric')}</Tag>}
                                                      {textColumns.includes(col) && <Tag color="blue" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('text')}</Tag>}
                                                      {dateColumns.includes(col) && <Tag color="purple" style={{ marginLeft: '4px', fontSize: '9px' }}>{t('date')}</Tag>}
                                                    </Select.Option>
                                                  ))}
                                                </Select>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text style={{ fontSize: '10px' }}>{t('switch_rows_columns')}</Text>
                                                <Switch
                                                  size="small"
                                                  checked={previewChart.config?.swapAxes || false}
                                                  onChange={(checked) => {
                                                    const newConfig = {
                                                      ...previewChart.config,
                                                      swapAxes: checked,
                                                      xAxisField: checked ? validYField : validXField,
                                                      yAxisField: checked ? validXField : validYField
                                                    };
                                                    const chartTypeName = (chartType.charAt(0).toUpperCase() + chartType.slice(1)) + ' Chart';
                                                    handleCreateChart(chartTypeName, previewChart.rawData, newConfig);
                                                  }}
                                                />
                                              </div>
                                            </>
                                          )}
                                          {showTransforms && (
                                            <>
                                              <Divider plain style={{ margin: '4px 0', fontSize: '10px' }}>{t('data_transformations')}</Divider>
                                              <Select
                                                size="small"
                                                value={previewChart.config?.aggregation || 'none'}
                                                style={{ width: '100%' }}
                                                onChange={(value) => {
                                                  try {
                                                    const newConfig = {
                                                      ...previewChart.config,
                                                      aggregation: value,
                                                      xAxisField: previewChart.config?.xAxisField,
                                                      yAxisField: previewChart.config?.yAxisField,
                                                      filter: previewChart.config?.filter || '',
                                                      sortOrder: previewChart.config?.sortOrder || 'none',
                                                      swapAxes: previewChart.config?.swapAxes || false
                                                    };
                                                    const chartTypeName = (chartType.charAt(0).toUpperCase() + chartType.slice(1)) + ' Chart';
                                                    handleCreateChart(chartTypeName, previewChart.rawData, newConfig);
                                                  } catch (error) {
                                                    console.error('Error changing aggregation:', error);
                                                    message.error(t('update_agg_failed'));
                                                  }
                                                }}
                                              >
                                                <Select.Option value="none">{t('no_aggregation')}</Select.Option>
                                                <Select.Option value="sum">{t('agg_sum')}</Select.Option>
                                                <Select.Option value="avg">{t('agg_average')}</Select.Option>
                                                <Select.Option value="count">{t('agg_count')}</Select.Option>
                                                <Select.Option value="min">{t('agg_min')}</Select.Option>
                                                <Select.Option value="max">{t('agg_max')}</Select.Option>
                                              </Select>
                                              <Input
                                                size="small"
                                                placeholder={t('filter_placeholder')}
                                                value={previewChart.config?.filter || ''}
                                                onChange={(e) => {
                                                  const updatedConfig = { ...previewChart.config, filter: e.target.value };
                                                  setPreviewChart({
                                                    ...previewChart,
                                                    config: updatedConfig
                                                  });
                                                }}
                                                onPressEnter={() => {
                                                  const chartTypeName = ((previewChart.config?.chartType || 'bar').charAt(0).toUpperCase() + (previewChart.config?.chartType || 'bar').slice(1)) + ' Chart';
                                                  handleCreateChart(chartTypeName, previewChart.rawData, previewChart.config);
                                                }}
                                                onBlur={() => {
                                                  const chartTypeName = ((previewChart.config?.chartType || 'bar').charAt(0).toUpperCase() + (previewChart.config?.chartType || 'bar').slice(1)) + ' Chart';
                                                  handleCreateChart(chartTypeName, previewChart.rawData, previewChart.config);
                                                }}
                                              />
                                              <Select
                                                size="small"
                                                value={previewChart.config?.sortOrder || 'none'}
                                                style={{ width: '100%' }}
                                                onChange={(value) => {
                                                  try {
                                                    const newConfig = {
                                                      ...previewChart.config,
                                                      sortOrder: value,
                                                      xAxisField: previewChart.config?.xAxisField,
                                                      yAxisField: previewChart.config?.yAxisField,
                                                      aggregation: previewChart.config?.aggregation || 'none',
                                                      filter: previewChart.config?.filter || '',
                                                      swapAxes: previewChart.config?.swapAxes || false
                                                    };
                                                    const chartTypeName = (chartType.charAt(0).toUpperCase() + chartType.slice(1)) + ' Chart';
                                                    handleCreateChart(chartTypeName, previewChart.rawData, newConfig);
                                                  } catch (error) {
                                                    console.error('Error changing sort order:', error);
                                                    message.error(t('update_sort_failed'));
                                                  }
                                                }}
                                              >
                                                <Select.Option value="none">{t('original_order')}</Select.Option>
                                                <Select.Option value="asc">{t('ascending')}</Select.Option>
                                                <Select.Option value="desc">{t('descending')}</Select.Option>
                                              </Select>
                                            </>
                                          )}
                                        </Space>
                                      );
                                    })() : (
                                      <Text type="secondary" style={{ fontSize: '11px' }}>
                                        {t('execute_query_configure_axes')}
                                      </Text>
                                    )}
                                  </div>
                                </Panel>
                                <Panel
                                  key="display"
                                  header={
                                    <div
                                      onMouseEnter={() => handleDesignerPanelHover('display')}
                                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                      <SettingOutlined style={{ fontSize: '12px', color: 'var(--ant-color-primary)' }} />
                                      <span style={{ fontSize: '11px', fontWeight: 500 }}>{t('display_styling')}</span>
                                    </div>
                                  }
                                >
                                  <div
                                    onMouseEnter={() => handleDesignerPanelHover('display')}
                                    onMouseLeave={() => handleDesignerPanelLeave('display')}
                                  >
                                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                                      <Select
                                        size="small"
                                        value={previewChart.config?.colorPalette || 'default'}
                                        style={{ width: '100%' }}
                                        onChange={(value) => {
                                          setPreviewChart({
                                            ...previewChart,
                                            config: { ...previewChart.config, colorPalette: value }
                                          });
                                          setTimeout(() => {
                                            setPreviewChart((prev: any) => ({ ...prev, config: { ...prev.config, colorPalette: value } }));
                                          }, 0);
                                        }}
                                      >
                                        <Select.Option value="default">{t('palette_default')}</Select.Option>
                                        <Select.Option value="vibrant">{t('palette_vibrant')}</Select.Option>
                                        <Select.Option value="pastel">{t('palette_pastel')}</Select.Option>
                                        <Select.Option value="monochrome">{t('palette_monochrome')}</Select.Option>
                                        <Select.Option value="cool">{t('palette_cool')}</Select.Option>
                                        <Select.Option value="warm">{t('palette_warm')}</Select.Option>
                                      </Select>
                                      {(() => {
                                        const chartType = previewChart.config?.chartType || 'bar';
                                        const legendSupported = !['scatter', 'gauge', 'heatmap'].includes(chartType);
                                        return (
                                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                              <Text style={{ fontSize: '10px' }}>{t('show_legend')}</Text>
                                              <Tooltip title={legendSupported ? '' : t('legend_disabled_for_chart_type')}>
                                                <Switch
                                                  size="small"
                                                  disabled={!legendSupported}
                                                  checked={legendSupported ? previewChart.config?.legendShow !== false : false}
                                                  onChange={(checked) => {
                                                    if (!legendSupported) return;
                                                    setPreviewChart({
                                                      ...previewChart,
                                                      config: { ...previewChart.config, legendShow: checked }
                                                    });
                                                    setTimeout(() => {
                                                      setPreviewChart((prev: any) => ({ ...prev, config: { ...prev.config, legendShow: checked } }));
                                                    }, 0);
                                                  }}
                                                />
                                              </Tooltip>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                              <Text style={{ fontSize: '10px' }}>{t('show_tooltip')}</Text>
                                              <Switch
                                                size="small"
                                                checked={previewChart.config?.tooltipShow !== false}
                                                onChange={(checked) => {
                                                  setPreviewChart({
                                                    ...previewChart,
                                                    config: { ...previewChart.config, tooltipShow: checked }
                                                  });
                                                  setTimeout(() => {
                                                    setPreviewChart((prev: any) => ({ ...prev, config: { ...prev.config, tooltipShow: checked } }));
                                                  }, 0);
                                                }}
                                              />
                                            </div>
                                            {previewChart.config?.chartType !== 'pie' && (
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text style={{ fontSize: '10px' }}>{t('show_grid')}</Text>
                                                <Switch
                                                  size="small"
                                                  checked={previewChart.config?.showGrid !== false}
                                                  onChange={(checked) => {
                                                    setPreviewChart({
                                                      ...previewChart,
                                                      config: { ...previewChart.config, showGrid: checked }
                                                    });
                                                    setTimeout(() => {
                                                      setPreviewChart((prev: any) => ({ ...prev, config: { ...prev.config, showGrid: checked } }));
                                                    }, 0);
                                                  }}
                                                />
                                              </div>
                                            )}
                                          </Space>
                                        );
                                      })()}
                                    </Space>
                                  </div>
                                </Panel>
                              </Collapse>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="data-content" style={{ 
                      flex: 1,
                      minHeight: 0,
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      justifyContent: 'center',
                      color: 'var(--ant-color-text-secondary)',
                      padding: '32px 20px',
                      background: 'transparent',
                      border: `1px dashed ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`,
                      borderRadius: '6px',
                      overflow: 'auto'
                    }}>
                      <BarChartOutlined style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.4, color: 'var(--ant-color-text-tertiary)' }} />
                      <Title level={5} style={{ color: 'var(--ant-color-text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
                        No Chart Preview
                      </Title>
                      <Text style={{ color: 'var(--ant-color-text-tertiary)', textAlign: 'center', maxWidth: '350px', fontSize: '13px' }}>
                        Execute a query and click "Generate Chart" in the Query Results tab to see a preview here.
                      </Text>
                    </div>
                  )}
                </div>
              </TabPane> */}

                <TabPane tab={t('tab_query_history')} key="history">
                  <div style={{
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    background: 'transparent'
                  }}>
                    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 8 }}>
                      <Space wrap>
                        <Input
                          placeholder="Search SQL or error..."
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                          allowClear
                          style={{ width: 220 }}
                          size="small"
                        />
                        <Select
                          value={historyStatusFilter}
                          onChange={setHistoryStatusFilter}
                          style={{ width: 120 }}
                          size="small"
                          options={[
                            { value: 'all', label: 'All' },
                            { value: 'success', label: 'Success' },
                            { value: 'error', label: 'Failed' },
                          ]}
                        />
                      </Space>
                    </Space>
                    <div className="data-content" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'transparent' }}>
                      <Table
                        dataSource={(() => {
                          const search = (historySearch || '').toLowerCase().trim();
                          const status = historyStatusFilter;
                          return queryHistory.filter((r: any) => {
                            if (status !== 'all' && (r.status || r.state) !== status) return false;
                            if (!search) return true;
                            return (
                              (r.sql || '').toLowerCase().includes(search) ||
                              (r.error || '').toLowerCase().includes(search)
                            );
                          });
                        })()}
                        columns={historyColumns}
                        size="small"
                        pagination={false}
                        scroll={{ y: 'calc(100vh - 600px)' }}
                        style={{ background: 'transparent' }}
                        className="query-history-table"
                        onRow={(record) => ({
                          style: { cursor: 'pointer' },
                        })}
                      />
                    </div>
                  </div>
                </TabPane>
              </Tabs>
            </div>
          </div>
        </div>
        {/* Data Sources Panel on Right */}
        <div
          style={{
            width: isStackedLayout ? '100%' : effectiveSidebarCollapsed ? '64px' : '320px',
            minWidth: isStackedLayout ? '100%' : effectiveSidebarCollapsed ? '64px' : '320px',
            minHeight: isStackedLayout ? 'auto' : '100%',
            borderLeft:
              !isStackedLayout && !effectiveSidebarCollapsed
                ? `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`
                : 'none',
            borderTop: isStackedLayout
              ? `1px solid ${isDarkMode ? 'var(--ant-color-border)' : 'var(--ant-color-border-secondary)'}`
              : 'none',
            background: 'var(--layout-panel-background, var(--ant-color-bg-container))',
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            marginTop: isStackedLayout ? 16 : 0,
            order: isStackedLayout ? 2 : 0,
          }}
        >
          {!isStackedLayout && effectiveSidebarCollapsed ? (
            <div
              style={{
                padding: '16px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
                background: 'var(--ant-color-bg-container)',
                border: '1px solid var(--ant-color-border)',
                borderRadius: 'var(--ant-border-radius-lg)',
                height: '100%',
                boxShadow: 'var(--ant-box-shadow)',
              }}
            >
              <Tooltip title={t('expand_data_panel')} placement="left">
                <Button
                  type="text"
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => {
                    setSidebarCollapsed(false);
                    try {
                      window.localStorage.setItem('sidebarCollapsed', 'false');
                    } catch {}
                    try {
                      window.dispatchEvent(
                        new CustomEvent('sidebar-collapse-changed', { detail: { collapsed: false } })
                      );
                    } catch {}
                  }}
                  style={{
                    width: '100%',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Tooltip>
              <Tooltip title={t('add_data_source')} placement="left">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setShowConnectDataModal(true)}
                  style={{
                    width: '100%',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Tooltip>
              <Tooltip title={t('data_sources')} placement="left">
                <DatabaseOutlined style={{ fontSize: '20px', color: 'var(--ant-color-primary)' }} />
              </Tooltip>
            </div>
          ) : (
            <EnhancedDataPanel
              onCollapse={() => {
                setSidebarCollapsed(true);
                try {
                  window.localStorage.setItem('sidebarCollapsed', 'true');
                } catch {}
                try {
                  window.dispatchEvent(new CustomEvent('sidebar-collapse-changed', { detail: { collapsed: true } }));
                } catch { }
              }}
              onTableClick={(tableName, schemaName) => {
                const ident = schemaName && schemaName !== 'public' ? `${schemaName}.${tableName}` : tableName;
                const fromRef = /[\s"]/.test(ident) ? `"${ident.replace(/"/g, '""')}"` : ident;
                editorInsertRef.current?.insertTextAtCursor(`SELECT * FROM ${fromRef} LIMIT 100`);
              }}
              onColumnClick={(tableName, columnName, schemaName) => {
                const text = /[\s"]/.test(columnName) ? `"${columnName.replace(/"/g, '""')}"` : columnName;
                editorInsertRef.current?.insertTextAtCursor(text);
              }}
              // insertHint={
              //   <Text type="secondary" style={{ fontSize: 11 }}>
              //     Click table → full SELECT snippet. Click column → name only. In editor: autocomplete (tables, columns, keywords) and type <code style={{ padding: '0 2px' }}>{'{{ '}</code> for Jinja templates.
              //   </Text>
              // }
              compact={false}
            />
          )}
        </div>
      </div>

      {/* Connect Data Modal */}
      <UniversalDataSourceModal
        isOpen={showConnectDataModal}
        onClose={() => setShowConnectDataModal(false)}
        onDataSourceCreated={() => {
          setShowConnectDataModal(false);
          refreshDataSources();
        }}
      />

      {/* Saved Queries Modal - Consolidated: named queries only; execution history is in Query History tab */}
      <Modal
        open={showSavedModal}
        title={t('saved_queries_snapshots_title')}
        onCancel={() => setShowSavedModal(false)}
        footer={null}
        width={900}
        centered
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Same project scope as your query tabs. Load a query into a tab or load snapshot results.
        </Text>
        <Tabs
          defaultActiveKey="saved"
          items={[
            {
              key: 'saved',
              label: `Saved Queries (${savedQueries.length})`,
              children: (
                <div>
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                    {t('saved_queries_help')}
                  </div>
                  <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      placeholder="Query name (default: current tab title)"
                      style={{ width: 260 }}
                      id="save-query-name"
                      key={showSavedModal ? 'saved-modal-open' : 'saved-modal-closed'}
                      defaultValue={queryTabs.find(t => t.key === activeQueryKey)?.title}
                    />
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={async () => {
                        const nameInput = document.getElementById('save-query-name') as HTMLInputElement | null;
                        const currentTab = queryTabs.find((t) => t.key === activeQueryKey);
                        const name = nameInput?.value?.trim() || currentTab?.title || `Query ${Date.now()}`;
                        const existing = savedQueries.find((q: any) => (q.name || '').trim() === name);
                        const canUpdate = existing && typeof existing.id === 'number';
                        const doSaveAsNew = () => {
                          const newName = `${name} (copy)`;
                          if (nameInput) nameInput.value = newName;
                          message.info(`Name set to "${newName}". Click Save again to save as new.`);
                        };
                        if (existing && canUpdate) {
                          Modal.confirm({
                            title: 'Query name already exists',
                            content: `A saved query named "${name}" already exists. Update it or save as a new copy?`,
                            okText: 'Update existing',
                            cancelText: 'Save as new',
                            onCancel: doSaveAsNew,
                            onOk: async () => {
                              try {
                                await authenticatedFetch(`/api/queries/saved-queries/${existing.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    name,
                                    sql: sqlQuery,
                                    metadata: {
                                      activeQueryKey,
                                      language: resolveLanguage(currentTab?.language ?? editorLanguage),
                                      tabKey: currentTab?.key
                                    }
                                  })
                                });
                                message.success(`Query "${name}" updated`);
                                const j = await authenticatedFetch(savedQueriesUrl);
                                setSavedQueries(Array.isArray(j?.items) ? j.items : []);
                              } catch (e: any) {
                                message.error(e?.message || 'Update failed');
                              }
                            },
                          });
                          return;
                        }
                        if (existing && !canUpdate) {
                          doSaveAsNew();
                          return;
                        }
                        try {
                          await authenticatedFetch(savedQueriesUrl, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name,
                                sql: sqlQuery,
                                metadata: {
                                  activeQueryKey,
                                  language: resolveLanguage(currentTab?.language ?? editorLanguage),
                                  tabKey: currentTab?.key
                                }
                              })
                            });
                          message.success(`Query "${name}" saved successfully`);
                          const j = await authenticatedFetch(savedQueriesUrl);
                          setSavedQueries(Array.isArray(j?.items) ? j.items : []);
                          if (nameInput) nameInput.value = '';
                        } catch (err: any) {
                          message.error(err.message || 'Save failed');
                        }
                      }}
                    >
                      Save Current Query
                    </Button>
                  </div>
                  <Table
                    dataSource={(savedQueries || []).filter(Boolean)}
                    rowKey={(r: any) => r?.id ?? r?.name ?? String(Math.random())}
                    size="small"
                    pagination={{ pageSize: 10 }}
                    locale={{
                      emptyText: (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
                          <p style={{ marginBottom: 8 }}>{t('no_saved_queries_yet')}</p>
                          <p style={{ fontSize: 12 }}>{t('saved_queries_empty_help')}</p>
                        </div>
                      )
                    }}
                    columns={[
                      { title: t('name'), dataIndex: 'name', key: 'name' },
                      {
                        title: t('query'),
                        dataIndex: 'sql',
                        key: 'sql',
                        render: (text: string) => (
                          <Text
                            code
                            style={{
                              fontSize: '12px',
                              maxWidth: '400px',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {text?.substring(0, 100)}
                            {text?.length > 100 ? '...' : ''}
                          </Text>
                        ),
                      },
                      {
                        title: 'Language',
                        dataIndex: ['metadata', 'language'],
                        key: 'language',
                        render: (lang: string) => <Tag>{lang?.toUpperCase() || 'SQL'}</Tag>,
                      },
                      {
                        title: t('created'),
                        dataIndex: 'created_at',
                        key: 'created_at',
                        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
                      },
                      {
                        title: t('actions'),
                        key: 'actions',
                        render: (_: any, record: any) => {
                          if (record == null) return null;
                          return (
                          <Space>
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => {
                                const newKey = `q-${Date.now()}`;
                                const metadata = record?.metadata || {};
                                const language = resolveLanguage(metadata.language);
                                const baseSql = record.sql || DEFAULT_SQL_SNIPPET;
                                const pythonContent =
                                  language === 'python'
                                    ? baseSql
                                    : buildPythonTemplate(baseSql, selectedDataSource?.name);
                                const newTab = {
                                  key: newKey,
                                  title: record.name,
                                  sql: language === 'python' ? DEFAULT_SQL_SNIPPET : baseSql,
                                  python: pythonContent,
                                  language,
                                };
                                const next = [...queryTabs, newTab];
                                setQueryTabs(next);
                                setActiveQueryKey(newKey);
                                setEditorLanguage(language);
                                setSqlQuery(language === 'python' ? pythonContent : baseSql);
                                setShowSavedModal(false);
                                saveTabsToBackend(next, newKey, true);
                                message.success(`Query "${record.name}" loaded into new tab`);
                              }}
                            >
                              Load to Tab
                            </Button>
                            <Button
                              size="small"
                              onClick={() => {
                                const metadata = record?.metadata || {};
                                const language = resolveLanguage(metadata.language);
                                const baseSql = record?.sql || DEFAULT_SQL_SNIPPET;
                                const pythonContent = language === 'python'
                                  ? baseSql
                                  : buildPythonTemplate(baseSql, selectedDataSource?.name);
                                const updated = queryTabs.map(t =>
                                  t.key === activeQueryKey
                                    ? {
                                        ...t,
                                        title: record?.name ?? t.title,
                                        sql: language === 'python' ? DEFAULT_SQL_SNIPPET : baseSql,
                                        python: pythonContent,
                                        language
                                      }
                                    : t
                                );
                                setQueryTabs(updated);
                                setEditorLanguage(language);
                                setSqlQuery(language === 'python' ? pythonContent : baseSql);
                                setShowSavedModal(false);
                                saveTabsToBackend(updated, activeQueryKey, true);
                                message.success(t('loaded_query', { name: record?.name || 'Query' }));
                              }}
                            >
                              {t('load_here')}
                            </Button>
                            <Tooltip title={t('version_history')}>
                              <Button
                                size="small"
                                icon={<HistoryOutlined />}
                                onClick={() => {
                                  setVersionsModalQueryRecord({ name: record?.name ?? '', metadata: record?.metadata });
                                  setShowVersionsModalForQueryId(record?.id ?? null);
                                }}
                              />
                            </Tooltip>
                            <Tooltip title={t('duplicate_as_new_saved_query')}>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={async () => {
                                  try {
                                    const name = `${(record?.name || 'Query').replace(/\s*\(copy( \d+)?\)\s*$/i, '')} (copy)`;
                                    await authenticatedFetch(savedQueriesUrl, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        name,
                                        sql: record?.sql || '',
                                        metadata: record?.metadata || {}
                                      })
                                    });
                                    message.success(t('saved_as', { name }));
                                    const j = await authenticatedFetch(savedQueriesUrl);
                                    setSavedQueries(Array.isArray(j?.items) ? j.items : []);
                                  } catch (err: unknown) {
                                    const e = err as { message?: string };
                                    message.error(e?.message || t('duplicate_failed'));
                                  }
                                }}
                              />
                            </Tooltip>
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={async () => {
                                try {
                                  await authenticatedFetch(`/api/queries/saved-queries/${record.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`, {
                                    method: 'DELETE'
                                  });
                                  message.success(t('saved_query_removed'));
                                  const j = await authenticatedFetch(savedQueriesUrl);
                                  setSavedQueries(Array.isArray(j?.items) ? j.items : []);
                                } catch (err: any) {
                                  message.error(err?.message || t('delete_failed'));
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </Space>
                        );
                        }
                      }
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'snapshots',
              label: t('snapshots_count', { count: snapshots.length }),
              children: (
                <div>
                  <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                    {t('snapshots_include_desc')}
                  </div>
                  <Table
                    dataSource={(snapshots || []).filter(Boolean)}
                    rowKey={(r: any) => r?.id ?? String(Math.random())}
                    size="small"
                    pagination={{ pageSize: 10 }}
                    locale={{
                      emptyText: (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
                          <p style={{ marginBottom: 8 }}>{t('no_snapshots_yet')}</p>
                          <p style={{ fontSize: 12 }}>{t('snapshots_empty_help')}</p>
                        </div>
                      )
                    }}
                    columns={[
                      { title: t('name'), dataIndex: 'name', key: 'name' },
                      {
                        title: t('query'),
                        dataIndex: 'sql',
                        key: 'sql',
                        render: (text: string) => (
                          <Text
                            code
                            style={{
                              fontSize: '12px',
                              maxWidth: '400px',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {text?.substring(0, 100)}
                            {text?.length > 100 ? '...' : ''}
                          </Text>
                        ),
                      },
                      {
                        title: t('created'),
                        dataIndex: 'created_at',
                        key: 'created_at',
                        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
                      },
                      {
                        title: t('actions'),
                        key: 'actions',
                        render: (_: any, r: any) => {
                          if (r == null) return null;
                          return (
                          <Space>
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={async () => {
                                try {
                                  const url = `/api/queries/snapshots/${r?.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`;
                                  const j = await authenticatedFetch(url) as { snapshot?: { sql?: string; name?: string } };
                                  const snap = j?.snapshot;
                                  if (!snap) {
                                    message.error(t('snapshot_not_found'));
                                    return;
                                  }
                                  const baseSql = snap.sql || DEFAULT_SQL_SNIPPET;
                                  const newKey = `q-${Date.now()}`;
                                  const newTab = {
                                    key: newKey,
                                    title: snap.name || r?.name || 'Snapshot',
                                    sql: baseSql,
                                    python: buildPythonTemplate(baseSql, selectedDataSource?.name),
                                    language: 'sql' as QueryLanguage
                                  };
                                  setQueryTabs(prev => [...prev, newTab]);
                                  setActiveQueryKey(newKey);
                                  setEditorLanguage('sql');
                                  setSqlQuery(baseSql);
                                  setShowSavedModal(false);
                                  message.success(`Snapshot "${snap.name || r?.name}" loaded into new tab`);
                                } catch (e: unknown) {
                                  const err = e as { message?: string; status?: number };
                                  message.error(err?.message || t('load_snapshot_failed'));
                                }
                              }}
                            >
                              {t('load_query_to_tab')}
                            </Button>
                            <Button
                              size="small"
                              onClick={async () => {
                                try {
                                  const url = `/api/queries/snapshots/${r?.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`;
                                  const j = await authenticatedFetch(url) as { snapshot?: { rows?: unknown[] } };
                                  const rows = Array.isArray(j?.snapshot?.rows) ? j.snapshot.rows : [];
                                  if (rows.length) {
                                    setResults(rows);
                                    setActiveTab('results');
                                    setShowSavedModal(false);
                                    message.success(t('snapshot_loaded_results'));
                                  } else {
                                    message.warning(t('snapshot_no_rows'));
                                  }
                                } catch (e: unknown) {
                                  const err = e as { message?: string };
                                  message.error(err?.message || t('load_snapshot_failed'));
                                }
                              }}
                            >
                              {t('load_results')}
                            </Button>
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={async () => {
                                try {
                                  await authenticatedFetch(`/api/queries/snapshots/${r?.id}`, {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                  });
                                  message.success(t('snapshot_deleted'));
                                  const j = await authenticatedFetch(snapshotsUrl);
                                  setSnapshots(Array.isArray(j?.items) ? j.items : []);
                                } catch (err: any) {
                                  if (err?.status === 403 || err?.status === 401) setPermissionModalVisible(true);
                                  else message.error(err?.message || t('delete_failed'));
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </Space>
                        );
                        }
                      }
                    ]}
                  />
                </div>
              )
            }
          ]}
        />
      </Modal>

      {/* Save current Query Result as Snapshot */}
      <Modal
        title={t('save_result_as_snapshot_title')}
        open={showSaveSnapshotModal}
        onCancel={() => setShowSaveSnapshotModal(false)}
        okText={t('save')}
        cancelText={t('cancel')}
        okButtonProps={{ disabled: !results?.length }}
        onOk={async () => {
          const name = (saveSnapshotName || '').trim() || `${t('snapshot')} ${new Date().toISOString().slice(0, 10)}`;
          const columnKeys = results?.length && results[0] ? Object.keys(results[0]) : [];
          try {
            await authenticatedFetch(snapshotsUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                sql: sqlQuery,
                data_source_id: selectedDataSource?.id || selectedDataSourceId || '',
                rows: results || [],
                columns: columnKeys,
                organization_id: organizationId,
                project_id: currentProject?.id || projectId
              })
            });
            message.success(t('snapshot_saved_hint'));
            setShowSaveSnapshotModal(false);
            if (showSavedModal) {
              const j = await authenticatedFetch(snapshotsUrl).catch(() => ({ items: [] }));
              setSnapshots(Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items.filter(Boolean) : []);
            }
          } catch (err: unknown) {
            const apiErr = err as { status?: number; message?: string };
            if (apiErr?.status === 403 || apiErr?.status === 401) setPermissionModalVisible(true);
            else message.error(apiErr?.message || 'Failed to save snapshot');
          }
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">
            {results?.length
              ? 'Save the current query and its result set so you can load it later or bind it to widgets.'
              : 'No results to save. Run a query first, then use this to save the result as a snapshot.'}
          </Text>
        </div>
        <Form.Item label={t('name')}>
          <Input
            value={saveSnapshotName}
            onChange={(e) => setSaveSnapshotName(e.target.value)}
            placeholder={t('snapshot_name_placeholder')}
          />
        </Form.Item>
      </Modal>

      {/* Version history for saved query */}
      <Modal
        title={t('version_history')}
        open={showVersionsModalForQueryId != null}
        onCancel={() => { setShowVersionsModalForQueryId(null); setVersionsModalQueryRecord(null); }}
        footer={null}
        width={640}
      >
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
          {t('version_history_desc')}
        </div>
        {savedQueryVersions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
            {t('version_history_empty')}
          </div>
        ) : (
          <Table
            dataSource={savedQueryVersions}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            columns={[
              { title: t('saved_at'), dataIndex: 'created_at', key: 'created_at', width: 180, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
              {
                title: t('sql'),
                dataIndex: 'sql',
                key: 'sql',
                render: (text: string) => (
                  <Text code style={{ fontSize: 12, maxWidth: 360, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {text?.substring(0, 120)}{text && text.length > 120 ? '...' : ''}
                  </Text>
                )
              },
              {
                title: '',
                key: 'restore',
                width: 90,
                render: (_: unknown, version: { id: number; sql: string; created_at: string }) => (
                  <Button
                    size="small"
                    type="primary"
                    onClick={async () => {
                      if (showVersionsModalForQueryId == null || !versionsModalQueryRecord) return;
                      try {
                        await authenticatedFetch(
                          `/api/queries/saved-queries/${showVersionsModalForQueryId}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`,
                          {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: versionsModalQueryRecord.name,
                              sql: version.sql,
                              metadata: versionsModalQueryRecord.metadata ?? {}
                            })
                          }
                        );
                        message.success(t('restored_version'));
                        setShowVersionsModalForQueryId(null);
                        setVersionsModalQueryRecord(null);
                        const j = await authenticatedFetch(savedQueriesUrl);
                        setSavedQueries(Array.isArray(j?.items) ? j.items : []);
                      } catch (err: unknown) {
                        const e = err as { message?: string };
                        message.error(e?.message || 'Restore failed');
                      }
                    }}
                  >
                    Restore
                  </Button>
                )
              }
            ]}
          />
        )}
      </Modal>

      {/* Permission / Invite Modal */}
      <Modal
        open={permissionModalVisible}
        title={t('request_access')}
        onCancel={() => setPermissionModalVisible(false)}
        footer={null}
        centered
      >
        <div style={{ marginBottom: 12 }}>
          <Text>
            You're missing permissions to perform this action. Request access from your organization admin by entering
            their email below.
          </Text>
        </div>
        <Input placeholder="Admin email" value={permEmail} onChange={(e) => setPermEmail(e.target.value)} />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => setPermissionModalVisible(false)}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={permLoading}
            onClick={async () => {
              setPermLoading(true);
              try {
                // Send a lightweight access request to the backend (endpoint to implement)
                await authenticatedFetch(`/api/organization/request-access`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: permEmail }),
                });
                message.success(t('access_request_sent'));
                setPermissionModalVisible(false);
              } catch {
                message.error(t('access_request_failed'));
              } finally {
                setPermLoading(false);
              }
            }}
          >
            {t('request_access')}
          </Button>
        </div>
      </Modal>

      {/* Schedule Modal */}
      <Modal
        open={showScheduleModal}
        title={t('schedule_query')}
        onCancel={() => setShowScheduleModal(false)}
        footer={null}
        width={640}
        centered
      >
        <Form
          layout="inline"
          onFinish={async (vals) => {
            try {
              const res = await authenticatedFetch(`/api/queries/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: vals.name, sql: sqlQuery, cron: vals.cron, enabled: true }),
              });
              if (!res.ok) throw new Error('Failed');
              message.success(t('scheduled_ok'));
              const reload = await authenticatedFetch(`/api/queries/schedules`);
              if (reload.ok) {
                const j = await reload.json();
                setSchedules(Array.isArray(j.items) ? j.items : []);
              }
            } catch {
              message.error(t('schedule_failed'));
            }
          }}
        >
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="Schedule name" />
          </Form.Item>
          <Form.Item name="cron" rules={[{ required: true }]}>
            <Input placeholder="Cron (e.g., 0 9 * * 1)" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              Create
            </Button>
          </Form.Item>
        </Form>
        <Divider />
        <Table
          dataSource={schedules}
          rowKey={(r) => r.id}
          size="small"
          pagination={false}
          columns={[
            { title: t('name'), dataIndex: 'name', key: 'name' },
            { title: 'Cron', dataIndex: 'cron', key: 'cron' },
            { title: 'Enabled', dataIndex: 'enabled', key: 'enabled', render: (v: boolean) => (v ? 'Yes' : 'No') },
            {
              title: 'Last Run',
              dataIndex: 'last_run_at',
              key: 'last_run_at',
              render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
            },
          ]}
          className="data-content"
          style={{ maxHeight: 300, overflow: 'auto' }}
        />
      </Modal>
    </div>
  );
};

export default MonacoSQLEditor;
