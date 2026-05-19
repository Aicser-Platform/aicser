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
    name: 'Line ',
    icon: <LineChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Line chart using sample data for layout verification.',
  },
  {
    id: 't-bar',
    type: 'bar',
    name: 'Bar ',
    icon: <BarChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Bar chart for comparing categories and discrete values.',
  },
  {
    id: 't-area',
    type: 'area',
    name: 'Area ',
    icon: <AreaChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Area chart for showing trends over time.',
  },
  {
    id: 't-pie',
    type: 'pie',
    name: 'Pie ',
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
];
