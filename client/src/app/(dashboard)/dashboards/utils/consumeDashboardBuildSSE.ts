import { API_URL, fetchApi } from '@/utils/api';
import { drainSSEBuffer } from '@/utils/sseBuffer';
import { getCeBearerToken } from '@/auth/ce/bearerToken';
import { supabase, isSupabaseAuthConfigured } from '@/auth/authClient';

async function buildStreamHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('organization-storage');
      if (raw) {
        const parsed = JSON.parse(raw);
        const organizationId =
          parsed?.state?.currentOrganization?.id || parsed?.currentOrganization?.id;
        if (organizationId) headers['X-Organization-Id'] = String(organizationId);
      }
    } catch {
      /* ignore */
    }

    const ce = getCeBearerToken();
    if (ce) {
      headers.Authorization = `Bearer ${ce}`;
    } else if (isSupabaseAuthConfigured() && supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    }
  }

  return headers;
}

/** Read dashboard build SSE until terminal event or abort. */
export async function consumeDashboardBuildSSE(
  dashboardId: string,
  onEvent: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await buildStreamHeaders();
  const url = `${API_URL}/dashboards/${encodeURIComponent(dashboardId)}/build-progress/stream`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers,
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Dashboard build stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      break;
    }

    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        drainSSEBuffer(`${buffer}\n`, onEvent);
      }
      break;
    }

    buffer = drainSSEBuffer(buffer + decoder.decode(value, { stream: true }), onEvent);
  }
}

/** @deprecated use consumeDashboardBuildSSE — kept for tests */
export async function fetchDashboardBuildSnapshot(dashboardId: string): Promise<unknown> {
  return fetchApi(`dashboards/${encodeURIComponent(dashboardId)}/build-progress`, { method: 'GET' });
}
