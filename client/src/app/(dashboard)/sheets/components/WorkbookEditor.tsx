'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, App, Button, Drawer, Dropdown, Empty, Input, Space, Spin, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  CheckOutlined, CloudSyncOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, DownloadOutlined, DownOutlined,
  FieldTimeOutlined, HistoryOutlined, ImportOutlined, LockOutlined, MoreOutlined, PlusOutlined, ReloadOutlined,
  SafetyCertificateOutlined, TeamOutlined,   BarChartOutlined, BulbOutlined, ReadOutlined, TableOutlined, RobotOutlined,
} from '@ant-design/icons';
import { DocumentToolbar } from '@/components/work-surface/DocumentToolbar';
import '@/components/work-surface/work-surface.css';
import { IronCalc, Model, init } from '@ironcalc/workbook';
import '@ironcalc/workbook/style.css';
import { useDataSources } from '@/hooks/useDataSources';
import { useAiAvailability } from '@/hooks/useAiAvailability';
import { useProjectStore } from '@/stores/useProjectStore';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { persistSelectedDataSourceId } from '@/stores/useDataSourceStore';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import {
  fromBase64, toBase64, workbookService, type DataRange, type Workbook, type WorkbookSettings, type WorkbookVisualEmbed,
} from '@/services/workbookService';
import { SheetVisualEmbeds } from './SheetVisualEmbeds';
import { newVisualEmbedId } from './sheetVisualEmbed';
import { defaultParamValues } from '../../notebooks/utils/parameters';
import { emptySettings, WorkbookGovernanceDrawer } from './WorkbookGovernanceDrawer';
import { DashboardCollabCommentsPanel } from '../../dashboards/components/DashboardCollabCommentsPanel';
import '../../dashboards/styles/comments.css';
import { clearArea, writeTable } from './cellEncoding';
import { DataRangeDialog, type RangeRequest } from './DataRangeDialog';
import { DataRangesPanel } from './DataRangesPanel';
import {
  findAnalyzeBindingAt,
  newAnalyzeBindingId,
  type WorkbookAnalyzeBinding,
} from './sheetAnalyzeBindings';
import { WorkbookHistoryDrawer } from './WorkbookHistoryDrawer';
import { WorkbookScheduleDialog } from './WorkbookScheduleDialog';
import { SheetAnalyzePanel, type AnalyzeTab, type SheetAnalyzeRestore } from './SheetAnalyzePanel';
import { areaRef, cellRef, newRangeId, overlaps, runRangeQuery, seedKey } from './sheetData';
import { resolveSheetWriteAnchor } from './sheetInsertAnchor';
import type { SheetGridSelection } from './sheetTableExtract';
import { selectionFromModel } from './sheetTableExtract';
import { buildSheetStudioSurfaceContext } from '@/agent/sheetSurfaceContext';
import { applySheetChanges } from '@/agent/applySheetChanges';
import type { SurfaceAgentAction, SurfaceSheetChanges } from '@/agent/surfaceAgentTypes';
import { SurfaceCopilotDrawer, SurfaceInlineAsk } from '@/ee';
import { inlineAskShortcutLabel, isInlineAskShortcut, type PendingSurfaceQuestion } from '@/agent/inlineAsk';
import { forDarkGrid, sheetCss, sheetThemeVariables } from './sheetTheme';
import '../sheets.css';

const LANGUAGE = 'en';
const POLL_MS = 800;
const SAVE_DELAY_MS = 1500;

const { Text } = Typography;

