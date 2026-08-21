/**
 * Settings Store - Centralized state management for all settings
 * Replaces 25+ useState hooks from Settings page
 */

import { create } from 'zustand';
import { fetchApi } from '@/utils/api';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { UserProfile } from '@/stores/useProfileStore';
import {
  SecuritySettings,
  NotificationSettings,
  AppearanceSettings,
  ApiKey,
  ProviderApiKeys,
  TeamMember,
  RBACRole,
  DataSource,
  AIModel,
  ProfileFormValues,
  SecurityFormValues,
  NotificationFormValues,
  AppearanceFormValues,
  ApiKeyFormValues,
  ProviderKeyFormValues,
} from '@/app/(dashboard)/settings/types';

interface SettingsState {
  // UI State
  activeTab: string;
  isEditingProfile: boolean;
  showApiKey: Record<string, boolean>;
  showProviderKeyModal: boolean;
  editingProvider: string | null;

  // Loading States
  loading: boolean;
  fetching: boolean;

  // Data State
  profile: UserProfile | null;
  securitySettings: SecuritySettings | null;
  notificationSettings: NotificationSettings | null;
  appearanceSettings: AppearanceSettings | null;
  apiKeys: ApiKey[];
  providerApiKeys: ProviderApiKeys;
  aiModelPreference: string;
  availableModels: AIModel[];
  teamMembers: TeamMember[];
  availableRoles: RBACRole[];
  dataSources: DataSource[];

  // Filter States
  memberSearch: string;
  memberStatusFilter: 'all' | 'active' | 'invited' | 'inactive';
  dataSourceSearch: string;
  dataSourceStatusFilter: 'all' | 'connected' | 'failed' | 'pending';

  // UI Actions
  setActiveTab: (tab: string) => void;
  setIsEditingProfile: (value: boolean) => void;
  toggleApiKeyVisibility: (keyId: string) => void;
  setShowProviderKeyModal: (show: boolean) => void;
  setEditingProvider: (provider: string | null) => void;
  setMemberSearch: (search: string) => void;
  setMemberStatusFilter: (filter: 'all' | 'active' | 'invited' | 'inactive') => void;
  setDataSourceSearch: (search: string) => void;
  setDataSourceStatusFilter: (filter: 'all' | 'connected' | 'failed' | 'pending') => void;

  // Data Actions
  loadSettingsByTab: (tab: string, orgId?: string, options?: { projectId?: string }) => Promise<void>;
  loadProfile: () => Promise<void>;
  updateProfile: (data: ProfileFormValues) => Promise<void>;
  loadSecuritySettings: () => Promise<void>;
  updateSecuritySettings: (data: SecurityFormValues) => Promise<void>;
  loadNotificationSettings: () => Promise<void>;
  updateNotificationSettings: (data: NotificationFormValues) => Promise<void>;
  loadAppearanceSettings: () => Promise<void>;
  updateAppearanceSettings: (data: AppearanceFormValues) => Promise<void>;
  loadApiKeys: () => Promise<void>;
  createApiKey: (data: ApiKeyFormValues) => Promise<ApiKey | null>;
  deleteApiKey: (keyId: string) => Promise<void>;
  loadProviderApiKeys: () => Promise<void>;
  saveProviderKey: (provider: string, data: ProviderKeyFormValues) => Promise<void>;
  loadAiModelPreference: () => Promise<void>;
  updateAiModelPreference: (model: string) => Promise<void>;
  loadAvailableModels: () => Promise<void>;
  loadTeamMembers: (orgId?: string) => Promise<void>;
  loadAvailableRoles: (scope?: string) => Promise<void>;
  updateTeamMemberRole: (orgId: string, userId: string, roleId: string) => Promise<void>;
  removeTeamMember: (orgId: string, userId: string) => Promise<void>;
  inviteTeamMember: (orgId: string, payload: { email: string; role_id: string }) => Promise<void>;
  cancelInvitation: (orgId: string, invitationId: string) => Promise<void>;
  loadDataSources: (projectId?: string) => Promise<void>;

  // Reset
  reset: () => void;
}

