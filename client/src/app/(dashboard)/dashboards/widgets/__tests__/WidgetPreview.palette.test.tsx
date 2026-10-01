import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { WidgetInstance } from '../../stores/useDashboardStore';
import { useDashboardStore } from '../../stores/useDashboardStore';
import { WidgetPreview } from '../WidgetPreview';
import { DashboardPaletteProvider } from '../DashboardPaletteContext';

const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));

let lastConfig: Record<string, unknown> | null = null;

vi.mock('../WidgetRenderer', () => ({
  WidgetRenderer: ({ config }: { config: Record<string, unknown> }) => {
    lastConfig = config;
    return null;
  },
}));

const widget = (colorPalette?: string): WidgetInstance =>
  ({ id: 'w1', title: 'Sales', chartType: 'bar', chartOptions: colorPalette ? { colorPalette } : {} }) as WidgetInstance;

describe('WidgetPreview palette scope', () => {
  beforeEach(() => {
    lastConfig = null;
    // The studio has another dashboard open with a warm theme.
    useDashboardStore.setState({
      activeDashboardId: 'studio-dash',
      dashboards: [{ id: 'studio-dash', config: { default_color_palette: 'warm' } }] as never,
    });
  });

  it("never borrows the studio's active dashboard palette (feed posts, other dashboards)", () => {
    render(<WidgetPreview widget={widget('inherit')} readOnly />);
    expect(lastConfig?.colorPalette).toBe('default');
    expect(lastConfig?.__paletteChosen).toBe(true);
  });

  it('uses the palette of the dashboard it is drawn in', () => {
    render(
      <DashboardPaletteProvider palette="cool">
        <WidgetPreview widget={widget('inherit')} readOnly />
      </DashboardPaletteProvider>,
    );
    expect(lastConfig?.colorPalette).toBe('cool');
  });

  it("keeps a chart's own explicit palette over the dashboard's", () => {
    render(
      <DashboardPaletteProvider palette="cool">
        <WidgetPreview widget={widget('nature')} readOnly />
      </DashboardPaletteProvider>,
    );
    expect(lastConfig?.colorPalette).toBe('nature');
  });

  it('leaves saved snapshot colours alone when no palette was chosen anywhere', () => {
    render(<WidgetPreview widget={widget()} readOnly />);
    expect(lastConfig?.__paletteChosen).toBe(false);
  });
});

describe('older chat pins', () => {
  it("follow the dashboard when their 'custom' palette is just the default colours", () => {
    const pinned = {
      id: 'w2',
      title: 'From chat',
      chartType: 'area',
      chartOptions: { colorPalette: 'custom', customPalette: ['#00c2cb', '#4e79a7', '#f28e2b', '#e15759'], customColor: '#00c2cb' },
    } as unknown as WidgetInstance;
    render(
      <DashboardPaletteProvider palette="cool">
        <WidgetPreview widget={pinned} readOnly />
      </DashboardPaletteProvider>,
    );
    expect(lastConfig?.colorPalette).toBe('cool');
    expect(lastConfig?.customPalette).toBeUndefined();
  });
});
