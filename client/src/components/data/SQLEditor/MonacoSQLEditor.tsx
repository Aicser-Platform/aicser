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
  Popover,
  Progress,
  Dropdown,
  Menu,
  message,
  Collapse,
  Divider,
  Alert,
  Modal,
  Form,
  Grid,
  Pagination,
} from 'antd';
import { useTranslations } from 'next-intl';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import MemoryOptimizedEditor, { type MemoryOptimizedEditorHandle } from '@/components/ai/MemoryOptimizedEditor';
import {
  DatabaseOutlined,
  PlusOutlined,
  SaveOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  ExpandOutlined,
  CloudOutlined,
  ApiOutlined,
  FileOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  QuestionCircleOutlined,
  ScissorOutlined,
  MoreOutlined,
  CaretRightOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { enhancedDataService } from '@/services/enhancedDataService';
import { fetchApi } from '@/utils/api';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
import { generateColumns } from '@/components/data/SQLEditor/panes/generateColumns';
import { PerformancePane } from '@/components/data/SQLEditor/panes/PerformancePane';
import { QueryHistoryPane } from '@/components/data/SQLEditor/panes/QueryHistoryPane';
import { SavedQueriesSnapshotsPane } from '@/components/data/SQLEditor/panes/SavedQueriesSnapshotsPane';
import { ResultsTabPane } from '@/components/data/SQLEditor/panes/ResultsTabPane';
import NL2SqlPromptBar from '@/components/data/SQLEditor/NL2SqlPromptBar';
import { ModelSelector } from '@/components/ai/ModelSelector/ModelSelector';
import { useAiAvailability } from '@/hooks/useAiAvailability';
import { AiMarkdownContent } from '@/components/ui/AiMarkdownContent';
import { getChatHref } from '@/utils/appPaths';
import {
  isSameQueryName,
  resolveQueryTabSaveName,
  snapshotNameFromTabTitle,
  uniqueSavedQueryName,
} from '@/utils/queryTabNaming';
import {
  clearSavedQueryBind,
  columnsFromQueryResult,
  wrapSqlAsSubquery,
  buildChartDataFromRows,
  buildChartQueryFromBind,
  buildBindNavigateUrl,
  buildMappingFromFields,
  type SavedQueryBindPayload,
} from '@/app/(dashboard)/dashboards/utils/queryBindBridge';
import { chartBuilderService } from '@/app/(dashboard)/chart-designer/services/chartBuilderService';
import { QueryVisualizeModal, type QueryVisualizeModalValues } from '@/components/data/SQLEditor/QueryVisualizeModal';
import { RlsAppliedPopoverContent } from '@/components/data/SQLEditor/RlsAppliedPopoverContent';

const IS_EE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

/** Strip non-JSON-serializable cell values before snapshot POST. */
function jsonSafeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  try {
    return JSON.parse(
      JSON.stringify(rows, (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'undefined') return null;
        return value;
      }),
    ) as Record<string, unknown>[];
  } catch {
    return rows.map((row) => {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          next[k] = v;
        } else {
          next[k] = String(v);
        }
      }
      return next;
    });
  }
}

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
const { Panel } = Collapse;


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
  savedQueryId?: number | string | null;
};

type QueryLanguage = 'sql' | 'python';

const resolveLanguage = (language?: string | null): QueryLanguage => (language === 'python' ? 'python' : 'sql');

import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useDataSourceSchema, useDataSources } from '@/hooks/useDataSources';
import { useFormatUserError } from '@/hooks/useFormatUserError';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { DEFAULT_QUERY_LIMIT, ROW_LIMIT_PRESETS } from '@/config/queryLimits';
import {
  clearQueryEditorImport,
  consumeQueryEditorImport,
  peekQueryEditorImport,
  QUERY_EDITOR_IMPORT_EVENT,
  type QueryEditorImportPayload,
} from '@/utils/queryEditorBridge';

