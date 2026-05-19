import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase: SupabaseClient | null = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

/**
 * Attach Supabase session Bearer to fetchApi (not the FastAPI auth_token JWT).
 * Community default: false — CE uses httpOnly auth_token cookie only.
 */
export function useSupabaseForApiAuth(): boolean {
  if (!supabase) return false
  if (process.env.NEXT_PUBLIC_USE_SUPABASE_AUTH === 'true') return true
  if (process.env.NEXT_PUBLIC_EDITION === 'enterprise') return true
  return false
}
