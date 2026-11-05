'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { NAV_LABEL_KEYS, NAV_ROUTES, selectedKeyForPathname } from './navConfig';

/**
 * The way back to a list from inside one of its items (a sheet, a notebook, a model), as the last
 * step of the header's "organization › project" trail. On the list page itself it is left out: the
 * page title already names it and the sidebar shows where you are. Uses the sidebar's labels.
 */
export function HeaderPageCrumb({ withSeparator }: { withSeparator: boolean }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : null;
  const key = selectedKeyForPathname(pathname, search);
  const labelKey = key ? NAV_LABEL_KEYS[key] : undefined;
  if (!key || !labelKey) return null;

  const listPath = (NAV_ROUTES[key] || '').split('?')[0];
  const inside = Boolean(listPath && pathname && pathname !== listPath && pathname.startsWith(`${listPath}/`));
  if (!inside) return null;

  return (
    <>
      {withSeparator ? <span className="header-workspace-separator" aria-hidden="true">›</span> : null}
      <Link href={listPath} className="header-page-crumb header-page-crumb--link">{t(labelKey)}</Link>
    </>
  );
}

export default HeaderPageCrumb;
