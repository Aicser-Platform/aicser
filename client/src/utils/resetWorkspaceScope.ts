import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

/**
 * Clear all localStorage data on logout.
 * Preserves user device display preferences (theme & locale) so that
 * the login page does not unexpectedly flash or switch languages.
 */
export function clearLocalStorageOnLogout(): void {
  if (typeof window === 'undefined') return;
  try {
    const locale = window.localStorage.getItem('aiser_locale');
    const darkMode = window.localStorage.getItem('darkMode');
    const themeMode = window.localStorage.getItem('aicser_theme_mode');
    const brandTheme = window.localStorage.getItem('aicser_brand_theme');

    window.localStorage.clear();

    if (locale) window.localStorage.setItem('aiser_locale', locale);
    if (darkMode) window.localStorage.setItem('darkMode', darkMode);
    if (themeMode) window.localStorage.setItem('aicser_theme_mode', themeMode);
    if (brandTheme) window.localStorage.setItem('aicser_brand_theme', brandTheme);
  } catch (e) {
    console.warn('Failed to clear localStorage on logout:', e);
  }
}

/**
 * Clear persisted org/project/conversation selection AND cached queries
 * so a new login does not reuse stale IDs or data.
 */
export function resetWorkspaceScope(): void {
  useOrganizationStore.getState().setCurrentOrganization(null);
  useProjectStore.getState().clearProject();

  // Reset conversation store so in-memory messages & active conversation ID are wiped
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useConversationStore } = require('@/stores/useConversationStore');
    if (typeof useConversationStore?.getState === 'function') {
      const convStore = useConversationStore.getState();
      convStore.reset?.();
      convStore.setCurrentConversationId?.(null);
    }
  } catch {
    // Non-fatal if conversation store is unavailable
  }

  // Clear all localStorage entries
  clearLocalStorageOnLogout();

  // Deferred/dynamic import: Providers.tsx (which owns the QueryClient) sits
  // above this module in the app's import graph, so a static top-of-file
  // import here risks a require cycle.
  import('@/components/Providers/Providers')
    .then(({ queryClient }) => queryClient?.clear())
    .catch(() => {
      // Non-fatal: a stale query cache entry alone just means one extra
      // background refetch once Header.tsx's org-reconciliation effect runs.
    });
}

