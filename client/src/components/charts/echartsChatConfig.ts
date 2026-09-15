import type { EChartsOption } from 'echarts';

/** Metadata attached to the deterministic empty-state chart (chart_builder_node.py:1182). */
export interface ChatEchartsMeta {
  generation_method: string;
  empty?: boolean;
  [key: string]: unknown;
}

/**
 * Frame data for animated bar-race/line-race charts, stored under `__animate`
 * (chart_builder_node.py `_build_animate_chart`, keys enumerated at :881-896).
 */
export interface AnimateFrameData {
  type: string;
  chart_type_label?: string;
  frames: Record<string, unknown>[];
  time_frames?: string[];
  initial_frame_index?: number;
  categories?: string[];
  display_labels?: Record<string, string>;
  category_icons?: Record<string, string>;
  cat_colors?: Record<string, string>;
  metric_name?: string;
  total_by_frame?: Record<string, number>;
  narration_hints?: string[];
  interval_ms?: number;
  top_n?: number;
  [key: string]: unknown;
}

/**
 * Real shape of the object `chart_builder_node.py` stores as `echarts_config` in
 * `Message.ai_metadata` / returns from the `create_chart` capability. Extends the
 * official ECharts option type with the app-specific bolt-on keys chart_builder_node
 * attaches on top (sql_query at :1288/:1314/:1358, _meta at :1182, __animate at :881/:1005).
 */
export interface ChatEchartsConfig extends EChartsOption {
  sql_query?: string;
  _meta?: ChatEchartsMeta;
  __animate?: AnimateFrameData;
}
