/**
 * Canonical dashboard build SSE events — shared by /chat analyze stream and Studio build stream.
 */

export type DashboardBuildWidget = {
  index: number;
  title: string;
  chart_type: string;
  status?: string;
  error?: string;
  chart_id?: string;
  preview?: Record<string, unknown>; // executed chart data ({x, y, series}) for the in-chat thumbnail
  chart_query?: Record<string, unknown>; // widget query, passed to WidgetRenderer alongside preview data
};

export type DashboardBuildProgress = {
  active: boolean;
  dashboard_id?: string;
  dashboard_name?: string;
  status?: string;
  stage?: string;
  message?: string;
  percent?: number;
  target_widgets?: number;
  widget_count?: number;
  widgets_ready?: DashboardBuildWidget[];
  sections?: Array<{ title?: string; chart_type?: string }>;
  page_id?: string;
};

export type DashboardBuildPartialResults = {
  dashboard_created?: Record<string, unknown>;
  dashboard_kpi_plan?: Record<string, unknown>;
  dashboard_widgets_ready?: DashboardBuildWidget[];
  dashboard_build?: Record<string, unknown>;
  dashboard_build_progress?: DashboardBuildProgress;
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function getDashboardStreamEventType(raw: Record<string, unknown>): string {
  return String(raw.type ?? raw.event_type ?? '');
}

export function isDashboardBuildStreamEvent(raw: Record<string, unknown>): boolean {
  const t = getDashboardStreamEventType(raw);
  return (
    t === 'dashboard_kpi_plan' ||
    t === 'dashboard_build_started' ||
    t === 'dashboard_build_progress' ||
    t === 'dashboard_widget_ready' ||
    t === 'dashboard_widget_failed' ||
    Boolean(raw.dashboard_kpi_plan)
  );
}

export function isTerminalDashboardBuildStatus(status: unknown): boolean {
  return status === 'complete' || status === 'failed';
}

export function mergeDashboardWidgetReady(
  prevReady: DashboardBuildWidget[],
  raw: Record<string, unknown>,
  eventType: string,
): DashboardBuildWidget[] {
  const widgetStatus =
    eventType === 'dashboard_widget_failed' ? 'failed' : String(raw.status || 'ready');
  const widgetIndex = Number(raw.widget_index ?? raw.index ?? prevReady.length);
  const entry: DashboardBuildWidget = {
    index: widgetIndex,
    title: String(raw.title || 'Widget'),
    chart_type: String(raw.chart_type || 'bar'),
    status: widgetStatus,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    chart_id: typeof raw.chart_id === 'string' ? raw.chart_id : undefined,
  };
  return [...prevReady.filter((w) => w.index !== widgetIndex), entry].sort(
    (a, b) => a.index - b.index,
  );
}

export function sessionPayloadToProgress(raw: Record<string, unknown>): DashboardBuildProgress {
  const status = raw.status as string | undefined;
  return {
    active: Boolean(raw.active ?? status === 'building'),
    dashboard_id: raw.dashboard_id != null ? String(raw.dashboard_id) : undefined,
    dashboard_name: typeof raw.dashboard_name === 'string' ? raw.dashboard_name : undefined,
    status,
    stage: typeof raw.stage === 'string' ? raw.stage : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    percent: typeof raw.percent === 'number' ? raw.percent : Number(raw.percent ?? 0),
    target_widgets:
      typeof raw.target_widgets === 'number'
        ? raw.target_widgets
        : Number(raw.target_widgets ?? 0) || undefined,
    widget_count:
      typeof raw.widget_count === 'number'
        ? raw.widget_count
        : Number(raw.widget_count ?? 0) || undefined,
    widgets_ready: Array.isArray(raw.widgets_ready)
      ? (raw.widgets_ready as DashboardBuildWidget[])
      : [],
    sections: Array.isArray(raw.sections)
      ? (raw.sections as Array<{ title?: string; chart_type?: string }>)
      : [],
    page_id: raw.page_id != null ? String(raw.page_id) : undefined,
  };
}

/** Apply a dashboard SSE event to Studio build progress state. */
export function applyDashboardBuildProgressEvent(
  prev: DashboardBuildProgress | null,
  raw: unknown,
): DashboardBuildProgress | null {
  const event = asRecord(raw);
  if (!event) return prev;

  const eventType = getDashboardStreamEventType(event);

  if (eventType === 'dashboard_build_progress' || eventType === 'dashboard_build_started') {
    const next = sessionPayloadToProgress(event);
    if (prev?.widgets_ready?.length && !next.widgets_ready?.length) {
      next.widgets_ready = prev.widgets_ready;
    }
    if (prev?.sections?.length && !next.sections?.length) {
      next.sections = prev.sections;
    }
    return next;
  }

  if (eventType === 'dashboard_widget_ready' || eventType === 'dashboard_widget_failed') {
    const base = prev ?? sessionPayloadToProgress({ active: true, dashboard_id: event.dashboard_id });
    const widgets_ready = mergeDashboardWidgetReady(base.widgets_ready ?? [], event, eventType);
    const readyCount = widgets_ready.filter((w) => w.status !== 'failed').length;
    const target = base.target_widgets ?? base.sections?.length ?? 0;
    const percent =
      target > 0 ? Math.min(95, 20 + (readyCount / target) * 70) : base.percent ?? 0;
    return {
      ...base,
      widgets_ready,
      percent,
      active: !isTerminalDashboardBuildStatus(base.status),
    };
  }

  if (eventType === 'dashboard_kpi_plan' || event.dashboard_kpi_plan) {
    const plan = asRecord(event.dashboard_kpi_plan) ?? event;
    const sections = Array.isArray(plan.sections)
      ? (plan.sections as Array<{ title?: string; chart_type?: string }>)
      : prev?.sections;
    return {
      ...(prev ?? { active: true }),
      active: prev?.active ?? true,
      target_widgets: Number(plan.section_count ?? sections?.length ?? prev?.target_widgets ?? 0) || undefined,
      sections,
    };
  }

  return prev;
}

/** Apply dashboard SSE events into chat partial_results (same events as Studio stream). */
export function applyDashboardBuildPartialResults(
  prev: DashboardBuildPartialResults,
  raw: unknown,
): DashboardBuildPartialResults {
  const event = asRecord(raw);
  if (!event) return prev;

  const eventType = getDashboardStreamEventType(event);
  let next: DashboardBuildPartialResults = { ...prev };

  if (eventType === 'dashboard_widget_ready' || eventType === 'dashboard_widget_failed') {
    const prevReady = (prev.dashboard_widgets_ready as DashboardBuildWidget[]) || [];
    const nextReady = mergeDashboardWidgetReady(prevReady, event, eventType);
    const plan = prev.dashboard_kpi_plan;
    const planSections = Array.isArray(plan?.sections) ? [...(plan!.sections as unknown[])] : [];
    const widgetIndex = Number(event.widget_index ?? event.index ?? prevReady.length);
    if (planSections.length > widgetIndex) {
      planSections[widgetIndex] = {
        ...(planSections[widgetIndex] as object),
        status: eventType === 'dashboard_widget_failed' ? 'failed' : 'ready',
        title: event.title ?? (planSections[widgetIndex] as { title?: string })?.title,
      };
    }
    next = {
      ...next,
      dashboard_widgets_ready: nextReady,
      dashboard_kpi_plan: plan
        ? { ...plan, sections: planSections.length ? planSections : plan.sections }
        : prev.dashboard_kpi_plan,
    };
  } else if (eventType === 'dashboard_kpi_plan' || event.dashboard_kpi_plan) {
    const plan = asRecord(event.dashboard_kpi_plan) ?? event;
    next = { ...next, dashboard_kpi_plan: plan };
  } else if (eventType === 'dashboard_build_started' || event.dashboard_build) {
    const build = asRecord(event.dashboard_build) ?? event;
    const dashboardId = build.dashboard_id;
    next = {
      ...next,
      dashboard_build: build,
      dashboard_created: dashboardId
        ? {
            dashboard_id: String(dashboardId),
            page_id: build.page_id,
            dashboard_name: build.dashboard_name,
            status: build.status || 'building',
            widget_count: 0,
          }
        : prev.dashboard_created,
    };
  } else if (eventType === 'dashboard_build_progress') {
    const progress = sessionPayloadToProgress(event);
    next = {
      ...next,
      dashboard_build_progress: progress,
      dashboard_created: progress.dashboard_id
        ? {
            ...(prev.dashboard_created ?? {}),
            dashboard_id: progress.dashboard_id,
            page_id: progress.page_id ?? prev.dashboard_created?.page_id,
            dashboard_name: progress.dashboard_name ?? prev.dashboard_created?.dashboard_name,
            status: progress.status ?? 'building',
            widget_count: progress.widget_count ?? prev.dashboard_created?.widget_count ?? 0,
          }
        : prev.dashboard_created,
    };
    if (progress.widgets_ready?.length) {
      next.dashboard_widgets_ready = progress.widgets_ready;
    }
  }

  return next;
}
