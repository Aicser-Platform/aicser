'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/utils/api';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';

export type AiAvailability = {
  loading: boolean;
  available: boolean;
  configured: boolean;
  platformAvailable: boolean;
  byokAvailable: boolean;
  reason: string;
};

const DISABLED: AiAvailability = {
  loading: false,
  available: false,
  configured: false,
  platformAvailable: false,
  byokAvailable: false,
  reason: 'frontend_disabled',
};

export function useAiAvailability(validate = true, enabled = true): AiAvailability {
  const [state, setState] = useState<AiAvailability>(() => (
    enabled && isAiFrontendEnabled() ? { ...DISABLED, loading: true, reason: 'checking' } : DISABLED
  ));

  useEffect(() => {
    if (!enabled || !isAiFrontendEnabled()) {
      setState(DISABLED);
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    fetchApi(`ai/availability?validate=${validate ? 'true' : 'false'}`)
      .then((data) => {
        if (cancelled) return;
        setState({
          loading: false,
          available: data?.available === true,
          configured: data?.configured === true,
          platformAvailable: data?.platform_available === true,
          byokAvailable: data?.byok_available === true,
          reason: typeof data?.reason === 'string' ? data.reason : 'unknown',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ ...DISABLED, reason: 'availability_check_failed' });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, validate]);

  return state;
}
