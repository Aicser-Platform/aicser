/** Network errors worth retrying when the FastAPI dev server is reloading. */
import { getBackendUrlForProxy } from '@/utils/backendUrl';
function isRetriableProxyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { cause?: { code?: string; name?: string } };
  const code = (e as NodeJS.ErrnoException).code;
  const causeCode = e.cause?.code;
  const causeName = e.cause?.name;
  return (
    e.name === 'AbortError' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ETIMEDOUT' ||
    causeName === 'HeadersTimeoutError' ||
    e.message.includes('fetch failed')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BackendFetchOptions = RequestInit & {
  /** Per-attempt timeout in ms (default 12s). */
  timeoutMs?: number;
  /** Retry count after the first attempt (default 3). */
  retries?: number;
};

/**
 * Fetch the FastAPI backend with timeout + retry.
 * Handles transient ECONNRESET while uvicorn --reload restarts in dev.
 */
export async function fetchBackendWithRetry(
  url: string,
  options: BackendFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 12_000, retries = 3, ...fetchInit } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      lastError = err;
      if (!isRetriableProxyError(err) || attempt >= retries) break;
      await sleep(250 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

const FALLBACK_BACKENDS = ['http://chat2chart-server:8000', 'http://localhost:8000'];

/** Resolve backend base URL candidates (primary first). */
export function backendCandidates(primary: string): string[] {
  const normalized = primary.replace(/\/$/, '');
  return [normalized, ...FALLBACK_BACKENDS.filter((b) => b !== normalized)];
}

/**
 * Try primary (and fallback) backend hosts with retry per host.
 * Returns the first successful response or null if all fail.
 */
export async function fetchBackendUrlWithRetry(
  buildUrl: (backendBase: string) => string,
  options: BackendFetchOptions = {},
): Promise<Response | null> {
  const candidates = backendCandidates(getBackendUrlForProxy());

  for (const backend of candidates) {
    try {
      return await fetchBackendWithRetry(buildUrl(backend), options);
    } catch {
      // try next backend host
    }
  }
  return null;
}
