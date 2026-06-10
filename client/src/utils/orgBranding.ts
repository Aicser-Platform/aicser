import type { Organization } from '@/types/organization.type';

type OrganizationWithBranding = Organization & {
  logo_url?: string | null;
  settings?: { branding?: { logo_url?: string | null; app_name?: string | null } } | null;
};

export function getOrganizationBranding(org: Organization | null | undefined) {
  const o = org as OrganizationWithBranding | null | undefined;
  const logoUrl = o?.logo_url || o?.settings?.branding?.logo_url || null;
  const name = o?.settings?.branding?.app_name?.trim() || o?.name?.trim() || '';
  return { logoUrl, name };
}

export function getOrganizationInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}
