import { supabase, useSupabaseForApiAuth } from '@/auth/authClient'
import { getCeBearerToken } from '@/auth/ce/bearerToken'

/** Set password for the current session: Supabase when opted in, else FastAPI JWT cookie. */
export async function updateUserPassword(password: string): Promise<void> {
  if (useSupabaseForApiAuth() && supabase) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    return
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const ce = getCeBearerToken()
  if (ce) headers['Authorization'] = `Bearer ${ce}`
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    let detail = 'Failed to update password'
    try {
      const data = (await res.json()) as { detail?: string | { message?: string } }
      if (typeof data.detail === 'string') detail = data.detail
      else if (
        data.detail &&
        typeof data.detail === 'object' &&
        typeof (data.detail as { message?: string }).message === 'string'
      ) {
        detail = (data.detail as { message: string }).message
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
}
