/**
 * Aicser Visual API v1 Contract (`mount(el, ctx) -> { update, destroy }`).
 *
 * Plug-in Visuals ship as framework-agnostic ESM bundles that receive a DOM container
 * and `VisualContext` (including the host ECharts instance, theme, i18n, and formatters).
 */

export interface VisualContext {
  container: HTMLElement;
  width: number;
  height: number;
  data: {
    columns: Array<{ name: string; type: string }>;
    rows: Array<Record<string, any>>;
    raw?: any;
  };
  options: Record<string, any>;
  theme: {
    mode: 'light' | 'dark';
    palette: string[];
    backgroundColor?: string;
  };
  t: (key: string, defaultText?: string) => string;
  format: {
    number: (val: number, options?: Intl.NumberFormatOptions) => string;
    date: (val: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  };
  echarts: any;
}

export interface VisualInstance {
  update: (ctx: VisualContext) => void;
  destroy: () => void;
}

export interface VisualPlugin {
  mount: (el: HTMLElement, ctx: VisualContext) => VisualInstance;
}

