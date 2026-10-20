export type DetailTabKey =
  | 'overview'
  | 'schema'
  | 'semantic'
  | 'access'
  | 'permissions'
  | 'row-filters'
  | 'column-rules';

/** Sub-areas inside the Access tab (stable for deep links). */
export type AccessSubTab = 'sharing' | 'row-filters' | 'column-rules';

/** Sub-areas inside the Semantic layer tab (stable for deep links). */
export type SemanticLayerSection =
  | 'metrics'
  | 'dimensions'
  | 'questions'
  | 'joins'
  | 'preview'
  | 'advanced';

const TAB_KEYS: DetailTabKey[] = [
  'overview',
  'schema',
  'semantic',
  'access',
  'permissions',
  'row-filters',
  'column-rules',
];

const SEMANTIC_SECTION_KEYS: SemanticLayerSection[] = [
  'metrics',
  'dimensions',
  'questions',
  'joins',
  'preview',
  'advanced',
];

const ACCESS_SUB_KEYS: AccessSubTab[] = ['sharing', 'row-filters', 'column-rules'];

/** Canonical URL for the semantic layer on a data source (embedded tab). */
export function dataSourceSemanticTabHref(
  dataSourceId: string,
  section?: SemanticLayerSection,
): string {
  const params = new URLSearchParams({ tab: 'semantic' });
  if (section) params.set('section', section);
  return `/data/sources/${dataSourceId}?${params.toString()}`;
}

/**
 * Full-page semantic workbench — use for hub, overview, catalog, pipelines, and dashboards.
 * Use `dataSourceSemanticTabHref` only when staying inside the data-source detail Semantic tab.
 */
export function semanticLayerStudioHref(
  dataSourceId: string,
  section?: SemanticLayerSection,
): string {
  const params = new URLSearchParams();
  if (section) params.set('section', section);
  const q = params.toString();
  return `/semantic-layer/sources/${encodeURIComponent(dataSourceId)}${q ? `?${q}` : ''}`;
}

export function dataSourceAccessTabHref(dataSourceId: string, sub: AccessSubTab = 'sharing'): string {
  const params = new URLSearchParams({ tab: 'access', access: sub });
  return `/data/sources/${dataSourceId}?${params.toString()}`;
}

export function parseTabParam(raw: string | null): DetailTabKey {
  if (raw === 'permissions' || raw === 'row-filters' || raw === 'column-rules') {
    return 'access';
  }
  return TAB_KEYS.includes(raw as DetailTabKey) ? (raw as DetailTabKey) : 'overview';
}

export function parseAccessSubParam(tabRaw: string | null, accessRaw: string | null): AccessSubTab {
  if (accessRaw && ACCESS_SUB_KEYS.includes(accessRaw as AccessSubTab)) {
    return accessRaw as AccessSubTab;
  }
  if (tabRaw === 'permissions') return 'sharing';
  if (tabRaw === 'row-filters') return 'row-filters';
  if (tabRaw === 'column-rules') return 'column-rules';
  return 'sharing';
}

/** Returns null when the URL omits `section` (workbench may auto-pick a step). */
export function parseSemanticSectionParam(raw: string | null): SemanticLayerSection | null {
  if (!raw) return null;
  if (raw === 'entity_graph') return 'joins';
  // Time settings moved into Dimensions (time is a dimension type).
  if (raw === 'time') return 'dimensions';
  return SEMANTIC_SECTION_KEYS.includes(raw as SemanticLayerSection)
    ? (raw as SemanticLayerSection)
    : 'metrics';
}

/** First-time nudge: model relationships before metrics when both are empty. */
export function suggestSemanticSection(
  metricCount: number,
  joinCount: number,
  singleTableSource = false,
): SemanticLayerSection {
  if (metricCount === 0 && joinCount === 0 && !singleTableSource) return 'joins';
  return 'metrics';
}
