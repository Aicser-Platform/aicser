import { describe, expect, it } from 'vitest';
import {
  getWidgetPropertyProfile,
  isContentWidgetType,
  isControlWidgetType,
  SWITCHABLE_CHART_TYPES,
} from './widgetPropertyProfile';

describe('widgetPropertyProfile', () => {
  it('classifies content and control blocks', () => {
    expect(isContentWidgetType('text')).toBe(true);
    expect(isContentWidgetType('image')).toBe(true);
    expect(isContentWidgetType('embed')).toBe(true);
    expect(isContentWidgetType('divider')).toBe(true);
    expect(isControlWidgetType('slicer')).toBe(true);
    expect(isControlWidgetType('filter')).toBe(true);
    expect(isContentWidgetType('bar')).toBe(false);
  });

  it('exposes all data visuals in the chart-type switcher', () => {
    for (const type of [
      'bar',
      'line',
      'area',
      'pie',
      'donut',
      'scatter',
      'table',
      'stat',
      'heatmap',
      'funnel',
      'gauge',
      'treemap',
      'waterfall',
      'bullet',
      'geo',
    ]) {
      expect(SWITCHABLE_CHART_TYPES).toContain(type);
      expect(getWidgetPropertyProfile(type).inChartTypeSwitcher).toBe(true);
    }
    expect(SWITCHABLE_CHART_TYPES).not.toContain('text');
    // Chat-aligned order: bar before line
    expect(SWITCHABLE_CHART_TYPES.indexOf('bar')).toBeLessThan(SWITCHABLE_CHART_TYPES.indexOf('line'));
  });

  it('hides cartesian chrome for non-axis visuals', () => {
    expect(getWidgetPropertyProfile('pie').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('funnel').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('gauge').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('table').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('stat').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('geo').showCartesianAxes).toBe(false);
    expect(getWidgetPropertyProfile('bar').showCartesianAxes).toBe(true);
    expect(getWidgetPropertyProfile('heatmap').showCartesianAxes).toBe(true);
  });

  it('enables design controls for cartesian charts only', () => {
    expect(getWidgetPropertyProfile('bar').showDesign).toBe(true);
    expect(getWidgetPropertyProfile('scatter').showDesign).toBe(true);
    expect(getWidgetPropertyProfile('waterfall').showDesign).toBe(true);
    expect(getWidgetPropertyProfile('pie').showDesign).toBe(false);
    expect(getWidgetPropertyProfile('stat').showDesign).toBe(false);
    expect(getWidgetPropertyProfile('table').showDesign).toBe(false);
  });

  it('hides irrelevant legend/palette for table, map, and heatmap', () => {
    expect(getWidgetPropertyProfile('table').showLegendToggle).toBe(false);
    expect(getWidgetPropertyProfile('table').showColorPalette).toBe(false);
    expect(getWidgetPropertyProfile('geo').showColorPalette).toBe(false);
    expect(getWidgetPropertyProfile('heatmap').showColorPalette).toBe(false);
    expect(getWidgetPropertyProfile('heatmap').showLegendSeriesControls).toBe(false);
  });
});
