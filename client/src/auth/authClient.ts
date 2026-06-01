import type { SupabaseClient } from '@supabase/supabase-js';

// CE stub: no Supabase connection in Community Edition.
// EE overrides this via ee/src/ee/auth/authClient.ts (real Supabase client).
export const supabase: SupabaseClient | null = null;

export function useSupabaseForApiAuth(): boolean {
  return false;
}

export function isSupabaseAuthConfigured(): boolean {
  return false;
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  return null;
}

export async function getEeApiAuthToken(): Promise<string | null> {
  return null;
}

export async function updateEeUserPassword(_password: string): Promise<boolean> {
  return false;
}