const initialState = {
  activeTab: 'general',
  isEditingProfile: false,
  showApiKey: {},
  showProviderKeyModal: false,
  editingProvider: null,
  loading: false,
  fetching: false,
  profile: null,
  securitySettings: null,
  notificationSettings: null,
  appearanceSettings: null,
  apiKeys: [],
  providerApiKeys: {},
  aiModelPreference: '',
  availableModels: [],
  teamMembers: [],
  availableRoles: [],
  dataSources: [],
  memberSearch: '',
  memberStatusFilter: 'all' as const,
  dataSourceSearch: '',
  dataSourceStatusFilter: 'all' as const,
};

export const useSettingsStore = create<SettingsState>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // UI Actions
      setActiveTab: (tab) =>
        set((state) => {
          state.activeTab = tab;
        }),
      setIsEditingProfile: (value) =>
        set((state) => {
          state.isEditingProfile = value;
        }),
      toggleApiKeyVisibility: (keyId) =>
        set((state) => {
          state.showApiKey[keyId] = !state.showApiKey[keyId];
        }),
      setShowProviderKeyModal: (show) =>
        set((state) => {
          state.showProviderKeyModal = show;
        }),
      setEditingProvider: (provider) =>
        set((state) => {
          state.editingProvider = provider;
        }),
      setMemberSearch: (search) =>
        set((state) => {
          state.memberSearch = search;
        }),
      setMemberStatusFilter: (filter) =>
        set((state) => {
          state.memberStatusFilter = filter;
        }),
      setDataSourceSearch: (search) =>
        set((state) => {
          state.dataSourceSearch = search;
        }),
      setDataSourceStatusFilter: (filter) =>
        set((state) => {
          state.dataSourceStatusFilter = filter;
        }),

      // Data Actions
      loadSettingsByTab: async (tab: string, orgId?: string, options?: { projectId?: string }) => {
        set((state) => {
          state.fetching = true;
        });
        try {
          switch (tab) {
            case 'general':
              // General tab loads its own settings via GeneralTab
              break;
            case 'profile':
              await get().loadProfile();
              break;
            case 'security':
              await get().loadSecuritySettings();
              break;
            case 'notifications':
              await get().loadNotificationSettings();
              break;
            case 'api-keys':
              await Promise.all([
                get().loadApiKeys(),
                get().loadProviderApiKeys(),
                get().loadAiModelPreference(),
                get().loadAvailableModels(),
              ]);
              break;
            case 'team':
              if (orgId) await get().loadTeamMembers(orgId);
              break;
            case 'data-sources':
              await get().loadDataSources();
              break;
          }
        } catch (error) {
          console.error(`Failed to load settings for tab ${tab}:`, error);
        } finally {
          set((state) => {
            state.fetching = false;
          });
        }
      },

      loadProfile: async () => {
        try {
          const data = await fetchApi('users/profile', { method: 'GET' });
          set((state) => {
            state.profile = data;
          });
        } catch (error) {
          console.error('Failed to load profile:', error);
        }
      },

      updateProfile: async (payload) => {
        set((state) => {
          state.loading = true;
        });
        try {
          const result = await fetchApi('users/profile', {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          set((state) => {
            state.profile = { ...state.profile, ...(result?.updated || result), success: result?.success };
            state.isEditingProfile = false;
          });
        } catch (error) {
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadSecuritySettings: async () => {
        try {
          const data = await fetchApi('users/settings', { method: 'GET' });
          set((state) => {
            state.securitySettings = (data?.settings ?? data) as SecuritySettings;
          });
        } catch (error) {
          console.error('Failed to load security settings:', error);
        }
      },

      updateSecuritySettings: async (data) => {
        set((state) => {
          state.loading = true;
        });
        try {
          const updated = await fetchApi('users/settings', {
            method: 'PATCH',
            body: JSON.stringify(data),
          });
          set((state) => {
            state.securitySettings = (updated?.settings ?? updated) as SecuritySettings;
          });
        } catch (error) {
          console.error('Failed to update security settings:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadNotificationSettings: async () => {
        try {
          const data = await fetchApi('users/settings/notifications', { method: 'GET' });
          set((state) => {
            state.notificationSettings = data;
          });
        } catch (error) {
          console.error('Failed to load notification settings:', error);
        }
      },

      updateNotificationSettings: async (data) => {
        set((state) => {
          state.loading = true;
        });
        try {
          const updated = await fetchApi('users/settings/notifications', {
            method: 'PUT',
            body: JSON.stringify(data),
          });
          set((state) => {
            state.notificationSettings = updated;
          });
        } catch (error) {
          console.error('Failed to update notification settings:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadAppearanceSettings: async () => {
        try {
          const data = await fetchApi('users/settings', { method: 'GET' });
          set((state) => {
            state.appearanceSettings = (data?.settings ?? data) as AppearanceSettings;
          });
        } catch (error) {
          console.error('Failed to load appearance settings:', error);
        }
      },

      updateAppearanceSettings: async (data) => {
        set((state) => {
          state.loading = true;
        });
        try {
          const updated = await fetchApi('users/settings', {
            method: 'PATCH',
            body: JSON.stringify(data),
          });
          set((state) => {
            state.appearanceSettings = (updated?.settings ?? updated) as AppearanceSettings;
          });
        } catch (error) {
          console.error('Failed to update appearance settings:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadApiKeys: async () => {
        try {
          const data = await fetchApi('users/api-keys', { method: 'GET' });
          const list = Array.isArray(data) ? data : (data?.items ?? []);
          set((state) => {
            state.apiKeys = list;
          });
        } catch (error) {
          console.error('Failed to load API keys:', error);
          set((state) => {
            state.apiKeys = [];
          });
        }
      },

      createApiKey: async (data) => {
        set((state) => {
          state.loading = true;
        });
        try {
          const created = await fetchApi('users/api-keys', {
            method: 'POST',
            body: JSON.stringify(data),
          });
          await get().loadApiKeys();
          return created as ApiKey;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      deleteApiKey: async (keyId) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`users/api-keys/${keyId}`, { method: 'DELETE' });
          set((state) => {
            state.apiKeys = state.apiKeys.filter((key) => key.id !== keyId);
          });
        } catch (error) {
          console.error('Failed to delete API key:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadProviderApiKeys: async () => {
        try {
          const data = await fetchApi('users/ai-provider-keys', { method: 'GET' });
          set((state) => {
            state.providerApiKeys =
              data && typeof data === 'object' && !Array.isArray(data) ? (data as ProviderApiKeys) : {};
          });
        } catch (error) {
          console.error('Failed to load provider API keys:', error);
        }
      },

      saveProviderKey: async (provider, data) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`users/ai-provider-keys/${provider}`, {
            method: 'PUT',
            body: JSON.stringify(data),
          });
          await get().loadProviderApiKeys();
          await get().loadAvailableModels();
          set((state) => {
            state.showProviderKeyModal = false;
            state.editingProvider = null;
          });
        } catch (error) {
          console.error('Failed to save provider key:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadAiModelPreference: async () => {
        try {
          const data = await fetchApi('users/preferences/ai-model', { method: 'GET' });
          set((state) => {
            state.aiModelPreference = data?.model_id || data?.model || '';
          });
        } catch (error) {
          console.error('Failed to load AI model preference:', error);
        }
      },

      updateAiModelPreference: async (model) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi('users/preferences/ai-model', {
            method: 'PUT',
            body: JSON.stringify({ model_id: model }),
          });
          set((state) => {
            state.aiModelPreference = model;
          });
        } catch (error) {
          console.error('Failed to update AI model preference:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadAvailableModels: async () => {
        try {
          const data = await fetchApi('ai/models', { method: 'GET' });
          const list = Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
          set((state) => {
            state.availableModels = list;
          });
        } catch (error) {
          console.error('Failed to load available models:', error);
        }
      },

      loadTeamMembers: async (orgId?: string) => {
        if (!orgId) return;
        set((state) => {
          state.loading = true;
        });
        try {
          const [membersData, invitesData] = await Promise.allSettled([
            fetchApi(`/organizations/${orgId}/members`),
            fetchApi(`/api/invitations/organizations/${orgId}`),
          ]);

          const rawMembers =
            membersData.status === 'fulfilled'
              ? (membersData.value as Array<{
                  user_id: string;
                  email: string | null;
                  username: string | null;
                  first_name?: string | null;
                  last_name?: string | null;
                  avatar_url?: string | null;
                  role_id: string;
                  role_name: string;
                  role_display_name: string;
                  assigned_at?: string;
                  is_active?: boolean;
                }>)
              : [];

          const members: TeamMember[] = (rawMembers || []).map((m) => ({
            user_id: m.user_id,
            email: m.email ?? m.username ?? m.user_id,
            first_name: m.first_name ?? undefined,
            last_name: m.last_name ?? undefined,
            avatar_url: m.avatar_url ?? null,
            role_id: m.role_id,
            role_name: m.role_name,
            role_display_name: m.role_display_name,
            assigned_at: m.assigned_at ?? '',
            is_active: m.is_active ?? true,
            status: 'active' as const,
          }));

          const rawInvites =
            invitesData.status === 'fulfilled'
              ? (invitesData.value as Array<{
                  id: string;
                  email: string;
                  role_id: string;
                  role_display_name: string;
                  invited_at?: string;
                  expires_at?: string;
                }>)
              : [];

          const pendingMembers: TeamMember[] = (rawInvites || []).map((inv) => ({
            user_id: inv.id,
            invitation_id: inv.id,
            email: inv.email,
            role_id: inv.role_id,
            role_name: '',
            role_display_name: inv.role_display_name,
            assigned_at: inv.invited_at ?? inv.expires_at ?? '',
            is_active: false,
            status: 'pending' as const,
          }));

          set((state) => {
            state.teamMembers = [...members, ...pendingMembers];
          });
        } catch (error) {
          console.error('Failed to load team members:', error);
          set((state) => {
            state.teamMembers = [];
          });
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadAvailableRoles: async (scope = 'organization') => {
        try {
          const data = await fetchApi(`/api/rbac/roles?scope=${scope}`);
          set((state) => {
            state.availableRoles = data || [];
          });
        } catch (error) {
          console.error('Failed to load available roles:', error);
          set((state) => {
            state.availableRoles = [];
          });
        }
      },

      updateTeamMemberRole: async (orgId, userId, roleId) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`/api/organizations/${orgId}/members/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ role_id: roleId }),
          });
          await get().loadTeamMembers(orgId);
        } catch (error) {
          console.error('Failed to update member role:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      removeTeamMember: async (orgId, userId) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`/api/organizations/${orgId}/members/${userId}`, {
            method: 'DELETE',
          });
          await get().loadTeamMembers(orgId);
        } catch (error) {
          console.error('Failed to remove member:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      inviteTeamMember: async (orgId, payload) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`/api/invitations/organizations/${orgId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (error) {
          console.error('Failed to invite member:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      cancelInvitation: async (orgId, invitationId) => {
        set((state) => {
          state.loading = true;
        });
        try {
          await fetchApi(`/api/invitations/organizations/${orgId}/${invitationId}`, {
            method: 'DELETE',
          });
          await get().loadTeamMembers(orgId);
        } catch (error) {
          console.error('Failed to cancel invitation:', error);
          throw error;
        } finally {
          set((state) => {
            state.loading = false;
          });
        }
      },

      loadDataSources: async (projectId?: string) => {
        try {
          // Settings is the organization-level control plane. Keep project_id only for legacy callers.
          const url = projectId
            ? `/api/data/sources?project_id=${encodeURIComponent(projectId)}&access_mode=manage`
            : '/api/data/sources?access_mode=manage';
          const data = await fetchApi(url, { method: 'GET' });
          const raw = data?.data_sources ?? data?.sources ?? (Array.isArray(data) ? data : []);
          const list = Array.isArray(raw) ? raw : [];
          set((state) => {
            state.dataSources = list.map((ds: Record<string, unknown>) => {
              const rawStatus = (ds?.connection_status ?? ds?.status ?? (ds?.is_active ? 'active' : ''))
                .toString()
                .toLowerCase();
              const status: 'connected' | 'failed' | 'pending' =
                rawStatus === 'active' || rawStatus === 'connected'
                  ? 'connected'
                  : rawStatus === 'error' || rawStatus === 'failed' || rawStatus === 'inactive'
                    ? 'failed'
                    : 'pending';
              return {
                id: String(ds?.id ?? ''),
                name: String(ds?.name ?? ''),
                type: String(ds?.type ?? ''),
                db_type: ds?.db_type != null ? String(ds.db_type) : undefined,
                status,
                connected_at: ds?.created_at != null ? String(ds.created_at) : undefined,
                last_sync: ds?.last_accessed != null ? String(ds.last_accessed) : undefined,
                error_message: ds?.error_message != null ? String(ds.error_message) : undefined,
              };
            });
          });
        } catch (error) {
          console.error('Failed to load data sources:', error);
          set((state) => {
            state.dataSources = [];
          });
        }
      },

      reset: () => set(initialState),
    })),
    { name: 'SettingsStore' }
  )
);