const DEFAULT_SQL_SNIPPET = `SELECT * FROM data LIMIT ${DEFAULT_QUERY_LIMIT};`;
const MIN_EDITOR_HEIGHT = 100;
const RUN_BAR_HEIGHT = 44;
const TABS_ROW_HEIGHT = 32;
const MIN_TOP_SECTION_HEIGHT = TABS_ROW_HEIGHT + MIN_EDITOR_HEIGHT + RUN_BAR_HEIGHT; // tabs + editor + run bar
// Results pane's minimum footprint — kept small since it's the resizable floor,
// not its default (the results pane still gets whatever space is left over).
const MIN_RESULTS_PANE_HEIGHT = 90;
const DEFAULT_EDITOR_HEIGHT = 200;
const DATA_PANEL_MIN = 260;
const DATA_PANEL_MAX = 600;
const DATA_PANEL_DEFAULT = 320;
const computeMaxEditorHeight = (workspaceHeight?: number) => {
  if (typeof window === 'undefined') return 360;
  // `||` (not `??`) on purpose: a not-yet-laid-out container reports clientHeight
  // 0, which is defined (so `??` would accept it) but never a real measurement —
  // treating it as real clamped the editor to its floor on every mount and then
  // *persisted* that bogus small height, silently wiping the user's saved resize
  // on every refresh/navigation.
  const base =
    workspaceHeight ||
    (typeof document !== 'undefined'
      ? document.querySelector('.qe-workspace-main')?.clientHeight
      : undefined) ||
    window.innerHeight;
  // Chrome above the resizable split (page header + AI assist bar) — tightened
  // from an earlier, over-generous estimate that was silently capping the
  // editor's default height well below what the viewport actually allowed.
  const reserved = 140;
  const available = Math.max(MIN_TOP_SECTION_HEIGHT, base - reserved);
  return Math.max(MIN_TOP_SECTION_HEIGHT, available - MIN_RESULTS_PANE_HEIGHT);
};
const computeDefaultEditorHeight = () => {
  const max = computeMaxEditorHeight();
  // Default to a generously tall code area (most of the available space) rather
  // than a box that leaves a large empty void above the results pane on first
  // load — matches how most SQL editors (and this one, once resized) look.
  const target = Math.max(500, Math.floor(max * 0.88));
  return Math.min(max, target, 760);
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
  const router = useRouter();
  const formatError = useFormatUserError();
  const authenticatedFetch = useAuthenticatedFetch();
  const { session, user: authUser } = useAuthStore();
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
  const resultsTabByQueryKeyRef = useRef<Record<string, string>>({});
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
  const handleResultsTabChange = useCallback((key: string) => {
    if (activeQueryKey) {
      resultsTabByQueryKeyRef.current[activeQueryKey] = key;
    }
    setActiveTab(key);
  }, [activeQueryKey]);
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
  // Row-level security silently drops rows; the results toolbar has to say so.
  const [rlsApplied, setRlsApplied] = useState(false);
  const [columnsOmitted, setColumnsOmitted] = useState<string[]>([]);
  const [rlsPopoverOpen, setRlsPopoverOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [resultLimitApplied, setResultLimitApplied] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<string>('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => {
    setCurrentPage(1);
  }, [results]);
  const [selectedEngine, setSelectedEngine] = useState<string>('auto');
  const [resolvedEngine, setResolvedEngine] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const importHandledRef = useRef(false);

  const screens = Grid.useBreakpoint();
  const isDesktopLayout = screens.lg ?? false;
  const isStackedLayout = !isDesktopLayout;
  const effectiveSidebarCollapsed = isStackedLayout ? false : sidebarCollapsed;

  const [dataPanelWidth, setDataPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DATA_PANEL_DEFAULT;
    try {
      const saved = window.localStorage.getItem('qe_data_panel_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed >= DATA_PANEL_MIN && parsed <= DATA_PANEL_MAX) return parsed;
      }
    } catch {
      /* ignore */
    }
    return DATA_PANEL_DEFAULT;
  });
  const dataPanelDragRef = useRef({ active: false, startX: 0, startWidth: DATA_PANEL_DEFAULT });

  const handleDataPanelDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dataPanelDragRef.current = { active: true, startX: e.clientX, startWidth: dataPanelWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (me: MouseEvent) => {
        if (!dataPanelDragRef.current.active) return;
        const delta = dataPanelDragRef.current.startX - me.clientX;
        const next = Math.min(
          DATA_PANEL_MAX,
          Math.max(DATA_PANEL_MIN, dataPanelDragRef.current.startWidth + delta),
        );
        setDataPanelWidth(next);
      };

      const onUp = () => {
        dataPanelDragRef.current.active = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setDataPanelWidth((prev) => {
          try {
            window.localStorage.setItem('qe_data_panel_width', String(prev));
          } catch {
            /* ignore */
          }
          return prev;
        });
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [dataPanelWidth],
  );

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
          user: r.user || authUser?.email || 'unknown',
          engine: r.engine || 'unknown',
          error: r.error
        })));
      } catch (_) {
        // Keep in-memory only on failure
      }
    })();
    return () => { cancelled = true; };
  }, [authenticatedFetch]);

  const columns = useMemo(() => generateColumns(results, t), [results, t]);

  const handleHistoryRemove = useCallback(async (id: string | number) => {
    await authenticatedFetch(`/api/queries/execution-history/${id}`, { method: 'DELETE' });
    setQueryHistory((prev) => prev.filter((r: any) => (r.id ?? r.history_id) !== id));
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
  const [aiAssistantInput, setAiAssistantInput] = useState<string>('');
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const aiGenerateAbortRef = useRef<AbortController | null>(null);
  const [aiModel, setAiModel] = useState<string | undefined>();
  const selectedAiModel = aiModel ?? 'auto';
  const aiAvailability = useAiAvailability(true, IS_EE);
  const aiAvailable = !IS_EE || aiAvailability.available;
  const [aiExplainOpen, setAiExplainOpen] = useState(false);
  const [aiExplainContent, setAiExplainContent] = useState('');
  const [aiExplaining, setAiExplaining] = useState(false);
  const [hasEditorSelection, setHasEditorSelection] = useState(false);
  const [aiOptimizing, setAiOptimizing] = useState(false);
  // Optimize diff state — show before/after instead of silent overwrite
  const [optimizeDiffOpen, setOptimizeDiffOpen] = useState(false);
  const [optimizeOriginalSQL, setOptimizeOriginalSQL] = useState('');
  const [optimizeNewSQL, setOptimizeNewSQL] = useState('');
  const [optimizeImprovements, setOptimizeImprovements] = useState('');
  // Query cancel support
  const queryAbortControllerRef = useRef<AbortController | null>(null);
  // Query parameters: {{param_name}} substitution
  const [queryParamValues, setQueryParamValues] = useState<Record<string, string>>({});
  const [editingTabKey, setEditingTabKey] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string>('');
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [showVisualizeModal, setShowVisualizeModal] = useState(false);
  const [visualizeConfirming, setVisualizeConfirming] = useState(false);
  const [modalSaveQueryName, setModalSaveQueryName] = useState('');
  const [savingSavedQuery, setSavingSavedQuery] = useState(false);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [permEmail, setPermEmail] = useState('');
  const [permLoading, setPermLoading] = useState(false);
  const [savedQueries, setSavedQueries] = useState<any[]>([]);
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
    const max = computeMaxEditorHeight();
    const stored = Number(window.localStorage.getItem('qe_editor_height_v3'));
    const initial = Number.isFinite(stored) && stored > 0 ? stored : computeDefaultEditorHeight();
    return Math.min(Math.max(initial, MIN_TOP_SECTION_HEIGHT), max);
  });
  const editorResizeStateRef = useRef({
    isResizing: false,
    startY: 0,
    startHeight: editorHeight,
  });
  const workspaceMainRef = useRef<HTMLDivElement>(null);
  const clampEditorHeight = useCallback(
    (value: number) => {
      const workspaceH = workspaceMainRef.current?.clientHeight;
      const max = computeMaxEditorHeight(workspaceH);
      setMaxEditorHeight(max);
      return Math.min(Math.max(value, MIN_TOP_SECTION_HEIGHT), max);
    },
    [],
  );
  const rowLimitOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [...ROW_LIMIT_PRESETS];
    if (limitSource === 'query' && rowLimit && !opts.some((option) => option.value === rowLimit)) {
      opts.push({ value: rowLimit, label: rowLimit });
    }
    return opts;
  }, [limitSource, rowLimit]);
  // The window-resize listeners below only catch viewport changes — they miss the
  // workspace shrinking/growing from its own sibling content (e.g. the AI bar
  // wrapping onto a second line when its model selector overflows). Without this,
  // editorHeight/maxEditorHeight go stale relative to the real available space and
  // the split leaves empty/clipped space until the next window resize.
  useEffect(() => {
    const node = workspaceMainRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setEditorHeight((h) => clampEditorHeight(h));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [clampEditorHeight]);
  useEffect(() => {
    const nextMax = computeMaxEditorHeight();
    setMaxEditorHeight(nextMax);
    setEditorHeight((h) => {
      const clamped = Math.min(Math.max(h, MIN_TOP_SECTION_HEIGHT), nextMax);
      if (clamped !== h) {
        try {
          window.localStorage.setItem('qe_editor_height_v3', String(clamped));
        } catch {
          /* ignore */
        }
      }
      return clamped;
    });
    const handleWindowResize = () => {
      const max = computeMaxEditorHeight();
      setMaxEditorHeight(max);
      setEditorHeight((h) => Math.min(Math.max(h, MIN_TOP_SECTION_HEIGHT), max));
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
      window.localStorage.setItem('qe_editor_height_v3', String(editorHeight));
    } catch {
      // ignore storage failures
    }
  }, [editorHeight]);
  const normalizeTabs = (tabs: Array<Partial<QueryTab>>) =>
    tabs.map((tab, index) => {
      const sql = tab.sql ?? DEFAULT_SQL_SNIPPET;
      const language = resolveLanguage(tab.language);
      const meta = (tab as { metadata?: { savedQueryId?: number | string } }).metadata;
      return {
        key: tab.key ?? `tab-${index}`,
        title: tab.title ?? `Query ${index + 1}`,
        sql,
        python: tab.python ?? buildPythonTemplate(sql, selectedDataSource?.name),
        language,
        savedQueryId: tab.savedQueryId ?? meta?.savedQueryId ?? null,
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

  const applyQueryEditorImport = useCallback(
    (payload: QueryEditorImportPayload) => {
      const sql = payload?.sql?.trim();
      if (!sql) return;
      importHandledRef.current = true;
      if (payload.dataSourceId) selectDataSource(String(payload.dataSourceId));
      setEditorLanguage('sql');
      setSqlQuery(sql);
      const tabKey = activeQueryKey || 'q-1';
      const nextTabs = (() => {
        const tabs = queryTabs.length
          ? queryTabs
          : [{ key: 'q-1', title: 'Query 1', sql: DEFAULT_SQL_SNIPPET, language: 'sql' as QueryLanguage }];
        return tabs.map((tab) =>
          tab.key === tabKey
            ? { ...tab, sql, title: payload.title?.trim() || tab.title, language: 'sql' as QueryLanguage }
            : tab,
        );
      })();
      setQueryTabs(nextTabs);
      try {
        localStorage.setItem('qe_tabs', JSON.stringify({ tabs: nextTabs, activeKey: tabKey }));
      } catch {
        /* ignore */
      }
      if (payload.rows?.length) {
        setResults(payload.rows);
        onQueryResult?.(payload.rows);
        setActiveTab('results');
      }
      clearQueryEditorImport();
      message.success(t('toast_imported_from_chat'));
    },
    [activeQueryKey, onQueryResult, queryTabs, selectDataSource, t],
  );

  useEffect(() => {
    const staged = consumeQueryEditorImport();
    if (staged) applyQueryEditorImport(staged);

    const onImport = (event: Event) => {
      const detail = (event as CustomEvent<QueryEditorImportPayload>).detail;
      if (detail?.sql?.trim()) applyQueryEditorImport(detail);
    };
    window.addEventListener(QUERY_EDITOR_IMPORT_EVENT, onImport);
    return () => window.removeEventListener(QUERY_EDITOR_IMPORT_EVENT, onImport);
  }, [applyQueryEditorImport]);

  // When user selects a data source and schema loads, set starter SQL if editor still has default snippet
  useEffect(() => {
    if (importHandledRef.current || peekQueryEditorImport()) return;
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

  useEffect(() => {
    const updateMax = () => {
      const workspaceH = workspaceMainRef.current?.clientHeight;
      if (workspaceH) {
        setMaxEditorHeight(computeMaxEditorHeight(workspaceH));
      }
    };
    updateMax();
    window.addEventListener('resize', updateMax);
    return () => window.removeEventListener('resize', updateMax);
  }, []);

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
    if (importHandledRef.current || peekQueryEditorImport()) return false;
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
    if (importHandledRef.current || peekQueryEditorImport()) return;

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

  const saveTabsToBackendRef = useRef<
    (tabs: QueryTab[], activeKey: string, silent?: boolean) => Promise<void>
  >(async () => {});

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
  }, [authenticatedFetch, organizationId, projectId, t]);

  useEffect(() => {
    saveTabsToBackendRef.current = saveTabsToBackend;
  }, [saveTabsToBackend]);

  const removeQueryTab = useCallback(
    (key: string) => {
      if (queryTabs.length <= 1) return;
      const idx = queryTabs.findIndex((tab) => tab.key === key);
      const newTabs = queryTabs.filter((tab) => tab.key !== key);
      const nextActiveKey =
        activeQueryKey === key && newTabs.length ? newTabs[Math.max(0, idx - 1)].key : activeQueryKey;
      setQueryTabs(newTabs);
      if (activeQueryKey === key && newTabs.length) {
        const next = newTabs[Math.max(0, idx - 1)];
        const nextLanguage = resolveLanguage(next.language);
        setActiveQueryKey(next.key);
        setEditorLanguage(nextLanguage);
        setSqlQuery(
          nextLanguage === 'python'
            ? getPythonTemplate(next, selectedDataSource?.name)
            : (next.sql ?? DEFAULT_SQL_SNIPPET),
        );
      } else if (!newTabs.length) {
        setActiveQueryKey('');
        setEditorLanguage('sql');
        setSqlQuery(DEFAULT_SQL_SNIPPET);
      }
      saveTabsToBackendRef.current(newTabs, newTabs.length ? nextActiveKey : '', true);
    },
    [queryTabs, activeQueryKey, selectedDataSource?.name],
  );

  const refreshSavedQueriesList = useCallback(async () => {
    const j = await authenticatedFetch(savedQueriesUrl);
    const list = Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items.filter(Boolean) : [];
    setSavedQueries(list);
    return list as Array<{ id?: number | string; name?: string }>;
  }, [authenticatedFetch, savedQueriesUrl]);

  const persistSavedQueryForTab = useCallback(
    async (opts: {
      name: string;
      sql: string;
      tabKey: string;
      language: QueryLanguage;
      savedQueryId?: number | string | null;
      syncTabTitle?: boolean;
      /** When true, auto-suffix name on collision instead of failing */
      uniqueName?: boolean;
    }) => {
      let trimmedName = opts.name.trim();
      if (!trimmedName || !opts.sql.trim()) {
        message.warning(t('no_query_to_save'));
        return null;
      }

      const metadata = {
        tabKey: opts.tabKey,
        language: opts.language,
        activeQueryKey: opts.tabKey,
        data_source_id: selectedDataSource?.id ? String(selectedDataSource.id) : undefined,
        dataSourceId: selectedDataSource?.id ? String(selectedDataSource.id) : undefined,
        dataSourceName: selectedDataSource?.name,
      };

      const scopeQs = queriesScopeParams ? `?${queriesScopeParams}` : '';
      let targetId: number | string | null = opts.savedQueryId ?? null;

      if (targetId == null) {
        const tab = queryTabs.find((qt) => qt.key === opts.tabKey);
        if (tab?.savedQueryId != null) targetId = tab.savedQueryId;
      }
      if (targetId == null) {
        const byName = savedQueries.find((q: { name?: string; id?: number | string }) =>
          isSameQueryName(q.name, trimmedName),
        );
        if (byName?.id != null) targetId = byName.id;
      }

      if (opts.uniqueName) {
        trimmedName = uniqueSavedQueryName(trimmedName, savedQueries, targetId);
      }

      const canPut = targetId != null && String(targetId).trim() !== '';

      try {
        if (canPut) {
          await authenticatedFetch(`/api/queries/saved-queries/${targetId}${scopeQs}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmedName, sql: opts.sql, metadata }),
          });
        } else {
          const created = await authenticatedFetch(savedQueriesUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmedName, sql: opts.sql, metadata }),
          });
          if (created?.id != null) targetId = created.id;
        }
      } catch (err: any) {
        const msg = String(err?.message || err?.detail || JSON.stringify(err?.body || ''));
        // Name collision → update existing row or retry with a unique name
        if (/already exists/i.test(msg)) {
          const existing = savedQueries.find((q: { name?: string; id?: number | string }) =>
            isSameQueryName(q.name, trimmedName),
          );
          if (existing?.id != null && (targetId == null || String(existing.id) === String(targetId))) {
            targetId = existing.id;
            await authenticatedFetch(`/api/queries/saved-queries/${targetId}${scopeQs}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: trimmedName, sql: opts.sql, metadata }),
            });
          } else {
            trimmedName = uniqueSavedQueryName(trimmedName, savedQueries, targetId);
            if (targetId != null && String(targetId).trim() !== '') {
              await authenticatedFetch(`/api/queries/saved-queries/${targetId}${scopeQs}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmedName, sql: opts.sql, metadata }),
              });
            } else {
              const created = await authenticatedFetch(savedQueriesUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmedName, sql: opts.sql, metadata }),
              });
              if (created?.id != null) targetId = created.id;
            }
          }
        } else {
          throw err;
        }
      }

      const list = await refreshSavedQueriesList();
      const saved =
        list.find((q) => q.id != null && targetId != null && String(q.id) === String(targetId)) ??
        list.find((q) => isSameQueryName(q.name, trimmedName));

      if (saved?.id != null) {
        setQueryTabs((prev) =>
          prev.map((tab) =>
            tab.key === opts.tabKey
              ? {
                  ...tab,
                  savedQueryId: saved.id,
                  title: opts.syncTabTitle === false ? tab.title : trimmedName,
                }
              : tab,
          ),
        );
      } else if (opts.syncTabTitle !== false) {
        setQueryTabs((prev) =>
          prev.map((tab) => (tab.key === opts.tabKey ? { ...tab, title: trimmedName } : tab)),
        );
      }

      return saved?.id ?? targetId ?? null;
    },
    [
      authenticatedFetch,
      queriesScopeParams,
      queryTabs,
      refreshSavedQueriesList,
      savedQueries,
      savedQueriesUrl,
      selectedDataSource,
      t,
    ],
  );

  const openVisualizeModal = useCallback(() => {
    const content = latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
    if (!content) {
      message.warning(t('no_query_to_save'));
      return;
    }
    if (!selectedDataSourceId) {
      message.warning(t('select_ds_first'));
      return;
    }
    setShowVisualizeModal(true);
  }, [sqlQuery, selectedDataSourceId, t]);

  const confirmVisualizeQuery = useCallback(
    async (values: QueryVisualizeModalValues) => {
      const tab = queryTabs.find((qt) => qt.key === activeQueryKey);
      const idx = queryTabs.findIndex((qt) => qt.key === activeQueryKey);
      const fallbackName = resolveQueryTabSaveName(tab?.title, idx >= 0 ? idx + 1 : queryTabs.length);
      const name = (values.title || '').trim() || fallbackName;
      const content = latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
      if (!content || !selectedDataSourceId) return;
      if (values.target === 'dashboard' && !values.dashboardId) {
        message.warning('Select a dashboard first');
        return;
      }

      setVisualizeConfirming(true);
      try {
        // Persist under the widget title (unique). Keep tab title unless user named the tab.
        const savedId = await persistSavedQueryForTab({
          name,
          sql: content,
          tabKey: tab?.key ?? activeQueryKey,
          language: resolveLanguage(tab?.language ?? editorLanguage),
          savedQueryId: tab?.savedQueryId,
          uniqueName: true,
          syncTabTitle: false,
        });
        if (savedId == null) {
          message.error('Could not save query for visualization');
          return;
        }

        // Discover columns: prefer current results, else probe SQL
        let columns = columnsFromQueryResult({
          data: Array.isArray(results) ? results.slice(0, 5) : [],
        });
        if (!columns.length) {
          try {
            const probe = await enhancedDataService.executeMultiEngineQuery(
              wrapSqlAsSubquery(content, 5),
              String(selectedDataSourceId),
              undefined,
              true,
              undefined,
              projectId || currentProjectId,
            );
            columns = columnsFromQueryResult(probe as any);
          } catch (err) {
            console.warn('Column probe failed:', err);
          }
        }

        const mapping = buildMappingFromFields({
          chartType: values.chartType,
          xField: values.xField,
          yFields: values.yFields,
          groupField: values.groupField,
          columns,
        });

        let querySnapshotId: string | number | undefined;
        let chartData: Record<string, unknown> | undefined;

        if (values.dataMode === 'snapshot') {
          if (!Array.isArray(results) || results.length === 0) {
            message.warning('Run the query first to create a snapshot');
            return;
          }
          const snapCols = columns.map((c) => c.name);
          const snapRes = await authenticatedFetch(
            queriesScopeParams ? `/api/queries/snapshots?${queriesScopeParams}` : '/api/queries/snapshots',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                sql: content,
                data_source_id: selectedDataSourceId,
                rows: jsonSafeRows(results.slice(0, 500) as Record<string, unknown>[]),
                columns: snapCols,
                preview_rows: Math.min(500, results.length),
                organization_id: organizationId || undefined,
                project_id: projectId || undefined,
              }),
            },
          );
          querySnapshotId = snapRes?.id ?? snapRes?.snapshot_id;
          chartData = buildChartDataFromRows(results.slice(0, 500), {
            chartType: values.chartType,
            x: mapping.x,
            yMetrics: mapping.yMetrics,
          });
        } else if (Array.isArray(results) && results.length > 0) {
          chartData = buildChartDataFromRows(results.slice(0, 500), {
            chartType: values.chartType,
            x: mapping.x,
            yMetrics: mapping.yMetrics,
          });
        }

        const chartQuery = buildChartQueryFromBind({
          savedQueryId: savedId,
          querySnapshotId,
          columns,
          chartType: values.chartType,
          dataMode: values.dataMode,
          chartQuery: {
            x: mapping.x,
            yMetrics: mapping.yMetrics,
            yMetric: 'none',
            sortBy: mapping.x ? 'x' : 'record_order',
            ...(values.xGrain ? { xGrain: values.xGrain } : {}),
            ...(mapping.groupField
              ? { groupField: mapping.groupField, legend: mapping.groupField }
              : {}),
            ...(values.drillPath?.length ? { drillPath: values.drillPath } : {}),
          },
        });

        // Upsert library chart then link (shared helper used by Chat + Designer too)
        const { ensureLibraryChartAndPinToDashboard } = await import(
          '@/components/charts/ensureLibraryChartAndPin'
        );

        let preCreatedChartId: string | undefined;
        let libraryChartId: string | undefined;

        if (values.target === 'dashboard' && values.dashboardId) {
          const h = values.chartType === 'stat' ? 4 : 8;
          const pinned = await ensureLibraryChartAndPinToDashboard({
            dashboardId: values.dashboardId,
            definition: {
              title: name,
              chartType: values.chartType,
              dataSourceId: String(selectedDataSourceId),
              chartQuery: chartQuery as any,
              chartOptions: {
                showLegend: values.chartType !== 'stat' && values.chartType !== 'table',
                ...(chartData ? { __prefetchedChartData: chartData } : {}),
              },
              reuseSavedQuery: true,
            },
            // Placement is resolved against the target board inside the helper
            layout: { w: 6, h },
            mode: 'link',
            projectId: projectId || currentProjectId,
          });
          preCreatedChartId = pinned.chartId;
          libraryChartId = pinned.libraryChartId;

          try {
            const { useDashboardStore } = await import(
              '@/app/(dashboard)/dashboards/stores/useDashboardStore'
            );
            const store = useDashboardStore.getState();
            // Reload charts for this dashboard (fetchDashboards alone can leave a stale canvas)
            await store.loadDashboardById(values.dashboardId);
            store.setStudioMode('edit');
            store.setSelectedWidgetId(`widget-${preCreatedChartId}`);
            store.setPropertiesCollapsed(false);
          } catch (refreshErr) {
            console.warn('Dashboard store refresh after pin failed:', refreshErr);
          }
        } else {
          const libraryChart = await chartBuilderService.createChart(
            {
              title: name,
              chartType: values.chartType,
              dataSourceId: String(selectedDataSourceId),
              chartQuery: chartQuery as any,
              chartOptions: {
                showLegend: values.chartType !== 'stat' && values.chartType !== 'table',
                ...(chartData ? { __prefetchedChartData: chartData } : {}),
              },
              reuseSavedQuery: true,
            },
            projectId || currentProjectId,
          );
          libraryChartId = libraryChart?.id ? String(libraryChart.id) : undefined;
          preCreatedChartId = libraryChartId;
          if (!libraryChartId) {
            throw new Error('Library chart was not created');
          }
        }

        const payload: SavedQueryBindPayload = {
          savedQueryId: savedId,
          querySnapshotId,
          name,
          sql: content,
          dataSourceId: String(selectedDataSourceId),
          columns,
          chartType: values.chartType,
          dataMode: values.dataMode,
          target: values.target,
          dashboardId: values.dashboardId,
          preCreatedChartId,
          chartQuery,
          chartData,
        };

        clearSavedQueryBind();
        if (values.target === 'chart-designer' && libraryChartId) {
          try {
            sessionStorage.setItem('chart_designer_select', libraryChartId);
          } catch {
            /* ignore */
          }
        }

        setShowVisualizeModal(false);
        message.success(
          values.target === 'dashboard'
            ? `Linked “${name}” to dashboard`
            : `Opening Chart Designer with “${name}”…`,
        );
        router.push(
          values.target === 'chart-designer'
            ? `/chart-designer?chart=${libraryChartId}`
            : buildBindNavigateUrl(payload),
        );
      } catch (e: unknown) {
        message.error(formatError(e) || 'Could not visualize query');
      } finally {
        setVisualizeConfirming(false);
      }
    },
    [
      queryTabs,
      activeQueryKey,
      sqlQuery,
      selectedDataSourceId,
      persistSavedQueryForTab,
      editorLanguage,
      results,
      authenticatedFetch,
      queriesScopeParams,
      organizationId,
      projectId,
      currentProjectId,
      router,
      formatError,
    ],
  );

  useEffect(() => {
    if (!showSavedModal) return;
    const tab = queryTabs.find((qt) => qt.key === activeQueryKey);
    const idx = queryTabs.findIndex((qt) => qt.key === activeQueryKey);
    setModalSaveQueryName(resolveQueryTabSaveName(tab?.title, idx >= 0 ? idx + 1 : queryTabs.length));
  }, [showSavedModal, activeQueryKey, queryTabs]);

  const activeTabForSavedModal = useMemo(() => {
    const tab = queryTabs.find((qt) => qt.key === activeQueryKey);
    if (!tab) return null;
    return { key: tab.key, title: tab.title, savedQueryId: tab.savedQueryId ?? null };
  }, [queryTabs, activeQueryKey]);

  const buildTabFromSavedRecord = useCallback(
    (record: { name?: string; sql?: string; metadata?: Record<string, unknown>; id?: number | string }, newKey: string) => {
      const metadata = record?.metadata || {};
      const language = resolveLanguage(metadata.language as string | undefined);
      const baseSql = record.sql || DEFAULT_SQL_SNIPPET;
      const pythonContent =
        language === 'python' ? baseSql : buildPythonTemplate(baseSql, selectedDataSource?.name);
      return {
        key: newKey,
        title: (record.name || '').trim() || 'Query',
        sql: language === 'python' ? DEFAULT_SQL_SNIPPET : baseSql,
        python: pythonContent,
        language,
        savedQueryId: record.id ?? null,
      };
    },
    [selectedDataSource?.name],
  );

  const handleModalSaveCurrentQuery = useCallback(async () => {
    const currentTab = queryTabs.find((qt) => qt.key === activeQueryKey);
    if (!currentTab) return;
    const idx = queryTabs.findIndex((qt) => qt.key === activeQueryKey);
    const name = modalSaveQueryName.trim() || resolveQueryTabSaveName(currentTab.title, idx >= 0 ? idx + 1 : queryTabs.length);
    const content = latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
    if (!content) {
      message.warning(t('no_query_to_save'));
      return;
    }

    const existing = savedQueries.find((q: { name?: string; id?: number | string }) =>
      isSameQueryName(q.name, name),
    );
    const canUpdateExisting =
      existing &&
      typeof existing.id === 'number' &&
      existing.id !== currentTab.savedQueryId &&
      !isSameQueryName(currentTab.title, name);

    if (canUpdateExisting) {
      Modal.confirm({
        title: t('saved_query_name_exists_title'),
        content: t('saved_query_name_exists_body', { name }),
        okText: t('update_existing_query'),
        cancelText: t('save_as_new_copy'),
        onCancel: () => setModalSaveQueryName(`${name} (copy)`),
        onOk: async () => {
          setSavingSavedQuery(true);
          try {
            await persistSavedQueryForTab({
              name,
              sql: content,
              tabKey: currentTab.key,
              language: resolveLanguage(currentTab.language ?? editorLanguage),
              savedQueryId: existing.id,
            });
            message.success(t('saved_to_list', { name }));
          } catch (e: unknown) {
            message.error(formatError(e as { message?: string }, 'save_failed', t('update_failed')));
          } finally {
            setSavingSavedQuery(false);
          }
        },
      });
      return;
    }

    setSavingSavedQuery(true);
    try {
      await persistSavedQueryForTab({
        name,
        sql: content,
        tabKey: currentTab.key,
        language: resolveLanguage(currentTab.language ?? editorLanguage),
        savedQueryId: currentTab.savedQueryId,
      });
      message.success(t('saved_to_list', { name }));
    } catch (err: unknown) {
      message.error(formatError(err as { message?: string }, 'save_failed', t('save_failed')));
    } finally {
      setSavingSavedQuery(false);
    }
  }, [
    activeQueryKey,
    editorLanguage,
    modalSaveQueryName,
    persistSavedQueryForTab,
    queryTabs,
    savedQueries,
    sqlQuery,
    t,
  ]);

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

  // Ctrl+S save shortcut and Ctrl+Enter run (use refs so handler always has latest; Monaco Ctrl+Enter registered in onMonacoMount)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const tabs = queryTabsRef.current;
        const activeKey = activeQueryKeyRef.current;
        try { localStorage.setItem('qe_tabs', JSON.stringify({ tabs, activeKey })); } catch { }
        saveTabsToBackendRef.current(tabs, activeKey);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        // Skip when Monaco has focus — its own addAction keybinding (registered in
        // onMonacoMount) already runs the query for this exact keypress; without this
        // check both handlers fire and the query runs twice. This listener exists for
        // the case where focus is elsewhere on the page (e.g. the row-limit control).
        if (monacoEditorInstanceRef.current?.hasTextFocus?.()) return;
        e.preventDefault();
        runHandlerRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // Monaco editor instance, so the window-level Ctrl+Enter fallback below can check
  // hasTextFocus() and skip when Monaco's own action (registered in onMonacoMount)
  // is already handling the same keypress — otherwise both fire and the query runs twice.
  const monacoEditorInstanceRef = useRef<{ hasTextFocus?: () => boolean } | null>(null);

  // Debounced auto-save: persist current tab content to backend after 2s of no typing
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
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
      saveTabsToBackendRef.current(merged, activeKey, true);
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [sqlQuery, activeQueryKey, editorLanguage]);

  // Schema is now loaded automatically by DataSourceContext when selectDataSource is called

  /**
   * Parse a SQL error message for a line/column position and highlight it in Monaco.
   * Supports common patterns from PostgreSQL, MySQL, SQLite, DuckDB, Trino, BigQuery.
   */
  const highlightSQLError = useCallback((errorMessage: string) => {
    const monacoInstance = monacoInstanceRef.current;
    const model = editorModelRef.current;
    if (!monacoInstance?.editor?.setModelMarkers || !model) return;

    // Clear previous markers
    monacoInstance.editor.setModelMarkers(model, 'sql-error', []);

    // Patterns: "line N", "LINE N", "at line N", "position N" (char offset), "[N:M]"
    let line = 0, col = 1;
    const lineMatch = errorMessage.match(/\bline[:\s]+(\d+)/i) || errorMessage.match(/\[(\d+):(\d+)\]/);
    const posMatch = errorMessage.match(/\bposition\s+(\d+)/i); // char-offset (PostgreSQL)

    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
      if (lineMatch[2]) col = parseInt(lineMatch[2], 10);
    } else if (posMatch) {
      // Convert char offset to line/col using the model's content
      const charOffset = parseInt(posMatch[1], 10);
      const sql: string = typeof model.getValue === 'function' ? model.getValue() : '';
      let remaining = charOffset;
      const lines: string[] = sql.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) { line = i + 1; col = remaining + 1; break; }
        remaining -= lines[i].length + 1;
      }
      if (!line) line = lines.length;
    }

    if (!line) return; // no position info found

    const totalLines = typeof model.getLineCount === 'function' ? model.getLineCount() : 1;
    const safeLine = Math.min(Math.max(line, 1), totalLines);
    const lineLength = typeof model.getLineLength === 'function' ? model.getLineLength(safeLine) : 80;

    monacoInstance.editor.setModelMarkers(model, 'sql-error', [{
      severity: 8, // MarkerSeverity.Error
      message: errorMessage,
      startLineNumber: safeLine,
      startColumn: col,
      endLineNumber: safeLine,
      endColumn: Math.max(lineLength + 1, col + 1),
    }]);
  }, []);

  // Register SQL completion, language config, Ctrl+Enter run, format provider, and selection tracking
  const handleMonacoMount = useCallback((editor: unknown, monacoInstance: unknown) => {
    // Store refs for external use (e.g. setModelMarkers for error highlighting)
    monacoInstanceRef.current = monacoInstance;
    editorModelRef.current = (editor as any)?.getModel?.() ?? null;
    monacoEditorInstanceRef.current = editor as { hasTextFocus?: () => boolean };

    const monaco = monacoInstance as {
      languages: {
        setLanguageConfiguration: (lang: string, config: unknown) => { dispose: () => void };
        registerCompletionItemProvider: (lang: string, provider: unknown) => { dispose: () => void };
        registerDocumentFormattingEditProvider: (lang: string, provider: unknown) => { dispose: () => void };
      };
      editor: {
        setModelMarkers: (model: unknown, owner: string, markers: unknown[]) => void;
      };
      KeyMod?: { CtrlCmd: number; Alt: number; Shift: number };
      KeyCode?: { Enter: number; KeyF: number };
    };
    const standAlone = editor as {
      addAction?: (action: { id: string; label: string; keybindings?: number[]; run: (ed: unknown) => void }) => void;
      onDidChangeCursorSelection?: (fn: (e: { selection: { isEmpty: () => boolean } }) => void) => { dispose: () => void };
      getModel?: () => unknown;
    };

    // Ctrl+Enter → run query
    if (standAlone?.addAction && monaco?.KeyMod != null && monaco?.KeyCode != null) {
      standAlone.addAction({
        id: 'run-query-editor',
        label: 'Run SQL/Python',
        keybindings: [monaco.KeyMod.CtrlCmd! | monaco.KeyCode.Enter!],
        run: () => { runHandlerRef.current?.(); },
      });
    }

    // Track editor text selection so we can offer "Run Selection"
    const selectionDisposable = standAlone?.onDidChangeCursorSelection?.((e) => {
      setHasEditorSelection(!e.selection.isEmpty());
    });

    // Register a simple SQL document formatter (Shift+Alt+F / Shift+Option+F)
    let formatDisposable: { dispose: () => void } | null = null;
    if (monaco?.languages?.registerDocumentFormattingEditProvider) {
      const SQL_KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
        'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN',
        'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
        'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
        'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
        'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
        'WITH', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      ];
      const formatSQL = (sql: string): string => {
        // Normalise whitespace
        let s = sql.replace(/\r\n/g, '\n').trim();
        // Uppercase keywords that appear as whole tokens
        const escaped = SQL_KEYWORDS
          .slice()
          .sort((a, b) => b.length - a.length) // longest first to avoid partial match
          .map((k) => k.replace(/ /g, '\\s+'));
        s = s.replace(
          new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi'),
          (m) => m.toUpperCase()
        );
        // Add newline before major clause keywords
        const CLAUSE_BREAKS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
          'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
          'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'JOIN',
          'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'WITH'];
        for (const kw of CLAUSE_BREAKS) {
          s = s.replace(new RegExp(`(?<!\\n)\\s+\\b${kw.replace(/ /g, '\\s+')}\\b`, 'g'), `\n${kw}`);
        }
        // Indent lines after SELECT / CASE commas
        s = s.replace(/,\s*\n/g, ',\n  ').replace(/,\s+(?=[^\n])/g, ',\n  ');
        // Collapse excessive blank lines
        s = s.replace(/\n{3,}/g, '\n\n').trim();
        return s;
      };
      formatDisposable = monaco.languages.registerDocumentFormattingEditProvider('sql', {
        provideDocumentFormattingEdits: (model: { getValue: () => string; getFullModelRange: () => unknown }) => {
          const formatted = formatSQL(model.getValue());
          return [{ range: model.getFullModelRange(), text: formatted }];
        },
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
      formatDisposable?.dispose();
      selectionDisposable?.dispose();
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
  // Store monaco instance + editor model ref for setModelMarkers (error highlighting)
  const monacoInstanceRef = useRef<any>(null);
  const editorModelRef = useRef<any>(null);
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

  const getCurrentSQL = (ignoreSelection = false): string => {
    if (!ignoreSelection) {
      const selected = editorInsertRef.current?.getSelectedText?.() || '';
      if (selected.trim()) return selected.trim();
    }
    return latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
  };

  // Extract {{param}} names from SQL (preserving order, deduped)
  const detectedQueryParams = useMemo((): string[] => {
    const sql = latestEditorContentRef.current || sqlQuery || '';
    const matches = [...sql.matchAll(/\{\{(\w+)\}\}/g)];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const m of matches) {
      if (!seen.has(m[1])) { seen.add(m[1]); result.push(m[1]); }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sqlQuery]);

  // Substitute {{param}} with user-supplied values before execution
  const applyQueryParams = (sql: string): string => {
    if (detectedQueryParams.length === 0) return sql;
    return sql.replace(/\{\{(\w+)\}\}/g, (_, name) => queryParamValues[name] ?? `{{${name}}}`);
  };

  const handleAIExplainSQL = async () => {
    if (!aiAvailable) {
      message.warning('AI is unavailable. Add or update an AI provider key in Settings.');
      return;
    }
    const sql = getCurrentSQL();
    if (!sql) { message.warning(t('no_query_to_save')); return; }
    setAiExplaining(true);
    setAiExplainContent('');
    setAiExplainOpen(true);

    // Build compact schema context string for the backend prompt
    const schemaContext = (() => {
      const tables = schema?.tables ?? [];
      if (!tables.length) return '';
      return tables
        .slice(0, 20)
        .map((tbl: { name: string; schema?: string; columns?: { name: string; type?: string }[] }) => {
          const cols = (tbl.columns ?? [])
            .slice(0, 15)
            .map((c: { name: string; type?: string }) => `${c.name}${c.type ? `:${c.type}` : ''}`)
            .join(', ');
          const fullName = tbl.schema && tbl.schema !== 'public' ? `${tbl.schema}.${tbl.name}` : tbl.name;
          return `${fullName}(${cols})`;
        })
        .join('\n');
    })();

    try {
      const result = await authenticatedFetch('/api/ai/query-editor/explain-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql,
          data_source_id: selectedDataSourceId,
          schema_context: schemaContext || undefined,
        }),
      }) as { success: boolean; explanation?: string };
      setAiExplainContent(result.explanation || t('explain_sql_no_result'));
    } catch (err) {
      const e = err as { message?: string };
      setAiExplainContent(e?.message || t('explain_sql_failed'));
    } finally {
      setAiExplaining(false);
    }
  };

  const handleAIOptimizeSQL = async () => {
    if (!aiAvailable) {
      message.warning('AI is unavailable. Add or update an AI provider key in Settings.');
      return;
    }
    const sql = getCurrentSQL();
    if (!sql) { message.warning(t('no_query_to_save')); return; }
    if (!selectedDataSourceId) { message.warning(t('select_ds_first')); return; }
    setAiOptimizing(true);
    try {
      const result = await authenticatedFetch('/api/ai/query-editor/optimize-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql,
          data_source_id: selectedDataSourceId,
        }),
      }) as { success: boolean; optimized_sql?: string; improvements?: string };
      if (result.success && result.optimized_sql) {
        setOptimizeOriginalSQL(sql);
        setOptimizeNewSQL(result.optimized_sql.trim());
        setOptimizeImprovements(result.improvements?.trim() || '');
        setOptimizeDiffOpen(true);
      } else {
        message.warning(t('optimize_no_result'));
      }
    } catch (err) {
      const e = err as { message?: string };
      message.error(formatError(e, 'generic', t('optimize_failed')));
    } finally {
      setAiOptimizing(false);
    }
  };

  const handleAcceptOptimize = () => {
    const optimized = optimizeNewSQL;
    const merged = queryTabs.map(tab => {
      if (tab.key !== activeQueryKey) return tab;
      return editorLanguage === 'python'
        ? { ...tab, python: optimized, language: editorLanguage }
        : { ...tab, sql: optimized, language: editorLanguage };
    });
    setQueryTabs(merged);
    setSqlQuery(optimized);
    setOptimizeDiffOpen(false);
    message.success(t('optimize_success'));
  };

  const handleAIGenerate = async () => {
    if (!aiAvailable) {
      message.warning('AI is unavailable. Add or update an AI provider key in Settings.');
      return;
    }
    if (!aiAssistantInput.trim()) {
      message.warning(t('enter_query_description'));
      return;
    }

    if (!selectedDataSourceId) {
      message.warning(t('select_ds_first'));
      return;
    }

    const abortController = new AbortController();
    aiGenerateAbortRef.current = abortController;
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
          model: selectedAiModel,
        }),
        signal: abortController.signal,
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
        const errorMsg = formatError(
          result.error || result.detail || result,
          'generic',
          t('ai_assistant_hint'),
        );
        console.error('AI generation failed:', result);
        message.error({
          content: errorMsg,
          duration: 5,
        });
      }
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) {
        message.info({ content: t('ai_generation_cancelled'), duration: 3 });
      } else {
        console.error('AI generation error:', error);
        message.error({
          content: formatError(error, 'generic', t('ai_assistant_hint')),
          duration: 5,
        });
      }
    } finally {
      aiGenerateAbortRef.current = null;
      setAiGenerating(false);
    }
  };

  const handleCancelAIGenerate = () => {
    aiGenerateAbortRef.current?.abort();
  };

  // Python execution handler
  const handleExecutePython = async () => {
    setExecuting(true);
    setLoading(true);
    setError(null);
    setExecutionTime(null);
    setRlsApplied(false);
    setColumnsOmitted([]);
    setResolvedEngine(null); // Clear resolved engine when starting new execution
    setExecutionStatus('Executing Python script...');

    try {
      const startTime = Date.now();

      // Determine data source id
      const dsId = selectedDataSource?.id || selectedDataSourceId || '';
      if (!dsId) throw new Error(t('no_ds_to_run'));
      if (!sqlQuery.trim()) throw new Error(t('no_script_to_run'));

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
        const result = await enhancedDataService.executeMultiEngineQuery(
          extractedSQL,
          dsId,
          engineParam,
          true,
          undefined,
          projectId || currentProjectId,
        );

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
      message.error(formatError({ message: errorMessage }, 'generic', t('python_exec_failed')));
    } finally {
      setExecuting(false);
      setLoading(false);
    }
  };

  const handleCancelQuery = () => {
    queryAbortControllerRef.current?.abort();
    queryAbortControllerRef.current = null;
    setExecuting(false);
    setLoading(false);
    setExecutionStatus('');
    message.info(t('query_cancelled'));
  };

  const handleExecuteQuery = async () => {
    // Cancel any in-flight query before starting a new one
    queryAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    queryAbortControllerRef.current = abortController;

    setExecuting(true);
    setLoading(true);
    setError(null);
    setExecutionTime(null);
    setRlsApplied(false);
    setColumnsOmitted([]);
    setResolvedEngine(null);
    setExecutionStatus('Analyzing query...');
    // Clear previous error markers when starting a new run
    if (monacoInstanceRef.current?.editor?.setModelMarkers && editorModelRef.current) {
      monacoInstanceRef.current.editor.setModelMarkers(editorModelRef.current, 'sql-error', []);
    }
    // Use selected text if available (Run Selection), otherwise full query; substitute {{params}}
    let executedSql = applyQueryParams(getCurrentSQL());
    let appendedLimit = false;

    try {
      const startTime = Date.now();

      // Respect the limit the user has set: use LIMIT/TOP in the SQL if present; otherwise use Row Limit control (or no limit if "All").
      if (editorLanguage === 'sql' && !isPromqlDataSource) {
        const existingLimit = extractLimitFromQuery(executedSql);
        const limitInQuery = existingLimit !== null || limitSource === 'query';
        if (!limitInQuery && rowLimit !== 'all') {
          const parsedLimit = parseInt(rowLimit, 10);
          if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
            executedSql = appendLimitClause(executedSql, parsedLimit, selectedDataSource?.db_type);
            appendedLimit = true;
          }
        }
      }

      // Determine data source id - prioritize selectedDataSource from EnhancedDataPanel
      const dsId = selectedDataSource?.id || selectedDataSourceId || '';
      if (!dsId) {
        throw new Error(
          t('no_ds_to_run')
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
      const result = await enhancedDataService.executeMultiEngineQuery(
        executedSql,
        dsId,
        engineParam,
        true,
        abortController.signal,
        projectId || currentProjectId,
      );

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
        setResultLimitApplied(appendedLimit);
        setRlsApplied(Boolean(result.rls_applied));
        setColumnsOmitted(Array.isArray(result.columns_omitted) ? result.columns_omitted.map(String) : []);
        setExecutionTime(result.execution_time || executionTime);
        // Update resolved engine state for display
        const resolvedEngineValue = result.engine || (engineParam as string) || 'auto';
        setResolvedEngine(resolvedEngineValue);
        setExecutionStatus('Query completed successfully');
        // Clear any lingering error markers on success
        if (monacoInstanceRef.current?.editor?.setModelMarkers && editorModelRef.current) {
          monacoInstanceRef.current.editor.setModelMarkers(editorModelRef.current, 'sql-error', []);
        }

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
          user: authUser?.email || authUser?.username || authUser?.id || 'unknown',
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
      // Swallow abort errors — user intentionally cancelled
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed';
      setExecutionStatus('Query failed');
      setSelectedEngine('unknown');
      setError(errorMessage);
      setLoading(false);
      // Highlight error line in Monaco if position info is present
      highlightSQLError(errorMessage);
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

  const resultsTabItems = useMemo(
    () => [
      {
        key: 'results',
        label: t('tab_query_results'),
        children: (
          <ResultsTabPane
            results={results}
            columns={columns}
            isExecuting={isExecuting}
            loading={loading}
            executionStatus={executionStatus}
            executionTime={executionTime}
            resultLimitApplied={resultLimitApplied}
            rowLimit={Number(rowLimit)}
            sqlQuery={sqlQuery}
            latestSql={latestEditorContentRef.current || sqlQuery}
            selectedDataSourceId={selectedDataSourceId}
            currentPage={currentPage}
            pageSize={pageSize}
          />
        ),
      },
      {
        key: 'performance',
        label: t('tab_performance'),
        children: (
          <PerformancePane
            sqlQuery={sqlQuery}
            selectedDataSourceId={selectedDataSourceId}
            selectedDataSource={selectedDataSource}
            isDarkMode={isDarkMode}
            authenticatedFetch={authenticatedFetch}
            formatError={formatError}
          />
        ),
      },
      {
        key: 'history',
        label: t('tab_query_history'),
        children: (
          <QueryHistoryPane
            queryHistory={queryHistory}
            historySearch={historySearch}
            historyStatusFilter={historyStatusFilter}
            onHistorySearchChange={setHistorySearch}
            onHistoryStatusFilterChange={setHistoryStatusFilter}
            onHistoryItemClick={handleHistoryItemClick}
            onHistoryRerun={handleHistoryRerun}
            onHistoryRemove={handleHistoryRemove}
          />
        ),
      },
    ],
    [
      activeQueryKey,
      authenticatedFetch,
      columns,
      executionStatus,
      executionTime,
      formatError,
      handleHistoryItemClick,
      handleHistoryRerun,
      handleHistoryRemove,
      historySearch,
      historyStatusFilter,
      isDarkMode,
      isExecuting,
      loading,
      queryHistory,
      queryTabs,
      resultLimitApplied,
      results,
      rowLimit,
      selectedDataSource,
      selectedDataSourceId,
      sqlQuery,
      t,
    ],
  );

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
          {IS_EE && aiAvailable && (
          <div className="qe-ai-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
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
                  className="qe-ai-avatar"
                  style={{
                    flexShrink: 0,
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <AnimatedAIAvatar
                    size={22}
                    isSpeaking={!!aiAssistantInput && !aiGenerating}
                    isThinking={aiGenerating}
                  />
                </div>
              </Tooltip>
              <Input.TextArea
                placeholder={t('ai_assistant_placeholder')}
                style={{ flex: '1 1 160px', minWidth: 0, borderRadius: '6px', resize: 'none' }}
                autoSize={{ minRows: 1, maxRows: 6 }}
                value={aiAssistantInput}
                onChange={(e) => setAiAssistantInput(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  // Enter submits; Ctrl/Shift+Enter inserts a newline instead.
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    handleAIGenerate();
                  }
                }}
                disabled={aiGenerating}
              />
              {aiGenerating ? (
                <Tooltip title={t('cancel_generation')}>
                  <Button
                    size="small"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={handleCancelAIGenerate}
                  />
                </Tooltip>
              ) : (
                <Tooltip title={editorLanguage === 'python' ? 'Generate Python' : 'Generate SQL'}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<RocketOutlined />}
                    onClick={handleAIGenerate}
                    disabled={!selectedDataSourceId || !aiAssistantInput.trim()}
                  />
                </Tooltip>
              )}
              <ModelSelector
                compact
                value={aiModel}
                onModelChange={setAiModel}
                disabled={aiGenerating}
                persistPreference
                style={{ minWidth: 0, maxWidth: 140, width: 'clamp(56px, 16vw, 140px)', flexShrink: 1 }}
                dropdownWidth={200}
              />
            </div>
          </div>
          )}

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
            }}
            className="qe-workspace-main"
            ref={workspaceMainRef}
          >
            {/* Top panel: Tabs + Editor + Run (fixed height, flexShrink: 0 - never goes under results) */}
            <div
              className="qe-editor-top-panel"
              style={{
              height: editorHeight,
              minHeight: MIN_TOP_SECTION_HEIGHT,
              maxHeight: maxEditorHeight,
            }}>
            {/* Query Tabs - inside top panel so they move with editor+run */}
            <div className="qe-query-tabs-row">
              <Tabs
                size="small"
                type="editable-card"
                className="workspace-inline-tabs query-editor-query-tabs"
                activeKey={activeQueryKey}
                tabBarExtraContent={{
                  right: (
                  <Space size={4} className="icon-toolbar qe-tab-toolbar">
                    {isExecuting ? (
                      <Tooltip title={t('cancel_query_tooltip')}>
                        <Button
                          type="primary"
                          danger
                          icon={<CloseCircleOutlined />}
                          size="small"
                          className="qe-run-btn qe-cancel-btn"
                          onClick={handleCancelQuery}
                        >
                          {t('cancel_query')}
                        </Button>
                      </Tooltip>
                    ) : (
                      <Button
                        type="primary"
                        icon={<CaretRightOutlined />}
                        size="small"
                        className="qe-run-btn"
                        onClick={() => runHandlerRef.current?.()}
                        disabled={isLoadingSchema || !sqlQuery.trim() || !selectedDataSourceId}
                      >
                        {editorLanguage === 'python'
                          ? t('run_python')
                          : isPromqlDataSource
                            ? t('run_promql')
                            : hasEditorSelection
                              ? t('run_selection')
                              : t('run_sql')}
                      </Button>
                    )}
                    <Divider type="vertical" style={{ margin: '0 4px' }} />
                    <Tooltip title={t('tooltip_save_query_script')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<SaveOutlined />}
                        aria-label={t('aria_save_to_saved_queries')}
                        onClick={async () => {
                          const tab = queryTabs.find((qt) => qt.key === activeQueryKey);
                          const idx = queryTabs.findIndex((qt) => qt.key === activeQueryKey);
                          const name = resolveQueryTabSaveName(tab?.title, idx >= 0 ? idx + 1 : queryTabs.length);
                          const content = latestEditorContentRef.current?.trim() || sqlQuery?.trim() || '';
                          if (!content) {
                            message.warning(t('no_query_to_save'));
                            return;
                          }
                          try {
                            await persistSavedQueryForTab({
                              name,
                              sql: content,
                              tabKey: tab?.key ?? activeQueryKey,
                              language: resolveLanguage(tab?.language ?? editorLanguage),
                              savedQueryId: tab?.savedQueryId,
                            });
                            message.success(t('saved_to_list', { name }));
                            setShowSavedModal(true);
                          } catch (e: unknown) {
                            message.error(formatError(e as { message?: string }, 'save_failed', t('save_failed_name_exists')));
                          }
                        }}
                      />
                    </Tooltip>
                    <Tooltip title={editorLanguage === 'python' ? t('tooltip_download_py') : t('tooltip_download_sql')}>
                      <Button type="text" size="small" icon={<DownloadOutlined />} aria-label={t('aria_download_tab_as_file')} onClick={downloadCurrentQueryAsFile} disabled={!sqlQuery.trim()} />
                    </Tooltip>
                    <Tooltip title={t('tooltip_saved_queries_snapshots')}>
                      <Button type="text" size="small" icon={<UnorderedListOutlined />} aria-label={t('aria_saved_queries_snapshots')} onClick={() => { setShowSavedModal(true); }} />
                    </Tooltip>
                    {editorLanguage === 'sql' && (
                      <Tooltip title="Visualize — add chart to a dashboard or Chart Designer">
                        <Button
                          type="text"
                          size="small"
                          icon={<LineChartOutlined />}
                          disabled={!sqlQuery.trim() || !selectedDataSourceId}
                          onClick={openVisualizeModal}
                          aria-label="Visualize query"
                        />
                      </Tooltip>
                    )}
                    {IS_EE && aiAvailable && editorLanguage === 'sql' && (
                      <>
                        <Divider type="vertical" style={{ margin: '0 2px' }} />
                        <Tooltip title={t('explain_sql_tooltip')}>
                          <Button
                            type="text"
                            size="small"
                            icon={<QuestionCircleOutlined />}
                            loading={aiExplaining}
                            disabled={!sqlQuery.trim() || !selectedDataSourceId}
                            onClick={() => void handleAIExplainSQL()}
                            aria-label={t('explain_sql_title')}
                          />
                        </Tooltip>
                        <Tooltip title={t('optimize_sql_tooltip')}>
                          <Button
                            type="text"
                            size="small"
                            icon={<ScissorOutlined />}
                            loading={aiOptimizing}
                            disabled={!sqlQuery.trim() || !selectedDataSourceId}
                            onClick={() => void handleAIOptimizeSQL()}
                            aria-label={t('optimize_sql_title')}
                          />
                        </Tooltip>
                      </>
                    )}
                  </Space>
                  ),
                }}
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

                  if (activeQueryKey) {
                    resultsTabByQueryKeyRef.current[activeQueryKey] = activeTab;
                  }

                  setActiveQueryKey(key);
                  setActiveTab(resultsTabByQueryKeyRef.current[key] ?? 'results');
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
                    removeQueryTab(String(targetKey));
                  }
                }}
                items={queryTabs.map((tab) => ({
                  key: tab.key,
                  closable: false,
                  label: (
                    <div className="qe-query-tab-label">
                      {editingTabKey === tab.key ? (
                        <input
                          className="qe-query-tab-rename-input"
                          value={titleDraft}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onChange={e => setTitleDraft(e.target.value)}
                          onBlur={() => {
                            const idx = queryTabs.findIndex((x) => x.key === tab.key);
                            const fallbackTitle = idx >= 0 ? `Query ${idx + 1}` : tab.title;
                            const newTitle = (titleDraft || '').trim() || fallbackTitle;
                            const nextTabs = queryTabs.map((x) =>
                              x.key === tab.key ? { ...x, title: newTitle } : x,
                            );
                            setQueryTabs(nextTabs);
                            setEditingTabKey(null);
                            saveTabsToBackend(nextTabs, activeQueryKey, true);
                            if (tab.savedQueryId != null && typeof tab.savedQueryId === 'number' && !isSameQueryName(tab.title, newTitle)) {
                              const content = tab.language === 'python' ? tab.python ?? tab.sql : tab.sql;
                              void persistSavedQueryForTab({
                                name: newTitle,
                                sql: content,
                                tabKey: tab.key,
                                language: resolveLanguage(tab.language),
                                savedQueryId: tab.savedQueryId,
                                syncTabTitle: false,
                              }).catch(() => undefined);
                            }
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') {
                              setEditingTabKey(null);
                              setTitleDraft('');
                            }
                          }}
                        />
                      ) : (
                        <>
                          <DatabaseOutlined className="qe-query-tab-icon" style={{ marginRight: '6px', color: 'inherit' }} />
                          <Tooltip title={t('rename_query_tab_hint')}>
                            <span
                              className="qe-query-tab-title"
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingTabKey(tab.key);
                                setTitleDraft(tab.title ?? '');
                              }}
                            >
                              {tab.title}
                            </span>
                          </Tooltip>
                          {queryTabs.length > 1 ? (
                            <Tooltip title={t('close_query_tab')}>
                              <button
                                type="button"
                                className="qe-query-tab-close"
                                aria-label={t('close_query_tab')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeQueryTab(tab.key);
                                }}
                              >
                                <CloseOutlined />
                              </button>
                            </Tooltip>
                          ) : null}
                        </>
                      )}
                    </div>
                  ),
                }))}
                />
              </div>

              {/* SQL Editor - fills space between Tabs and Run bar */}
              <div
                className="qe-editor-surface"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {!['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()) && (
                  <NL2SqlPromptBar
                    dataSourceId={selectedDataSource?.id ? String(selectedDataSource.id) : undefined}
                    onInsert={(sql) => editorInsertRef.current?.insertTextAtCursor(sql)}
                  />
                )}
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

              {/* Query Parameters bar — shown only when {{params}} are detected */}
              {detectedQueryParams.length > 0 && (
                <div className="qe-query-params-bar">
                  <Text style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {t('query_params_title')}:
                  </Text>
                  {detectedQueryParams.map(param => (
                    <div key={param} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Tag style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{`{{${param}}}`}</Tag>
                      <Input
                        size="small"
                        placeholder={param}
                        value={queryParamValues[param] ?? ''}
                        onChange={e => setQueryParamValues(prev => ({ ...prev, [param]: e.target.value }))}
                        style={{ width: 120, fontSize: 12 }}
                        allowClear
                      />
                    </div>
                  ))}
                </div>
              )}

                {/* Execution bar moved to top */}
              {/* <div className="qe-run-bar"> ... </div> */}
            </div>

            {/* Resize handle: border between Run button and Query Results - drag to split */}
            <div
              className="qe-split-handle"
              onMouseDown={startEditorResize}
              title={t('tooltip_drag_resize')}
            >
              <div className="qe-split-handle-grip" />
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
              className="qe-results-pane"
              style={{ flex: 1, minHeight: MIN_RESULTS_PANE_HEIGHT, display: 'flex', flexDirection: 'column' }}
            >
              <Tabs
                activeKey={activeTab}
                onChange={handleResultsTabChange}
                size="small"
                destroyInactiveTabPane={false}
                className="workspace-inline-tabs query-editor-results-tabs"
                items={resultsTabItems}
                tabBarExtraContent={
                  activeTab === 'results' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginRight: '8px' }}>
                        {executionTime ? t('execution_time_ms', { ms: executionTime }) : null}
                        {executionTime && results.length > 0 ? ' · ' : null}
                        {results.length > 0 ? t('result_rows', { count: results.length }) : null}
                        {resultLimitApplied && results.length > 0 ? (
                          <Tooltip title={t('result_limited', { limit: Number(rowLimit) || 0 })}>
                            <span> · {t('result_limited', { limit: (Number(rowLimit) || 0).toLocaleString() })}</span>
                          </Tooltip>
                        ) : null}
                      </span>
                      {rlsApplied || columnsOmitted.length > 0 ? (
                        <Popover
                          trigger="click"
                          placement="bottomRight"
                          open={rlsPopoverOpen}
                          onOpenChange={setRlsPopoverOpen}
                          content={
                            <RlsAppliedPopoverContent
                              dataSourceId={selectedDataSourceId}
                              open={rlsPopoverOpen}
                              columnsOmitted={columnsOmitted}
                            />
                          }
                        >
                          <Tooltip title={rlsPopoverOpen ? undefined : t('row_column_filters_tip')}>
                            <Tag
                              color="warning"
                              icon={<SafetyCertificateOutlined />}
                              style={{ marginInlineEnd: 0, cursor: 'pointer' }}
                              tabIndex={0}
                              role="button"
                              aria-haspopup="dialog"
                              aria-expanded={rlsPopoverOpen}
                              aria-label={
                                columnsOmitted.length > 0 ? t('row_column_filters_label') : t('rls_applied_label')
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setRlsPopoverOpen((prev) => !prev);
                                }
                              }}
                            >
                              {columnsOmitted.length > 0 ? t('row_column_filters_label') : t('rls_applied_label')}
                            </Tag>
                          </Tooltip>
                        </Popover>
                      ) : null}
                      <Space size={4}>
                        {results.length > 0 && (
                          <Tooltip title={t('ask_ai_results_tip')}>
                            <Button
                              type="text"
                              size="small"
                              icon={<RocketOutlined />}
                              onClick={() => {
                                const sql = latestEditorContentRef.current || sqlQuery;
                                const cols = results.length > 0 ? Object.keys(results[0]).join(', ') : '';
                                const promptText = `I ran this SQL query:\n${sql}\n\nThe result has ${results.length} rows with columns: ${cols}.\n\nHelp me understand and explore these results.`;
                                window.open(
                                  getChatHref({
                                    prompt: promptText,
                                    dataSourceId: selectedDataSourceId || undefined,
                                  }),
                                  '_blank',
                                );
                              }}
                            />
                          </Tooltip>
                        )}
                        <Tooltip title={t('save_as_snapshot')}>
                          <Button
                            type="text"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={() => {
                              const tab = queryTabs.find((qt) => qt.key === activeQueryKey);
                              setSaveSnapshotName(
                                snapshotNameFromTabTitle(
                                  tab?.title,
                                  `${t('snapshot')} ${new Date().toISOString().slice(0, 10)}`,
                                ),
                              );
                              setShowSaveSnapshotModal(true);
                            }}
                            disabled={results.length === 0}
                          />
                        </Tooltip>
                        <Dropdown menu={{ items: [
                          {
                            key: 'csv',
                            label: t('export_csv'),
                            icon: <DownloadOutlined />,
                            disabled: results.length === 0,
                            onClick: () => exportToCSV(results),
                          },
                          {
                            key: 'json',
                            label: t('export_json'),
                            icon: <DownloadOutlined />,
                            disabled: results.length === 0,
                            onClick: () => exportToJSON(results),
                          }
                        ] }} trigger={['click']}>
                          <Tooltip title={t('more_actions')}>
                            <Button
                              type="text"
                              size="small"
                              icon={<MoreOutlined />}
                            />
                          </Tooltip>
                        </Dropdown>
                      </Space>
                    </div>
                  ) : null
                }
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
                  minHeight: 36,
                  background: 'var(--ant-color-bg-container)',
                  flexShrink: 0,
                }}
              />
              <div
                className="qe-results-footer"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 16px',
                  borderTop: '1px solid var(--ant-color-border-secondary)',
                  background: 'var(--ant-color-bg-container)',
                  fontSize: '12px',
                  color: 'var(--ant-color-text-secondary)',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div className="qe-run-control-group">
                    <span>Engine:</span>
                    <Select
                      className="qe-engine-select"
                      value={selectedEngine}
                      onChange={(val) => {
                        setSelectedEngine(val);
                        setResolvedEngine(null);
                      }}
                      size="small"
                      bordered={false}
                      style={{ fontWeight: 600, color: 'var(--ant-color-primary)' }}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        ...enhancedDataService
                          .getAvailableQueryEngines()
                          .map((e) => ({ value: e.type, label: e.name })),
                      ]}
                    />
                  </div>
                  <div className="qe-run-control-group">
                    <span>Limit:</span>
                    <Select
                      className="qe-row-limit-select"
                      value={rowLimit}
                      onChange={handleRowLimitChange}
                      size="small"
                      bordered={false}
                      disabled={limitSource === 'query'}
                      options={rowLimitOptions}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <Pagination
                    current={currentPage}
                    pageSize={pageSize}
                    total={results.length}
                    onChange={(page, size) => { setCurrentPage(page); setPageSize(size); }}
                    showSizeChanger
                    size="small"
                    showTotal={(total, range) => t('rows_range_total', { from: range[0], to: range[1], total })}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        {!isStackedLayout && !effectiveSidebarCollapsed ? (
          <div
            className="qe-panel-resize-handle"
            onMouseDown={handleDataPanelDragStart}
            title={t('tooltip_drag_resize')}
            aria-hidden
          >
            <div />
          </div>
        ) : null}
        {/* Data Sources Panel on Right */}
        <div
          style={{
            width: isStackedLayout ? '100%' : effectiveSidebarCollapsed ? '64px' : `${dataPanelWidth}px`,
            minWidth: isStackedLayout ? '100%' : effectiveSidebarCollapsed ? '64px' : `${dataPanelWidth}px`,
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
            <div className="qe-sources-collapsed">
              <Tooltip title={t('expand_data_panel')} placement="left">
                <Button
                  type="text"
                  size="small"
                  className="icon-only-btn qe-sources-collapsed-btn"
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
                />
              </Tooltip>
              <Tooltip title={t('add_data_source')} placement="left">
                <Button
                  type="text"
                  size="small"
                  className="icon-only-btn qe-sources-collapsed-btn"
                  icon={<PlusOutlined />}
                  onClick={() => setShowConnectDataModal(true)}
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
                editorInsertRef.current?.insertTextAtCursor(`SELECT * FROM ${fromRef} LIMIT ${DEFAULT_QUERY_LIMIT}`);
              }}
              onColumnClick={(tableName, columnName, schemaName) => {
                const text = /[\s"]/.test(columnName) ? `"${columnName.replace(/"/g, '""')}"` : columnName;
                editorInsertRef.current?.insertTextAtCursor(text);
              }}
              schemaTreeCompact
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
        width={920}
        centered
        className="qe-saved-modal"
      >
        <SavedQueriesSnapshotsPane
          savedQueries={savedQueries}
          snapshots={snapshots}
          activeTab={activeTabForSavedModal}
          saveQueryName={modalSaveQueryName}
          onSaveQueryNameChange={setModalSaveQueryName}
          onSaveCurrentQuery={handleModalSaveCurrentQuery}
          savingCurrent={savingSavedQuery}
          organizationId={organizationId}
          projectId={projectId}
          onSavedQueriesChanged={() => {
            void refreshSavedQueriesList();
          }}
          onLoadToNewTab={(record) => {
            const newKey = `q-${Date.now()}`;
            const newTab = buildTabFromSavedRecord(record, newKey);
            const next = [...queryTabs, newTab];
            setQueryTabs(next);
            setActiveQueryKey(newKey);
            setEditorLanguage(newTab.language ?? 'sql');
            setSqlQuery(newTab.language === 'python' ? newTab.python ?? '' : newTab.sql);
            setShowSavedModal(false);
            saveTabsToBackend(next, newKey, true);
            message.success(t('loaded_query', { name: record.name || 'Query' }));
          }}
          onLoadHere={(record) => {
            const newTab = buildTabFromSavedRecord(record, activeQueryKey);
            const updated = queryTabs.map((tab) =>
              tab.key === activeQueryKey ? { ...tab, ...newTab, key: tab.key } : tab,
            );
            setQueryTabs(updated);
            setEditorLanguage(newTab.language ?? 'sql');
            setSqlQuery(newTab.language === 'python' ? newTab.python ?? '' : newTab.sql);
            setShowSavedModal(false);
            saveTabsToBackend(updated, activeQueryKey, true);
            message.success(t('loaded_query', { name: record.name || 'Query' }));
          }}
          onShowVersions={(record) => {
            setVersionsModalQueryRecord({ name: record?.name ?? '', metadata: record?.metadata });
            setShowVersionsModalForQueryId(typeof record?.id === 'number' ? record.id : null);
          }}
          onDuplicateSaved={async (record) => {
            try {
              const name = `${(record?.name || 'Query').replace(/\s*\(copy( \d+)?\)\s*$/i, '')} (copy)`;
              await authenticatedFetch(savedQueriesUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name,
                  sql: record?.sql || '',
                  metadata: record?.metadata || {},
                }),
              });
              message.success(t('saved_as', { name }));
              await refreshSavedQueriesList();
            } catch (err: unknown) {
              message.error(formatError(err as { message?: string }, 'generic', t('duplicate_failed')));
            }
          }}
          onDeleteSaved={async (record) => {
            try {
              await authenticatedFetch(
                `/api/queries/saved-queries/${record.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`,
                { method: 'DELETE' },
              );
              message.success(t('saved_query_removed'));
              await refreshSavedQueriesList();
              if (activeTabForSavedModal?.savedQueryId != null && String(activeTabForSavedModal.savedQueryId) === String(record.id)) {
                setQueryTabs((prev) =>
                  prev.map((tab) =>
                    tab.key === activeQueryKey ? { ...tab, savedQueryId: null } : tab,
                  ),
                );
              }
            } catch (err: unknown) {
              message.error(formatError(err as { message?: string }, 'delete_failed'));
            }
          }}
          onLoadSnapshotToTab={async (r) => {
            try {
              const url = `/api/queries/snapshots/${r?.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`;
              const j = (await authenticatedFetch(url)) as { snapshot?: { sql?: string; name?: string } };
              const snap = j?.snapshot;
              if (!snap) {
                message.error(t('snapshot_not_found'));
                return;
              }
              const baseSql = snap.sql || DEFAULT_SQL_SNIPPET;
              const snapName = snapshotNameFromTabTitle(snap.name || r?.name, t('snapshot'));
              const newKey = `q-${Date.now()}`;
              const newTab = {
                key: newKey,
                title: snapName,
                sql: baseSql,
                python: buildPythonTemplate(baseSql, selectedDataSource?.name),
                language: 'sql' as QueryLanguage,
              };
              const next = [...queryTabs, newTab];
              setQueryTabs(next);
              setActiveQueryKey(newKey);
              setEditorLanguage('sql');
              setSqlQuery(baseSql);
              setShowSavedModal(false);
              saveTabsToBackend(next, newKey, true);
              message.success(t('loaded_query', { name: snapName }));
            } catch (e: unknown) {
              message.error(formatError(e as { message?: string }, 'generic', t('load_snapshot_failed')));
            }
          }}
          onLoadSnapshotResults={async (r) => {
            try {
              const url = `/api/queries/snapshots/${r?.id}${queriesScopeParams ? `?${queriesScopeParams}` : ''}`;
              const j = (await authenticatedFetch(url)) as { snapshot?: { rows?: unknown[] } };
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
              message.error(formatError(e as { message?: string }, 'generic', t('load_snapshot_failed')));
            }
          }}
          onDeleteSnapshot={async (r) => {
            try {
              await authenticatedFetch(`/api/queries/snapshots/${r?.id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
              });
              message.success(t('snapshot_deleted'));
              const j = await authenticatedFetch(snapshotsUrl);
              setSnapshots(Array.isArray((j as { items?: unknown[] })?.items) ? (j as { items: unknown[] }).items.filter(Boolean) : []);
            } catch (err: unknown) {
              const e = err as { status?: number; message?: string };
              if (e?.status === 403 || e?.status === 401) setPermissionModalVisible(true);
              message.error(formatError(e, 'delete_failed'));
            }
          }}
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
          const name = (saveSnapshotName || '').trim() || snapshotNameFromTabTitle(
            queryTabs.find((qt) => qt.key === activeQueryKey)?.title,
            `${t('snapshot')} ${new Date().toISOString().slice(0, 10)}`,
          );
          const columnKeys = results?.length && results[0] ? Object.keys(results[0]) : [];
          const dsId = selectedDataSource?.id || selectedDataSourceId || null;
          const safeRows = jsonSafeRows((results || []) as Record<string, unknown>[]);
          const snapshotBody: Record<string, unknown> = {
            name,
            sql: sqlQuery,
            rows: safeRows,
            columns: columnKeys,
          };
          if (dsId) snapshotBody.data_source_id = String(dsId);
          try {
            await authenticatedFetch(snapshotsUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snapshotBody),
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
            else message.error(formatError(apiErr, 'save_failed', t('save_snapshot_failed')));
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
                        message.error(formatError(e, 'generic', t('load_snapshot_failed')));
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

      {IS_EE && (
      <>
      {/* ── AI Optimize Diff Modal ─────────────────────────────────── */}
      <Modal
        open={optimizeDiffOpen}
        onCancel={() => setOptimizeDiffOpen(false)}
        width={860}
        title={
          <Space>
            <ThunderboltOutlined style={{ color: 'var(--ant-color-primary)' }} />
            <span>{t('optimize_diff_title')}</span>
          </Space>
        }
        footer={[
          <Button key="reject" onClick={() => setOptimizeDiffOpen(false)}>
            {t('optimize_reject')}
          </Button>,
          <Button key="accept" type="primary" icon={<CheckCircleOutlined />} onClick={handleAcceptOptimize}>
            {t('optimize_accept')}
          </Button>,
        ]}
      >
        {optimizeImprovements && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12, fontSize: 13 }}
            message={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 12 }}>{optimizeImprovements}</pre>}
          />
        )}
        <div style={{ display: 'flex', gap: 12, height: 340 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ant-color-text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('optimize_diff_original')}
            </div>
            <div style={{ flex: 1, border: '1px solid var(--ant-color-border)', borderRadius: 6, overflow: 'hidden' }}>
              <MemoryOptimizedEditor
                value={optimizeOriginalSQL}
                onChange={() => {}}
                language="sql"
                theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                options={{ readOnly: true, lineNumbers: 'on', scrollBeyondLastLine: false }}
              />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ant-color-success)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('optimize_diff_optimized')}
            </div>
            <div style={{ flex: 1, border: '1px solid var(--ant-color-success-border)', borderRadius: 6, overflow: 'hidden' }}>
              <MemoryOptimizedEditor
                value={optimizeNewSQL}
                onChange={() => {}}
                language="sql"
                theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                options={{ readOnly: true, lineNumbers: 'on', scrollBeyondLastLine: false }}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* ── AI Explain SQL Modal ─────────────────────────────────── */}
      <Modal
        open={aiExplainOpen}
        onCancel={() => setAiExplainOpen(false)}
        width={680}
        title={
          <Space>
            <QuestionCircleOutlined style={{ color: 'var(--ant-color-primary)' }} />
            <span>{t('explain_sql_title')}</span>
          </Space>
        }
        footer={
          !aiExplaining && aiExplainContent ? [
            <Button
              key="copy"
              icon={<CopyOutlined />}
              onClick={() => {
                void navigator.clipboard.writeText(aiExplainContent);
                message.success(t('explain_sql_copied'));
              }}
            >
              {t('explain_sql_copy')}
            </Button>,
          ] : null
        }
      >
        {aiExplaining ? (
          <div style={{ padding: '24px 0' }}>
            <AppLoadingIndicator variant="inline" tip={t('explain_sql_analyzing')} />
          </div>
        ) : (
          <div
            style={{
              maxHeight: 480,
              overflowY: 'auto',
              padding: '4px 0',
            }}
          >
            {aiExplainContent ? (
              <AiMarkdownContent content={aiExplainContent} />
            ) : (
              <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('explain_sql_no_result')}</span>
            )}
          </div>
        )}
      </Modal>
      <QueryVisualizeModal
        open={showVisualizeModal}
        confirming={visualizeConfirming}
        onCancel={() => setShowVisualizeModal(false)}
        onConfirm={(vals) => void confirmVisualizeQuery(vals)}
        defaultTitle={
          resolveQueryTabSaveName(
            queryTabs.find((qt) => qt.key === activeQueryKey)?.title,
            Math.max(1, queryTabs.findIndex((qt) => qt.key === activeQueryKey) + 1),
          )
        }
        hasResultRows={Array.isArray(results) && results.length > 0}
        projectId={projectId || currentProjectId}
        resultRows={Array.isArray(results) ? (results as Array<Record<string, unknown>>).slice(0, 200) : []}
        columns={columnsFromQueryResult({
          data: Array.isArray(results) ? results.slice(0, 5) : [],
        })}
      />
      </>
      )}
    </div>
  );
};

export default MonacoSQLEditor;
