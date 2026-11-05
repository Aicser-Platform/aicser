'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/utils/api';

export type MenuLevel = 'everyone' | 'admins' | 'off';
export type OrgMenu = Record<string, MenuLevel>;

export const ORG_MENU_KEY = ['org-menu'];

const isEnterprise = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase());

/** What the organization shows in the menu. Assistants stay out until the answer arrives, so they don't flash. */
export function useOrgMenu(): OrgMenu {
  const { data, isError } = useQuery({
    queryKey: ORG_MENU_KEY,
    queryFn: () => fetchApi<{ items: OrgMenu }>('/api/organizations/me/menu'),
    enabled: isEnterprise,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!isEnterprise || isError) return {};
  return data?.items ?? { agents: 'off' };
}
