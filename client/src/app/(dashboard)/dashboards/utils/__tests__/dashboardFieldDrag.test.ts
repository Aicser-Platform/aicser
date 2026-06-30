import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FIELD_DRAG_MIME,
  getDashboardFieldDragData,
  isDashboardFieldDrag,
  setDashboardFieldDragData,
} from '../dashboardFieldDrag';

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() {
      return Array.from(values.keys());
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
  } as unknown as DataTransfer;
}

describe('dashboard field drag payloads', () => {
  it('serializes and reads a dragged dashboard field', () => {
    const dataTransfer = createDataTransfer();

    setDashboardFieldDragData(dataTransfer, {
      dataSourceId: 'source-1',
      tableName: 'orders',
      tableId: 'public.orders',
      columnName: 'total',
      columnType: 'decimal',
      label: 'orders.total',
    });

    expect(isDashboardFieldDrag(dataTransfer)).toBe(true);
    expect(dataTransfer.getData('text/plain')).toBe('total');
    expect(dataTransfer.getData(DASHBOARD_FIELD_DRAG_MIME)).toContain('orders.total');
    expect(getDashboardFieldDragData(dataTransfer)).toEqual({
      dataSourceId: 'source-1',
      tableName: 'orders',
      tableId: 'public.orders',
      columnName: 'total',
      columnType: 'decimal',
      label: 'orders.total',
    });
  });

  it('rejects malformed payloads', () => {
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(DASHBOARD_FIELD_DRAG_MIME, '{"columnName":"missing source"}');

    expect(getDashboardFieldDragData(dataTransfer)).toBeNull();
  });
});
