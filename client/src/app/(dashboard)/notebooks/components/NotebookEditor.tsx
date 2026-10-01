'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Alert, App, Button, Dropdown, Empty, Input, Modal, Popover, Select, Space, Spin, Switch, Tag, Tooltip, Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  CaretRightOutlined, CheckOutlined, ClearOutlined, FieldTimeOutlined, HistoryOutlined, CloudSyncOutlined, CodeOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined,
  DownOutlined, DownloadOutlined, FilePdfOutlined, FileTextOutlined, GlobalOutlined, LockOutlined, MoreOutlined,
  ReloadOutlined, SaveOutlined, ShareAltOutlined, StopOutlined,
} from '@ant-design/icons';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { useDataSources } from '@/hooks/useDataSources';
import { useAiAvailability } from '@/hooks/useAiAvailability';
import { useProjectStore } from '@/stores/useProjectStore';
import { enhancedDataService } from '@/services/enhancedDataService';
import { fetchApi } from '@/utils/api';
import { isEnterpriseEdition } from '@/utils/appPaths';
import {
  newCellId, nextResultName, notebookService,
  type CellOutput, type CellType, type Notebook, type NotebookCell as Cell,
} from '@/services/notebookService';
import { usePythonRuntime, type Frame } from '../hooks/usePythonRuntime';
import { NotebookCell, TYPE_ICON, type EditorHandle, type ResultInfo } from './NotebookCell';
import { toCsv, toTsv, type OutputAction } from './CellOutputView';
import { DataSidebar } from './DataSidebar';
import { setNotebookFrames, setNotebookSources } from './pythonCompletion';
import { PublishDialog, type PublishTarget } from './PublishDialog';
import { createPythonBridge } from './pythonBridge';
import { openAsWorkbook } from '../../sheets/components/openAsWorkbook';
import { configureInlineAi, type InlineRequest } from './inlineAi';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';
import { ScheduleDialog, notebookRuns } from './ScheduleDialog';
import { DashboardCollabCommentsPanel } from '../../dashboards/components/DashboardCollabCommentsPanel';
import { suggestChart, suggestPivot } from './chartDefaults';
import { pivot } from './chartShape';
import { pivotGrid } from './PivotView';
import { schemaFor, tableName } from './sqlCompletion';
import { chartImage } from './NotebookChart';
import { notebookHtml, printHtml } from './notebookExport';
import '../notebooks.css';
import '../../dashboards/styles/comments.css';

const { Text } = Typography;
const OUTPUT_ROWS = 200;
const SIDEBAR_KEY = 'aicser.notebook.sidebar';

/** What a cell's output was computed from; when it changes the output is out of date. */
const INLINE_AI_KEY = 'aicser.notebook.inlineAi';
const signature = (c: Cell) => `${c.data_source_id ?? ''}\u0000${c.source}`;

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Python errors start at the user's code: the runtime's own frames (Pyodide internals) are
 * dropped, the way Jupyter shows a traceback. */
export function cleanTraceback(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*File "<exec>"/.test(l));
  if (start <= 0) return text;
  const header = lines.findIndex((l) => l.startsWith('Traceback'));
  return [header >= 0 ? lines[header] : 'Traceback (most recent call last):', ...lines.slice(start)].join('\n');
}

function safeFileName(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim() || 'notebook';
}

function AddBar({ onAdd, label, end = false }: { onAdd: (type: CellType) => void; label: string; end?: boolean }) {
  const t = useTranslations('notebooks');
  return (
    <div className={`nb-add${end ? ' nb-add--end' : ''}`} role="group" aria-label={label}>
      {(['sql', 'python', 'markdown', 'chart', 'pivot'] as CellType[]).map((type) => (
        <Button key={type} size="small" type="text" icon={TYPE_ICON[type]} onClick={() => onAdd(type)}>
          + {t(`type_${type}`)}
        </Button>
      ))}
    </div>
  );
}

type Result = Frame & { row_count: number; version: number };

function toRows(data: unknown[], columns: string[]): unknown[][] {
  return data.map((r) => (Array.isArray(r) ? r : columns.map((c) => (r as Record<string, unknown>)[c])));
}

