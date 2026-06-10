import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

/** Clear persisted org/project selection so a new login does not reuse stale IDs. */
export function resetWorkspaceScope(): void {
  useOrganizationStore.getState().setCurrentOrganization(null);
  useProjectStore.getState().clearProject();
}
