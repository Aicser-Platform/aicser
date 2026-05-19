import { useQuery, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

/**
 * Hook that wraps React Query's useQuery with automatic Bearer token authentication.
 * Automatically gets token from Supabase session and adds it to request headers.
 * 
 * @param queryKey - React Query query key
 * @param queryFn - Query function that receives the access token as first parameter
 * @param options - Additional React Query options
 * @returns React Query useQuery result
 */
export function useAuthenticatedQuery<TData = unknown, TError = Error>(
  queryKey: unknown[],
  queryFn: (token: string) => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'>
): UseQueryResult<TData, TError> {
  const { session } = useAuth();
  const token = session?.access_token;

  return useQuery<TData, TError>({
    ...options,
    queryKey: [...queryKey, token], // Include token in key for proper cache invalidation
    queryFn: () => {
      if (!token) {
        throw new Error('No access token available');
      }
      return queryFn(token);
    },
    enabled: !!token && (options?.enabled !== false),
  });
}
