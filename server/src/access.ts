import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Access resolution for the COLLABORATION RELAY only.
 *
 * In scope C, RLS enforces access for all Postgres-backed data the client
 * touches directly. But the Yjs/LevelDB document content is outside Postgres,
 * reached over the WebSocket relay — RLS cannot guard it. So the relay does its
 * own authorization: it asks Supabase "what role does this user have on this
 * doc?" using the SERVICE ROLE key (which bypasses RLS — correct here, because
 * the relay is trusted server code performing the check itself, not a client).
 */

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER' | 'MANAGER'
export type Access = { role: Role } | null

let client: SupabaseClient | null = null
function supa(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

export async function getAccess(userId: string, documentId: string): Promise<Access> {
  const db = supa()

  const { data: doc } = await db
    .from('document')
    .select('owner_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return null
  if (doc.owner_id === userId) return { role: 'OWNER' }

  const { data: membership } = await db
    .from('membership')
    .select('role')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return null
  return { role: membership.role as Role }
}

/** Edit rights: owner, editor, or manager (not viewer). */
export function canEdit(access: Access): boolean {
  return (
    access?.role === 'OWNER' || access?.role === 'EDITOR' || access?.role === 'MANAGER'
  )
}
