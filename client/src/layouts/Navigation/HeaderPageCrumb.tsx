'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { NAV_LABEL_KEYS, NAV_ROUTES, selectedKeyForPathname } from './navConfig';

/**
 * The current page, as the last step of the header's "organization › project" trail, instead of
 * a breadcrumb row of its own. Inside an item (a sheet, a notebook, a dashboard) it links back
 * to the list. Uses the sidebar's labels (NAV_LABEL_KEYS) so the two never drift apart.
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
  const label = t(labelKey);

  return (
    <>
      {withSeparator ? <span className="header-workspace-separator" aria-hidden="true">›</span> : null}
      {inside ? (
        <Link href={listPath} className="header-page-crumb header-page-crumb--link">{label}</Link>
      ) : (
        <span className="header-page-crumb" aria-current="page">{label}</span>
      )}
    </>
  );
}

export default HeaderPageCrumb;
