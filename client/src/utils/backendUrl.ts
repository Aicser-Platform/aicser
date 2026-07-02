// Server-side proxy should use service name in Docker; browser uses NEXT_PUBLIC_API_URL

export const getBackendUrl = (): string => {
  const raw =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://localhost:8000';
  return raw.replace(/\/$/, '');
};

/** Used by API route proxy (server-side). Prefer API_TARGET for Docker (chat2chart-server). */
export const getBackendUrlForApi = (): string => {
  const raw =
    process.env.API_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000';
  return raw.replace(/\/$/, '');
};

/**
 * Next.js server-side proxy → FastAPI. Prefer API_TARGET (Docker service name) so
 * `localhost:8000` inside the client container is not used by mistake.
 */
export const getBackendUrlForProxy = (): string => {
  const raw =
    process.env.API_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://localhost:8000';
  return raw.replace(/\/$/, '');
};
