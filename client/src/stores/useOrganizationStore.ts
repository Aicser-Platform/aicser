import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { fetchApi } from '@/utils/api';
import type { Organization } from '@/types/organization.type';

interface OrganizationUIState {
  currentOrganization: Organization | null;
  setCurrentOrganization: (org: Organization | null) => void;
  uploadLogo: (file: File) => Promise<string | null>;
  logoUploading: boolean;
}

export const useOrganizationStore = create<OrganizationUIState>()(
  devtools(
    persist(
      (set, get) => ({
        currentOrganization: null,
        logoUploading: false,
        setCurrentOrganization: (org) => set({ currentOrganization: org }),
        uploadLogo: async (file: File) => {
          set({ logoUploading: true });
          try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetchApi<{ success?: boolean; logo_url?: string }>(
              'organizations/me/logo',
              { method: 'POST', body: formData },
            );
            const url = res?.logo_url;
            if (!url) throw new Error('No logo URL returned from server');

            const current = get().currentOrganization;
            if (current) {
              set({
                currentOrganization: {
                  ...current,
                  logo_url: url,
                  settings: {
                    ...(current.settings ?? {}),
                    branding: {
                      ...(current.settings?.branding ?? {}),
                      logo_url: url,
                    },
                  },
                },
                logoUploading: false,
              });
            } else {
              set({ logoUploading: false });
            }
            return url;
          } catch (error) {
            set({ logoUploading: false });
            throw error;
          }
        },
      }),
      {
        name: 'organization-storage',
        storage: createJSONStorage(() => localStorage),
      },
    ),
    { name: 'OrganizationStore' },
  ),
);
