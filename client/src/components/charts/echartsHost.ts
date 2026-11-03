/**
 * Shared ECharts host instance (`echarts/core`) provided to Core charts and Plug-in Visuals via `ctx.echarts`.
 *
 * Per ADR-0002, the host passes `ctx.echarts` rather than letting each visual bundle carry
 * a duplicate copy of ECharts, keeping visual bundles small (~2-5 KB) and theming/watermarks consistent.
 */

import * as echarts from 'echarts/core';
import {
  BarChart,
  BoxplotChart,
  CandlestickChart,
  CustomChart,
  EffectScatterChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  TreemapChart,
} from 'echarts/charts';
import {
  CalendarComponent,
  DatasetComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  RadarComponent,
  SingleAxisComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use([
  CanvasRenderer,
  SVGRenderer,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  CustomChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  SankeyChart,
  TreemapChart,
  BoxplotChart,
  CandlestickChart,
  EffectScatterChart,
  SunburstChart,
  GraphChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  GraphicComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  DatasetComponent,
  TransformComponent,
  RadarComponent,
  PolarComponent,
  SingleAxisComponent,
  CalendarComponent,
]);

export { echarts };
export default echarts;

