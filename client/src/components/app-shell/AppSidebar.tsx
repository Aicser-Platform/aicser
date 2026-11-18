'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/aicser-ui/sidebar';
import { NAV_HINT_KEYS, NAV_ROUTES, NAV_LABEL_KEYS, type NavLinkDef } from '@/layouts/Navigation/navConfig';
import { preloadRoute } from '@/layouts/Navigation/routePreload';
import { NAV_ICONS } from './navIcons';
import { isEnterpriseEdition, useSelectedNavKey, useSidebarItems } from './useNavItems';

const FOLD_STORAGE_KEY = 'aicser.nav.folded';
const CHAT_PRELOAD_DELAY_MS = 3000;

function readFolded(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FOLD_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeFolded(value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable: folding still works for this visit
  }
}

function NavMenuItem({ link, active }: { link: NavLinkDef; active: boolean }) {
  const t = useTranslations('nav');
  const Icon = NAV_ICONS[link.key];
  const label = t(link.labelKey);
  const hintKey = NAV_HINT_KEYS[link.key];
  const hint = hintKey ? t(hintKey) : undefined;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={hint ? `${label} — ${hint}` : label}>
        <Link href={link.href} title={hint} data-guide={`nav-${link.key}`} onMouseEnter={() => preloadRoute(link.href)}>
          {Icon ? <Icon aria-hidden /> : null}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Web sidebar in the desktop's style: top links, then foldable sections; a 48px icon rail when collapsed. */
export function AppSidebar() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tHeader = useTranslations('header');
  const selected = useSelectedNavKey();
  const { items, defaultFolded, viewsOnly, essentialsOnly, toggleAllTools } = useSidebarItems();
  const brand = isEnterpriseEdition ? tCommon('brand_name') : `${tCommon('brand_name')} Community Edition`;

  // The person's own folding (remembered) over the role default; the section holding the current page stays open.
  const [folded, setFolded] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setFolded(readFolded()), []);
  const activeSection = React.useMemo(() => {
    for (const item of items) {
      if (item.kind === 'section' && item.children.some((c) => c.key === selected)) return item.key;
    }
    return null;
  }, [items, selected]);
  const isFolded = (key: string) => key !== activeSection && (folded[key] ?? defaultFolded.includes(key));
  const toggle = (key: string) => {
    setFolded((current) => {
      const next = { ...current, [key]: !isFolded(key) };
      writeFolded(next);
      return next;
    });
  };

  // Ask is where most sessions go next: have it ready once the first page has settled.
  React.useEffect(() => {
    const id = window.setTimeout(() => preloadRoute('/chat'), CHAT_PRELOAD_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  const settings: NavLinkDef = { key: 'settings', labelKey: NAV_LABEL_KEYS.settings, href: NAV_ROUTES.settings };

  return (
    <Sidebar
      aria-label={t('mobile_primary_nav')}
      style={{ background: 'var(--color-bg-navigation-sider, rgb(var(--ui-sidebar)))' }}
    >
      <SidebarHeader className="h-[var(--app-header-height,52px)] justify-center border-b py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="h-10 hover:bg-transparent">
              <Link href={NAV_ROUTES.dashboards} aria-label={brand}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a 32px static logo; next/image adds nothing here */}
                <img src="/aiser-logo.png" alt="" className="size-8 shrink-0 rounded-md" />
                <span className="truncate text-base font-semibold">{brand}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="py-1">
        {items.map((item, index) => {
          if (item.kind === 'divider')
            return <div key={`divider-${index}`} className="mx-3 my-1 h-px bg-sidebar-border/40" />;
          if (item.kind === 'link') {
            return (
              <SidebarGroup key={item.key} className="py-0">
                <SidebarMenu>
                  <NavMenuItem link={item} active={selected === item.key} />
                </SidebarMenu>
              </SidebarGroup>
            );
          }
          const sectionFolded = isFolded(item.key);
          const hintKey = NAV_HINT_KEYS[item.key];
          return (
            <SidebarGroup key={item.key} className="pt-3">
              <SidebarGroupLabel asChild>
                <button
                  type="button"
                  className="group/section w-full justify-between border-0 bg-transparent uppercase tracking-wider hover:text-sidebar-foreground"
                  aria-expanded={!sectionFolded}
                  title={hintKey ? t(hintKey) : undefined}
                  onClick={() => toggle(item.key)}
                >
                  <span>{t(item.labelKey)}</span>
                  {sectionFolded ? (
                    <ChevronRight aria-hidden />
                  ) : (
                    <ChevronDown aria-hidden className="opacity-0 group-hover/section:opacity-100" />
                  )}
                </button>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className={sectionFolded ? 'hidden group-data-[collapsible=icon]:flex' : undefined}>
                  {item.children.map((link) => (
                    <NavMenuItem key={link.key} link={link} active={selected === link.key} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t">
        {viewsOnly ? (
          <button
            type="button"
            onClick={toggleAllTools}
            className="w-fit border-0 bg-transparent px-2 text-left text-xs text-primary-hover hover:underline group-data-[collapsible=icon]:hidden dark:text-primary"
          >
            {essentialsOnly ? t('show_all_tools') : t('show_essentials')}
          </button>
        ) : null}
        <SidebarMenu>
          <NavMenuItem link={settings} active={selected === 'settings' || selected === 'billing'} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail label={tHeader('collapse_sidebar')} />
    </Sidebar>
  );
}
