import { fetchApi } from '@/utils/api';

export interface PluginContributionItem {
  kind: 'visual' | 'connector' | 'ai_skill' | 'mcp_server';
  label?: string;
  chart_type?: string;
  db_type?: string;
  skill_name?: string;
  server_name?: string;
  description?: string;
  icon?: string;
  default_port?: number;
}

export interface PluginStateItem {
  id: string;
  name: string;
  version: string;
  api_version: string;
  description?: string;
  author?: string;
  homepage?: string;
  installed: boolean;
  entitled: boolean;
  enabled: boolean;
  active: boolean;
  default_enabled: boolean;
  requires_feature?: string | null;
  has_config?: boolean;
  contributions: PluginContributionItem[];
}

export interface ActiveVisualMeta {
  chart_type: string;
  label: string;
  icon?: string;
  bundle_url: string;
  plugin_id: string;
}

export interface ActiveConnectorMeta {
  db_type: string;
  label: string;
  default_port?: number;
  plugin_id: string;
}

export interface ActivePluginsPayload {
  active_plugins: string[];
  visuals: ActiveVisualMeta[];
  connectors: ActiveConnectorMeta[];
  disabled_chart_types?: Record<string, string>;
  disabled_db_types?: Record<string, string>;
}

export const pluginService = {
  async getActivePlugins(): Promise<ActivePluginsPayload> {
    const res = await fetchApi('/plugins/active');
    return res as ActivePluginsPayload;
  },

  async getAllPlugins(): Promise<PluginStateItem[]> {
    const res = await fetchApi('/plugins');
    return (Array.isArray(res) ? res : []) as PluginStateItem[];
  },

  async updateEnablement(
    id: string,
    enabled: boolean,
    config?: Record<string, any>,
  ): Promise<PluginStateItem> {
    const res = await fetchApi(`/plugins/${encodeURIComponent(id)}/enablement`, {
      method: 'PUT',
      body: JSON.stringify(config !== undefined ? { enabled, config } : { enabled }),
    });
    return res as PluginStateItem;
  },
};

