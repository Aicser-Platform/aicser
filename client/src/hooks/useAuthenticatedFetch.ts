import { useCallback } from 'react';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { fetchApi } from '@/utils/api';

/**
 * Hook that provides an authenticated fetch function.
 * Automatically adds Bearer token from Supabase session to requests.
 * 
 * Only works in client-side components (uses React hooks).
 * For server-side code, use fetchApi directly and pass Authorization header.
 * 
 * @returns An authenticated fetch function that automatically includes Bearer token
 */
export const useAuthenticatedFetch = () => {
  const { session } = useAuth();
  const token = session?.access_token;

  const authenticatedFetch = useCallback(
    async (endpoint: string, options: RequestInit = {}): Promise<any> => {
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      };

      // Add Authorization header if token is available
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // fetchApi already checks response.ok, parses JSON, and throws on errors
      return fetchApi(endpoint, {
        ...options,
        headers,
      });
    },
    [token]
  );

  return authenticatedFetch;
};
