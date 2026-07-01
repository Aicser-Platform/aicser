'use client';

import React from 'react';
import {
  LineChartOutlined,
  PieChartFilled,
  BarChartOutlined,
  AreaChartOutlined,
} from '@ant-design/icons';

/**
 * Shared widget template definitions for dashboard studio and chart designer.
 * English labels; localized UIs should use translations when rendering names/descriptions.
 */
export const WIDGET_TEMPLATES = [
  {
    id: 't-line',
    type: 'line',
    name: 'Line',
    icon: <LineChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Line chart using sample data for layout verification.',
  },
  {
    id: 't-bar',
    type: 'bar',
    name: 'Bar',
    icon: <BarChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Bar chart for comparing categories and discrete values.',
  },
  {
    id: 't-area',
    type: 'area',
    name: 'Area',
    icon: <AreaChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Area chart for showing trends over time.',
  },
  {
    id: 't-donut',
    type: 'donut',
    name: 'Donut',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 672c-123.7 0-224-100.3-224-224s100.3-224 224-224 224 100.3 224 224-100.3 224-224 224z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Donut chart for proportions with a central hole.',
  },
  {
    id: 't-pie',
    type: 'pie',
    name: 'Pie',
    icon: <PieChartFilled />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Pie chart with stubbed data; useful to test chart slots.',
  },
  {
    id: 't-scatter',
    type: 'scatter',
    name: 'Scatter',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M888 792H232V136c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v704c0 4.4 3.6 8 8 8h720c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM312 288c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm560 216c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zM544 192c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm176 416c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Scatter plot for showing correlation between two variables.',
  },
  {
    id: 't-heatmap',
    type: 'heatmap',
    name: 'Heatmap',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h128v128H320V320zm256 0h128v128H576V320zM320 576h128v128H320V576zm256 0h128v128H576V576z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Heatmap to visualize data density.',
  },
  {
    id: 't-funnel',
    type: 'funnel',
    name: 'Funnel',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M192.1 64h639.8c8.8 0 16 7.2 16 16v121.7c0 4.2-1.7 8.3-4.7 11.3L540.3 515.9V912c0 8.8-7.2 16-16 16h-24.6c-8.8 0-16-7.2-16-16V515.9L180.8 213c-3-3-4.7-7.1-4.7-11.3V80c0-8.8 7.2-16 16-16z" />
        </svg>
      </div>
    ),
    category: 'Indicators',
    defaultSize: { w: 6, h: 5 },
    description: 'Funnel chart for visualizing stages in a process.',
  },
  {
    id: 't-table',
    type: 'table',
    name: 'Table',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M912 192H112c-8.8 0-16 7.2-16 16v560c0 8.8 7.2 16 16 16h800c8.8 0 16-7.2 16-16V208c0-8.8-7.2-16-16-16zM656 256v160H368V256h288zM368 480h288v160H368V480zM160 256h144v160H160V256zm0 224h144v160H160V480zm0 304v-80h144v80H160zm208 0v-80h288v80H368zm496 0H720v-80h144v80zm0-144H720V480h144v160zm0-224H720V256h144v160z" />
        </svg>
      </div>
    ),
    category: 'Data',
    defaultSize: { w: 8, h: 6 },
    description: 'Table widget to display raw data.',
  },
  {
    id: 't-text',
    type: 'text',
    name: 'Text Block',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h384v64H320V320zm0 192h384v64H320V512zm0 192h256v64H320V704z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 4, h: 3 },
    description: 'Add text notes or descriptions.',
  },
  {
    id: 't-stat',
    type: 'stat',
    name: 'KPI Card',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M888 792H200V168c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v688c0 4.4 3.6 8 8 8h752c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM305.8 637.7c3.1 3.1 8.1 3.1 11.3 0l138.3-137.6L583 628.5c3.1 3.1 8.2 3.1 11.3 0l275.4-275.3c3.1-3.1 3.1-8.2 0-11.3l-39.6-39.6a8.03 8.03 0 0 0-11.3 0l-230 229.9L461 613.7c-3.1 3.1-8.2 3.1-11.3 0L266.3 486.3a8.03 8.03 0 0 0-11.3 0l-39.6 39.6a8.03 8.03 0 0 0 0 11.3l90.4 90.4z" />
        </svg>
      </div>
    ),
    category: 'Indicators',
    defaultSize: { w: 3, h: 2 },
    description: 'KPI stat card for one headline number.',
  },
  {
    id: 't-slicer',
    type: 'slicer',
    name: 'Slicer',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M880.1 154H143.9c-24.5 0-39.8 26.7-27.5 48L349 597.4V838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V597.4L907.7 202c12.2-21.3-3.1-48-27.6-48z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 3, h: 3 },
    description: 'Interactive filter dropdown for dashboard viewers.',
  },
  {
    id: 't-filter',
    type: 'filter',
    name: 'Filter',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M880.1 154H143.9c-24.5 0-39.8 26.7-27.5 48L349 597.4V838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V597.4L907.7 202c12.2-21.3-3.1-48-27.6-48z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 6, h: 2 },
    description: 'Dashboard-wide filter you can place anywhere on the canvas.',
  },
  {
    id: 't-gauge',
    type: 'gauge',
    name: 'Gauge',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M512 64C264.6 64 64 264.6 64 512c0 141.9 62.1 269.4 160.8 356.5l-4.5 4.5c-6.3 6.3-6.3 16.4 0 22.6l45.3 45.3c6.3 6.3 16.4 6.3 22.6 0l4.5-4.5C380.6 1025 444 1048 512 1048c247.4 0 448-200.6 448-448S759.4 64 512 64zm0 48c220.9 0 400 179.1 400 400 0 101-37.4 193-98.7 263.4L512 511.6 220.7 775.4C159.4 705 122 613 122 512c0-220.9 179.1-400 390-400zm0 354a94 94 0 100 188 94 94 0 000-188zm0 48a46 46 0 110 92 46 46 0 010-92zm256-32L552 611.5a94 94 0 00-40 0L256 432l-.6.6 170.2 181.7a94 94 0 00126.8 126.8L723.6 912l.6-.6-171.2-181.7A94 94 0 00768 482z" />
        </svg>
      </div>
    ),
    category: 'Indicators',
    defaultSize: { w: 3, h: 4 },
    description: 'Gauge chart for KPI vs target visualization.',
  },
  {
    id: 't-treemap',
    type: 'treemap',
    name: 'Treemap',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm400 400H208V208h320v320zm320 0H592V208h256v320zM528 896H208V592h320v304zm320 0H592V592h256v304z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Treemap for hierarchical proportional data.',
  },
  {
    id: 't-waterfall',
    type: 'waterfall',
    name: 'Waterfall',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M192 832h640v64H192zM208 320h144v400H208zm224-96h144v496H432zm224-128h144v624H656z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Waterfall chart for bridge/variance analysis.',
  },
  {
    id: 't-bullet',
    type: 'bullet',
    name: 'Bullet Chart',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 384h640v96H128zm0 160h640v96H128zm512-256h192v416H640z" opacity="0.25" />
          <path d="M128 448h420v32H128z" />
          <path d="M548 456h4v16h-4z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 4 },
    description: 'Bullet chart — actual vs target with performance bands.',
  },
  {
    id: 't-divider',
    type: 'divider',
    name: 'Section',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 480h768v64H128z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 12, h: 2 },
    description: 'Section divider with optional title label.',
  },
  {
    id: 't-image',
    type: 'image',
    name: 'Image',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M928 160H96c-17.7 0-32 14.3-32 32v640c0 17.7 14.3 32 32 32h832c17.7 0 32-14.3 32-32V192c0-17.7-14.3-32-32-32zm-40 632H136v-39.9l138.5-164.3 150.1 178L658.1 491 888 746.7V792zm0-129.8L664.2 438.6c-3.1-3.7-7.9-5.7-12.9-5.7s-9.8 1.9-12.9 5.7L476.4 626.8l-143.7-170.4c-3.1-3.7-7.8-5.8-12.7-5.8-4.9 0-9.6 2.1-12.7 5.8L136 611.2V232h752v430.2z" />
          <path d="M304 424a112 112 0 100-224 112 112 0 000 224zm0-184a72 72 0 110 144 72 72 0 010-144z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 4, h: 4 },
    description: 'Display an image from a URL.',
  },
  {
    id: 't-geo',
    type: 'geo',
    name: 'Geo Map',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm-32 660.8l-288-192 32-160 192 96 32-32-64-128 96-96v-64l128-64 32 32-96 96 64 128-64 32-192-64-32 128 256 160v128zM800 688l-64-32V528l-128-32V336l128 64 64-64V688z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 8, h: 6 },
    description: 'Choropleth world map — color countries by metric value.',
  },
  {
    id: 't-embed',
    type: 'embed',
    name: 'Embed',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M464 164.8L168 512l296 347.2 61.8-52.6L282 512l243.8-294.6z" />
          <path d="M560 164.8l-61.8 52.6L742 512 498.2 806.6 560 859.2 856 512z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 6, h: 6 },
    description: 'Embed an external URL (Loom, Figma, docs) via iframe.',
  },
];

