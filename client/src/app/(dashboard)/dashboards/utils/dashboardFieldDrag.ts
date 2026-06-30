export const DASHBOARD_FIELD_DRAG_MIME = 'application/x-aicser-dashboard-field';

export type DashboardFieldDragPayload = {
  dataSourceId: string;
  tableName?: string;
  tableId?: string;
  columnName: string;
  columnType?: string;
  label?: string;
};

export function setDashboardFieldDragData(
  dataTransfer: DataTransfer,
  payload: DashboardFieldDragPayload,
) {
  const serialized = JSON.stringify(payload);
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(DASHBOARD_FIELD_DRAG_MIME, serialized);
  dataTransfer.setData('text/plain', payload.columnName);
}

export function getDashboardFieldDragData(dataTransfer: DataTransfer): DashboardFieldDragPayload | null {
  const serialized = dataTransfer.getData(DASHBOARD_FIELD_DRAG_MIME);
  if (!serialized) return null;

  try {
    const payload = JSON.parse(serialized) as Partial<DashboardFieldDragPayload>;
    if (!payload.dataSourceId || !payload.columnName) return null;
    return {
      dataSourceId: String(payload.dataSourceId),
      tableName: payload.tableName ? String(payload.tableName) : undefined,
      tableId: payload.tableId ? String(payload.tableId) : undefined,
      columnName: String(payload.columnName),
      columnType: payload.columnType ? String(payload.columnType) : undefined,
      label: payload.label ? String(payload.label) : undefined,
    };
  } catch {
    return null;
  }
}

export function isDashboardFieldDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(DASHBOARD_FIELD_DRAG_MIME);
}
