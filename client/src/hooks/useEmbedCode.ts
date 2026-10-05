'use client';

import { useCallback, useState } from 'react';
import { fetchApi } from '@/utils/api';
import {
  buildEmbedChartUrl,
  buildEmbedChatUrl,
  buildEmbedDashboardUrl,
  pickPrimaryEmbedUrl,
  withDashboardView,
} from '@/utils/embedSnippet';

type EmbedScope = 'dashboard' | 'chart' | 'chat';

export type EmbedDownload = 'none' | 'image' | 'data';

export type EmbedTheme = {
  primary_color?: string;
  logo_url?: string;
  font_family?: string;
  mode?: 'light' | 'dark' | 'auto';
  hide_aicser_branding?: boolean;
};

type EmbedTokenCreated = {
  token?: string;
  embed_urls?: Record<string, string>;
};

type CreateEmbedCodeOptions = {
  scope: EmbedScope;
  resourceId?: string;
  name?: string;
  pageId?: string | null;
  filters?: unknown;
  assistantId?: string;
  expiresInHours?: number;
  theme?: EmbedTheme;
  /** Sites allowed to show the embed (hostnames); empty allows any. */
  allowedDomains?: string[];
  download?: EmbedDownload;
};

type EmbedCodeResult = {
  embedUrl: string;
  token?: string;
};

export function useEmbedCode() {
  const [loading, setLoading] = useState(false);

  // Errors (no permission, plan, bad input) reach the caller: a link built without a token
  // would only show "Not connected" on the customer's site.
  const createEmbedCode = useCallback(async (options: CreateEmbedCodeOptions): Promise<EmbedCodeResult> => {
    setLoading(true);
    try {
      const created = await fetchApi<EmbedTokenCreated>('/api/embed/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: (options.name || `Embed: ${options.resourceId || options.scope}`).slice(0, 120),
          scopes: [options.scope],
          resource_id: options.resourceId || undefined,
          expires_in_hours: options.expiresInHours ?? 720,
          allowed_domains: options.allowedDomains ?? [],
          download: options.download ?? 'none',
          theme: options.theme || undefined,
        }),
      });
      const token = created.token;
      let embedUrl = created.embed_urls?.[options.scope] || pickPrimaryEmbedUrl(created.embed_urls);

      if (!embedUrl) {
        if (options.scope === 'dashboard' && options.resourceId) {
          embedUrl = buildEmbedDashboardUrl(options.resourceId, { token });
        } else if (options.scope === 'chart' && options.resourceId) {
          embedUrl = buildEmbedChartUrl(options.resourceId, token);
        } else if (options.scope === 'chat') {
          embedUrl = buildEmbedChatUrl({ token, assistantId: options.assistantId });
        }
      }
      if (embedUrl && options.scope === 'dashboard') {
        embedUrl = withDashboardView(embedUrl, options.pageId, options.filters);
      }
      if (embedUrl && options.scope === 'chat' && options.assistantId) {
        const url = new URL(embedUrl);
        url.searchParams.set('assistant_id', options.assistantId);
        embedUrl = url.toString();
      }

      return { embedUrl, token };
    } finally {
      setLoading(false);
    }
  }, []);

  return { createEmbedCode, loading };
}
