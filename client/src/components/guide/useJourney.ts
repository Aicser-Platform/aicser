'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/utils/api';
import type { Journey } from './guides';

const KEY = ['onboarding-journey'];

/** The person's progress. Polls while a tour waits for them, and closely once they've acted. */
export function useJourney(watching = false, acted = false) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchApi<Journey>('/api/onboarding/journey'),
    staleTime: 60_000,
    refetchInterval: acted ? 1_000 : watching ? 5_000 : false,
  });
}

export function useSaveGuide() {
  const client = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (state: { guide: string; status: 'active' | 'done' | 'dismissed'; step: number }) =>
      fetchApi('/api/onboarding/journey', { method: 'POST', body: JSON.stringify(state) }),
    onMutate: ({ guide, status, step }) => {
      client.setQueryData<Journey>(KEY, (old) =>
        old ? { ...old, guides: { ...old.guides, [guide]: { status, step } } } : old);
    },
  });
  return useCallback(
    (guide: string, status: 'active' | 'done' | 'dismissed', step = 0) => mutate({ guide, status, step }),
    [mutate],
  );
}
