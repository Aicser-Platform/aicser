import type { AuthActions } from '@/auth/types';
import { ceAuthActions } from '@/auth/ce/authActions';
import { eeAuthActions } from '@/ee';

// CE only decides CE vs. EE. Which sub-provider EE itself uses (local vs.
// Supabase, via NEXT_PUBLIC_AUTH_PROVIDER) is EE's own decision — see
// ee/src/ee/auth/authActions.ts — so it isn't duplicated here.
export function getAuthActions(): AuthActions {
  if (process.env.NEXT_PUBLIC_EDITION === 'enterprise') {
    return eeAuthActions;
  }
  return ceAuthActions;
}
