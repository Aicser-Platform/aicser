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
  if (opts.pageId) url.searchParams.set('page', opts.pageId);
  if (opts.filters) {
    url.searchParams.set('filters', encodeURIComponent(JSON.stringify(opts.filters)));
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
