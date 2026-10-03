import { createClient } from '@supabase/supabase-js'

// Supabase project credentials (public — the anon key is safe in the browser
// because RLS enforces access). Set these in client/.env:
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, anon)

/** The current access token (JWT) for the logged-in user, or null. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
