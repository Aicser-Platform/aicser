import { useMutation, useQuery } from '@tanstack/react-query';
import { getAiModels, generateSql, type GenerateSqlPayload } from '@/api/ai';

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

export function useGenerateSql() {
  return useMutation({
    mutationFn: (payload: GenerateSqlPayload) => generateSql(payload),
  });
}
