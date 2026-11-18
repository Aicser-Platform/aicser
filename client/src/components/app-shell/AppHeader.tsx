'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, Plus, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import { Separator } from '@/components/aicser-ui/separator';
import { SidebarTrigger, useSidebar } from '@/components/aicser-ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/aicser-ui/tooltip';
import { GuideLauncher } from '@/components/guide/GuideLauncher';
import { NAV_LABEL_KEYS, NAV_ROUTES } from '@/layouts/Navigation/navConfig';
import { useHeaderStore } from '@/stores/useHeaderStore';
import { asDynamicModule } from '@/utils/asDynamicModule';
import { UserMenu } from './UserMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { isEnterpriseEdition, useSelectedNavKey } from './useNavItems';

const ThemeCustomizer = dynamic(
  () =>
    import('@/ee-lazy/ThemeCustomizer').then((m) =>
      asDynamicModule<{ open?: boolean; onClose?: () => void }>(m.ThemeCustomizer, () => null)
    ),
  { ssr: false }
);
const SandboxBar = dynamic(
  () => import('@/ee-lazy/SandboxBar').then((m) => asDynamicModule(m.SandboxBar, () => null)),
  { ssr: false }
);
const ActivityInboxBell = dynamic(
  () => import('@/ee-lazy/ActivityInboxBell').then((m) => asDynamicModule(m.ActivityInboxBell, () => null)),
  { ssr: false }
);

/** Inside an item of a list (a sheet, a notebook): the way back to the list, as the trail's last step. */
function PageCrumb({ withSeparator }: { withSeparator: boolean }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const key = useSelectedNavKey();
  const labelKey = key ? NAV_LABEL_KEYS[key] : undefined;
  if (!key || !labelKey) return null;
  const listPath = (NAV_ROUTES[key] || '').split('?')[0];
  if (!listPath || !pathname || pathname === listPath || !pathname.startsWith(`${listPath}/`)) return null;
  return (
    <>
      {withSeparator ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <Link
        href={listPath}
        className="max-w-[220px] truncate rounded px-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground hover:underline"
      >
        {t(labelKey)}
      </Link>
    </>
  );
}

function IconAction({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

type Props = {
  isMobile: boolean;
  onOpenDataSourceModal?: () => void;
  /** No data source yet: a dot on Connect so first-time users notice it. */
  highlightConnectData?: boolean;
  /** Data sources failing to connect, shown up front instead of only in Settings. */
  failedDataSourcesCount?: number;
};

/** Desktop-style header: sidebar toggle · organization › project › page · search, actions, account. */
export function AppHeader({
  isMobile,
  onOpenDataSourceModal,
  highlightConnectData = false,
  failedDataSourcesCount = 0,
}: Props) {
  const t = useTranslations('header');
  const router = useRouter();
  const { open } = useSidebar();
  const { extraLeft, extraRight } = useHeaderStore();
  const [customizerOpen, setCustomizerOpen] = React.useState(false);
  const [shortcut, setShortcut] = React.useState('Ctrl K');

  React.useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setShortcut('⌘K');
  }, []);
  // Opened from the account menu, with the other appearance choices.
  React.useEffect(() => {
    const show = () => setCustomizerOpen(true);
    window.addEventListener('open-theme-customizer', show);
    return () => window.removeEventListener('open-theme-customizer', show);
  }, []);

  const connectLabel = highlightConnectData ? t('connect_first_data_source') : t('connect_data_source');
  const failingLabel = t('data_sources_failing', { count: failedDataSourcesCount });

  return (
    <header className="layout-app-header no-print flex h-[var(--app-header-height,52px)] shrink-0 items-center gap-1.5 border-b bg-background px-2 sm:px-3">
      {isMobile ? (
        // eslint-disable-next-line @next/next/no-img-element -- a 28px static logo
        <img src="/aiser-logo.png" alt="" className="size-7 shrink-0 rounded-md" />
      ) : (
        <>
          <SidebarTrigger label={open ? t('collapse_sidebar') : t('open_sidebar')} />
          <Separator orientation="vertical" className="mx-1 h-4" />
        </>
      )}

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {isEnterpriseEdition ? <WorkspaceSwitcher compact={isMobile} /> : null}
        {!isMobile ? <PageCrumb withSeparator={isEnterpriseEdition} /> : null}
      </nav>
      {extraLeft}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {extraRight}
        {failedDataSourcesCount > 0 ? (
          <IconAction label={failingLabel}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              aria-label={failingLabel}
              onClick={() => router.push('/settings?tab=data-sources')}
            >
              <TriangleAlert />
            </Button>
          </IconAction>
        ) : null}
        {isEnterpriseEdition ? <SandboxBar /> : null}
        {/* Same as ⌘K / Ctrl K: pages, settings and everything people have named. */}
        <Button
          variant="outline"
          size={isMobile ? 'icon-sm' : 'sm'}
          className="text-muted-foreground sm:w-48 sm:justify-start"
          aria-label={t('search')}
          onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
        >
          <Search />
          {!isMobile ? (
            <>
              <span>{t('search')}</span>
              <kbd className="ml-auto rounded border bg-muted px-1 font-sans text-[10px]">{shortcut}</kbd>
            </>
          ) : null}
        </Button>
        {onOpenDataSourceModal ? (
          <IconAction label={connectLabel}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative text-primary-hover dark:text-primary"
              aria-label={connectLabel}
              data-guide="connect-data"
              onClick={onOpenDataSourceModal}
            >
              <Plus />
              {highlightConnectData ? (
                <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
              ) : null}
            </Button>
          </IconAction>
        ) : null}
        <GuideLauncher />
        {isEnterpriseEdition ? <ActivityInboxBell /> : null}
        <UserMenu />
      </div>

      {isEnterpriseEdition ? <ThemeCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} /> : null}
    </header>
  );
}
