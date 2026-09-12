/**
 * Strip Presidio/LLM PII placeholders (`<DATE_TIME>`, `<ORGANIZATION>`, …)
 * from titles shown to readers. Those tokens are for model context, not UI.
 * Request phrasing ("how about build a dashboard for…") is also not a title.
 */
const PII_PLACEHOLDER_RE = /<[A-Z][A-Z0-9_]{2,}>/g;
const GENERATED_FROM_RE = /^\s*generated from(\s+prompt)?\s*:?\s*/i;
const WEAK_TITLE_WORDS = new Set([
  'dashboard',
  'analytics',
  'overview',
  'performance',
  'report',
  'summary',
  'analysis',
  'chart',
  'untitled',
  'ai',
  'data',
  'dataset',
  'management',
]);
const INSTRUCTION_STOP = new Set([
  'how',
  'about',
  'what',
  'build',
  'create',
  'generate',
  'make',
  'show',
  'give',
  'display',
  'please',
  'can',
  'could',
  'would',
  'want',
  'need',
  'let',
  'lets',
  'me',
  'us',
  'you',
  'our',
  'my',
  'your',
  'a',
  'an',
  'the',
  'for',
  'this',
  'that',
  'of',
  'on',
  'with',
  'from',
  'to',
  'and',
  'or',
  'by',
  'in',
  ...WEAK_TITLE_WORDS,
]);
const REQUEST_PREFIX_RE =
  /^\s*(how\s+about|what\s+about|can\s+you|could\s+you|would\s+you|please|i\s+want|i\s+need|i'?d\s+like|let'?s|let\s+us|build|create|generate|make|show(\s+me)?|give(\s+me)?|analyse|analyze|display)\b/i;
const BUILD_DASHBOARD_RE = /\b(build|create|generate|make|show|give)\b.+\b(dashboard|chart|report)\b/i;
const DASHBOARD_FOR_RE = /\b(dashboard|chart|report|summary)\s+for\b/i;
const DANGLING_PREP_RE = /\b(for|of|about|on|to|a|an|the)$/i;

export function stripPiiPlaceholders(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(PII_PLACEHOLDER_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function stripGeneratedFrom(text: string | null | undefined): string {
  return stripPiiPlaceholders(text).replace(GENERATED_FROM_RE, '').trim();
}

export function isInstructionEchoTitle(title: string | null | undefined): boolean {
  const cleaned = stripPiiPlaceholders(title);
  if (!cleaned) return true;
  if (REQUEST_PREFIX_RE.test(cleaned)) return true;
  if (BUILD_DASHBOARD_RE.test(cleaned)) return true;
  if (DASHBOARD_FOR_RE.test(cleaned)) return true;
  if (DANGLING_PREP_RE.test(cleaned)) return true;
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?]/g, '').toLowerCase())
    .filter(Boolean);
  const content = words.filter((w) => !INSTRUCTION_STOP.has(w));
  if (content.length === 0) return true;
  return content.length / Math.max(words.length, 1) < 0.4;
}

export function isWeakDisplayTitle(title: string | null | undefined): boolean {
  const cleaned = stripPiiPlaceholders(title);
  if (cleaned.length < 3) return true;
  if (cleaned.includes('<') && cleaned.includes('>')) return true;
  if (isInstructionEchoTitle(cleaned)) return true;
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?]/g, '').toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => WEAK_TITLE_WORDS.has(w));
}

export function sanitizeDisplayTitle(
  title: string | null | undefined,
  fallback?: string | null,
): string {
  const cleaned = stripPiiPlaceholders(title);
  if (cleaned && !isWeakDisplayTitle(cleaned)) return cleaned;
  const fallbackClean = stripPiiPlaceholders(fallback);
  if (fallbackClean && !isWeakDisplayTitle(fallbackClean)) return fallbackClean;
  // Never surface placeholders like "Analytics" / "Chart" / "Dashboard".
  return '';
}

function titleTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return stripPiiPlaceholders(value);
  if (value && typeof value === 'object' && 'text' in (value as { text?: unknown })) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return stripPiiPlaceholders(text);
  }
  return '';
}

/** Real chart/widget name from a captured snapshot or live chartWidget. */
export function extractAssetDisplayTitle(asset?: {
  previewLabel?: string;
  chartWidget?: {
    title?: string;
    chartOptions?: Record<string, unknown>;
  } | null;
  snapshotPayload?: Record<string, unknown> | null;
}): string {
  if (!asset) return '';
  const widgets =
    ((asset.snapshotPayload as { visuals?: { widgets?: Array<{ title?: string; chartType?: string }> } } | undefined)
      ?.visuals?.widgets) || [];
  const snapshotTitle = widgets
    .map((w) => stripPiiPlaceholders(w.title))
    .find((name, i) => name && !isWeakDisplayTitle(name) && widgets[i]?.chartType !== 'text');
  if (snapshotTitle) return snapshotTitle;

  const optionsTitle = titleTextFromUnknown(asset.chartWidget?.chartOptions?.title);
  if (optionsTitle && !isWeakDisplayTitle(optionsTitle)) return optionsTitle;

  const echartsSnapshot = asset.chartWidget?.chartOptions?.__echartsSnapshot as { title?: unknown } | undefined;
  const snapshotOptTitle = titleTextFromUnknown(echartsSnapshot?.title);
  if (snapshotOptTitle && !isWeakDisplayTitle(snapshotOptTitle)) return snapshotOptTitle;

  const widgetTitle = stripPiiPlaceholders(asset.chartWidget?.title);
  if (widgetTitle && !isWeakDisplayTitle(widgetTitle)) return widgetTitle;

  const preview = stripPiiPlaceholders(asset.previewLabel);
  if (preview && !isWeakDisplayTitle(preview)) return preview;
  return '';
}

export function feedItemDisplayDescription(description: string | null | undefined): string {
  const cleaned = stripGeneratedFrom(description);
  if (!cleaned) return '';
  // Long body prose (executive summaries) must not use title heuristics —
  // phrases like "chart for" / "Show …" / high stop-word density wipe real narration.
  if (cleaned.length > 80) return cleaned;
  if (isWeakDisplayTitle(cleaned) || isInstructionEchoTitle(cleaned)) return '';
  return cleaned;
}

/** Prefer a real widget title from a captured snapshot when the post title is a placeholder. */
export function feedItemDisplayTitle(
  item: {
    title?: string | null;
    asset?: {
      previewLabel?: string;
      snapshotPayload?: Record<string, unknown> | null;
      chartWidget?: {
        title?: string;
        chartOptions?: Record<string, unknown>;
      } | null;
    };
  },
  genericFallback = '',
): string {
  const fromAsset = extractAssetDisplayTitle(item.asset);
  return sanitizeDisplayTitle(item.title, fromAsset || genericFallback);
}
