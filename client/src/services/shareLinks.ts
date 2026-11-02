import { fetchApi } from '@/utils/api';

export type ShareKind = 'chart' | 'dashboard';
export type ShareAccess = 'organization' | 'public';

export type ShareLink = {
  id: string;
  slug: string;
  kind: ShareKind;
  resource_id: string;
  title?: string | null;
  access: ShareAccess;
  status: 'active' | 'pending' | 'off';
  live_data: boolean;
  expires_at?: string | null;
  has_password: boolean;
  allowed_domains: string[];
  view_count: number;
  last_viewed_at?: string | null;
  snapshot_at?: string | null;
};

export type ShareLinkSettings = {
  access: ShareAccess;
  live_data: boolean;
  expires_in_days: number | null;
  password?: string;
  clear_password?: boolean;
  allowed_domains: string[];
};

const ROOT = '/api/share-links';
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getShareLink = (kind: ShareKind, resourceId: string) =>
  fetchApi<{ link: ShareLink | null }>(`${ROOT}?kind=${kind}&resource_id=${encodeURIComponent(resourceId)}`).then((r) => r.link);

export const saveShareLink = (kind: ShareKind, resourceId: string, title: string, settings: ShareLinkSettings) =>
  fetchApi<{ link: ShareLink }>(ROOT, json('PUT', { kind, resource_id: resourceId, title, ...settings })).then((r) => r.link);

export const turnShareLinkOff = (id: string) =>
  fetchApi<{ link: ShareLink }>(`${ROOT}/${id}/off`, json('POST', {})).then((r) => r.link);

export const turnShareLinkOn = (id: string) =>
  fetchApi<{ link: ShareLink }>(`${ROOT}/${id}/on`, json('POST', {})).then((r) => r.link);

export const approveShareLink = (id: string) => fetchApi(`${ROOT}/${id}/approve`, json('POST', {}));

export const organizationShareLinks = () =>
  fetchApi<{ links: ShareLink[] }>(`${ROOT}/organization`).then((r) => r.links);

export const shareUrl = (slug: string) => `${window.location.origin}/s/${slug}`;

/** The iframe for a website: the same link, without the page's own header. */
export const shareEmbedCode = (slug: string, title: string) =>
  `<iframe src="${shareUrl(slug)}?embed=1" title="${title.replace(/"/g, '&quot;')}" width="100%" height="480" style="border:0" loading="lazy"></iframe>`;

/** Days left, so saving another option doesn't move the end date. */
export function daysLeft(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  return Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000));
}
