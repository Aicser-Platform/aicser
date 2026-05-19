import { getBackendUrl } from './backendUrl';
import { supabase, useSupabaseForApiAuth } from '@/auth/authClient';
import { getCeBearerToken } from '@/auth/ce/bearerToken';

/**
 * Structured API error with status code and parsed detail.
 * Thrown by fetchApi for non-OK responses.
 */
export class ApiError extends Error {
  status: number;
  detail: any;

  constructor(status: number, detail: any, rawText?: string) {
    const friendlyMsg =
      (typeof detail === 'object' && detail?.message) ||
      (typeof detail === 'string' ? detail : `Request failed (${status})`);
    super(friendlyMsg);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Check if an error is a plan-limit 403 and, if so, show a Modal.warning
 * with an "Upgrade Plan" button. Returns true when handled.
 */
export function handlePlanLimitError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const detail = error.detail;
  const limitErrors = ['project_limit_reached', 'data_source_limit_reached', 'ai_credit_limit_reached'];
  if (!detail || !limitErrors.includes(detail.error)) return false;

  // Lazy-import antd Modal so this utility works without a direct antd dependency at import time
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Modal } = require('antd');
    const titles: Record<string, string> = {
      project_limit_reached: 'Project Limit Reached',
      data_source_limit_reached: 'Data Source Limit Reached',
      ai_credit_limit_reached: 'AI Credit Limit Reached',
    };
    Modal.warning({
      title: titles[detail.error] || 'Plan Limit Reached',
      content: detail.message || 'You have reached the limit on your current plan. Upgrade to continue.',
      okText: 'Upgrade Plan',
      onOk: () => {
        window.dispatchEvent(new CustomEvent('open-pricing-modal'));
      },
    });
  } catch {
    // If antd is unavailable, fall through
  }
  return true;
}

// When running in the browser prefer same-origin proxy so all frontend calls
// go through `/api/...` and benefit from cookie forwarding and CORS handling.
export const API_URL = ((): string => {
  if (typeof window !== 'undefined') return '/api';
  return getBackendUrl();
})();

// Default AUTH_URL to the auth service port when not explicitly set in the environment.
// This makes dev workflows simpler (upgrade-demo and other dev helpers live on the chat2chart service).
// Default AUTH_URL: prefer explicit NEXT_PUBLIC_AUTH_URL, otherwise default to the auth service dev port
export const AUTH_URL = (() => {
  if (typeof window !== 'undefined') {
    // derive auth host from current hostname to ensure cookies match
    const host = window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname;
    const protocol = window.location.protocol;
    const authPort = process.env.NEXT_PUBLIC_AUTH_PORT || '5000';
    return `${protocol}//${host}:${authPort}`;
  }
  return process.env.NEXT_PUBLIC_AUTH_URL || 'http://auth-service:5000';
})();

const getSelectedOrganizationId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('organization-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (
      parsed?.state?.currentOrganization?.id ||
      parsed?.currentOrganization?.id ||
      null
    );
  } catch {
    return null;
  }
};

/**
 * API fetch utility with automatic JSON parsing.
 *
 * Supabase Bearer when enabled; else CE JWT from sessionStorage as Bearer (same secret as auth_token cookie).
 * Returns parsed JSON response.
 *
 * @param endpoint - API endpoint path
 * @param options - Fetch options
 * @returns Parsed JSON data
 */
export const fetchApi = async (endpoint: string, options: RequestInit = {}): Promise<any> => {
  // Don't set Content-Type for FormData - browser will set it automatically with boundary
  const isFormData = options.body instanceof FormData;
  const defaultHeaders: Record<string, string> = isFormData
    ? {}
    : {
        'Content-Type': 'application/json',
      };

  if (typeof window !== 'undefined') {
    const organizationId = getSelectedOrganizationId();
    if (organizationId) {
      defaultHeaders['X-Organization-Id'] = organizationId;
    }

    // CE bearer token (sessionStorage) always takes priority — it carries the
    // database user UUID and is set after both CE login and EE token-exchange.
    const ce = getCeBearerToken();
    if (ce) {
      defaultHeaders['Authorization'] = `Bearer ${ce}`;
    } else if (useSupabaseForApiAuth() && supabase) {
      // EE fallback: use raw Supabase session (pre-exchange or Keycloak flow).
      try {
        let {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          const { data: refreshed, error } = await supabase.auth.refreshSession();
          if (!error && refreshed?.session?.access_token) {
            session = refreshed.session;
          }
        }
        if (session?.access_token) {
          defaultHeaders['Authorization'] = `Bearer ${session.access_token}`;
        }
      } catch (error) {
        console.warn('Failed to get Supabase session:', error);
      }
    }
  }

  // Normalize endpoint: remove leading/trailing slashes and handle double 'api/' prefix
  let normalizedEndpoint = endpoint.replace(/^\/+/, '').replace(/\/+$/, '');
  // If endpoint already starts with 'api/', remove it to avoid double prefix when API_URL is '/api'
  if (normalizedEndpoint.startsWith('api/') && API_URL === '/api') {
    normalizedEndpoint = normalizedEndpoint.substring(4); // Remove 'api/' prefix
  }

  // Determine which base URL to use based on the endpoint
  const isAuthEndpoint =
    normalizedEndpoint.startsWith('v1/enterprise/auth/') ||
    normalizedEndpoint.startsWith('enterprise/auth/') ||
    normalizedEndpoint.startsWith('v1/organizations/') ||
    normalizedEndpoint.startsWith('v1/projects/') ||
    normalizedEndpoint.startsWith('v1/pricing') ||
    normalizedEndpoint.startsWith('v1/ai-usage/');

  const baseUrl = isAuthEndpoint ? (typeof window !== 'undefined' ? '' : AUTH_URL) : API_URL;

  // When calling auth endpoints from the browser, use the same-origin proxy
  // at `/api/auth/...` to ensure proper routing.
  const url =
    isAuthEndpoint && typeof window !== 'undefined'
      ? `/api/auth/${normalizedEndpoint}`
      : `${baseUrl}/${normalizedEndpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    cache: 'no-store', // Prevent 304 cached responses — conversations/messages must be fresh
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  // Check if response is ok
  if (!response.ok) {
    const errorText = await response.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      // not JSON — leave parsed as null
    }

    // FastAPI structured errors: {"detail": { "error": "...", "message": "..." }}
    if (parsed && typeof parsed.detail === 'object' && parsed.detail !== null) {
      throw new ApiError(response.status, parsed.detail, errorText);
    }

    // Simple detail string or error string
    let message = errorText;
    if (parsed && typeof parsed.detail === 'string') {
      message = parsed.detail;
    } else if (parsed && typeof parsed.error === 'string') {
      message = parsed.error;
    }
    throw new ApiError(response.status, message, errorText);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  // 304 Not Modified has empty body — would fail JSON parse; treat as error and retry
  if (response.status === 304) {
    throw new Error('API returned 304 (cached) — please retry');
  }

  // Parse and return JSON
  return await response.json();
};
