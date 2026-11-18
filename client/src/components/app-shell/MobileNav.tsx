'use client';

import React from 'react';
import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/aicser-ui/sheet';
import { useAiAvailability } from '@/hooks/useAiAvailability';
import { useOrgMenu } from '@/hooks/useOrgMenu';
import { usePermissions } from '@/hooks/usePermissions';
import { Permission } from '@/constants/permissions';
import { cn } from '@/lib/ui/utils';
import { filterSidebarItems, linkAllowed } from '@/layouts/Navigation/navConfig';
import {
  CE_MOBILE_TABS,
  EE_MOBILE_TABS,
  communityMoreNavItems,
  enterpriseMoreNavItems,
  isMoreNavActive,
} from '@/layouts/Navigation/mobileNavConfig';
import { NAV_ICONS } from './navIcons';
import { isEnterpriseEdition, useHasFeature, useSelectedNavKey } from './useNavItems';

const tabClass =
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border-0 bg-transparent px-1 text-[11px] font-medium text-muted-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:text-primary-hover dark:data-[active=true]:text-primary [&_svg]:size-5';

/** Phones and small tablets (< 992px): four tabs and More (everything else, in the sidebar's order). */
export function MobileNav() {
  const t = useTranslations('nav');
  const selected = useSelectedNavKey();
  const [moreOpen, setMoreOpen] = React.useState(false);
  // validate=false: only "configured" is read; Settings validates keys when they're saved.
  const aiAvailability = useAiAvailability(false, isEnterpriseEdition);
  const showAiNav = isEnterpriseEdition && aiAvailability.configured;
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const menu = useOrgMenu();
  const hasFeature = useHasFeature();
  const isAdmin = hasPermission(Permission.ORG_EDIT);

  const tabs = (
    isEnterpriseEdition
      ? showAiNav
        ? EE_MOBILE_TABS
        : EE_MOBILE_TABS.filter((tab) => tab.key !== 'chat')
      : CE_MOBILE_TABS
  ).filter((tab) => linkAllowed(tab.key, { menu, isAdmin }));
  const moreItems = React.useMemo(() => {
    const raw = isEnterpriseEdition ? enterpriseMoreNavItems() : communityMoreNavItems();
    if (!isEnterpriseEdition) return raw;
    return filterSidebarItems(raw, {
      hasFeature,
      hasPermission: permissionsLoading ? undefined : (code) => hasPermission(code as Permission),
      menu,
      isAdmin,
    });
  }, [hasFeature, hasPermission, permissionsLoading, menu, isAdmin]);
  const moreActive = isMoreNavActive(selected, isEnterpriseEdition, showAiNav);

  return (
    <>
      <nav
        aria-label={t('mobile_primary_nav')}
        className="mobile-bottom-nav no-print shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
      >
        <ul className="m-0 mx-auto flex h-14 max-w-[560px] list-none items-stretch gap-1 px-1 py-1">
          {tabs.map((tab) => {
            const Icon = NAV_ICONS[tab.key];
            const active = selected === tab.key;
            return (
              <li key={tab.key} className="flex min-w-0 flex-1">
                <Link
                  href={tab.href}
                  className={tabClass}
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  {Icon ? <Icon aria-hidden /> : null}
                  <span className="max-w-full truncate">{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              className={tabClass}
              data-active={moreActive || moreOpen}
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <Ellipsis aria-hidden />
              <span>{t('more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{t('more')}</SheetTitle>
          </SheetHeader>
          <ul className="m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-2 pb-4">
            {moreItems.map((item, index) => {
              if (item.kind === 'divider')
                return <li key={`divider-${index}`} role="separator" className="mx-2 my-1 h-px bg-border/50" />;
              const links = item.kind === 'link' ? [item] : item.children;
              return links.map((link) => {
                const Icon = NAV_ICONS[link.key];
                const active = selected === link.key;
                return (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      onClick={() => setMoreOpen(false)}
                      data-active={active}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-sm text-foreground no-underline hover:bg-accent data-[active=true]:bg-accent data-[active=true]:font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground'
                      )}
                    >
                      {Icon ? <Icon aria-hidden /> : null}
                      <span className="truncate">{t(link.labelKey)}</span>
                    </Link>
                  </li>
                );
              });
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
