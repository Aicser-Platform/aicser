'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, App, Badge, Button, Dropdown, Empty, Input, Space, Spin, Tag, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  CheckOutlined, CloudSyncOutlined, CopyOutlined, DatabaseOutlined, DeleteOutlined, DownloadOutlined, HistoryOutlined,
  LockOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, TeamOutlined,
} from '@ant-design/icons';
import { IronCalc, Model, init } from '@ironcalc/workbook';
import '@ironcalc/workbook/style.css';
import { useDataSources } from '@/hooks/useDataSources';
import { useAiAvailability } from '@/hooks/useAiAvailability';
import { useProjectStore } from '@/stores/useProjectStore';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { fromBase64, toBase64, workbookService, type DataRange, type Workbook } from '@/services/workbookService';
import { DashboardCollabCommentsPanel } from '../../dashboards/components/DashboardCollabCommentsPanel';
import '../../dashboards/styles/comments.css';
import { clearArea, writeTable } from './cellEncoding';
import { DataRangeDialog, type RangeRequest } from './DataRangeDialog';
import { DataRangesPanel } from './DataRangesPanel';
import { FormulaAssistant } from './FormulaAssistant';
import { WorkbookHistoryDrawer } from './WorkbookHistoryDrawer';
import { areaRef, cellRef, newRangeId, overlaps, runRangeQuery, seedKey } from './sheetData';
import { forDarkGrid, sheetCss, sheetThemeVariables } from './sheetTheme';
import '../sheets.css';

const { Text } = Typography;
const LANGUAGE = 'en';
const POLL_MS = 800;
const SAVE_DELAY_MS = 1500;

let wasmReady: Promise<unknown> | null = null;
function ensureEngine() {
  wasmReady ??= init();
  return wasmReady;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'gone';

export function WorkbookEditor({ workbookId }: { workbookId: string }) {
  const t = useTranslations('sheets');
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
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);

  const modelRef = useRef<Model | null>(null);
  const versionRef = useRef(0);
  const rangesRef = useRef<DataRange[]>([]);
  rangesRef.current = ranges;
  const titleRef = useRef('');
  titleRef.current = title;
  const readOnly = wb ? !wb.is_owner : true;

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
      const res = await runRangeQuery(r.sql, r.data_source_id, projectId ? String(projectId) : null);
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

  const insertRange = useCallback(async (req: RangeRequest) => {
    const m = modelRef.current;
    if (!m) return;
    const editing = dialog?.edit;
    const v = m.getSelectedView();
    const anchor = editing ?? { sheet: v.sheet, row: v.row, column: v.column };
    const res = await runRangeQuery(req.sql, req.dataSourceId, projectId ? String(projectId) : null);
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

  const moreItems: MenuProps['items'] = [
    { key: 'history', icon: <HistoryOutlined />, label: t('version_history') },
    { key: 'duplicate', icon: <CopyOutlined />, label: t('duplicate') },
    ...(wb?.is_owner ? [{ type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, label: t('delete'), danger: true }] : []),
  ];
  const onMore: MenuProps['onClick'] = async ({ key }) => {
    if (!wb) return;
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

  return (
    <div className="wb-editor">
      <div className="wb-toolbar">
        <div className="wb-toolbar__title">
          <Input
            variant="borderless"
            className="wb-title"
            value={title}
            readOnly={readOnly}
            maxLength={200}
            aria-label={t('title_label')}
            onChange={(e) => { setTitle(e.target.value); markDirty(); }}
            onBlur={() => { if (!title.trim()) { setTitle(wb.title); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
          />
          <Tooltip title={saveState === 'error' ? `${t('save_error')} ${saveProblem || t('save_retrying')}` : undefined}>
            <Text type={saveState === 'error' || saveState === 'conflict' || saveState === 'gone' ? 'danger' : 'secondary'} className="wb-save-state" aria-live="polite">
              {!readOnly ? <><CloudSyncOutlined /> {saveLabel}</> : <Tag bordered={false}>{t('view_only')}</Tag>}
            </Text>
          </Tooltip>
        </div>
        <Space size={8} wrap>
          {!readOnly ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDialog({})}>{t('insert_data')}</Button>
          ) : null}
          {ai.available && !readOnly ? (
            <FormulaAssistant model={model} ranges={ranges} sheetName={sheetName} onChanged={() => { markDirty(); redraw(); }} />
          ) : null}
          <Badge count={ranges.length} size="small" offset={[-4, 4]} color={token.colorPrimary}>
            <Button icon={<DatabaseOutlined />} onClick={() => setPanelOpen((o) => !o)} aria-pressed={panelOpen}>{t('data_ranges')}</Button>
          </Badge>
          {liveCount && !readOnly ? (
            <Tooltip title={t('refresh_all_help')}>
              <Button icon={<ReloadOutlined />} loading={refreshing.size > 0} onClick={() => void refreshAll()}>{t('refresh_all')}</Button>
            </Tooltip>
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
              <Button icon={wb.visibility === 'project' ? <TeamOutlined /> : <LockOutlined />}>{t('share')}</Button>
            </Dropdown>
          ) : null}
          <Button icon={<DownloadOutlined />} onClick={() => void exportXlsx()}>{t('export_xlsx')}</Button>
          <Dropdown trigger={['click']} menu={{ items: moreItems, onClick: onMore }}>
            <Button icon={<MoreOutlined />} aria-label={t('more')} />
          </Dropdown>
        </Space>
      </div>

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

      <div className={`wb-body${panelOpen ? ' wb-body--panel' : ''}`}>
        <style>{sheetStyles}</style>
        <div ref={setGridEl} className={`wb-grid${isDarkMode ? ' wb-grid--dark' : ''}`}>
          {/* IronCalc themes and scopes itself to its root; without one it takes over <body>. */}
          {grid}
        </div>
        {panelOpen ? (
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
    </div>
  );
}