export type WidgetTemplate = (typeof WIDGET_TEMPLATES)[number];

/** Visual chart templates only (excludes table, stat, text, slicer). */
const CHART_ONLY_TYPES = new Set([
  'line',
  'bar',
  'area',
  'donut',
  'pie',
  'scatter',
  'heatmap',
  'funnel',
  'geo',
]);

export const CHART_WIDGET_TEMPLATES = WIDGET_TEMPLATES.filter((t) => CHART_ONLY_TYPES.has(t.type));

/** Non-chart dashboard blocks (indicators, data, content). */
export const NON_CHART_WIDGET_TEMPLATES = WIDGET_TEMPLATES.filter((t) => !CHART_ONLY_TYPES.has(t.type));

const SECTION_BY_CATEGORY: Record<string, string> = {
  Visuals: 'Charts',
  Data: 'Data',
  Content: 'Content',
  Indicators: 'Indicators',
};

/** Group shared templates into Add Block / empty-canvas sections. */
export function buildWidgetSections(templates: WidgetTemplate[] = WIDGET_TEMPLATES) {
  const order = ['Charts', 'Indicators', 'Data', 'Content'];
  const grouped = new Map<string, WidgetTemplate[]>();

  templates.forEach((template) => {
    const title = SECTION_BY_CATEGORY[template.category] || template.category;
    const list = grouped.get(title) || [];
    list.push(template);
    grouped.set(title, list);
  });

  return order
    .filter((title) => grouped.has(title))
    .map((title) => ({ title, items: grouped.get(title)! }));
}
