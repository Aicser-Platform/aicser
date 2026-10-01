/**
 * Server-side helper: mint a signed, single-use embed link for one of your customers.
 *
 * Run this on your server, never in the browser: it uses your Aicser API key. Every query made
 * with the link is pinned to `lockedFilters` by Aicser, whatever the browser sends.
 *
 * ```ts
 * import { signEmbedUrl } from '@aicser/embed/server';
 * const { url } = await signEmbedUrl({
 *   baseUrl: 'https://api.aicser.com',
 *   apiKey: process.env.AICSER_API_KEY!,
 *   dashboardId: 'b4b3…',
 *   lockedFilters: [{ field: 'tenant_id', value: customer.id }],
 * });
 * // Charts / reports: pass scope + resourceId instead of dashboardId.
 * ```
 */

export type SignEmbedScope = 'dashboard' | 'chart' | 'report';

export interface LockedFilter {
  field: string;
  value: string | number | boolean | Array<string | number | boolean>;
}

export interface SignEmbedOptions {
  /** Your Aicser API URL (the server, e.g. https://api.aicser.com). */
  baseUrl: string;
  /** An Aicser API key (Settings → API keys), e.g. aiser_sk_… */
  apiKey: string;
  /**
   * Dashboard id when `scope` is `dashboard` (the default). Prefer `resourceId` when embedding
   * a chart or report (`conversationId:messageId`).
   */
  dashboardId?: string;
  /**
   * Resource to embed: dashboard id, chart id, or `conversationId:messageId` for reports.
   * Required when `dashboardId` is omitted.
   */
  resourceId?: string;
  /** What to embed (default `dashboard`). */
  scope?: SignEmbedScope;
  lockedFilters?: LockedFilter[];
  /** How long the session may last once opened, 5–1440 minutes (default 60). */
  expiresInMinutes?: number;
  /** Sites allowed to show the embed, e.g. ['app.example.com']. */
  allowedDomains?: string[];
  /** What visitors may save: 'none' (default), 'image', or 'data'. */
  download?: 'none' | 'image' | 'data';
  /** Custom fetch (tests, proxies); defaults to the global fetch of Node 18+. */
  fetch?: typeof fetch;
}

export interface SignedEmbed {
  /** The iframe URL. It opens once; get a new one per page view (or via the SDK's getToken). */
  url: string;
  token: string;
  expiresAt: string;
}

export class AicserSignError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AicserSignError';
  }
}

export async function signEmbedUrl(options: SignEmbedOptions): Promise<SignedEmbed> {
  const scope: SignEmbedScope = options.scope ?? 'dashboard';
  const resourceId = options.resourceId ?? options.dashboardId;
  if (!resourceId) {
    throw new AicserSignError('resourceId (or dashboardId) is required', 400);
  }

  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/api/embed/sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resource_id: resourceId,
      scope,
      locked_filters: options.lockedFilters ?? [],
      expires_in_minutes: options.expiresInMinutes ?? 60,
      allowed_domains: options.allowedDomains ?? [],
      download: options.download ?? 'none',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    url?: string;
    token?: string;
    expires_at?: string;
    detail?: unknown;
  };
  if (!res.ok || !body.url || !body.token) {
    const detail = body.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string'
          ? (detail as { message: string }).message
          : `Aicser refused to sign the embed (${res.status})`;
    throw new AicserSignError(message, res.status);
  }
  return { url: body.url, token: body.token, expiresAt: body.expires_at ?? '' };
}
