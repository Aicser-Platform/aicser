'use client';

import { create } from 'zustand';
import { getAuthActions } from '@/auth/authProvider';
import type { SignupResult } from '@/auth/types';
import { setCeBearerToken, getCeBearerToken } from '@/auth/ce/bearerToken';

interface AppUser {
  id: string;
  email: string;
  username?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  access_token?: string;
  [key: string]: unknown;
}

export interface AuthState {
  user: AppUser | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  actionLoading: boolean;
  loginError: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
  setLoginError: (v: string | null) => void;
  setSession: (session: AuthSession | null) => void;
  init: () => () => void;
}

function userFromMePayload(j: {
  id?: unknown;
  email?: unknown;
  username?: unknown;
}): AppUser | null {
  if (j?.id == null) return null;
  return {
    id: String(j.id),
    email: String(j.email ?? ''),
    username: j.username != null ? String(j.username) : undefined,
  };
}

function meHeaders(): HeadersInit {
  const h: Record<string, string> = {};
  const ce = getCeBearerToken();
  if (ce) h['Authorization'] = `Bearer ${ce}`;
  return h;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  session: null,
  isAuthenticated: false,
  authLoading: true,
  actionLoading: false,
  loginError: null,

  init: () => {
    fetch('/api/auth/me', { credentials: 'include', headers: meHeaders() })
      .then(async (res) => {
        if (!res.ok) return null;
        const j = (await res.json()) as { access_token?: string; id?: unknown };
        if (typeof j.access_token === 'string' && j.access_token) setCeBearerToken(j.access_token);
        return userFromMePayload(j);
      })
      .then((user) => {
        set({ user: user ?? null, isAuthenticated: !!user, authLoading: false });
      })
      .catch(() => {
        set({ authLoading: false });
      });
    return () => {};
  },

  login: async (email, password) => {
    set({ loginError: null, actionLoading: true });
    try {
      await getAuthActions().login(email, password);
      const res = await fetch('/api/auth/me', { credentials: 'include', headers: meHeaders() });
      const j = res.ok ? ((await res.json()) as { access_token?: string; id?: unknown }) : {};
      if (typeof j.access_token === 'string' && j.access_token) setCeBearerToken(j.access_token);
      const user = userFromMePayload(j);
      set({ user, isAuthenticated: !!user });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      set({ loginError: msg });
      throw e;
    } finally {
      set({ actionLoading: false });
    }
  },

  signup: async (email, username, password) => {
    set({ loginError: null, actionLoading: true });
    try {
      const result = await getAuthActions().signup(email, username, password);
      if (result.is_verified) {
        const res = await fetch('/api/auth/me', { credentials: 'include', headers: meHeaders() });
        const j = res.ok ? ((await res.json()) as { access_token?: string; id?: unknown }) : {};
        if (typeof j.access_token === 'string' && j.access_token) setCeBearerToken(j.access_token);
        const user = userFromMePayload(j);
        set({ user, isAuthenticated: !!user });
      }
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Signup failed';
      set({ loginError: msg });
      throw e;
    } finally {
      set({ actionLoading: false });
    }
  },

  logout: async () => {
    await getAuthActions().logout();
    set({ user: null, isAuthenticated: false });
  },

  setLoginError: (v) => set({ loginError: v }),
  setSession: (session) => set({ session }),
}));

export const useAuth = useAuthStore;
