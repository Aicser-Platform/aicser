import { useMutation, UseMutationOptions, UseMutationResult } from '@tanstack/react-query';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

/**
 * Hook that wraps React Query's useMutation with automatic Bearer token authentication.
 * Automatically gets token from Supabase session and adds it to request headers.
 * 
 * @param mutationFn - Mutation function that receives the access token as first parameter, then variables
 * @param options - Additional React Query mutation options
 * @returns React Query useMutation result
 */
export function useAuthenticatedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown
>(
  mutationFn: (token: string, variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'mutationFn'>
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { session } = useAuth();
  const token = session?.access_token;

  return useMutation<TData, TError, TVariables, TContext>({
    ...options,
    mutationFn: (variables: TVariables) => {
      if (!token) {
        throw new Error('No access token available');
      }
      return mutationFn(token, variables);
    },
  });
}