let wasmReady: Promise<unknown> | null = null;
function ensureEngine() {
  wasmReady ??= init();
  return wasmReady;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'gone';

export function WorkbookEditor({ workbookId }: { workbookId: string }) {
  const t = useTranslations('sheets');
  const tAsk = useTranslations('surface_copilot');
  const tSurface = useTranslations('surface_copilot');
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { token } = theme.useToken();
  const { isDarkMode } = useThemeMode();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { dataSources } = useDataSources();
  const ai = useAiAvailability(false, isEnterpriseEdition());

  const [wb, setWb] = useState<Workbook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [title, setTitle] = useState('');
  const [ranges, setRanges] = useState<DataRange[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ edit?: DataRange } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeTab, setAnalyzeTab] = useState<AnalyzeTab>('pivot');
  const [analyzeRestore, setAnalyzeRestore] = useState<SheetAnalyzeRestore | null>(null);
  const [analyzeRestoreKey, setAnalyzeRestoreKey] = useState<string | null>(null);
  const [copilotView, setCopilotView] = useState<'ask' | 'formula'>('ask');
  const [formulaSubMode, setFormulaSubMode] = useState<'write' | 'explain'>('write');
  const [syncingAi, setSyncingAi] = useState(false);
  const [syncedSourceId, setSyncedSourceId] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [gridSelection, setGridSelection] = useState<SheetGridSelection | null>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [wbSettings, setWbSettings] = useState<WorkbookSettings>(emptySettings);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  // ⌘J in the sheet: a one-line question about the selected cells, answered (and applied) by the AI panel.
  const [inlineAskOpen, setInlineAskOpen] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingSurfaceQuestion | null>(null);
  useEffect(() => {
    if (!ai.available) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isInlineAskShortcut(e)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.ant-modal, .ant-drawer, .surface-inline-ask')) return;
      e.preventDefault();
      setInlineAskOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ai.available]);

  const modelRef = useRef<Model | null>(null);
  const versionRef = useRef(0);
  const rangesRef = useRef<DataRange[]>([]);
  rangesRef.current = ranges;
  const titleRef = useRef('');
  titleRef.current = title;
  const readOnly = wb
    ? !wb.is_owner || (wbSettings.certification.status === 'approved' && Boolean(wbSettings.certification.locks_edits))
    : true;
  const paramValuesRef = useRef(paramValues);
  paramValuesRef.current = paramValues;

  const sourceOptions = useMemo(() => dataSources.map((d) => ({ value: String(d.id), label: d.name })), [dataSources]);
  // The sheet follows the app theme. In dark mode the chrome (toolbar, formula bar, tabs, panels,
  // menus) takes the dark palette directly, while the grid is shown through a lightness-flipping
  // filter so cells with their own colours (from Excel files and cell styles) stay readable; the
  // grid palette is pre-filtered so it still looks exactly like the dark theme (sheetTheme.ts).
  const chromeVars = useMemo(() => sheetThemeVariables(token, isDarkMode), [token, isDarkMode]);
  const themeVariables = useMemo(() => (isDarkMode ? forDarkGrid(chromeVars) : chromeVars), [chromeVars, isDarkMode]);
  const sheetStyles = useMemo(() => sheetCss(themeVariables, isDarkMode ? chromeVars : null), [chromeVars, themeVariables, isDarkMode]);
  const markDirty = useCallback(() => setSaveState((s) => (s === 'conflict' || s === 'gone' ? s : 'dirty')), []);
  const redraw = useCallback(() => setRenderKey((k) => k + 1), []);

  // The grid re-renders only when what it shows changes. Rendering it again on every keystroke in
  // the title (and every save-state change) made it take keyboard focus back to the cells.
  const grid = useMemo(
    () => (gridEl && model ? (
      // Rebuilt on a theme switch: the grid reads its colours when it is created. The filler
      // stretches only the grid; IronCalc's tooltips and menus go straight into gridEl.
      <div className="wb-fill">
        <IronCalc key={`${renderKey}-${isDarkMode ? 'dark' : 'light'}`} model={model} canEdit={!readOnly} themeVariables={themeVariables} rootContainer={gridEl} />
      </div>
    ) : null),
    [gridEl, model, readOnly, themeVariables, renderKey, isDarkMode],
  );

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await workbookService.get(workbookId);
      await ensureEngine();
      const m = Model.from_bytes(fromBase64(data.doc), LANGUAGE);
      m.flushSendQueue(); // nothing to save yet
      modelRef.current = m;
      versionRef.current = data.version;
      setWb(data);
      setTitle(data.title);
      setRanges(data.ranges || []);
      const settings = data.settings ?? emptySettings;
      setWbSettings(settings);
      setParamValues(defaultParamValues(settings.parameters));
      setModel(m);
      setSaveState('saved');
      setLoadError(null);
      redraw();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('load_failed'));
    }
  }, [workbookId, redraw, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Save ────────────────────────────────────────────────────────────────
  const saveNow = useCallback(async () => {
    const m = modelRef.current;
    if (!m || !wb || readOnly) return;
    setSaveState('saving');
    try {
      const saved = await workbookService.update(wb.id, {
        title: titleRef.current.trim() || wb.title,
        doc: toBase64(m.toBytes()),
        ranges: rangesRef.current,
        version: versionRef.current,
      });
      versionRef.current = saved.version;
      setSaveProblem(null);
      setSaveState((s) => (s === 'saving' ? 'saved' : s));
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setSaveProblem(typeof status === 'number' && status >= 400 && status < 500 && err instanceof Error ? err.message : null);
      setSaveState(status === 409 ? 'conflict' : status === 404 ? 'gone' : 'error');
    }
  }, [wb, readOnly]);

  // Edits made in the grid show up in the engine's change queue; drain it and save shortly after.
  useEffect(() => {
    if (!model) return;
    const timer = window.setInterval(() => {
      const changes = model.flushSendQueue();
      if (changes.length > 1 && !readOnly) markDirty();
      const v = model.getSelectedView();
      const name = model.getWorksheetsProperties()[v.sheet]?.name ?? 'Sheet1';
      setSelectedRef(cellRef(name, v.row, v.column));
      setGridSelection(selectionFromModel(model, (s) => model.getWorksheetsProperties()[s]?.name ?? 'Sheet1'));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [model, readOnly, markDirty]);

  useEffect(() => {
    if (saveState !== 'dirty' || readOnly) return;
    const timer = window.setTimeout(() => void saveNow(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [saveState, readOnly, saveNow, title, ranges]);

  useEffect(() => {
    if (saveState !== 'error' || saveProblem) return;
    const timer = window.setTimeout(() => void saveNow(), 8000);
    return () => window.clearTimeout(timer);
  }, [saveState, saveProblem, saveNow]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [saveState]);

  // Deleted somewhere else while open (another tab, the list's Delete): nothing typed here is lost.
  const restoreDeleted = useCallback(async () => {
    if (!wb) return;
    try {
      await workbookService.restore(wb.id);
      setSaveState('dirty');
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  }, [wb, message, t]);

  const saveAsNew = useCallback(async () => {
    const m = modelRef.current;
    if (!m || !wb) return;
    try {
      const copy = await workbookService.create({
        title: titleRef.current.trim() || wb.title, project_id: projectId ? String(projectId) : null, timezone: wb.timezone,
      });
      await workbookService.update(copy.id, { doc: toBase64(m.toBytes()), ranges: rangesRef.current, version: copy.version });
      setSaveState('saved');
      router.replace(`/sheets/${copy.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  }, [wb, message, projectId, router, t]);

  // ── Data ranges ─────────────────────────────────────────────────────────
  const sheetName = useCallback((sheet: number) => modelRef.current?.getWorksheetsProperties()[sheet]?.name ?? 'Sheet1', []);

  const activeSheetName = useMemo(() => {
    if (!model) return undefined;
    const idx = model.getSelectedSheet?.() ?? 0;
    return sheetName(idx);
  }, [model, sheetName]);

  const sheetCopilotContext = useMemo(
    () =>
      buildSheetStudioSurfaceContext({
        workbookId,
        title,
        intent: 'ask',
        model,
        ranges,
        sheetName,
        gridSelection,
        selectionA1: selectedRef ?? gridSelection?.label,
        sheetNameActive: activeSheetName,
        parameters: paramValues,
        askSnapshotStale: Boolean(syncedSourceId && saveState === 'dirty'),
        linkedAskDataSourceId: syncedSourceId ?? undefined,
        dataSourceId: syncedSourceId ?? ranges[0]?.data_source_id ?? undefined,
      }),
    [
      workbookId,
      title,
      model,
      ranges,
      sheetName,
      gridSelection,
      selectedRef,
      activeSheetName,
      paramValues,
      syncedSourceId,
      saveState,
      renderKey,
    ],
  );

  const fill = useCallback((m: Model, r: DataRange, columns: string[], rows: unknown[][]): DataRange => {
    clearArea(m, r.sheet, r.row, r.column, r.width, r.height);
    const out = writeTable(m, r.sheet, r.row, r.column, columns, rows);
    return { ...r, width: out.width, height: out.height };
  }, []);

  const refreshRange = useCallback(async (r: DataRange, quiet = false): Promise<DataRange | null> => {
    const m = modelRef.current;
    if (!m || r.mode !== 'live' || !r.data_source_id || !r.sql) return null;
    setRefreshing((prev) => new Set(prev).add(r.id));
    try {
      const res = await runRangeQuery(r.sql, r.data_source_id, projectId ? String(projectId) : null, undefined, paramValuesRef.current);
      const before = r.height;
      const next: DataRange = {
        ...fill(m, r, res.columns, res.rows),
        refreshed_at: new Date().toISOString(), row_count: res.total, truncated: res.total > res.rows.length, pending: false,
      };
      setRanges((prev) => prev.map((x) => (x.id === r.id ? next : x)));
      markDirty();
      redraw();
      if (!quiet && before && before !== next.height) {
        message.info(t('range_rows_changed', { name: r.name || '', before: Math.max(before - 1, 0), after: next.height - 1 }));
      }
      return next;
    } catch (err) {
      if (!quiet) message.error(err instanceof Error ? err.message : t('query_failed'));
      return null;
    } finally {
      setRefreshing((prev) => { const n = new Set(prev); n.delete(r.id); return n; });
    }
  }, [fill, markDirty, message, projectId, redraw, t]);

  const refreshAll = useCallback(async () => {
    const live = rangesRef.current.filter((r) => r.mode === 'live');
    let ok = 0;
    for (const r of live) if (await refreshRange(r, true)) ok += 1;
    if (ok < live.length) message.warning(t('refresh_partial', { ok, total: live.length }));
    else message.success(t('refresh_done', { n: ok }));
  }, [message, refreshRange, t]);

  // Ranges created by "Open as workbook" are filled the first time the owner opens it.
  const seeded = useRef(false);
  useEffect(() => {
    if (!model || !wb || readOnly || seeded.current) return;
    seeded.current = true;
    const pending = rangesRef.current.filter((r) => r.pending);
    if (!pending.length) return;
    void (async () => {
      for (const r of pending) {
        if (r.mode === 'live') {
          await refreshRange(r, true);
          continue;
        }
        let seed: { columns: string[]; rows: unknown[][] } | null = null;
        try {
          const raw = window.sessionStorage.getItem(seedKey(wb.id, r.id));
          seed = raw ? JSON.parse(raw) : null;
          window.sessionStorage.removeItem(seedKey(wb.id, r.id));
        } catch {
          seed = null;
        }
        const next = seed ? fill(model, r, seed.columns, seed.rows) : r;
        setRanges((prev) => prev.map((x) => (x.id === r.id ? { ...next, pending: false, refreshed_at: new Date().toISOString(),
          row_count: seed ? seed.rows.length : 0 } : x)));
      }
      markDirty();
      redraw();
    })();
  }, [model, wb, readOnly, refreshRange, fill, markDirty, redraw]);

  /** Puts a live range at the selected cell, or at `at` (the assistant names its cell). */
  const insertRange = useCallback(async (req: RangeRequest, at?: { sheet: number; row: number; column: number }) => {
    const m = modelRef.current;
    if (!m) return;
    const editing = at ? undefined : dialog?.edit;
    const v = m.getSelectedView();
    const anchor = editing ?? at ?? { sheet: v.sheet, row: v.row, column: v.column };
    const res = await runRangeQuery(req.sql, req.dataSourceId, projectId ? String(projectId) : null, undefined, paramValuesRef.current);
    const box = { sheet: anchor.sheet, row: anchor.row, column: anchor.column, width: res.columns.length, height: res.rows.length + 1 };
    const clash = rangesRef.current.find((r) => r.id !== editing?.id && overlaps(box, r));
    if (clash) throw new Error(t('range_overlaps', { name: clash.name || areaRef(sheetName(clash.sheet), clash) }));
    // Writing over the person's own cells asks first.
    if (!editing) {
      let used = 0;
      for (let c = box.column; c < box.column + box.width; c += 1) {
        used += Array.from(m.getRowsWithData(box.sheet, c)).filter((r) => r >= box.row && r < box.row + box.height).length;
      }
      if (used) {
        const go = await new Promise<boolean>((resolve) => modal.confirm({
          title: t('range_overwrite_title'),
          content: t('range_overwrite_body', { n: used, area: areaRef(sheetName(box.sheet), box) }),
          okText: t('range_overwrite_ok'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }));
        if (!go) return;
      }
    }
    const base: DataRange = editing
      ? { ...editing, data_source_id: req.dataSourceId, source_name: req.sourceName, sql: req.sql, name: req.name }
      : { id: newRangeId(), name: req.name, sheet: box.sheet, row: box.row, column: box.column, width: 0, height: 0, mode: 'live',
          data_source_id: req.dataSourceId, source_name: req.sourceName, sql: req.sql };
    const next: DataRange = {
      ...fill(m, base, res.columns, res.rows),
      refreshed_at: new Date().toISOString(), row_count: res.total, truncated: res.total > res.rows.length, pending: false,
    };
    setRanges((prev) => (editing ? prev.map((x) => (x.id === editing.id ? next : x)) : [...prev, next]));
    setDialog(null);
    setPanelOpen(true);
    markDirty();
    redraw();
    if (next.truncated) message.warning(t('range_truncated', { shown: res.rows.length, total: res.total }));
  }, [dialog, fill, markDirty, message, modal, projectId, redraw, sheetName, t]);

  const goTo = useCallback((r: DataRange) => {
    const m = modelRef.current;
    if (!m) return;
    m.setSelectedSheet(r.sheet);
    m.setSelectedCell(r.row, r.column);
    m.setSelectedRange(r.row, r.column, r.row + Math.max(r.height, 1) - 1, r.column + Math.max(r.width, 1) - 1);
    m.setTopLeftVisibleCell(Math.max(1, r.row - 2), Math.max(1, r.column - 1));
    redraw();
  }, [redraw]);

  const unlinkRange = useCallback((r: DataRange, clear: boolean) => {
    const m = modelRef.current;
    if (!m) return;
    if (clear) clearArea(m, r.sheet, r.row, r.column, r.width, r.height);
    setRanges((prev) => prev.filter((x) => x.id !== r.id));
    markDirty();
    if (clear) redraw();
    message.success(clear ? t('range_deleted') : t('range_unlinked'));
  }, [markDirty, message, redraw, t]);

  // ── Menus ───────────────────────────────────────────────────────────────
  const exportXlsx = async () => {
    try {
      if (saveState === 'dirty' || saveState === 'saving') await saveNow();
      const { blob } = await workbookService.exportXlsx(workbookId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(titleRef.current || 'workbook').replace(/[^\w .-]+/g, '').trim() || 'workbook'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('export_failed'));
    }
  };

  const ensureWorkbookDataSource = useCallback(async (): Promise<string> => {
    if (syncedSourceId) return syncedSourceId;
    if (!wb) throw new Error(t('ai_sync_failed'));
    if (saveState === 'dirty' || saveState === 'saving') await saveNow();
    const result = await workbookService.syncDataSource(wb.id);
    const id = result.data_source_id;
    if (!id) throw new Error(result.message || t('ai_sync_failed'));
    setSyncedSourceId(id);
    persistSelectedDataSourceId(id);
    if (result.deduped_sources && result.deduped_sources > 0) {
      message.info(t('ai_sync_deduped', { count: result.deduped_sources }));
    }
    return id;
  }, [syncedSourceId, wb, saveState, saveNow, t]);

  const visualEmbeds = wbSettings.visual_embeds ?? [];
  const analyzeBindings = (wbSettings.analyze_bindings ?? []) as WorkbookAnalyzeBinding[];

  const persistAnalyzeBindings = useCallback(async (next: WorkbookAnalyzeBinding[]) => {
    if (!wb) return;
    try {
      const res = await workbookService.putSettings(wb.id, { analyze_bindings: next });
      setWbSettings(res.settings);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  }, [wb, message, t]);

  const openAnalyzeBinding = useCallback((binding: WorkbookAnalyzeBinding) => {
    const restore = binding.analyze_binding;
    setAnalyzeRestore(restore);
    setAnalyzeRestoreKey(binding.id);
    setAnalyzeTab(restore.tab ?? 'pivot');
    setPanelOpen(false);
    setAnalyzeOpen(true);
  }, []);

  const persistVisualEmbeds = useCallback(async (next: WorkbookVisualEmbed[]) => {
    if (!wb) return;
    try {
      const res = await workbookService.putSettings(wb.id, { visual_embeds: next });
      setWbSettings(res.settings);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  }, [wb, message, t]);

  const openCopilot = useCallback(async (
    view: 'ask' | 'formula' = 'ask',
    formulaMode: 'write' | 'explain' = 'write',
  ) => {
    setCopilotView(view);
    if (view === 'formula') setFormulaSubMode(formulaMode);
    setCopilotOpen(true);
    if (wb && !readOnly && view === 'ask') {
      try {
        await ensureWorkbookDataSource();
      } catch {
        /* ACC still includes grid tables */
      }
    }
  }, [wb, readOnly, ensureWorkbookDataSource]);

  const handleSyncAi = useCallback(async () => {
    setSyncingAi(true);
    try {
      await ensureWorkbookDataSource();
      message.success(t('ai_sync_success'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('ai_sync_failed'));
    } finally {
      setSyncingAi(false);
    }
  }, [ensureWorkbookDataSource, message, t]);

  const openPipelineAutomation = useCallback(async () => {
    setSyncingAi(true);
    try {
      const id = await ensureWorkbookDataSource();
      router.push(`/pipelines/new?sourceId=${encodeURIComponent(id)}&fresh=1`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('pipeline_automate_failed'));
    } finally {
      setSyncingAi(false);
    }
  }, [ensureWorkbookDataSource, router, message, t]);

  const setVisibility = async (visibility: 'private' | 'project') => {
    if (!wb) return;
    try {
      const saved = await workbookService.update(wb.id, { visibility, version: versionRef.current });
      versionRef.current = saved.version;
      setWb({ ...wb, visibility });
      message.success(visibility === 'project' ? t('shared_project') : t('shared_private'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('save_error'));
    }
  };

  const openAnalyzeFresh = (tab: AnalyzeTab) => {
    setAnalyzeRestore(null);
    setAnalyzeRestoreKey(null);
    setAnalyzeTab(tab);
    setPanelOpen(false);
    setAnalyzeOpen(true);
  };

  const moreItems: MenuProps['items'] = [
    { key: 'export', icon: <DownloadOutlined />, label: t('export_xlsx') },
    ...(ai.available && !readOnly
      ? [{
          key: 'ai_sync',
          icon: <CloudSyncOutlined />,
          label: (
            <span>
              {t('ai_sync_datasource')}
              {syncedSourceId && saveState === 'dirty' ? ` (${t('ai_sync_stale')})` : ''}
            </span>
          ),
          title: t('ai_sync_datasource_tooltip'),
        }]
      : []),
    { type: 'divider' as const },
    { key: 'history', icon: <HistoryOutlined />, label: t('menu_version_history') },
    { key: 'governance', icon: <SafetyCertificateOutlined />, label: t('menu_governance') },
    ...(isEnterpriseEdition() && !readOnly
      ? [{ key: 'schedule', icon: <FieldTimeOutlined />, label: t('menu_schedule_refresh') }]
      : []),
    { type: 'divider' as const },
    { key: 'duplicate', icon: <CopyOutlined />, label: t('duplicate') },
    ...(isEnterpriseEdition() && !readOnly
      ? [{ key: 'pipeline', label: t('pipeline_automate'), title: t('pipeline_automate_menu_hint') }]
      : []),
    ...(wb?.is_owner ? [{ type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, label: t('delete'), danger: true }] : []),
  ];
  const onMore: MenuProps['onClick'] = async ({ key }) => {
    if (!wb) return;
    if (key === 'export') {
      await exportXlsx();
      return;
    }
    if (key === 'pipeline') {
      await openPipelineAutomation();
      return;
    }
    if (key === 'ai_sync') {
      await handleSyncAi();
      return;
    }
    if (key === 'governance') {
      setGovernanceOpen(true);
      return;
    }
    if (key === 'schedule') {
      setScheduleOpen(true);
      return;
    }
    if (key === 'history') {
      if (saveState === 'dirty') await saveNow();
      setHistoryOpen(true);
    }
    if (key === 'duplicate') {
      if (saveState === 'dirty') await saveNow();
      const copy = await workbookService.duplicate(wb.id);
      router.push(`/sheets/${copy.id}`);
    }
    if (key === 'delete') {
      await workbookService.remove(wb.id);
      router.push(`/sheets?deleted=${wb.id}`);
    }
  };

  if (loadError) {
    return <Alert type="error" showIcon message={loadError} action={<Button size="small" onClick={() => void load()}>{t('retry')}</Button>} />;
  }
  if (!wb || !model) return <div className="wb-loading"><Spin /></div>;

  const saveLabel = {
    saved: t('saved'), dirty: t('unsaved'), saving: t('saving'), conflict: t('conflict_short'), error: t('save_error_short'), gone: t('gone_short'),
  }[saveState];
  const liveCount = ranges.filter((r) => r.mode === 'live').length;
  const selectedCell = (() => {
    const v = model.getSelectedView();
    return cellRef(sheetName(v.sheet), v.row, v.column);
  })();

  const saveTone = saveState === 'error' || saveState === 'conflict' || saveState === 'gone' ? 'danger' : 'ok';

  const dataMenu: MenuProps['items'] = [
    ...(!readOnly ? [{ key: 'insert', icon: <ImportOutlined />, label: t('insert_data') }] : []),
    {
      key: 'ranges',
      icon: <DatabaseOutlined />,
      label: (
        <span>
          {t('data_ranges')}{ranges.length ? ` (${ranges.length})` : ''}
        </span>
      ),
    },
    ...(liveCount && !readOnly ? [{ key: 'refresh', icon: <ReloadOutlined />, label: t('refresh_all') }] : []),
  ];
  const onDataMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'insert') setDialog({});
    if (key === 'ranges') setPanelOpen((o) => !o);
    if (key === 'refresh') void refreshAll();
  };

  const analyzeMenu: MenuProps['items'] = [
    { key: 'pivot', icon: <TableOutlined />, label: t('pivot_table') },
    { key: 'chart', icon: <BarChartOutlined />, label: t('chart') },
    ...(ai.available && !readOnly
      ? [
          { key: 'formula', icon: <BulbOutlined />, label: t('formula_button') },
          { key: 'explain_cell', icon: <ReadOutlined />, label: t('formula_explain_menu') },
        ]
      : []),
  ];
  const onAnalyzeMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'formula') {
      void openCopilot('formula', 'write');
      return;
    }
    if (key === 'explain_cell') {
      void openCopilot('formula', 'explain');
      return;
    }
    if (key === 'pivot' || key === 'chart') {
      const sel = model ? selectionFromModel(model, sheetName) : null;
      if (sel) setGridSelection(sel);
      else message.info(key === 'chart' ? t('chart_select_first') : t('pivot_select_first'));
      openAnalyzeFresh(key === 'chart' ? 'chart' : 'pivot');
    }
  };

  return (
    <div className="wb-editor">
      <DocumentToolbar
        title={title}
        titleReadOnly={readOnly}
        titleAriaLabel={t('title_label')}
        titlePlaceholder={t('untitled')}
        onTitleChange={(v) => { setTitle(v); markDirty(); }}
        onTitleBlur={() => { if (!title.trim()) setTitle(wb.title); }}
        saveLabel={readOnly ? undefined : saveLabel}
        saveTone={saveTone}
        saveTooltip={saveState === 'error' ? `${t('save_error')} ${saveProblem || t('save_retrying')}` : undefined}
        viewOnly={readOnly}
        viewOnlyLabel={t('view_only')}
        menuRow={(
          <Space wrap size={8}>
            <Dropdown trigger={['click']} menu={{ items: dataMenu, onClick: onDataMenu }}>
              <Button type={readOnly ? 'default' : 'primary'} icon={<DatabaseOutlined />}>
                {t('menu_data')} <DownOutlined />
              </Button>
            </Dropdown>
            <Space size={4} className="wb-analyze-cluster">
              <Dropdown trigger={['click']} menu={{ items: analyzeMenu, onClick: onAnalyzeMenu }}>
                <Button icon={<BarChartOutlined />}>{t('menu_analyze')} <DownOutlined /></Button>
              </Dropdown>
            </Space>
            {ai.available ? (
              <Tooltip title={tAsk('inline_hint', { label: tAsk('inline_title'), shortcut: inlineAskShortcutLabel() })}>
                <Button icon={<RobotOutlined />} onClick={() => void openCopilot('ask')}>
                  {t('ai_copilot')}
                </Button>
              </Tooltip>
            ) : null}
          </Space>
        )}
        actions={(
          <>
            {wbSettings.parameters.length ? (
              <Space wrap size={4} className="wb-param-bar">
                {wbSettings.parameters.map((p) => (
                  <Input
                    key={p.name}
                    size="small"
                    style={{ width: 120 }}
                    placeholder={p.label || p.name}
                    value={paramValues[p.name] != null ? String(paramValues[p.name]) : ''}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    aria-label={p.name}
                  />
                ))}
              </Space>
            ) : null}
            <DashboardCollabCommentsPanel
              dashboardId={wb.id}
              apiRoot="/api/workbooks"
              open={commentsOpen}
              onOpenChange={setCommentsOpen}
              selectedWidgetId={selectedRef ?? selectedCell}
              widgetTitle={(ref) => ref}
              canModerate={!readOnly}
              triggerSize="middle"
              anchorTerms={{
                attach: (name) => t('comment_attach_cell', { cell: name }),
                on: t('comment_on_cell'),
                only: t('comment_only_cell'),
                selected: t('comment_selected_cell'),
              }}
            />
            {!readOnly ? (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'private', icon: wb.visibility === 'private' ? <CheckOutlined /> : <LockOutlined />, label: t('share_private') },
                    { key: 'project', icon: wb.visibility === 'project' ? <CheckOutlined /> : <TeamOutlined />, label: t('share_project') },
                  ],
                  onClick: ({ key }) => void setVisibility(key as 'private' | 'project'),
                }}
              >
                <Tooltip title={t('share')}>
                  <Button icon={wb.visibility === 'project' ? <TeamOutlined /> : <LockOutlined />} aria-label={t('share')} />
                </Tooltip>
              </Dropdown>
            ) : null}
            <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: onMore }}>
              <Button icon={<MoreOutlined />} aria-label={t('more')} />
            </Dropdown>
          </>
        )}
      />

      {saveState === 'gone' ? (
        <Alert
          type="warning"
          showIcon
          message={t('gone')}
          action={
            <Space>
              <Button size="small" onClick={() => void restoreDeleted()}>{t('gone_restore')}</Button>
              <Button size="small" type="primary" onClick={() => void saveAsNew()}>{t('gone_save_new')}</Button>
            </Space>
          }
        />
      ) : null}
      {saveState === 'conflict' ? (
        <Alert type="warning" showIcon message={t('conflict')} action={<Button size="small" onClick={() => void load()}>{t('reload')}</Button>} />
      ) : null}
      {readOnly ? (
        <Alert type="info" showIcon message={t('read_only')}
          action={<Button size="small" onClick={() => onMore({ key: 'duplicate' } as never)}>{t('make_copy')}</Button>} />
      ) : null}

      {wbSettings.certification.status === 'approved' ? (
        <div className="wb-meta-strip" aria-label={t('meta_strip')}>
          <Text type="success">{t('governance_cert_approved_badge')}</Text>
        </div>
      ) : null}

      <div className={`wb-body${panelOpen || analyzeOpen ? ' wb-body--panel' : ''}${analyzeOpen ? ' wb-body--analyze' : ''}`}>
        <style>{sheetStyles}</style>
        <div
          ref={setGridEl}
          className={`wb-grid${isDarkMode ? ' wb-grid--dark' : ''}`}
          onDoubleClick={() => {
            if (!model || readOnly) return;
            const v = model.getSelectedView();
            const hit = findAnalyzeBindingAt(analyzeBindings, v.sheet, v.row, v.column);
            if (hit) openAnalyzeBinding(hit);
          }}
          onPaste={readOnly ? undefined : (e) => {
            const item = e.clipboardData?.items?.[0];
            if (!item || item.kind !== 'file' || !item.type.startsWith('image/')) return;
            const file = item.getAsFile();
            if (!file || !model) return;
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const v = model.getSelectedView() as { sheet: number; row: number; column: number };
              const embed: WorkbookVisualEmbed = {
                id: newVisualEmbedId(),
                kind: 'image',
                sheet_index: v.sheet,
                row: v.row,
                column: v.column,
                width: 320,
                height: 200,
                payload: { src: String(reader.result), alt: file.name },
              };
              void persistVisualEmbeds([...visualEmbeds, embed]);
            };
            reader.readAsDataURL(file);
          }}
        >
          {grid}
          <SheetVisualEmbeds
            embeds={visualEmbeds}
            activeSheetIndex={model?.getSelectedSheet?.() ?? 0}
            gridHost={gridEl}
            readOnly={readOnly}
            onRemove={(id) => void persistVisualEmbeds(visualEmbeds.filter((x) => x.id !== id))}
            onOpenChart={(embed) => {
              if (readOnly) return;
              const binding = embed.payload.analyzeBinding as SheetAnalyzeRestore | undefined;
              if (!binding) {
                message.info(t('chart_embed_legacy'));
                return;
              }
              setAnalyzeRestore(binding);
              setAnalyzeRestoreKey(embed.id);
              setAnalyzeTab(binding.tab ?? 'chart');
              setPanelOpen(false);
              setAnalyzeOpen(true);
            }}
          />
        </div>
        {analyzeOpen ? (
          <SheetAnalyzePanel
            tab={analyzeTab}
            onTabChange={setAnalyzeTab}
            onClose={() => {
              setAnalyzeOpen(false);
              setAnalyzeRestore(null);
              setAnalyzeRestoreKey(null);
            }}
            restore={analyzeRestore}
            restoreKey={analyzeRestoreKey}
            model={model}
            ranges={ranges}
            sheetName={sheetName}
            gridSelection={gridSelection}
            readOnly={readOnly}
            workbookId={wb.id}
            workbookTitle={title || wb.title}
            onTableInserted={(anchor) => {
              markDirty();
              redraw();
              const m = modelRef.current;
              if (!m || !anchor) return;
              m.setSelectedSheet(anchor.sheet);
              m.setSelectedCell(anchor.row, anchor.column);
              m.setSelectedRange(
                anchor.row,
                anchor.column,
                anchor.row + Math.max(anchor.height, 1) - 1,
                anchor.column + Math.max(anchor.width, 1) - 1,
              );
              m.setTopLeftVisibleCell(Math.max(1, anchor.row - 1), Math.max(1, anchor.column - 1));
            }}
            onRefreshRange={async (r) => {
              await refreshRange(r);
              redraw();
            }}
            onPivotInserted={({ sheet, row, column, width, height, analyzeBinding }) => {
              const entry: WorkbookAnalyzeBinding = {
                id: newAnalyzeBindingId(),
                kind: 'pivot',
                sheet_index: sheet,
                row,
                column,
                width,
                height,
                analyze_binding: analyzeBinding,
              };
              const withoutOverlap = analyzeBindings.filter(
                (b) =>
                  !(
                    b.sheet_index === sheet
                    && b.row === row
                    && b.column === column
                  ),
              );
              void persistAnalyzeBindings([...withoutOverlap, entry]);
            }}
            onInsertVisualChart={({ chartType, chartData, title, placement, analyzeBinding }) => {
              if (!model) return;
              const { sheet, row, column } = resolveSheetWriteAnchor(model, placement, gridSelection, t('chart'));
              const embed: WorkbookVisualEmbed = {
                id: newVisualEmbedId(),
                kind: 'chart',
                sheet_index: sheet,
                row,
                column,
                width: 440,
                height: 280,
                payload: { chartType, chartData, title, analyzeBinding },
              };
              void persistVisualEmbeds([...visualEmbeds, embed]);
            }}
          />
        ) : null}
        {panelOpen && !analyzeOpen ? (
          <DataRangesPanel
            ranges={ranges}
            sheetName={sheetName}
            refreshing={refreshing}
            readOnly={readOnly}
            onClose={() => setPanelOpen(false)}
            onGoTo={goTo}
            onRefresh={(r) => void refreshRange(r)}
            onEdit={(r) => setDialog({ edit: r })}
            onUnlink={unlinkRange}
            empty={!readOnly ? (
              <Empty description={t('ranges_empty')}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setDialog({})}>{t('insert_data')}</Button>
              </Empty>
            ) : <Empty description={t('ranges_empty_view')} />}
          />
        ) : null}
      </div>

      <DataRangeDialog
        open={dialog !== null}
        anchorLabel={dialog?.edit ? areaRef(sheetName(dialog.edit.sheet), dialog.edit) : selectedCell}
        dataSources={sourceOptions}
        defaultSourceId={ranges[ranges.length - 1]?.data_source_id ?? null}
        aiAvailable={ai.available}
        initial={dialog?.edit && dialog.edit.data_source_id && dialog.edit.sql ? {
          dataSourceId: dialog.edit.data_source_id, sourceName: dialog.edit.source_name ?? '', sql: dialog.edit.sql, name: dialog.edit.name ?? '',
        } : null}
        onCancel={() => setDialog(null)}
        onSubmit={insertRange}
      />
      <WorkbookHistoryDrawer
        open={historyOpen}
        workbookId={wb.id}
        canRestore={!readOnly}
        themeVariables={themeVariables}
        dark={isDarkMode}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => void load()}
      />
      <WorkbookGovernanceDrawer
        open={governanceOpen}
        workbookId={wb.id}
        canEdit={!readOnly}
        settings={wbSettings}
        onClose={() => setGovernanceOpen(false)}
        onSettingsChange={(s) => {
          setWbSettings(s);
          setParamValues((prev) => ({ ...defaultParamValues(s.parameters), ...prev }));
        }}
      />
      <WorkbookScheduleDialog
        open={scheduleOpen}
        workbookId={wb.id}
        canEdit={!readOnly}
        defaultRunParameters={paramValues}
        onClose={() => setScheduleOpen(false)}
        onAfterRun={() => void load()}
      />
      <SurfaceInlineAsk
        open={inlineAskOpen}
        anchor={gridEl}
        scopeLabel={gridSelection?.label ?? selectedCell}
        onClose={() => setInlineAskOpen(false)}
        onSubmit={(question: string) => {
          setPendingQuestion({
            id: Date.now(),
            text: tAsk('inline_question', { scope: gridSelection?.label ?? selectedCell, question }),
          });
          setCopilotView('ask');
          setCopilotOpen(true);
        }}
      />
      <SurfaceCopilotDrawer
        title={t('ai_copilot')}
        open={copilotOpen}
        pendingQuestion={pendingQuestion}
        onClose={() => setCopilotOpen(false)}
        width={400}
        placeholder={tSurface('workbook_cleaning_hint')}
        surfaceContext={sheetCopilotContext}
        projectId={wb?.project_id ?? (projectId != null ? String(projectId) : undefined)}
        dataSourceId={syncedSourceId ?? ranges[0]?.data_source_id ?? undefined}
        copilotView={copilotView}
        onCopilotViewChange={setCopilotView}
        formulaSubMode={formulaSubMode}
        sheetFormula={
          ai.available && !readOnly
            ? {
                model,
                ranges,
                sheetName,
                activeCellLabel: selectedCell,
                workbookId: String(wb.id),
                onSheetChanged: () => {
                  markDirty();
                  redraw();
                },
                onCellNotePosted: () => setCommentsOpen(true),
              }
            : undefined
        }
        onApplyActions={async (actions: SurfaceAgentAction[]) => {
          const m = modelRef.current;
          const change = actions.find((a): a is SurfaceSheetChanges => a.type === 'sheet_changes');
          if (!m || !change) return undefined;
          // One undo for the whole set: the workbook, its live ranges and charts as they were.
          const before = { doc: m.toBytes(), ranges: rangesRef.current, embeds: visualEmbeds };
          const n = await applySheetChanges(change, {
            model: m,
            insertRangeAt: (req, at) => insertRange(req, at),
            sourceName: (id) => sourceOptions.find((o) => o.value === id)?.label ?? '',
            visualEmbeds,
            persistVisualEmbeds,
          });
          if (!n) return undefined;
          m.evaluate();
          markDirty();
          redraw();
          message.success(t('ai_actions_applied', { count: n }));
          return async () => {
            const restored = Model.from_bytes(before.doc, LANGUAGE);
            modelRef.current = restored;
            setModel(restored);
            setRanges(before.ranges);
            await persistVisualEmbeds(before.embeds);
            markDirty();
            redraw();
          };
        }}
      />
    </div>
  );
}
