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

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  api_version: '1';
  description?: string;
  author?: string;
  homepage?: string;
  requires_feature?: string | null;
  default_enabled?: boolean;
  assets_dir?: string;
  contributions: Array<
    | {
        kind: 'visual';
        chart_type: string;
        label: string;
        bundle: string;
        icon?: string;
      }
    | {
        kind: 'connector';
        db_type: string;
        label: string;
        target: string;
        default_port?: number;
      }
    | {
        kind: 'ai_skill';
        skill_name: string;
        description: string;
        permission_code?: string;
      }
    | {
        kind: 'mcp_server';
        server_name: string;
        description: string;
      }
  >;
}

