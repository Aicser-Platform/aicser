import type { LayoutItem, WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';

const TRANSIENT_WIDGET_KEYS = new Set([
  'chartData',
  'isLoading',
  'error',
  'lastFetchedQueryHash',
  'collabTs',
]);

export type CollabWidgetChange =
  | { type: 'add'; widget: WidgetInstance; layout?: LayoutItem }
  | { type: 'remove'; id: string; widget?: WidgetInstance }
  | { type: 'update'; id: string; changes: Partial<WidgetInstance>; collabTs: number };

export function stampCollabTs(): number {
  return Date.now();
}

export function shouldApplyRemoteWidget(
  localWidget: WidgetInstance | undefined,
  incomingTs: number,
): boolean {
  if (!localWidget) return true;
  return incomingTs >= (localWidget.collabTs ?? 0);
}

export function shouldApplyRemoteLayout(localTs: number, incomingTs: number): boolean {
  return incomingTs >= localTs;
}

export function mergeRemoteWidgetChanges(
  localWidget: WidgetInstance,
  changes: Partial<WidgetInstance>,
  incomingTs: number,
): WidgetInstance | null {
  if (!shouldApplyRemoteWidget(localWidget, incomingTs)) return null;
  const { collabTs: _ignored, ...rest } = changes;
  return { ...localWidget, ...rest, collabTs: incomingTs };
}

export function stripTransientWidgetFields(widget: WidgetInstance): Partial<WidgetInstance> {
  const out: Record<string, unknown> = { ...widget };
  TRANSIENT_WIDGET_KEYS.forEach((key) => delete out[key]);
  return out as Partial<WidgetInstance>;
}

export function widgetReadyForCollab(widget: WidgetInstance): boolean {
  if (!widget?.id) return false;
  const nonData = ['text', 'slicer', 'divider', 'image', 'embed'].includes(widget.chartType || '');
  return nonData || Boolean(widget.chartId);
}

export function computeCollabChanges(
  prevWidgets: WidgetInstance[],
  currentWidgets: WidgetInstance[],
  layout: LayoutItem[],
): CollabWidgetChange[] {
  const changes: CollabWidgetChange[] = [];

  currentWidgets.forEach((widget) => {
    if (!widget.id || !widgetReadyForCollab(widget)) return;
    const existed = prevWidgets.find((p) => p.id === widget.id);
    if (!existed) {
      const layoutItem = layout.find((l) => l.i === widget.id);
      changes.push({ type: 'add', widget, layout: layoutItem });
    }
  });

  prevWidgets.forEach((widget) => {
    if (!widget.id) return;
    const stillThere = currentWidgets.find((c) => c.id === widget.id);
    if (!stillThere && widgetReadyForCollab(widget)) {
      changes.push({ type: 'remove', id: widget.id, widget });
    }
  });

  currentWidgets.forEach((widget) => {
    if (!widget.id || !widgetReadyForCollab(widget)) return;
    const prevWidget = prevWidgets.find((p) => p.id === widget.id);
    if (!prevWidget) return;

    const prevStable = stripTransientWidgetFields(prevWidget as WidgetInstance);
    const nextStable = stripTransientWidgetFields(widget);
    if (JSON.stringify(prevStable) !== JSON.stringify(nextStable)) {
      changes.push({ type: 'update', id: widget.id, changes: nextStable, collabTs: stampCollabTs() });
    }
  });

  return changes;
}

export function computeLayoutChanged(prev: LayoutItem[], next: LayoutItem[]): boolean {
  if (prev.length !== next.length) return true;
  const prevById = new Map(prev.map((l) => [l.i, l]));
  return next.some((item) => {
    const old = prevById.get(item.i);
    if (!old) return true;
    return (
      old.x !== item.x ||
      old.y !== item.y ||
      old.w !== item.w ||
      old.h !== item.h ||
      old.pageId !== item.pageId
    );
  });
}

export function peerCountFromActiveUsers(
  activeUsers: Array<{ user_id?: string; id?: string }> | undefined,
  selfId?: string | null,
): number {
  if (!activeUsers?.length) return 0;
  const others = activeUsers.filter((u) => {
    const uid = u.user_id || u.id;
    return uid && uid !== selfId;
  });
  return others.length;
}
