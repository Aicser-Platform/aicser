export type IframeSnippetOptions = {
  height?: number | string;
  title?: string;
  width?: string;
};

export function getEmbedOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

export function buildIframeSnippet(embedUrl: string, options: IframeSnippetOptions = {}): string {
  const height = options.height ?? 600;
  const heightCss = typeof height === 'number' ? `${height}px` : height;
  const width = options.width ?? '100%';
  const titleAttr = options.title
    ? ` title="${options.title.replace(/"/g, '&quot;')}"`
    : '';
  return `<iframe src="${embedUrl}" style="width:${width};height:${heightCss};border:0;border-radius:8px" allow="clipboard-write"${titleAttr} loading="lazy"></iframe>`;
}

export function buildEmbedDashboardUrl(
  dashboardId: string,
  opts: { token?: string; pageId?: string | null; filters?: unknown } = {},
): string {
  const url = new URL(`${getEmbedOrigin()}/embed/dashboard/${dashboardId}`);
  if (opts.token) url.searchParams.set('token', opts.token);
  return withDashboardView(url.toString(), opts.pageId, opts.filters);
}

/** The page and starting filters a dashboard embed opens on (visitors may only narrow them). */
export function withDashboardView(embedUrl: string, pageId?: string | null, filters?: unknown): string {
  const url = new URL(embedUrl);
  if (pageId) url.searchParams.set('page', pageId);
  if (Array.isArray(filters) ? filters.length : filters) {
    url.searchParams.set('filters', encodeURIComponent(JSON.stringify(filters)));
  }
  return url.toString();
}

export function buildEmbedChartUrl(chartId: string, token?: string): string {
  const url = new URL(`${getEmbedOrigin()}/embed/chart/${chartId}`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

export function buildEmbedChatUrl(opts: { token?: string; assistantId?: string } = {}): string {
  const url = new URL(`${getEmbedOrigin()}/embed/chat`);
  if (opts.token) url.searchParams.set('token', opts.token);
  if (opts.assistantId) url.searchParams.set('assistant_id', opts.assistantId);
  return url.toString();
}

/** Prefer dashboard → chart → chat when a token exposes multiple embed URLs. */
export function pickPrimaryEmbedUrl(embedUrls?: Record<string, string>): string {
  if (!embedUrls) return '';
  return embedUrls.dashboard || embedUrls.chart || embedUrls.chat || Object.values(embedUrls)[0] || '';
}

export async function copyEmbedText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export type SignedEmbedSnippets = { node: string; python: string; curl: string };

/** Server code that signs a per-customer embed of one chart or dashboard (Developer → API keys). */
export function buildSignedEmbedSnippets(opts: {
  baseUrl: string;
  scope: 'dashboard' | 'chart';
  resourceId: string;
}): SignedEmbedSnippets {
  const { baseUrl, scope, resourceId } = opts;
  const node = `import { signEmbedUrl } from '@aicser/embed/server';

// On your server, once per page view. Never send the API key to the browser.
const { url } = await signEmbedUrl({
  baseUrl: '${baseUrl}',
  apiKey: process.env.AICSER_API_KEY,
  scope: '${scope}',
  resourceId: '${resourceId}',
  // Each customer sees only their own rows (use your column and value)
  lockedFilters: [{ field: 'customer_id', value: customer.id }],
  allowedDomains: ['app.example.com'],
  expiresInMinutes: 60,
});
// Put url in an <iframe src="…">`;
  const python = `from aicser_embed import sign_embed_url

# On your server, once per page view. Never send the API key to the browser.
signed = sign_embed_url(
    base_url="${baseUrl}",
    api_key=os.environ["AICSER_API_KEY"],
    scope="${scope}",
    resource_id="${resourceId}",
    # Each customer sees only their own rows (use your column and value)
    locked_filters=[{"field": "customer_id", "value": customer.id}],
    allowed_domains=["app.example.com"],
    expires_in_minutes=60,
)
# Put signed.url in an <iframe src="…">`;
  const curl = `curl -X POST '${baseUrl}/api/embed/sign' \\
  -H "Authorization: Bearer $AICSER_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "scope": "${scope}",
    "resource_id": "${resourceId}",
    "locked_filters": [{"field": "customer_id", "value": "acme"}],
    "allowed_domains": ["app.example.com"],
    "expires_in_minutes": 60
  }'
# The response's "url" opens once: sign a new one for each page view`;
  return { node, python, curl };
}

/** "app.example.com" from whatever was typed or pasted ("https://App.example.com/page"). */
export function normalizeEmbedDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return raw.replace(/\/.*$/, '');
  }
}
