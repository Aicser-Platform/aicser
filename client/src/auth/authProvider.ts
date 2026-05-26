import type { AuthActions } from '@/auth/types';
import { ceAuthActions } from '@/auth/ce/authActions';
import { eeAuthActions, supabaseAuthActions } from '@/ee';

export function getAuthActions(): AuthActions {
  if (process.env.NEXT_PUBLIC_EDITION === 'enterprise') {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return supabaseAuthActions;
    }
    return eeAuthActions;
  }
  return ceAuthActions;
}
