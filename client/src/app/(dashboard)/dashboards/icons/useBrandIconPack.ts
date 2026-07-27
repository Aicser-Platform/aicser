'use client';

import { useMemo } from 'react';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { buildBrandIconPack, type BrandIconPackItem } from './brandIconPack';

export function useBrandIconPack(): BrandIconPackItem[] {
  const org = useOrganizationStore((s) => s.currentOrganization);
  return useMemo(() => buildBrandIconPack(org), [org]);
}
