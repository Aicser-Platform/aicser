'use client';

import { useCallback, useState } from 'react';
import { fetchApi } from '@/utils/api';
import {
  buildEmbedChartUrl,
  buildEmbedChatUrl,
  buildEmbedDashboardUrl,
  pickPrimaryEmbedUrl,
} from '@/utils/embedSnippet';

type EmbedScope = 'dashboard' | 'chart' | 'chat';

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
};

type EmbedCodeResult = {
  embedUrl: string;
  token?: string;
};

export function useEmbedCode() {
  const [loading, setLoading] = useState(false);

  const createEmbedCode = useCallback(async (options: CreateEmbedCodeOptions): Promise<EmbedCodeResult> => {
    setLoading(true);
    try {
      let token: string | undefined;
      let embedUrl = '';

      try {
        const created = await fetchApi<EmbedTokenCreated>('/api/embed/tokens', {
          method: 'POST',
          body: JSON.stringify({
            name: options.name || `Embed: ${options.resourceId || options.scope}`,
            scopes: [options.scope],
            resource_id: options.resourceId || undefined,
            expires_in_hours: options.expiresInHours ?? 720,
          }),
        });
        token = created.token;
        embedUrl = pickPrimaryEmbedUrl(created.embed_urls);
      } catch {
        // Public resources may work without a token — build URL without it.
      }

      if (!embedUrl) {
        if (options.scope === 'dashboard' && options.resourceId) {
          embedUrl = buildEmbedDashboardUrl(options.resourceId, {
            token,
            pageId: options.pageId,
            filters: options.filters,
          });
        } else if (options.scope === 'chart' && options.resourceId) {
          embedUrl = buildEmbedChartUrl(options.resourceId, token);
        } else if (options.scope === 'chat') {
          embedUrl = buildEmbedChatUrl({ token, assistantId: options.assistantId });
        }
      }

      return { embedUrl, token };
    } finally {
      setLoading(false);
    }
  }, []);

  return { createEmbedCode, loading };
}
