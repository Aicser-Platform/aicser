'use client';

/**
 * Pages brought over from aicser-desktop (TanStack Router) use `Link to="/x/$id" params={{ id }}` and
 * `navigate({ to, params, search })`; these map that onto Next's router so their markup ports unchanged.
 */
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type Params = Record<string, string | number>;
type Search = Record<string, string | number | boolean | null | undefined>;
export type To = { to: string; params?: Params; search?: Search; hash?: string };

/** "/prepare/$recipeId" + { recipeId } → "/prepare/abc", plus ?search and #hash. */
export function hrefFor({ to, params, search, hash }: To): string {
  let path = to.replace(/\$([A-Za-z_]\w*)/g, (_, name: string) => encodeURIComponent(String(params?.[name] ?? '')));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  if (qs) path += `?${qs}`;
  if (hash) path += `#${hash}`;
  return path;
}

export const Link = React.forwardRef<
  HTMLAnchorElement,
  Omit<React.ComponentProps<'a'>, 'href'> & To & { replace?: boolean }
>(function Link({ to, params, search, hash, replace, ...props }, ref) {
  return <NextLink ref={ref} href={hrefFor({ to, params, search, hash })} replace={replace} {...props} />;
});

export function useNavigate() {
  const router = useRouter();
  return React.useCallback(
    async (target: To & { replace?: boolean }) => {
      const href = hrefFor(target);
      if (target.replace) router.replace(href);
      else router.push(href);
    },
    [router]
  );
}
