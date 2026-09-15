import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

/**
 * Clear persisted org/project selection AND cached org/project-scoped
 * queries so a new login does not reuse stale IDs.
 *
 * Clearing the Zustand-persisted currentOrganization/currentProject alone
 * isn't enough: React Query's `organizations`/`projects` query keys aren't
 * scoped by user identity (a deliberate simplification, not a bug on its
 * own), so a second account logging in on the same tab would still see the
 * *previous* account's cached list -- and Header.tsx's "pick a valid org if
 * the current one no longer is" effect would then run against that stale
 * list and silently re-select an org the new user has no access to,
 * producing 403s on every org-scoped request with no obvious cause.
 */
export function resetWorkspaceScope(): void {
  useOrganizationStore.getState().setCurrentOrganization(null);
  useProjectStore.getState().clearProject();
  // Deferred/dynamic import: Providers.tsx (which owns the QueryClient) sits
  // above this module in the app's import graph, so a static top-of-file
  // import here risks a require cycle. The Zustand-level clear above is the
  // part that must happen synchronously (it's what stops a wrong org/project
  // from actually being *used*); clearing the query cache can safely finish
  // a tick later.
  import('@/components/Providers/Providers')
    .then(({ queryClient }) => queryClient?.clear())
    .catch(() => {
      // Non-fatal: a stale query cache entry alone just means one extra
      // background refetch once Header.tsx's org-reconciliation effect runs.
    });
}
