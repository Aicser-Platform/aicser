import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fetchApi } from '@/utils/api';

export interface UserProfile {
  id: string;
  user_id: string;
  is_pro: boolean;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  company: string | null;
  location: string | null;
  timezone: string | null;
  bio: string | null;
  job_role: string | null;
  industry: string | null;
  company_size: string | null;
  data_experience: string | null;
  primary_use_case: string | null;
  data_frequency: string | null;
  goals: any[] | null;
  onboarding_completed_at: string | null;
  avatar_url: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_status: string | null;
}

/** Minimal profile used for author attribution in multi-user conversations */
export interface AuthorProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface ProfileStoreState {
  profile: UserProfile | null;
  loading: boolean;
  updating: boolean;
  error: string | null;
  /** Cache of other users' profiles keyed by user_id — for multi-user conversation display */
  userProfiles: Record<string, AuthorProfile>;

  fetchProfile: () => Promise<UserProfile | null>;
  updateProfile: (data: Partial<UserProfile>) => Promise<boolean>;
  uploadAvatar: (file: File) => Promise<string | null>;
  /** Fetch and cache minimal profiles for a list of user_ids (skips already-cached ones) */
  fetchUserProfiles: (userIds: string[]) => Promise<void>;
  generateTelegramLink: () => Promise<string | null>;
  reset: () => void;
}

export const useProfileStore = create<ProfileStoreState>()(
  devtools(
    (set, get) => ({
      profile: null,
      loading: false,
      updating: false,
      error: null,
      userProfiles: {},

      fetchProfile: async () => {
        set({ loading: true, error: null });
        try {
          const data = await fetchApi('/users/profile');

          if (data) {
            const userProfile: UserProfile = {
              id: data.id || data.user_id || '',
              user_id: data.user_id || data.id || '',
              is_pro: Boolean(data.is_pro),
              email: data.email || '',
              username: data.username || null,
              first_name: data.first_name || null,
              last_name: data.last_name || null,
              phone_number: data.phone_number || null,
              company: data.company || null,
              location: data.location || null,
              timezone: data.timezone || null,
              bio: data.bio || null,
              job_role: data.job_role || null,
              industry: data.industry || null,
              company_size: data.company_size || null,
              data_experience: data.data_experience || null,
              primary_use_case: data.primary_use_case || null,
              data_frequency: data.data_frequency || null,
              goals: data.goals || null,
              onboarding_completed_at: data.onboarding_completed_at || null,
              avatar_url: data.avatar_url || null,
              telegram_chat_id: data.telegram_chat_id || null,
              telegram_username: data.telegram_username || null,
              telegram_status: data.telegram_status || null,
            };
            set({ profile: userProfile, loading: false });
            return userProfile;
          }
          set({ loading: false });
          return null;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to fetch profile';
          set({ error: msg, loading: false });
          return null;
        }
      },

      updateProfile: async (data: Partial<UserProfile>) => {
        set({ updating: true, error: null });
        try {
          await fetchApi('/users/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
          });

          set((state) => ({
            profile: state.profile ? { ...state.profile, ...data } : null,
            updating: false,
          }));
          return true;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to update profile';
          set({ error: msg, updating: false });
          return false;
        }
      },

      uploadAvatar: async (file: File) => {
        set({ updating: true, error: null });
        try {
          const formData = new FormData();
          formData.append('file', file);

          const updated: UserProfile = await fetchApi('/api/users/profile/avatar', {
            method: 'POST',
            body: formData,
          });

          set((state) => ({
            profile: state.profile ? { ...state.profile, avatar_url: updated.avatar_url } : null,
            updating: false,
          }));
          return updated.avatar_url;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to upload avatar';
          set({ error: msg, updating: false });
          return null;
        }
      },

      reset: () => set({ profile: null, loading: false, updating: false, error: null, userProfiles: {} }),

      generateTelegramLink: async () => {
        set({ updating: true, error: null });
        try {
          const res = await fetchApi('/telegram/link-token');
          set({ updating: false });
          if (res?.success) {
            return res.link_url as string;
          }
          return null;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to generate link';
          set({ error: msg, updating: false });
          return null;
        }
      },

      fetchUserProfiles: async (userIds: string[]) => {
        const { userProfiles } = get();
        // Only fetch IDs not already in cache
        const missing = userIds.filter((id) => id && !userProfiles[id]);
        if (missing.length === 0) return;
        try {
          const qs = missing.join(',');
          const data: AuthorProfile[] = await fetchApi(`/users/bulk-profiles?user_ids=${encodeURIComponent(qs)}`);
          if (Array.isArray(data)) {
            const updates: Record<string, AuthorProfile> = {};
            data.forEach((p) => {
              if (p.user_id) updates[p.user_id] = p;
            });
            set((state) => ({ userProfiles: { ...state.userProfiles, ...updates } }));
          }
        } catch (err) {
          // Non-critical: silently ignore fetch failures
        }
      },
    }),
    { name: 'ProfileStore' }
  )
);
