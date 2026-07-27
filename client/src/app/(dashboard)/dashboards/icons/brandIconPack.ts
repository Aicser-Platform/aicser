import type { Organization } from '@/types/organization.type';

export type BrandIconPackItem = {
  key: string;
  label: string;
  kind: 'emoji' | 'image' | 'antd';
  value: string;
  color?: string;
};

/**
 * Build org brand icon pack (Phase 3).
 * Uses org emoji, logo, and accent-tinted Ant icons — no server schema change required.
 */
export function buildBrandIconPack(org?: Organization | null): BrandIconPackItem[] {
  if (!org) return [];

  const items: BrandIconPackItem[] = [];
  const logo =
    org.settings?.branding?.logo_url ||
    org.logo_url ||
    null;
  const emoji = org.icon_emoji?.trim() || null;
  const color = org.color?.trim() || undefined;
  const appName = org.settings?.branding?.app_name || org.name;

  if (logo) {
    items.push({
      key: 'logo',
      label: `${appName} logo`,
      kind: 'image',
      value: logo,
    });
  }
  if (emoji) {
    items.push({
      key: 'emoji',
      label: `${appName} emoji`,
      kind: 'emoji',
      value: emoji,
    });
  }

  const accents: { key: string; label: string; antd: string }[] = [
    { key: 'accent-dashboard', label: 'Brand dashboard', antd: 'DashboardOutlined' },
    { key: 'accent-metric', label: 'Brand metric', antd: 'NumberOutlined' },
    { key: 'accent-growth', label: 'Brand growth', antd: 'RiseOutlined' },
    { key: 'accent-team', label: 'Brand team', antd: 'TeamOutlined' },
    { key: 'accent-target', label: 'Brand target', antd: 'AimOutlined' },
  ];

  accents.forEach((a) => {
    items.push({
      key: a.key,
      label: a.label,
      kind: 'antd',
      value: a.antd,
      color,
    });
  });

  return items;
}
