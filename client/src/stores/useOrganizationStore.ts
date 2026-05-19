import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import type { Organization } from '@/types/organization.type';

interface OrganizationUIState {
  currentOrganization: Organization | null;
  setCurrentOrganization: (org: Organization | null) => void;
}

export const useOrganizationStore = create<OrganizationUIState>()(
  devtools(
    persist(
      (set) => ({
        currentOrganization: null,
        setCurrentOrganization: (org) => set({ currentOrganization: org }),
      }),
      {
        name: 'organization-storage',
        storage: createJSONStorage(() => localStorage),
      }
    ),
    { name: 'OrganizationStore' }
  )
);
