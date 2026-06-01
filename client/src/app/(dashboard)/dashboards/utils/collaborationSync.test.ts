import { describe, expect, it } from 'vitest';
import {
  computeCollabChanges,
  computeLayoutChanged,
  peerCountFromActiveUsers,
  shouldApplyRemoteLayout,
  shouldApplyRemoteWidget,
  stripTransientWidgetFields,
  widgetReadyForCollab,
} from './collaborationSync';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

const baseWidget = (overrides: Partial<WidgetInstance> = {}): WidgetInstance => ({
  id: 'widget-abc',
  title: 'Sales',
  chartType: 'bar',
  chartId: 'abc',
  ...overrides,
});

describe('collaborationSync', () => {
  it('strips transient fetch fields before diffing', () => {
    const widget = baseWidget({ chartData: { x: [1], y: [2] }, isLoading: true, error: 'x' });
    const stripped = stripTransientWidgetFields(widget);
    expect(stripped.chartData).toBeUndefined();
    expect(stripped.isLoading).toBeUndefined();
    expect(stripped.title).toBe('Sales');
  });

  it('requires chartId for data widgets before broadcasting', () => {
    expect(widgetReadyForCollab(baseWidget({ chartId: 'abc' }))).toBe(true);
    expect(widgetReadyForCollab(baseWidget({ chartId: undefined }))).toBe(false);
    expect(widgetReadyForCollab(baseWidget({ chartType: 'text', chartId: undefined }))).toBe(true);
  });

  it('detects add/remove/update changes', () => {
    const prev = [baseWidget()];
    const added = [...prev, baseWidget({ id: 'widget-def', chartId: 'def', title: 'Profit' })];
    const changes = computeCollabChanges(prev, added, [{ i: 'widget-def', x: 0, y: 0, w: 4, h: 4 }]);
    expect(changes.some((c) => c.type === 'add')).toBe(true);

    const removed = computeCollabChanges(added, prev, []);
    expect(removed.some((c) => c.type === 'remove')).toBe(true);

    const updated = computeCollabChanges(prev, [baseWidget({ title: 'Revenue' })], []);
    expect(updated.some((c) => c.type === 'update' && c.changes.title === 'Revenue')).toBe(true);
  });

  it('detects layout moves', () => {
    const prev = [{ i: 'widget-abc', x: 0, y: 0, w: 4, h: 4 }];
    const moved = [{ i: 'widget-abc', x: 2, y: 0, w: 4, h: 4 }];
    expect(computeLayoutChanged(prev, moved)).toBe(true);
    expect(computeLayoutChanged(prev, prev)).toBe(false);
  });

  it('counts peers excluding self', () => {
    expect(
      peerCountFromActiveUsers(
        [{ user_id: 'me' }, { user_id: 'other' }],
        'me',
      ),
    ).toBe(1);
  });

  it('applies LWW widget and layout timestamps', () => {
    expect(shouldApplyRemoteWidget({ id: 'w1', title: 'A', chartType: 'bar', collabTs: 100 }, 150)).toBe(true);
    expect(shouldApplyRemoteWidget({ id: 'w1', title: 'A', chartType: 'bar', collabTs: 200 }, 150)).toBe(false);
    expect(shouldApplyRemoteLayout(100, 150)).toBe(true);
    expect(shouldApplyRemoteLayout(200, 150)).toBe(false);
  });
});
