'use client';

import { create } from 'zustand';
import { getAuthActions } from '@/auth/authProvider';
import type { SignupResult } from '@/auth/types';
import { setCeBearerToken, getCeBearerToken, clearCeBearerToken } from '@/auth/ce/bearerToken';
import { resetWorkspaceScope } from '@/utils/resetWorkspaceScope';
import { getEeApiAuthToken } from '@/ee';
import {
  beginLogout,
  endLogout,
  canAcceptAuthSession,
  getLogoutEpoch,
  isStaleLogoutEpoch,
  clearIntentionalLogout,
} from '@/auth/logoutBarrier';

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
  clearLoginError: () => void;
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

async function ensureAicserBearerFromEeSession(): Promise<void> {
  if (!canAcceptAuthSession()) return;
  if (getCeBearerToken()) return;
  const epochAtStart = getLogoutEpoch();
  const providerToken = await getEeApiAuthToken().catch(() => null);
  if (!providerToken) return;
  if (!canAcceptAuthSession() || isStaleLogoutEpoch(epochAtStart)) return;

  const res = await fetch('/api/auth/token-exchange', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'supabase', token: providerToken }),
  });
  if (!res.ok) return;
  if (!canAcceptAuthSession() || isStaleLogoutEpoch(epochAtStart)) return;

  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (data.access_token && canAcceptAuthSession() && !isStaleLogoutEpoch(epochAtStart)) {
    setCeBearerToken(data.access_token);
  }
}

async function fetchMeWithRetry(maxAttempts = 4): Promise<AppUser | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!canAcceptAuthSession()) return null;
    try {
      await ensureAicserBearerFromEeSession();
      if (!canAcceptAuthSession()) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: meHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!canAcceptAuthSession()) return null;
      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error(`auth/me ${res.status}`);
      }
      const j = (await res.json()) as { access_token?: string; id?: unknown };
      if (!canAcceptAuthSession()) return null;
      if (typeof j.access_token === 'string' && j.access_token) {
        setCeBearerToken(j.access_token);
      }
      return userFromMePayload(j);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }
  if (lastError) console.warn('[auth] /api/auth/me failed after retries:', lastError);
  return null;
}

function sessionFromBearer(): AuthSession | null {
  const ce = getCeBearerToken();
  return ce ? { access_token: ce } : null;
}

/** Cancels the active init() fetch when logout starts. */
let cancelActiveInit: (() => void) | null = null;

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  session: null,
  isAuthenticated: false,
  authLoading: true,
  actionLoading: false,
  loginError: null,

  init: () => {
    let cancelled = false;
    cancelActiveInit = () => {
      cancelled = true;
    };
    fetchMeWithRetry()
      .then((user) => {
        if (cancelled || !canAcceptAuthSession()) return;
        set((state) => {
          if (user) {
            return { user, isAuthenticated: true, authLoading: false, session: sessionFromBearer() };
          }
          // Keep session from a recent login if /me failed transiently (backend reload).
          // Never keep it across an intentional logout (bearer already cleared).
          if (state.isAuthenticated && state.user && getCeBearerToken()) {
            return { authLoading: false };
          }
          return { user: null, isAuthenticated: false, authLoading: false, session: null };
        });
      })
      .catch(() => {
        if (cancelled || !canAcceptAuthSession()) return;
        set((state) =>
          state.isAuthenticated && state.user && getCeBearerToken()
            ? { authLoading: false }
            : { authLoading: false, isAuthenticated: false, user: null, session: null }
        );
      });
    return () => {
      cancelled = true;
      if (cancelActiveInit) cancelActiveInit = null;
    };
  },

  login: async (email, password) => {
    set({ loginError: null, actionLoading: true });
    try {
      await getAuthActions().login(email, password);
      clearIntentionalLogout();
      resetWorkspaceScope();
      const res = await fetch('/api/auth/me', { credentials: 'include', headers: meHeaders() });
      const j = res.ok ? ((await res.json()) as { access_token?: string; id?: unknown }) : {};
      if (typeof j.access_token === 'string' && j.access_token) setCeBearerToken(j.access_token);
      const user = userFromMePayload(j);
      set({ user, isAuthenticated: !!user, session: sessionFromBearer() });
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
        clearIntentionalLogout();
        resetWorkspaceScope();
        const res = await fetch('/api/auth/me', { credentials: 'include', headers: meHeaders() });
        const j = res.ok ? ((await res.json()) as { access_token?: string; id?: unknown }) : {};
        if (typeof j.access_token === 'string' && j.access_token) setCeBearerToken(j.access_token);
        const user = userFromMePayload(j);
        set({ user, isAuthenticated: !!user, session: sessionFromBearer() });
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
    const epoch = beginLogout();
    cancelActiveInit?.();
    clearCeBearerToken();
    set({ user: null, isAuthenticated: false, session: null, authLoading: false });
    try {
      await getAuthActions().logout();
    } finally {
      // Defeat late token-exchange that raced during provider signOut
      clearCeBearerToken();
      resetWorkspaceScope();
      set({ user: null, isAuthenticated: false, session: null, authLoading: false });
      endLogout(epoch);
    }
  },

  setLoginError: (v) => set({ loginError: v }),
  clearLoginError: () => set({ loginError: null }),
  setSession: (session) => set({ session }),
}));

export const useAuth = useAuthStore;