export function NotebookEditor({ notebookId }: { notebookId: string }) {
  const t = useTranslations('notebooks');
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDarkMode } = useThemeMode();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { dataSources } = useDataSources();
  const ai = useAiAvailability(false, isEnterpriseEdition());
  const py = usePythonRuntime();

  const [nb, setNb] = useState<Notebook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [liveImages, setLiveImages] = useState<Record<string, string[]>>({});
  const [chartFrames, setChartFrames] = useState<Record<string, Frame>>({});
  const [resultsTick, setResultsTick] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveFrom, setSaveFrom] = useState<string | undefined>();
  const [saveName, setSaveName] = useState('');
  const [savingDataset, setSavingDataset] = useState(false);
  const [execCounts, setExecCounts] = useState<Record<string, number>>({});
  const [ranSig, setRanSig] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return typeof window === 'undefined' || window.localStorage.getItem(SIDEBAR_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [sideSource, setSideSource] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<{ cellId: string; target: PublishTarget } | null>(null);

  const results = useRef(new Map<string, Result>());
  const versionRef = useRef(1);
  const cellsRef = useRef<Cell[]>([]);
  cellsRef.current = cells;
  const execSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const runningKind = useRef<CellType | null>(null);
  const editors = useRef(new Map<string, EditorHandle>());
  const pendingFocus = useRef<string | null>(null);
  const sidebarSourceRef = useRef<string | null>(null);
  const readOnly = nb ? !nb.is_owner : true;

  const load = useCallback(async () => {
    try {
      const data = await notebookService.get(notebookId);
      setNb(data);
      setCells(data.cells || []);
      setRanSig(Object.fromEntries((data.cells || []).filter((c) => c.output).map((c) => [c.id, signature(c)])));
      setTitle(data.title);
      versionRef.current = data.version;
      setSaveState('saved');
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('load_failed'));
    }
  }, [notebookId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const titleRef = useRef(title);
  titleRef.current = title;
  const saveNow = useCallback(async () => {
    if (!nb || readOnly) return;
    setSaveState('saving');
    try {
      const saved = await notebookService.update(nb.id, { title: titleRef.current, cells: cellsRef.current, version: versionRef.current });
      versionRef.current = saved.version;
      setSaveProblem(null);
      setSaveState((s) => (s === 'saving' ? 'saved' : s));
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // The server says why (too large, an invalid result name); a network or server hiccup
      // gets no reason and is retried on its own.
      const reason = typeof status === 'number' && status >= 400 && status < 500 && err instanceof Error ? err.message : null;
      setSaveProblem(reason);
      setSaveState(status === 409 ? 'conflict' : 'error');
    }
  }, [nb, readOnly]);

  // A save that failed for a passing reason tries again; one the server refused waits for an edit.
  useEffect(() => {
    if (saveState !== 'error' || saveProblem) return;
    const timer = window.setTimeout(() => void saveNow(), 8000);
    return () => window.clearTimeout(timer);
  }, [saveState, saveProblem, saveNow]);

  // Autosave: a moment after the last change, like a document (Ctrl/Cmd+S saves at once).
  useEffect(() => {
    if (!nb || readOnly || saveState !== 'dirty') return;
    const timer = window.setTimeout(() => void saveNow(), 1200);
    return () => window.clearTimeout(timer);
  }, [nb, readOnly, saveState, title, cells, saveNow]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  const markDirty = () => setSaveState((s) => (s === 'conflict' ? s : 'dirty'));

  const patchCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    markDirty();
  }, []);

  /** Picking data for a starter query that reads the placeholder table ``data`` points it at the
   * source's first table, so templates work on databases as well as uploaded files. */
  const changeCell = useCallback((id: string, patch: Partial<Cell>) => {
    patchCell(id, patch);
    const cell = cellsRef.current.find((c) => c.id === id);
    if (!patch.data_source_id || cell?.type !== 'sql' || !/\bFROM\s+data\b/i.test(cell.source)) return;
    void schemaFor(patch.data_source_id).then((schema) => {
      const tables = schema?.tables ?? [];
      if (!tables.length || tables.some((tb) => tb.name === 'data')) return;
      const first = tableName(tables[0]).split('.').map((p) => (/^[a-z_][a-z0-9_]*$/.test(p) ? p : `"${p.replace(/"/g, '""')}"`)).join('.');
      const now = cellsRef.current.find((c) => c.id === id);
      if (now && /\bFROM\s+data\b/i.test(now.source)) patchCell(id, { source: now.source.replace(/\bFROM\s+data\b/i, `FROM ${first}`) });
    });
  }, [patchCell]);

  const addCell = useCallback((type: CellType, afterIndex: number, extra?: Partial<Cell>) => {
    const id = newCellId();
    if (type === 'sql' || type === 'python') pendingFocus.current = id;
    setCells((prev) => {
      const lastSql = [...prev.slice(0, afterIndex + 1)].reverse().find((c) => c.type === 'sql' && c.data_source_id);
      const cell: Cell = {
        id,
        type,
        source: '',
        name: type === 'sql' ? nextResultName(prev, 'q') : null,
        data_source_id: type === 'sql' ? lastSql?.data_source_id ?? null : null,
        chart: type === 'chart' ? { type: 'bar', y: [] } : type === 'pivot' ? { rows: [], columns: [], values: [] } : null,
        ...extra,
      };
      const next = [...prev];
      next.splice(afterIndex + 1, 0, cell);
      return next;
    });
    markDirty();
    return id;
  }, []);

  const lastDeleted = useRef<{ cell: Cell; index: number } | null>(null);
  const undoDelete = useCallback(() => {
    const last = lastDeleted.current;
    if (!last) return;
    lastDeleted.current = null;
    setCells((prev) => {
      const next = [...prev];
      next.splice(Math.min(last.index, next.length), 0, last.cell);
      return next;
    });
    markDirty();
    message.destroy('cell-undo');
  }, [message]);

  const removeCell = useCallback((id: string) => {
    const index = cellsRef.current.findIndex((c) => c.id === id);
    const removed = cellsRef.current[index];
    if (!removed) return;
    lastDeleted.current = { cell: removed, index };
    setCells((prev) => prev.filter((c) => c.id !== id));
    markDirty();
    message.open({
      type: 'info',
      content: (
        <span>
          {t('cell_deleted')}{' '}
          <Button
            size="small"
            type="link"
            onClick={undoDelete}
          >
            {t('undo')}
          </Button>
        </span>
      ),
      key: 'cell-undo',
      duration: 6,
    });
  }, [message, t, undoDelete]);

  const moveCell = useCallback((id: string, delta: -1 | 1) => {
    setCells((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    markDirty();
  }, []);

  /** Data for a named result: this session's full result, else the saved snapshot. */
  const resultFor = useCallback((name: string): Frame | null => {
    const live = results.current.get(name);
    if (live) return live;
    const cell = cellsRef.current.find((c) => c.type === 'sql' && c.name === name && c.output?.kind === 'table');
    if (cell?.output?.columns) return { columns: cell.output.columns, rows: (cell.output.rows ?? []) as unknown[][] };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsTick]);

  const pySources = useMemo(
    () => dataSources.map((d) => ({ id: String(d.id), name: d.name, type: (d as { db_type?: string; type?: string }).db_type || (d as { type?: string }).type })),
    [dataSources],
  );
  useEffect(() => setNotebookSources(pySources.map((x) => x.name)), [pySources]);

  /** The data source a Python cell means: named by name or id, else the source the cells above use. */
  const pySourceId = useCallback((cell: Cell, source: string | null): string => {
    if (source) {
      const want = source.trim().toLowerCase();
      const matches = pySources.filter((s) => s.id === source.trim() || s.name.trim().toLowerCase() === want);
      if (matches.length > 1) throw new Error(t('python_source_ambiguous', { name: source }));
      if (!matches[0]) throw new Error(t('python_source_unknown', { name: source }));
      return matches[0].id;
    }
    const list = cellsRef.current;
    const id = list.slice(0, list.findIndex((c) => c.id === cell.id)).reverse().find((c) => c.type === 'sql' && c.data_source_id)?.data_source_id
      ?? list.find((c) => c.type === 'sql' && c.data_source_id)?.data_source_id
      ?? (pySources.length === 1 ? pySources[0].id : null);
    if (!id) throw new Error(t('python_source_needed'));
    return id;
  }, [pySources, t]);

  /** aicser.* in a Python cell: queries take the same governed path as a SQL cell; models,
   * forecasts and decisions call their own APIs (see pythonBridge). */
  const bridgeFor = useCallback((cell: Cell, signal: AbortSignal) => createPythonBridge({
    api: (endpoint, init) => fetchApi(endpoint, init),
    projectId: projectId ? String(projectId) : null,
    signal,
    sourceId: (source) => pySourceId(cell, source),
    query: async (sql, source) => {
      const res = await enhancedDataService.executeMultiEngineQuery(sql, pySourceId(cell, source), undefined, true, signal, projectId);
      if (!res.success) throw new Error(res.error || t('query_failed'));
      const columns = ((res.columns || []) as Array<string | { name: string }>).map((c) => (typeof c === 'string' ? c : c.name));
      const cols = columns.length ? columns : Object.keys((res.data?.[0] as Record<string, unknown>) || {});
      return { columns: cols, rows: toRows(res.data || [], cols) };
    },
    text: {
      enterpriseOnly: t('python_ee_only'),
      notFound: (what, name) => t(what === 'model' ? 'python_model_unknown' : 'python_decision_unknown', { name }),
      ambiguous: (what, name) => t(what === 'model' ? 'python_model_ambiguous' : 'python_decision_ambiguous', { name }),
    },
  }), [projectId, pySourceId, t]);

  const runCell = useCallback(async (cell: Cell): Promise<boolean> => {
    if (cell.type !== 'sql' && cell.type !== 'python') return true;
    if (!cell.source.trim()) return true;
    const controller = new AbortController();
    abortRef.current = controller;
    runningKind.current = cell.type;
    setRunningId(cell.id);
    const ranAt = new Date().toISOString();
    let output: CellOutput;
    try {
      if (cell.type === 'sql') {
        if (!cell.data_source_id) throw new Error(t('choose_data_first'));
        const started = performance.now();
        const res = await enhancedDataService.executeMultiEngineQuery(cell.source, cell.data_source_id, undefined, true, controller.signal, projectId);
        if (controller.signal.aborted) throw new Error(t('stopped'));
        if (!res.success) throw new Error(res.error || t('query_failed'));
        const columns = ((res.columns || []) as Array<string | { name: string }>).map((c) => (typeof c === 'string' ? c : c.name));
        const cols = columns.length ? columns : Object.keys((res.data?.[0] as Record<string, unknown>) || {});
        const rows = toRows(res.data || [], cols);
        const rowCount = res.row_count || rows.length;
        if (cell.name) {
          results.current.set(cell.name, { columns: cols, rows, row_count: rowCount, version: Date.now() });
          setResultsTick((n) => n + 1);
        }
        output = { kind: 'table', columns: cols, rows: rows.slice(0, OUTPUT_ROWS), row_count: rowCount, ran_at: ranAt, duration_ms: Math.round(performance.now() - started) };
      } else {
        const inputs: Record<string, Result> = {};
        results.current.forEach((v, k) => { inputs[k] = v; });
        const out = await py.run(cell.source, inputs, { sources: pySources, load: bridgeFor(cell, controller.signal) });
        setLiveImages((prev) => ({ ...prev, [cell.id]: out.images }));
        const stdout = out.stdout?.trim() || undefined;
        if (out.result?.kind === 'table') {
          output = { kind: 'table', columns: out.result.columns, rows: out.result.rows, row_count: out.result.row_count, text: stdout, ran_at: ranAt, duration_ms: out.duration_ms };
        } else {
          const text = [stdout, out.result?.kind === 'text' ? out.result.text : undefined].filter(Boolean).join('\n');
          output = { kind: out.images.length ? 'image' : 'text', text: text || undefined, image: out.images[0], ran_at: ranAt, duration_ms: out.duration_ms };
        }
      }
      patchCell(cell.id, { output });
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const text = controller.signal.aborted ? t('stopped') : cell.type === 'python' ? cleanTraceback(raw) : raw;
      patchCell(cell.id, { output: { kind: 'error', text, ran_at: ranAt } });
      return false;
    } finally {
      execSeq.current += 1;
      const n = execSeq.current;
      setExecCounts((prev) => ({ ...prev, [cell.id]: n }));
      setRanSig((prev) => ({ ...prev, [cell.id]: signature(cell) }));
      abortRef.current = null;
      runningKind.current = null;
      setRunningId(null);
    }
  }, [bridgeFor, patchCell, projectId, py, pySources, t]);

  /** Stop what's running: a query is cancelled; Python can only be stopped by restarting it. */
  const stop = useCallback(() => {
    stopRef.current = true;
    if (runningKind.current === 'python') {
      py.restart();
      message.info(t('python_stopped'));
    }
    abortRef.current?.abort();
  }, [message, py, t]);

  const runMany = useCallback(async (list: Cell[]) => {
    stopRef.current = false;
    setRunningAll(true);
    try {
      for (const c of list) {
        if (stopRef.current) break;
        const ok = await runCell(cellsRef.current.find((x) => x.id === c.id) ?? c);
        if (!ok) {
          if (!stopRef.current) message.warning(t('run_all_stopped'));
          break;
        }
      }
    } finally {
      setRunningAll(false);
    }
  }, [message, runCell, t]);

  const focusCell = useCallback((id: string) => {
    const handle = editors.current.get(id);
    if (handle) handle.focus();
    else pendingFocus.current = id;
  }, []);

  /** Shift+Enter: run, then move to the next code cell, adding one at the end like Jupyter. */
  const runAndAdvance = useCallback(async (cell: Cell) => {
    stopRef.current = false;
    const ok = await runCell(cell);
    if (!ok) return;
    const list = cellsRef.current;
    const index = list.findIndex((c) => c.id === cell.id);
    const next = list.slice(index + 1).find((c) => c.type === 'sql' || c.type === 'python');
    if (next) focusCell(next.id);
    else if (!readOnly) addCell(cell.type, index);
  }, [addCell, focusCell, readOnly, runCell]);

  const runAll = () => runMany(cellsRef.current);

  // ── Keyboard: Jupyter's command mode (a cell is selected, nothing is being typed) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const selectCell = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) document.querySelector(`[data-cell-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const changeType = useCallback((id: string, type: CellType) => {
    const list = cellsRef.current;
    const cell = list.find((c) => c.id === id);
    if (!cell || cell.type === type || cell.type === 'chart' || cell.type === 'pivot') return;
    const lastSql = list.slice(0, list.indexOf(cell)).reverse().find((c) => c.type === 'sql' && c.data_source_id);
    patchCell(id, {
      type,
      output: null,
      name: type === 'sql' ? cell.name || nextResultName(list, 'q') : null,
      data_source_id: type === 'sql' ? cell.data_source_id ?? lastSql?.data_source_id ?? null : null,
    });
  }, [patchCell]);

  const runInsert = useCallback(async (cell: Cell) => {
    stopRef.current = false;
    await runCell(cell);
    if (!readOnly) addCell(cell.type === 'sql' || cell.type === 'python' ? cell.type : 'python', cellsRef.current.findIndex((c) => c.id === cell.id));
  }, [addCell, readOnly, runCell]);

  const keyState = useRef({ last: '', at: 0 });
  const keyActions = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyActions.current = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (!(runningAll || runningId !== null)) void runAll();
      return;
    }
    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void saveNow();
      return;
    }
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !!target.closest('.monaco-editor, .ant-select, .ant-modal, .ant-dropdown, .ant-popover'));
    if (typing || mod || e.altKey) return;
    const list = cellsRef.current;
    const index = list.findIndex((c) => c.id === selectedId);
    const cell = index >= 0 ? list[index] : null;
    const twice = (k: string) => {
      const now = Date.now();
      const hit = keyState.current.last === k && now - keyState.current.at < 600;
      keyState.current = { last: hit ? '' : k, at: now };
      return hit;
    };
    const go = (delta: number) => {
      const next = list[Math.max(0, Math.min(list.length - 1, (index < 0 ? 0 : index) + delta))];
      if (next) selectCell(next.id);
    };
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); go(1); return;
      case 'ArrowUp': case 'k': e.preventDefault(); go(-1); return;
      case 'Enter':
        if (cell) { e.preventDefault(); if (e.shiftKey) void runAndAdvance(cell); else focusCell(cell.id); }
        return;
      case 'h': case '?': e.preventDefault(); setShortcutsOpen(true); return;
      case 'i': case 'I': if (twice('i')) stop(); return;
      case '0': if (twice('0')) { py.restart(); message.info(t('python_restarted')); } return;
    }
    if (readOnly) return;
    switch (e.key) {
      case 'a': case 'b': {
        e.preventDefault();
        const type = cell && (cell.type === 'sql' || cell.type === 'python' || cell.type === 'markdown') ? cell.type : 'python';
        const id = addCell(type, e.key === 'a' ? index - 1 : (index < 0 ? list.length - 1 : index));
        setSelectedId(id);
        return;
      }
      case 'd': if (cell && twice('d')) { const next = list[index + 1] ?? list[index - 1]; removeCell(cell.id); setSelectedId(next?.id ?? null); } return;
      case 'z': undoDelete(); return;
      case 'y': if (cell) changeType(cell.id, 'python'); return;
      case 'm': if (cell) changeType(cell.id, 'markdown'); return;
      case 'q': if (cell) changeType(cell.id, 'sql'); return;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyActions.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const askAi = useCallback(async (cell: Cell, prompt: string) => {
    const index = cellsRef.current.findIndex((c) => c.id === cell.id);
    const context = cellsRef.current.slice(0, index).reverse().find((c) => c.type === 'sql' && c.data_source_id);
    const dataSourceId = cell.data_source_id || context?.data_source_id;
    // Python runs in the browser on the DataFrames the notebook already has (SQL results and
    // frames made in Python) — the server writes code for exactly those, not a connection.
    const frames =
      cell.type === 'python'
        ? [
            ...Array.from(results.current.entries()).map(([name, f]) => ({ name, columns: f.columns, rows: f.row_count })),
            ...py.frames
              .filter((f) => !results.current.has(f.name))
              .map((f) => ({ name: f.name, columns: f.columns, rows: f.rows })),
          ]
        : undefined;
    if (cell.type === 'sql' && !dataSourceId) {
      message.warning(t('choose_data_first'));
      return;
    }
    // Python can also load tables itself (aicser.table / aicser.sql): tell the AI which source
    // and tables are at hand, as the Data panel shows them.
    let source: { name: string; tables: Array<{ name: string; columns: string[] }> } | undefined;
    const pySourceId = dataSourceId || sidebarSourceRef.current;
    if (cell.type === 'python' && pySourceId) {
      const schema = await schemaFor(pySourceId).catch(() => null);
      const name = pySources.find((x) => x.id === pySourceId)?.name;
      if (name && schema) {
        source = {
          name,
          tables: (schema.tables ?? []).slice(0, 40).map((tb) => ({ name: tableName(tb), columns: (tb.columns ?? []).slice(0, 40).map((c) => c.name) })),
        };
      }
    }
    // …and the approved models and saved decisions it can use (Enterprise).
    let assets: { models: unknown[]; decisions: unknown[] } | undefined;
    if (cell.type === 'python' && isEnterpriseEdition()) {
      const scope = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
      const [m, d] = await Promise.all([
        fetchApi<{ items?: Array<Record<string, unknown>> }>(`/api/models${scope}`).catch(() => ({ items: [] })),
        fetchApi<{ definitions?: Array<Record<string, unknown>> }>(`/api/ai-decisions/definitions${scope}`).catch(() => ({ definitions: [] })),
      ]);
      assets = {
        models: (m.items || []).filter((x) => x.production).slice(0, 30)
          .map((x) => ({ name: x.name, task: x.task, predicts: x.output_column, inputs: x.features })),
        decisions: (d.definitions || []).slice(0, 30).map((x) => ({ name: x.name, type: x.question_type, instructions: x.instructions })),
      };
    }
    try {
      const res = await fetchApi<{ success: boolean; code?: string; error?: string }>('/api/ai/query-editor/generate-code', {
        method: 'POST',
        body: JSON.stringify(
          cell.type === 'sql'
            ? { query: prompt, data_source_id: dataSourceId, language: 'sql', current_sql: cell.source || undefined }
            : { query: prompt, language: 'python', frames, source, ...assets, current_code: cell.source || undefined, data_source_id: dataSourceId || undefined },
        ),
      });
      if (!res.success || !res.code) throw new Error(res.error || t('ai_failed'));
      const before = cellsRef.current.find((c) => c.id === cell.id)?.source ?? cell.source;
      patchCell(cell.id, { source: res.code.trim() });
      // The AI's code replaces the cell's; one click puts the previous code back.
      if (before.trim()) {
        const key = `nb-ai-${cell.id}`;
        message.success({
          key,
          duration: 8,
          content: (
            <span>
              {t('ai_code_applied')}{' '}
              <Button size="small" type="link" onClick={() => { patchCell(cell.id, { source: before }); message.destroy(key); }}>{t('undo')}</Button>
            </span>
          ),
        });
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('ai_failed'));
    }
  }, [message, patchCell, pySources, t, py.frames]);

  // Everything a chart or "save as dataset" can use: query results and Python DataFrames.
  const resultInfos: ResultInfo[] = useMemo(() => {
    const seen = new Map<string, ResultInfo>();
    for (const c of cells) {
      if (c.type === 'sql' && c.name) {
        const live = results.current.get(c.name);
        if (live) seen.set(c.name, { name: c.name, columns: live.columns, rows: live.row_count });
        else if (c.output?.columns) seen.set(c.name, { name: c.name, columns: c.output.columns, rows: c.output.row_count });
      }
    }
    for (const f of py.frames) if (!seen.has(f.name)) seen.set(f.name, { name: f.name, columns: f.columns, rows: f.rows });
    const all = Array.from(seen.values());
    // Python cells suggest these DataFrames and their columns (pythonCompletion.ts).
    setNotebookFrames(all);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, py.frames, resultsTick]);

  // A run's outputs (scheduled or "Run now") shown in the cells, as if run here.
  const showRun = useCallback(async (runId: string) => {
    if (!nb) return;
    try {
      const run = await notebookRuns.run(nb.id, runId);
      let shown = 0;
      for (const [cellId, output] of Object.entries(run.outputs || {})) {
        if (cellsRef.current.some((c) => c.id === cellId)) {
          patchCell(cellId, { output });
          shown += 1;
        }
      }
      setScheduleOpen(false);
      const when = run.finished_at ? new Date(run.finished_at).toLocaleString() : '';
      if (run.status === 'failed') message.warning(t('run_results_failed', { when, error: run.error ?? '' }));
      else message.success(t('run_results_shown', { n: shown, when }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('schedule_load_failed'));
    }
  }, [message, nb, patchCell, t]);

  // Opened from a notification ("Open results"): show that run once, then tidy the address.
  const runParam = searchParams?.get('run');
  useEffect(() => {
    if (!nb || !runParam || !isEnterpriseEdition()) return;
    void showRun(runParam);
    router.replace(`/notebooks/${nb.id}`);
  }, [nb, runParam, showRun, router]);

  // AI suggestions as you type: on by default where AI is available; each viewer can turn them off.
  const [inlineOn, setInlineOn] = useState(() => {
    try {
      return window.localStorage.getItem(INLINE_AI_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [sideSourceInfo, setSideSourceInfo] = useState<InlineRequest['source']>();
  const inlineEnabled = ai.available && inlineOn && !readOnly;
  useEffect(() => {
    if (!inlineEnabled) {
      configureInlineAi(null);
      return;
    }
    configureInlineAi(
      async (body, signal) => (await fetchApi<{ completion?: string }>('/api/ai/notebook/complete', {
        method: 'POST', body: JSON.stringify(body), signal,
      })).completion || '',
      { frames: resultInfos.map((r) => ({ name: r.name, columns: r.columns, rows: r.rows })), source: sideSourceInfo },
    );
  }, [inlineEnabled, resultInfos, sideSourceInfo]);
  useEffect(() => () => configureInlineAi(null), []);

  // Charts from Python DataFrames fetch their rows from the Python session.
  useEffect(() => {
    for (const c of cells) {
      const from = c.type === 'chart' || c.type === 'pivot' ? c.chart?.from : undefined;
      if (!from || resultFor(from) || chartFrames[`${c.id}:${from}`]) continue;
      if (!py.frames.some((f) => f.name === from)) continue;
      void py.getFrame(from, 50000).then((frame) => setChartFrames((prev) => ({ ...prev, [`${c.id}:${from}`]: frame }))).catch(() => undefined);
    }
  }, [cells, py, resultFor, chartFrames]);

  const exportIpynb = async () => {
    if (!nb) return;
    const doc = await notebookService.exportIpynb(nb.id);
    download(`${safeFileName(title)}.ipynb`, JSON.stringify(doc, null, 1), 'application/x-ipynb+json');
  };

  /** A chart's first look: sensible axes picked from the data, not the first two columns. */
  const pickChartSource = useCallback(async (cellId: string, from: string) => {
    const current = cellsRef.current.find((c) => c.id === cellId);
    const isPivot = current?.type === 'pivot';
    patchCell(cellId, { chart: isPivot ? { from, rows: [], columns: [], values: [] } : { ...(current?.chart || {}), from, x: undefined, y: [], series: null } });
    let frame = resultFor(from);
    if (!frame && py.frames.some((f) => f.name === from)) {
      frame = await py.getFrame(from, 50000).catch(() => null);
      if (frame) setChartFrames((prev) => ({ ...prev, [`${cellId}:${from}`]: frame! }));
    }
    if (!frame) return;
    const now = cellsRef.current.find((c) => c.id === cellId);
    if (now?.chart?.from !== from) return;
    patchCell(cellId, { chart: { ...now.chart, ...(isPivot ? suggestPivot(frame.columns, frame.rows) : suggestChart(frame.columns, frame.rows)) } });
  }, [patchCell, py, resultFor]);

  // A chart pointed at a result before it ran (e.g. from a template) gets its axes once the data arrives.
  useEffect(() => {
    for (const c of cells) {
      const spec = c.type === 'chart' || c.type === 'pivot' ? c.chart : null;
      if (!spec?.from || readOnly) continue;
      if (c.type === 'chart' ? spec.x || spec.y?.length : spec.rows?.length || spec.columns?.length) continue;
      const frame = resultFor(spec.from) ?? chartFrames[`${c.id}:${spec.from}`];
      if (!frame?.columns.length) continue;
      if (c.type === 'pivot') {
        const suggestion = suggestPivot(frame.columns, frame.rows);
        if (suggestion.rows?.length || suggestion.columns?.length) patchCell(c.id, { chart: { ...spec, ...suggestion } });
        continue;
      }
      const suggestion = suggestChart(frame.columns, frame.rows);
      if (suggestion.x || suggestion.y?.length) patchCell(c.id, { chart: { ...spec, ...suggestion } });
    }
  }, [cells, chartFrames, patchCell, readOnly, resultFor]);

  const outputAction = useCallback(async (cell: Cell, action: OutputAction) => {
    const out = cell.output;
    const frame = (cell.type === 'sql' && cell.name ? resultFor(cell.name) : null)
      ?? (out?.columns ? { columns: out.columns, rows: (out.rows ?? []) as unknown[][] } : null);
    if (!frame) return;
    const index = cellsRef.current.findIndex((c) => c.id === cell.id);
    if (action === 'chart' && cell.name) {
      addCell('chart', index, { chart: { from: cell.name, ...suggestChart(frame.columns, frame.rows) } });
    } else if (action === 'pivot' && cell.name) {
      addCell('pivot', index, { chart: { from: cell.name, ...suggestPivot(frame.columns, frame.rows) } });
    } else if (action === 'save') {
      const name = cell.type === 'sql' && cell.name ? cell.name : resultInfos[resultInfos.length - 1]?.name;
      setSaveFrom(name);
      setSaveName(`${title} ${name ?? ''}`.trim());
      setSaveOpen(true);
    } else if (action === 'workbook') {
      // A query result opens live (re-run as whoever opens it); a Python result as a snapshot.
      const sql = cell.type === 'sql' && cell.data_source_id ? cell : null;
      try {
        const id = await openAsWorkbook({
          title: `${title} ${cell.name ?? ''}`.trim(),
          projectId: projectId ? String(projectId) : null,
          columns: frame.columns,
          rows: frame.rows,
          rangeName: cell.name || undefined,
          live: sql ? { dataSourceId: sql.data_source_id!, sql: sql.source, sourceName: dataSources.find((d) => String(d.id) === sql.data_source_id)?.name } : undefined,
        });
        if (saveState === 'dirty') await saveNow();
        router.push(`/sheets/${id}`);
      } catch (err) {
        message.error(err instanceof Error ? err.message : t('sheet_failed'));
      }
    } else if (action === 'csv') {
      download(`${safeFileName(`${title} ${cell.name ?? ''}`)}.csv`, `\ufeff${toCsv(frame.columns, frame.rows)}`, 'text/csv;charset=utf-8');
    } else if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(toTsv(frame.columns, frame.rows.slice(0, 5000)));
        message.success(t('copied_rows', { n: Math.min(frame.rows.length, 5000) }));
      } catch {
        message.error(t('copy_failed'));
      }
    }
  }, [addCell, dataSources, message, projectId, resultFor, resultInfos, router, saveNow, saveState, t, title]);

  const insertIntoCell = useCallback((text: string, meta?: { kind: 'table' | 'column' | 'result'; sourceId?: string | null }) => {
    const list = cellsRef.current;
    const target = (focusedId && editors.current.has(focusedId) ? focusedId : null)
      ?? [...list].reverse().find((c) => (c.type === 'sql' || c.type === 'python') && editors.current.has(c.id))?.id;
    const handle = target ? editors.current.get(target) : null;
    if (!handle || !target) {
      message.info(t('insert_needs_cell'));
      return;
    }
    const cell = list.find((c) => c.id === target);
    // A table picked while writing Python types the call that loads it, named for its source.
    if (cell?.type === 'python' && meta?.kind === 'table' && meta.sourceId && !readOnly) {
      const base = text.split('.').pop()!.replace(/"/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'data';
      const name = /^[a-z_]/.test(base) ? base : `t_${base}`;
      const src = pySources.find((s) => s.id === meta.sourceId);
      const sameName = src ? pySources.filter((s) => s.name.trim().toLowerCase() === src.name.trim().toLowerCase()).length : 0;
      const ref = src && sameName === 1 ? src.name : meta.sourceId;
      handle.insert(`${name} = aicser.table(${JSON.stringify(text.replace(/"/g, ''))}, source=${JSON.stringify(ref)})\n`);
      return;
    }
    handle.insert(text);
  }, [focusedId, message, pySources, readOnly, t]);

  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };

  const saveDataset = async () => {
    if (!saveFrom) return;
    setSavingDataset(true);
    try {
      const frame = resultFor(saveFrom) ?? (await py.getFrame(saveFrom, 200000));
      const res = await notebookService.saveDataset(saveName.trim() || saveFrom, frame.columns, frame.rows, projectId ? String(projectId) : null);
      setSaveOpen(false);
      message.success(
        <span>
          {t('dataset_saved')}{' '}
          {res.data_source?.id ? <a href={`/data/sources/${res.data_source.id}`}>{t('open_dataset')}</a> : null}
        </span>,
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dataset_failed'));
    } finally {
      setSavingDataset(false);
    }
  };

  const moreItems: MenuProps['items'] = [
    { key: 'shortcuts', icon: <span aria-hidden>⌨</span>, label: t('keyboard_shortcuts') },
    ...(ai.available && !readOnly
      ? [{ key: 'inline_ai', icon: inlineOn ? <CheckOutlined /> : <span aria-hidden style={{ display: 'inline-block', width: 14 }} />, label: t('inline_ai') }]
      : []),
    { type: 'divider' as const },
    { key: 'dataset', icon: <SaveOutlined />, label: t('save_as_dataset'), disabled: !resultInfos.length },
    { key: 'duplicate', icon: <CopyOutlined />, label: t('duplicate') },
    { key: 'history', icon: <HistoryOutlined />, label: t('version_history') },
    ...(isEnterpriseEdition() ? [{ key: 'schedule', icon: <FieldTimeOutlined />, label: t('schedule_menu') }] : []),
    ...(nb?.is_owner ? [{ type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, label: t('delete'), danger: true }] : []),
  ];

  const exportItems: MenuProps['items'] = [
    {
      type: 'group',
      label: t('export_report'),
      children: [
        { key: 'pdf', icon: <FilePdfOutlined />, label: t('export_pdf') },
        { key: 'html', icon: <FileTextOutlined />, label: t('export_html') },
      ],
    },
    {
      type: 'group',
      label: t('export_notebook'),
      children: [
        { key: 'pdf-code', icon: <FilePdfOutlined />, label: t('export_pdf_code') },
        { key: 'html-code', icon: <CodeOutlined />, label: t('export_html_code') },
        { key: 'ipynb', icon: <DownloadOutlined />, label: t('export_ipynb') },
      ],
    },
  ];

  const exportReport = async (format: 'html' | 'pdf', includeCode: boolean) => {
    const charts: Record<string, { light: string; dark?: string }> = {};
    for (const c of cellsRef.current) {
      if (c.type !== 'chart') continue;
      const el = document.querySelector(`[data-cell-id="${c.id}"] .nb-chart-canvas`);
      const light = await chartImage(el, 'light').catch(() => null);
      // PDFs print in light only, so only the web page needs the dark version.
      const dark = format === 'html' ? await chartImage(el, 'dark').catch(() => null) : null;
      if (light) charts[c.id] = { light, ...(dark ? { dark } : {}) };
    }
    const pivots: Record<string, { columns: string[]; rows: unknown[][] }> = {};
    for (const c of cellsRef.current) {
      if (c.type !== 'pivot' || !c.chart?.from) continue;
      const frame = resultFor(c.chart.from) ?? chartFrames[`${c.id}:${c.chart.from}`];
      if (frame && (c.chart.rows?.length || c.chart.columns?.length)) pivots[c.id] = pivotGrid(pivot(frame.columns, frame.rows, c.chart), t('pivot_total'));
    }
    const html = await notebookHtml(cellsRef.current, {
      title: title || t('untitled'),
      includeCode,
      charts,
      pivots,
      images: liveImages,
      labels: {
        exportedOn: t('exported_on', { date: new Date().toLocaleString() }),
        rowsShown: (shown, total) => t('rows_shown', { shown, total }),
      },
    });
    if (format === 'html') download(`${safeFileName(title)}.html`, html, 'text/html;charset=utf-8');
    else await printHtml(html);
  };

  const onExport: MenuProps['onClick'] = async ({ key }) => {
    try {
      if (key === 'ipynb') await exportIpynb();
      else await exportReport(key.startsWith('pdf') ? 'pdf' : 'html', key.endsWith('-code'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('export_failed'));
    }
  };

  const setVisibility = async (on: boolean) => {
    if (!nb) return;
    try {
      const saved = await notebookService.update(nb.id, { visibility: on ? 'project' : 'private', version: versionRef.current });
      versionRef.current = saved.version;
      setNb({ ...nb, visibility: saved.visibility, version: saved.version });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  };

  const clearOutputs = () => {
    setCells((prev) => prev.map((c) => (c.output ? { ...c, output: null } : c)));
    setLiveImages({});
    setRanSig({});
    setExecCounts({});
    markDirty();
  };

  // The sidebar shows the data of the cell being edited, else the notebook's first source.
  const focused = cells.find((c) => c.id === focusedId);
  const sidebarSource = sideSource
    ?? (focused?.type === 'sql' ? focused.data_source_id : null)
    ?? cells.find((c) => c.type === 'sql' && c.data_source_id)?.data_source_id
    ?? null;
  sidebarSourceRef.current = sidebarSource;
  // How comment threads name the cell they're on: its position, type and result name.
  const cellLabel = useCallback((id: string) => {
    const i = cells.findIndex((c) => c.id === id);
    if (i < 0) return undefined;
    const c = cells[i];
    return `${t('cell_n', { n: i + 1 })} · ${t(`type_${c.type}`)}${c.name ? ` · ${c.name}` : ''}`;
  }, [cells, t]);
  const sideSourceName = pySources.find((x) => x.id === sidebarSource)?.name;
  useEffect(() => {
    if (!sidebarSource || !sideSourceName) {
      setSideSourceInfo(undefined);
      return;
    }
    let live = true;
    void schemaFor(sidebarSource).then((schema) => {
      if (!live || !schema) return;
      setSideSourceInfo({
        name: sideSourceName,
        tables: (schema.tables ?? []).slice(0, 40).map((tb) => ({ name: tableName(tb), columns: (tb.columns ?? []).slice(0, 40).map((c) => c.name) })),
      });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [sidebarSource, sideSourceName]);
  const sourceOptions = useMemo(() => dataSources.map((d) => ({ value: String(d.id), label: d.name })), [dataSources]);
  const busy = runningAll || runningId !== null;

  const onMore: MenuProps['onClick'] = async ({ key }) => {
    if (!nb) return;
    if (key === 'shortcuts') setShortcutsOpen(true);
    if (key === 'schedule') {
      if (saveState === 'dirty') await saveNow(); // runs use the saved notebook
      setScheduleOpen(true);
    }
    if (key === 'history') {
      // Save pending edits first so the history and "now" agree.
      if (saveState === 'dirty') await saveNow();
      setHistoryOpen(true);
    }
    if (key === 'inline_ai') {
      setInlineOn((on) => {
        try {
          window.localStorage.setItem(INLINE_AI_KEY, on ? '0' : '1');
        } catch {
          /* per-viewer convenience only */
        }
        return !on;
      });
    }
    if (key === 'dataset') {
      setSaveFrom(resultInfos[resultInfos.length - 1]?.name);
      setSaveName(title);
      setSaveOpen(true);
    }
    if (key === 'duplicate') {
      const copy = await notebookService.duplicate(nb.id);
      router.push(`/notebooks/${copy.id}`);
    }
    if (key === 'delete') {
      await notebookService.remove(nb.id);
      router.push(`/notebooks?deleted=${nb.id}`);
    }
  };

  if (loadError) return <Alert type="error" showIcon message={loadError} action={<Button onClick={() => router.push('/notebooks')}>{t('back')}</Button>} />;
  if (!nb) return <div className="nb-loading"><Spin /></div>;

  const saveLabel = { saved: t('saved'), dirty: t('unsaved'), saving: t('saving'), conflict: t('conflict_short'), error: t('save_error') }[saveState];
  const pyLabel = { off: null, starting: t('python_starting'), ready: t('python_ready'), busy: t('python_busy'), failed: t('python_failed') }[py.status];

  return (
    <div className="nb-editor">
      <div className="nb-toolbar">
        <div className="nb-toolbar__title">
          <Input
            className="nb-title"
            variant="borderless"
            value={title}
            readOnly={readOnly}
            maxLength={200}
            aria-label={t('title_label')}
            placeholder={t('untitled')}
            onChange={(e) => { setTitle(e.target.value); markDirty(); }}
            onBlur={() => { if (!title.trim() && nb) { setTitle(nb.title || t('untitled')); markDirty(); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          />
          <Tooltip title={saveState === 'error' ? saveProblem || t('save_retrying') : undefined}>
            <Text type={saveState === 'error' || saveState === 'conflict' ? 'danger' : 'secondary'} className="nb-save-state" aria-live="polite">
              {!readOnly ? <><CloudSyncOutlined /> {saveLabel}</> : <Tag>{t('view_only')}</Tag>}
            </Text>
          </Tooltip>
          {pyLabel ? (
            <Tooltip title={py.status === 'starting' ? t('python_note') : undefined}>
              <Tag color={py.status === 'failed' ? 'error' : 'processing'} bordered={false}>{pyLabel}</Tag>
            </Tooltip>
          ) : null}
        </div>
        <Space wrap size={8}>
          {busy ? (
            <Button danger icon={<StopOutlined />} onClick={stop}>{t('stop')}</Button>
          ) : (
            <Space.Compact>
              <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void runAll()} disabled={!cells.length}>
                {t('run_all')}
              </Button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'restart', icon: <ReloadOutlined />, label: t('restart_python'), disabled: py.status === 'off', title: t('restart_python_help') },
                    ...(readOnly ? [] : [{ key: 'clear', icon: <ClearOutlined />, label: t('clear_outputs') }]),
                  ],
                  onClick: ({ key }) => {
                    if (key === 'restart') py.restart();
                    if (key === 'clear') clearOutputs();
                  },
                }}
              >
                <Button type="primary" icon={<DownOutlined />} aria-label={t('run_options')} />
              </Dropdown>
            </Space.Compact>
          )}
          {nb.is_owner ? (
            <Popover
              trigger="click"
              placement="bottomRight"
              title={t('share_title')}
              content={(
                <div className="nb-share">
                  <label className="nb-share__row">
                    <span className="nb-share__icon" aria-hidden>{nb.visibility === 'project' ? <GlobalOutlined /> : <LockOutlined />}</span>
                    <span className="nb-share__text">
                      <Text strong>{t('share_with_project')}</Text>
                      <Text type="secondary">{t('share_help')}</Text>
                    </span>
                    <Switch size="small" checked={nb.visibility === 'project'} onChange={(on) => void setVisibility(on)} aria-label={t('share_with_project')} />
                  </label>
                </div>
              )}
            >
              <Button icon={<ShareAltOutlined />}>{t('share')}</Button>
            </Popover>
          ) : null}
          <Dropdown trigger={['click']} menu={{ items: exportItems, onClick: onExport }}>
            <Button icon={<DownloadOutlined />}>{t('export')}</Button>
          </Dropdown>
          {!sidebarOpen ? (
            <Tooltip title={t('show_sidebar')}>
              <Button icon={<DatabaseOutlined />} aria-label={t('show_sidebar')} onClick={() => toggleSidebar(true)} />
            </Tooltip>
          ) : null}
          {nb ? (
            <DashboardCollabCommentsPanel
              dashboardId={nb.id}
              apiRoot="/api/notebooks"
              open={commentsOpen}
              onOpenChange={setCommentsOpen}
              selectedWidgetId={selectedId}
              widgetTitle={cellLabel}
              canModerate={!readOnly}
              triggerSize="middle"
              anchorTerms={{
                attach: (name) => t('comment_attach_cell', { cell: name }),
                on: t('comment_on_cell'),
                only: t('comment_only_cell'),
                selected: t('comment_selected_cell'),
              }}
            />
          ) : null}
          <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: onMore }}>
            <Button icon={<MoreOutlined />} aria-label={t('more')} />
          </Dropdown>
        </Space>
      </div>

      {saveState === 'conflict' ? (
        <Alert type="warning" showIcon message={t('conflict')} action={<Button size="small" onClick={() => void load()}>{t('reload')}</Button>} />
      ) : null}
      {readOnly ? (
        <Alert
          type="info"
          showIcon
          message={t('read_only')}
          action={<Button size="small" onClick={() => onMore({ key: 'duplicate' } as never)}>{t('make_copy')}</Button>}
        />
      ) : null}

      <div className={`nb-body${sidebarOpen ? ' nb-body--side' : ''}`}>
        <div className="nb-main">
          {cells.length === 0 ? (
            <Empty description={t('empty_notebook')}>
              <Space wrap>
                {(['sql', 'python', 'markdown'] as CellType[]).map((type) => (
                  <Button key={type} onClick={() => addCell(type, -1)}>{t(`add_${type}`)}</Button>
                ))}
              </Space>
            </Empty>
          ) : (
            <div className="nb-cells">
              {!readOnly ? <AddBar label={t('add_cell')} onAdd={(type) => addCell(type, -1)} /> : null}
              {cells.map((cell, index) => {
                const from = cell.type === 'chart' || cell.type === 'pivot' ? cell.chart?.from : undefined;
                const chartData = from ? resultFor(from) ?? chartFrames[`${cell.id}:${from}`] ?? null : null;
                const producer = from && !chartData ? cells.find((c) => c.type === 'sql' && c.name === from) : undefined;
                const stale = Boolean(cell.output && ranSig[cell.id] !== undefined && ranSig[cell.id] !== signature(cell));
                return (
                  <React.Fragment key={cell.id}>
                    <NotebookCell
                      cell={cell}
                      index={index}
                      count={cells.length}
                      readOnly={readOnly}
                      running={runningId === cell.id}
                      selected={selectedId === cell.id}
                      onRunInsert={() => void runInsert(cellsRef.current.find((c) => c.id === cell.id) ?? cell)}
                      onEscape={() => selectCell(cell.id)}
                      onSaveNow={() => void saveNow()}
                      busy={busy}
                      dark={isDarkMode}
                      execCount={execCounts[cell.id]}
                      stale={stale}
                      dataSources={sourceOptions}
                      results={resultInfos}
                      chartData={chartData}
                      chartProducer={producer ? { id: producer.id, name: from! } : null}
                      liveImages={liveImages[cell.id]}
                      aiAvailable={ai.available}
                      onChange={(patch) => changeCell(cell.id, patch)}
                      onPickChartSource={(f) => void pickChartSource(cell.id, f)}
                      onRun={(advance) => {
                        const current = cellsRef.current.find((c) => c.id === cell.id) ?? cell;
                        void (advance ? runAndAdvance(current) : runCell(current));
                      }}
                      onStop={stop}
                      onRunRange={(range) => void runMany(range === 'above' ? cellsRef.current.slice(0, index) : cellsRef.current.slice(index))}
                      onRunCell={(id) => { const c = cellsRef.current.find((x) => x.id === id); if (c) void runMany([c]); }}
                      onDelete={() => removeCell(cell.id)}
                      onMove={(d) => moveCell(cell.id, d)}
                      onAskAi={(prompt) => askAi(cell, prompt)}
                      onOutputAction={(action) => void outputAction(cellsRef.current.find((c) => c.id === cell.id) ?? cell, action)}
                      onFocus={() => { setFocusedId(cell.id); setSelectedId(cell.id); }}
                      onPublish={readOnly ? undefined : (target) => setPublishing({ cellId: cell.id, target })}
                      registerEditor={(handle) => {
                        if (handle) {
                          editors.current.set(cell.id, handle);
                          if (pendingFocus.current === cell.id) {
                            pendingFocus.current = null;
                            setTimeout(handle.focus, 0);
                          }
                        } else {
                          editors.current.delete(cell.id);
                        }
                      }}
                    />
                    {!readOnly ? <AddBar label={t('add_cell')} end={index === cells.length - 1} onAdd={(type) => addCell(type, index)} /> : null}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
        {sidebarOpen ? (
          <DataSidebar
            dataSources={sourceOptions}
            sourceId={sidebarSource}
            onSourceChange={(id) => {
              setSideSource(id);
              if (focused?.type === 'sql' && !focused.data_source_id && !readOnly) changeCell(focused.id, { data_source_id: id });
            }}
            results={resultInfos}
            onInsert={(text, kind) => insertIntoCell(text, { kind, sourceId: sidebarSource })}
            onClose={() => toggleSidebar(false)}
          />
        ) : null}
      </div>

      <Modal open={shortcutsOpen} title={t('keyboard_shortcuts')} footer={null} onCancel={() => setShortcutsOpen(false)} width={640}>
        <div className="nb-shortcuts">
          {([
            ['editing', [['Shift+Enter', 'sc_run_next'], ['Ctrl/⌘+Enter', 'sc_run'], ['Alt+Enter', 'sc_run_insert'], ['Ctrl/⌘+S', 'sc_save'], ['Esc', 'sc_command']]],
            ['command', [['Enter', 'sc_edit'], ['↑ / K · ↓ / J', 'sc_move'], ['A · B', 'sc_insert'], ['D D', 'sc_delete'], ['Z', 'sc_undo'], ['Y · M · Q', 'sc_type'], ['I I', 'sc_stop'], ['0 0', 'sc_restart'], ['H · ?', 'sc_help']]],
            ['anywhere', [['Ctrl/⌘+Shift+Enter', 'sc_run_all']]],
          ] as Array<[string, Array<[string, string]>]>).map(([group, rows]) => (
            <section key={group}>
              <h4>{t(`sc_group_${group}`)}</h4>
              <dl>
                {rows.map(([keys, label]) => (
                  <React.Fragment key={label}>
                    <dt>{keys.split(' · ').map((k, i) => <React.Fragment key={k}>{i ? ' · ' : ''}<kbd>{k}</kbd></React.Fragment>)}</dt>
                    <dd>{t(label)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Modal>

      {nb && isEnterpriseEdition() ? (
        <ScheduleDialog
          open={scheduleOpen}
          notebookId={nb.id}
          canEdit={!readOnly}
          onClose={() => setScheduleOpen(false)}
          onShowRun={(id) => void showRun(id)}
        />
      ) : null}
      {nb ? (
        <VersionHistoryDrawer
          open={historyOpen}
          notebookId={nb.id}
          current={cells}
          canRestore={!readOnly}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => void load()}
        />
      ) : null}
      <PublishDialog
        open={Boolean(publishing)}
        target={publishing?.target ?? 'library'}
        cell={cells.find((c) => c.id === publishing?.cellId) ?? null}
        cells={cells}
        notebookId={nb.id}
        frameFor={async (name) => resultFor(name) ?? (await py.getFrame(name, 200000).catch(() => null))}
        onClose={() => setPublishing(null)}
      />

      <Modal
        open={saveOpen}
        title={t('save_as_dataset')}
        okText={t('save')}
        confirmLoading={savingDataset}
        onOk={() => void saveDataset()}
        onCancel={() => setSaveOpen(false)}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">{t('save_dataset_desc')}</Text>
          <Select value={saveFrom} onChange={setSaveFrom} style={{ width: '100%' }} options={resultInfos.map((r) => ({ value: r.name, label: r.name }))} aria-label={t('save_which')} />
          <Input value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)} aria-label={t('dataset_name')} placeholder={t('dataset_name')} />
        </Space>
      </Modal>
    </div>
  );
}
