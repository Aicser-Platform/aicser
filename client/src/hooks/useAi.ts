import { useQuery } from '@tanstack/react-query';
import { getAiModels } from '@/api/ai';

export const aiKeys = {
  models: ['ai', 'models'] as const,
};

export function useAiModels() {
  return useQuery({
    queryKey: aiKeys.models,
    queryFn: getAiModels,
    staleTime: 60_000,
  });
}
