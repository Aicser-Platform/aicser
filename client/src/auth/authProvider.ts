import type { AuthActions } from '@/auth/types';
import { ceAuthActions } from '@/auth/ce/authActions';
import { eeAuthActions } from '@/ee';
import { supabaseAuthActions } from '@/auth/supabaseAuthActions';

export function getAuthActions(): AuthActions {
  if (process.env.NEXT_PUBLIC_EDITION === 'enterprise') {
    // Prefer Supabase auth when SUPABASE_URL is configured
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return supabaseAuthActions;
    }
    return eeAuthActions;
  }
  return ceAuthActions;
}
