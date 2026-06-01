'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const STORAGE_KEY = 'discover_referral_code';

/** Persist ?ref= handle for attribution on views and remix. */
export function useDiscoverReferral(): string | null {
  const searchParams = useSearchParams();
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    const ref = searchParams.get('ref')?.trim();
    if (ref) {
      const clean = ref.replace(/^@/, '');
      try {
        sessionStorage.setItem(STORAGE_KEY, clean);
      } catch {
        /* ignore */
      }
      setStored(clean);
      return;
    }
    try {
      setStored(sessionStorage.getItem(STORAGE_KEY));
    } catch {
      setStored(null);
    }
  }, [searchParams]);

  return stored;
}

export function getStoredDiscoverReferral(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function buildDiscoverShareUrl(postId: string, refHandle?: string | null): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}/discover/${postId}`;
  const ref = refHandle?.trim().replace(/^@/, '');
  if (!ref) return base;
  return `${base}?ref=${encodeURIComponent(ref)}`;
}
