/** Commercial SKU map. Sidebar keys and plan flags attach here — not 1:1 with RBAC rows. */

export type SkuId =
  | 'kernel'
  | 'analyze'
  | 'ask'
  | 'govern'
  | 'operate'
  | 'decide'
  | 'platform'
  | 'channel'
  | 'industry';

export type SkuTier = 'ce' | 'pro' | 'team' | 'enterprise';

export type SkuDefinition = {
  id: SkuId;
  name: string;
  layer: 'kernel' | 'core' | 'addon';
  minTier: SkuTier;
  /** Plan feature flags that turn this SKU on. */
  features: string[];
  /** Sidebar keys that belong to this SKU. Empty = not a nav product. */
  navKeys: string[];
};

export const SKU_CATALOG: SkuDefinition[] = [
  {
    id: 'kernel',
    name: 'Kernel',
    layer: 'kernel',
    minTier: 'ce',
    features: [],
    navKeys: [],
  },
  {
    id: 'analyze',
    name: 'Analyze',
    layer: 'core',
    minTier: 'ce',
    features: [],
    navKeys: ['dashboards', 'chart-designer', 'query-editor', 'sheets', 'notebooks', 'feed', 'data'],
  },
  {
    id: 'ask',
    name: 'Ask',
    layer: 'core',
    minTier: 'pro',
    features: ['advanced_ai'],
    navKeys: ['chat', 'knowledge'],
  },
  {
    id: 'govern',
    name: 'Govern',
    layer: 'core',
    minTier: 'team',
    features: ['govern', 'audit_logs', 'team_governance'],
    navKeys: ['catalog'],
  },
  {
    id: 'operate',
    name: 'Operate',
    layer: 'addon',
    minTier: 'team',
    features: ['operate', 'alerts', 'scheduled_reports'],
    navKeys: ['alerts'],
  },
  {
    id: 'decide',
    name: 'Decide',
    layer: 'addon',
    minTier: 'pro',
    features: ['decide', 'ai_decisions'],
    navKeys: ['ai-decisions'],
  },
  {
    id: 'platform',
    name: 'Platform',
    layer: 'addon',
    minTier: 'pro',
    features: ['platform', 'lakehouse', 'catalog', 'platform_services'],
    navKeys: ['warehouse', 'pipelines'],
  },
  {
    id: 'channel',
    name: 'Channel',
    layer: 'addon',
    minTier: 'pro',
    features: ['channel_pack', 'embed_analytics', 'bi_sync', 'slack_teams'],
    navKeys: [],
  },
  {
    id: 'industry',
    name: 'Industry packs',
    layer: 'addon',
    minTier: 'team',
    features: ['industry_packs'],
    navKeys: [],
  },
];

/** Sidebar key → plan feature that must be on. Missing key = always shown (kernel/analyze). */
export const NAV_FEATURE_GATE: Record<string, string> = {
  alerts: 'alerts',
  catalog: 'catalog',
  warehouse: 'lakehouse',
  pipelines: 'lakehouse',
  models: 'ml_models',
  'ai-decisions': 'ai_decisions',
};

export function skuForNavKey(key: string): SkuDefinition | undefined {
  return SKU_CATALOG.find((s) => s.navKeys.includes(key));
}

/** SKUs turned on by a license/plan feature set. Analyze has no flags and always ships. */
export function skusForFeatures(features: string[]): SkuDefinition[] {
  const set = new Set(features);
  return SKU_CATALOG.filter((sku) => {
    if (sku.id === 'kernel') return false;
    if (sku.features.length === 0) return true;
    return sku.features.some((feature) => set.has(feature));
  });
}
